/**
 * Synthetic scene generator with known ground truth.
 *
 * These fixtures are SYNTHETIC and every one of them carries `synthetic: true`,
 * which the UI renders as a persistent badge and the PDF prints as a line. They
 * exist because real Sentinel-2/Landsat rasters cannot be fetched from this
 * machine — see docs/DATA.md for the exact swap procedure.
 *
 * What is real here: the school names, the OSM way IDs, and the yard polygons,
 * which are genuine OpenStreetMap geometry projected to UTM 12N.
 * What is synthetic: the pixel values.
 *
 * Design rule that makes these fixtures worth having: the generator emits
 * *reflectance and thermal digital numbers*, not NDVI and not temperature. The
 * core pipeline then derives NDVI, radiance, brightness temperature, emissivity
 * and LST exactly as it would from a real scene. The fixture cannot hide a bug
 * in that chain, because it never computes any part of it.
 *
 * Ground truth is planted by construction: a target LST~NDVI slope is imposed
 * on the thermal field, so a test can assert the recovered β₁ matches the
 * planted β₁ within the noise. That is a real end-to-end check of the
 * regression, not a tautology.
 */

import type { Rng } from './prng.js';
import { mulberry32 } from './prng.js';
import { fractalField, type Field } from './field.js';

export interface SceneSpec {
  readonly slug: string;
  readonly seed: number;
  /** Fine (optical) grid size in pixels, 10 m each. */
  readonly fineSize: number;
  /** Thermal grid size in pixels, 100 m each. */
  readonly thermalSize: number;
  /** UTM easting/northing of the grid origin (top-left outer corner). */
  readonly originX: number;
  readonly originY: number;
  readonly epsg: number;
  /** Mean NDVI of the neighbourhood — sets the climate character. */
  readonly ndviMean: number;
  /** NDVI spread. Arid sites are low-mean, low-spread. */
  readonly ndviSpread: number;
  /** Fraction of the yard to force to dense canopy, 0..1. */
  readonly yardCanopyTarget: number;
  /** LST in °C at NDVI = 0 — the hot bare-surface intercept. */
  readonly lstIntercept: number;
  /** Planted regression slope, °C per NDVI unit. Negative = vegetation cools. */
  readonly lstSlope: number;
  /**
   * Target R² for the neighbourhood fit. Noise σ is derived from this and the
   * signal's own variance, so the fixture's fit quality is declared rather than
   * discovered. Set below 0.30 to build a fixture that must suppress.
   */
  readonly targetR2: number;
  /** Cloud coverage fraction over the yard, 0..1. Drives the failure fixture. */
  readonly cloudFraction: number;
}

export interface RasterOut {
  readonly width: number;
  readonly height: number;
  /** Row-major values. */
  readonly data: number[];
}

export interface SceneOut {
  /** Sentinel-2 B4 reflectance, 10 m. */
  readonly red: RasterOut;
  /** Sentinel-2 B8 reflectance, 10 m. */
  readonly nir: RasterOut;
  /** Landsat B10 thermal digital numbers, 100 m. */
  readonly thermalDn: RasterOut;
  /** Landsat QA_PIXEL bitmask, 100 m. */
  readonly qa: RasterOut;
  /** The planted values, so tests can assert recovery. */
  readonly groundTruth: {
    readonly plantedSlope: number;
    readonly plantedIntercept: number;
    readonly targetR2: number;
    /** Noise σ in °C, derived from targetR2 and the signal variance. */
    readonly derivedNoiseSdC: number;
    /** SD of the area-averaged NDVI across thermal cells. */
    readonly ndviCellSd: number;
    readonly cloudFraction: number;
  };
}

/** Landsat 9 B10 constants used to invert °C back to a digital number. */
export interface ThermalCalibration {
  readonly radianceMult: number;
  readonly radianceAdd: number;
  readonly k1: number;
  readonly k2: number;
}

