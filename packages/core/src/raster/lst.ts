/**
 * LST — Land Surface Temperature from Landsat 8/9 Band 10. §4.3.
 *
 * Four steps, each a pure function, each unit-tested against a known value:
 *
 *   1. DN → TOA spectral radiance     L_λ = M_L · Q_cal + A_L
 *   2. radiance → brightness temp     BT  = K₂ / ln(K₁/L_λ + 1)
 *   3. NDVI → emissivity              P_v = ((NDVI−0.2)/(0.5−0.2))²,  ε = 0.004·P_v + 0.986
 *   4. emissivity-corrected LST       LST = BT / (1 + (λ·BT/ρ)·ln ε)
 *
 * UNIT TRAP: step 4 requires BT in **Kelvin**. Feeding it °C produces
 * temperatures around 0.4 °C — plausible enough to ship, and wrong. Conversion
 * to °C happens once, at the very end.
 */

import type { BoolGrid, Grid, MtlConstants } from '../types.js';
import { makeGrid, sameShape } from '../types.js';

/** Band 10 centre wavelength, in metres (10.895 µm). */
export const LAMBDA_B10_M = 10.895e-6;

/**
 * ρ = h·c/σ = 1.438e-2 m·K
 * h = 6.626e-34 J·s (Planck), c = 2.998e8 m/s, σ = 1.38e-23 J/K (Boltzmann).
 */
export const RHO_M_K = 1.438e-2;

export const KELVIN_OFFSET = 273.15;

/** NDVI bounds for the Sobrino proportion-of-vegetation method. */
export const NDVI_MIN_PV = 0.2;
export const NDVI_MAX_PV = 0.5;

/** Step 1 — digital number to top-of-atmosphere spectral radiance. */
export function toRadiance(dn: number, mult: number, add: number): number {
  return mult * dn + add;
}

/**
 * Step 2 — radiance to at-sensor brightness temperature, in **Kelvin**.
 *
 * Returns NaN for non-positive radiance: `ln(K₁/L + 1)` is undefined there, and
 * a masked or saturated thermal pixel must stay unknown rather than become a
 * number.
 */
export function toBrightnessTempK(radiance: number, k1: number, k2: number): number {
  if (!Number.isFinite(radiance) || radiance <= 0) return Number.NaN;
  const bt = k2 / Math.log(k1 / radiance + 1);
  return Number.isFinite(bt) ? bt : Number.NaN;
}

/** Step 3a — proportion of vegetation, clamped to [0, 1]. */
export function proportionVegetation(
  ndviValue: number,
  min: number = NDVI_MIN_PV,
  max: number = NDVI_MAX_PV,
): number {
  if (!Number.isFinite(ndviValue)) return Number.NaN;
  const ratio = (ndviValue - min) / (max - min);
  const clamped = Math.min(1, Math.max(0, ratio));
  return clamped * clamped;
}

/**
 * Step 3b — emissivity from proportion of vegetation.
 * ε ∈ [0.986, 0.990], the standard narrow range for mixed urban surfaces.
 */
export function emissivity(pv: number): number {
  if (!Number.isFinite(pv)) return Number.NaN;
  return 0.004 * pv + 0.986;
}

/**
 * Step 4 — emissivity-corrected land surface temperature, returned in **°C**.
 *
 * `btKelvin` must be Kelvin. See the unit trap at the top of this file.
 */
export function lstCelsius(btKelvin: number, emis: number): number {
  if (!Number.isFinite(btKelvin) || btKelvin <= 0) return Number.NaN;
  if (!Number.isFinite(emis) || emis <= 0) return Number.NaN;
  const lstK = btKelvin / (1 + (LAMBDA_B10_M * btKelvin / RHO_M_K) * Math.log(emis));
  if (!Number.isFinite(lstK) || lstK <= 0) return Number.NaN;
  return lstK - KELVIN_OFFSET;
}

/**
 * Full chain over a thermal DN grid, given co-registered NDVI already resampled
 * to the thermal grid. Output is °C, NaN where unknown.
 *
 * `dn` and `ndviOnThermalGrid` must be the same shape — resample NDVI first
 * with `resampleToThermal`, which area-averages rather than nearest-neighbours.
 */
export function lstGrid(dn: Grid, mtl: MtlConstants, ndviOnThermalGrid: Grid): Grid {
  if (!sameShape(dn, ndviOnThermalGrid)) {
    throw new Error(
      'lstGrid: thermal grid and NDVI grid are not co-registered — resample NDVI to the thermal grid first',
    );
  }
  const out = makeGrid(dn.width, dn.height, dn.transform);
  for (let i = 0; i < out.data.length; i++) {
    const rawDn = dn.data[i]!;
    const nd = ndviOnThermalGrid.data[i]!;
    if (Number.isNaN(rawDn) || Number.isNaN(nd)) {
      out.data[i] = Number.NaN;
      continue;
    }
    const radiance = toRadiance(rawDn, mtl.radianceMult, mtl.radianceAdd);
    const bt = toBrightnessTempK(radiance, mtl.k1, mtl.k2);
    const emis = emissivity(proportionVegetation(nd));
    out.data[i] = lstCelsius(bt, emis);
  }
  return out;
}

/** Count of valid (non-NaN) thermal pixels inside a mask — reported on screen. */
export function validPixelCount(lst: Grid, valid: BoolGrid): number {
  let n = 0;
  for (let i = 0; i < lst.data.length; i++) {
    if (valid.data[i] === 1 && !Number.isNaN(lst.data[i]!)) n++;
  }
  return n;
}