export const L9_B10: ThermalCalibration = {
  radianceMult: 3.8e-4,
  radianceAdd: 0.1,
  k1: 799.0284,
  k2: 1329.2405,
};

const KELVIN = 273.15;
const LAMBDA_M = 10.895e-6;
const RHO_M_K = 1.438e-2;

/** Emissivity from NDVI, matching the core's Sobrino derivation. */
function emissivityFromNdvi(ndvi: number): number {
  const r = Math.min(1, Math.max(0, (ndvi - 0.2) / 0.3));
  return 0.004 * r * r + 0.986;
}

/**
 * Invert the core's LST chain to a thermal digital number.
 *
 * The generator must produce DN, because DN is what a real scene contains. This
 * runs the physics backwards: °C → LST(K) → BT(K) → radiance → DN. If the
 * core's forward chain is correct, feeding it this DN returns the °C we started
 * from — which is exactly what the round-trip test asserts.
 */
export function celsiusToThermalDn(
  targetC: number,
  ndvi: number,
  cal: ThermalCalibration,
): number {
  const lstK = targetC + KELVIN;
  const emis = emissivityFromNdvi(ndvi);
  // LST = BT / (1 + (λ·BT/ρ)·ln ε)  →  solve for BT.
  // Let c = (λ/ρ)·ln ε, then LST = BT/(1 + c·BT) → BT = LST/(1 − c·LST).
  const c = (LAMBDA_M / RHO_M_K) * Math.log(emis);
  const bt = lstK / (1 - c * lstK);
  // BT = K₂/ln(K₁/L + 1)  →  L = K₁/(exp(K₂/BT) − 1)
  const radiance = cal.k1 / (Math.exp(cal.k2 / bt) - 1);
  // L = M·DN + A  →  DN = (L − A)/M
  return (radiance - cal.radianceAdd) / cal.radianceMult;
}

/** Reflectance pair that yields a target NDVI at a plausible brightness. */
function reflectanceForNdvi(ndvi: number, brightness: number): [number, number] {
  // NDVI = (nir − red)/(nir + red), with nir + red = 2·brightness.
  const sum = 2 * brightness;
  const nir = (sum * (1 + ndvi)) / 2;
  const red = (sum * (1 - ndvi)) / 2;
  return [Math.max(0, nir), Math.max(0, red)];
}

/** QA bits, matching the core's mask module. */
const QA_CLOUD = 1 << 3;
const QA_DILATED = 1 << 1;

export interface YardTest {
  /** True when a fine-grid pixel centre lies inside the yard polygon. */
  (x: number, y: number): boolean;
}

/**
 * Generate one scene.
 *
 * @param inYard predicate in projected metres, used to raise canopy inside the
 *               yard and to place the cloud over it for the failure fixture
 */
export function generateScene(spec: SceneSpec, inYard: YardTest): SceneOut {
  const rng: Rng = mulberry32(spec.seed);
  const ndviField: Field = fractalField(rng, [3, 7, 17]);
  const brightField: Field = fractalField(rng, [5, 11]);
  // A separate field decides WHERE crowns sit. It must be independent of the
  // field that sets NDVI magnitude, or the canopy mask saturates to all-or-
  // nothing instead of producing a realistic patchy yard.
  //
  // The lattice is fine (61/149) because a recess yard is only ~130 m across —
  // about 13 fine pixels. A coarse field would put the entire yard inside a
  // single lobe, giving 0% or 100% canopy and never a realistic value.
  const crownField: Field = fractalField(rng, [61, 149]);

  const fine = spec.fineSize;
  const red: number[] = new Array(fine * fine).fill(0);
  const nir: number[] = new Array(fine * fine).fill(0);

  // A per-pixel NDVI surface, held for the thermal step so the two are
  // physically consistent rather than independently random.
  const ndviGrid: number[] = new Array(fine * fine).fill(0);

  // Pass 1 — locate the yard's fine pixels and pick the crown-field cutoff that
  // realises the requested canopy fraction.
  //
  // A raw threshold on the crown field does NOT work: summed value noise is
  // bell-shaped around 0.5, so `crown < 0.09` almost never fires and an arid
  // yard comes back at 0% canopy while a shaded one lands near 50% by accident.
  // Taking the cutoff at the target QUANTILE of the field's own values inside
  // this yard makes the realised fraction match the target by construction, for
  // any target. Same technique as the cloud placement below.
  const yardCrown = new Map<number, number>();
  for (let row = 0; row < fine; row++) {
    for (let col = 0; col < fine; col++) {
      const x = spec.originX + (col + 0.5) * 10;
      const y = spec.originY - (row + 0.5) * 10;
      if (inYard(x, y)) {
        yardCrown.set(row * fine + col, crownField.at(col / fine, row / fine));
      }
    }
  }
  const sortedCrown = [...yardCrown.values()].sort((a, b) => a - b);
  const nCanopy = Math.round(sortedCrown.length * spec.yardCanopyTarget);
  const crownCutoff =
    nCanopy <= 0 ? -1 : sortedCrown[Math.min(nCanopy - 1, sortedCrown.length - 1)]!;

  for (let row = 0; row < fine; row++) {
    for (let col = 0; col < fine; col++) {
      const u = col / fine;
      const v = row / fine;
      const i = row * fine + col;

      let ndvi = spec.ndviMean + (ndviField.at(u, v) - 0.5) * 2 * spec.ndviSpread;

      const crown = yardCrown.get(i);
      if (crown !== undefined) {
        if (crown <= crownCutoff) {
          // A crown pixel: comfortably above any plausible canopy threshold.
          ndvi = 0.7 + (crown / Math.max(1e-6, crownCutoff)) * 0.12;
        } else {
          // Open yard: hot, bare surface — asphalt, decomposed granite, dirt.
          ndvi = Math.min(0.17, Math.max(0.02, ndvi * 0.55));
        }
      }

      ndvi = Math.min(0.92, Math.max(-0.05, ndvi));
      ndviGrid[i] = ndvi;

      // Brightness varies independently of NDVI, as it does in a real scene.
      const brightness = 0.12 + brightField.at(u, v) * 0.16;
      const [n, r] = reflectanceForNdvi(ndvi, brightness);
      nir[i] = +n.toFixed(6);
      red[i] = +r.toFixed(6);
    }
  }

  // Thermal grid, in two passes.
  //
  // Pass 1 area-averages the fine NDVI onto each thermal cell. Pass 2 imposes
  // the planted linear relationship and adds noise.
  //
  // The noise σ is DERIVED from the signal's own standard deviation to hit a
  // declared target R², rather than guessed. For a linear fit with Gaussian
  // noise, R² ≈ s²/(s² + σ²) where s = |β₁|·sd(NDVI_cell), so
  // σ = s·sqrt((1−R²)/R²). This makes "this fixture fits at R² ≈ 0.72" a stated
  // property of the fixture instead of an accident of hand-tuned constants —
  // and it is exactly why fixture R² must never be read as evidence about the
  // real world. The ground truth records the target so a test can assert it.
  const th = spec.thermalSize;
  const perCell = Math.round(fine / th);
  const cellNdvi: number[] = new Array(th * th).fill(0);

  for (let row = 0; row < th; row++) {
    for (let col = 0; col < th; col++) {
      let sum = 0;
      let n = 0;
      for (let fr = row * perCell; fr < (row + 1) * perCell; fr++) {
        for (let fc = col * perCell; fc < (col + 1) * perCell; fc++) {
          sum += ndviGrid[fr * fine + fc]!;
          n++;
        }
      }
      cellNdvi[row * th + col] = n > 0 ? sum / n : 0;
    }
  }

  let ndviSum = 0;
  for (const v of cellNdvi) ndviSum += v;
  const ndviCellMean = ndviSum / cellNdvi.length;
  let ndviSS = 0;
  for (const v of cellNdvi) ndviSS += (v - ndviCellMean) ** 2;
  const ndviCellSd = Math.sqrt(ndviSS / Math.max(1, cellNdvi.length - 1));

  const signalSd = Math.abs(spec.lstSlope) * ndviCellSd;
  const r2 = Math.min(0.99, Math.max(0.01, spec.targetR2));
  const noiseSd = signalSd * Math.sqrt((1 - r2) / r2);

  const thermalDn: number[] = new Array(th * th).fill(0);
  const qa: number[] = new Array(th * th).fill(0);

  for (let i = 0; i < cellNdvi.length; i++) {
    const nd = cellNdvi[i]!;
    const targetC = spec.lstIntercept + spec.lstSlope * nd + rng.normal() * noiseSd;
    thermalDn[i] = Math.round(celsiusToThermalDn(targetC, nd, L9_B10));
  }

  // Cloud placement: a contiguous blob over the yard, so the masked fraction is
  // realistic rather than salt-and-pepper.
  //
  // The blob is sized in METRES around the yard centroid, not as a quantile of
  // the yard's own thermal cells. A 9,000 m² recess yard intersects only one or
  // two 100 m cells, so a quantile approach rounds to zero cells and silently
  // produces no cloud at all — which would make the failure fixture stop
  // failing. Real cloud is hundreds of metres across regardless of yard size.
  if (spec.cloudFraction > 0) {
    const cloudField = fractalField(mulberry32(spec.seed ^ 0x5eed), [2, 5]);

    // Yard centroid on the thermal grid.
    let sx = 0;
    let sy = 0;
    let count = 0;
    for (let row = 0; row < th; row++) {
      for (let col = 0; col < th; col++) {
        const x = spec.originX + (col + 0.5) * 100;
        const y = spec.originY - (row + 0.5) * 100;
        if (inYard(x, y)) {
          sx += x;
          sy += y;
          count++;
        }
      }
    }
    // Fall back to the grid centre if the yard misses every cell centre.
    const cx = count > 0 ? sx / count : spec.originX + (th * 100) / 2;
    const cy = count > 0 ? sy / count : spec.originY - (th * 100) / 2;

    // Cloud radius scaled by the requested fraction. Deliberately sized to
    // occlude PART of the yard: a partial mask is far more convincing on camera
    // than a total blackout, and it exercises the coverage ratio rather than
    // just the empty case. Offset from the centroid for the same reason.
    const radiusM = 210 * Math.sqrt(Math.max(0.05, spec.cloudFraction));
    const offsetM = radiusM * 0.85;

    for (let row = 0; row < th; row++) {
      for (let col = 0; col < th; col++) {
        const x = spec.originX + (col + 0.5) * 100;
        const y = spec.originY - (row + 0.5) * 100;
        const d = Math.hypot(x - (cx + offsetM), y - (cy + offsetM * 0.4));
        // Ragged edge from the noise field, so the mask is not a perfect disc.
        const edge = 0.75 + cloudField.at(col / th, row / th) * 0.5;
        if (d <= radiusM * edge) {
          qa[row * th + col] = QA_CLOUD | QA_DILATED;
        }
      }
    }
  }

  return {
    red: { width: fine, height: fine, data: red },
    nir: { width: fine, height: fine, data: nir },
    thermalDn: { width: th, height: th, data: thermalDn },
    qa: { width: th, height: th, data: qa },
    groundTruth: {
      plantedSlope: spec.lstSlope,
      plantedIntercept: spec.lstIntercept,
      targetR2: spec.targetR2,
      derivedNoiseSdC: +noiseSd.toFixed(4),
      ndviCellSd: +ndviCellSd.toFixed(4),
      cloudFraction: spec.cloudFraction,
    },
  };
}
