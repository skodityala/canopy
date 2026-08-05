/**
 * NDVI — Normalized Difference Vegetation Index. §4.2.
 *
 *              NIR − RED
 *     NDVI  =  ─────────
 *              NIR + RED
 *
 * Sentinel-2 B8 (NIR, 842 nm) and B4 (red, 665 nm) at 10 m. A schoolyard is
 * 100–200 m across, so 10 m gives 100–400 pixels — enough to resolve individual
 * crowns. Landsat's 30 m would give 10–40, which is not enough.
 */

import type { BoolGrid, Grid } from '../types.js';
import { makeBoolGrid, makeGrid, sameShape } from '../types.js';

/**
 * Default canopy threshold. NDVI ≥ 0.60 is dense tree canopy.
 *
 * This is a *default*, not a constant to rely on: in arid climates irrigated
 * turf can exceed 0.6 and inflate the canopy figure. Every fixture carries its
 * own hand-validated `ndviCanopyThreshold`, and the chosen value is printed in
 * the PDF. See §4.2.
 */
export const DEFAULT_CANOPY_THRESHOLD = 0.6;

/**
 * NDVI for a single pixel.
 *
 * Returns `null` when the denominator is zero — a pixel with no signal in
 * either band is *unknown*. Not Infinity, not 0. Propagating that honestly into
 * the aggregate is the difference between a defensible number and a bogus one.
 */
export function ndvi(nir: number, red: number): number | null {
  if (!Number.isFinite(nir) || !Number.isFinite(red)) return null;
  const denom = nir + red;
  if (denom === 0) return null;
  const v = (nir - red) / denom;
  if (!Number.isFinite(v)) return null;
  // Reflectances are non-negative, so the ratio is mathematically bounded to
  // [-1, 1]; clamp defends against negative-reflectance atmospheric artefacts.
  return Math.min(1, Math.max(-1, v));
}

/** Per-pixel NDVI over a pair of co-registered reflectance grids. Null-propagating. */
export function ndviGrid(nir: Grid, red: Grid): Grid {
  if (!sameShape(nir, red)) {
    throw new Error('ndviGrid: NIR and RED grids are not co-registered');
  }
  const out = makeGrid(nir.width, nir.height, nir.transform);
  for (let i = 0; i < out.data.length; i++) {
    const v = ndvi(nir.data[i]!, red.data[i]!);
    out.data[i] = v === null ? Number.NaN : v;
  }
  return out;
}

/**
 * Classify canopy pixels at a threshold.
 *
 * Unknown (NaN) pixels classify as *not* canopy — but they are also excluded
 * from the denominator by `canopyFraction`, so an unknown pixel never silently
 * counts as bare ground.
 */
export function classifyCanopy(g: Grid, threshold: number): BoolGrid {
  const out = makeBoolGrid(g.width, g.height, g.transform);
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i]!;
    out.data[i] = !Number.isNaN(v) && v >= threshold ? 1 : 0;
  }
  return out;
}

/**
 * Canopy fraction (0..1) over the valid pixels only.
 *
 * `valid` marks pixels usable for measurement — inside the yard and unmasked.
 * Returns NaN when there are no valid pixels, so the caller must handle the
 * unknown rather than reading a confident 0%.
 */
export function canopyFraction(canopy: BoolGrid, valid: BoolGrid): number {
  if (canopy.width !== valid.width || canopy.height !== valid.height) {
    throw new Error('canopyFraction: canopy and valid masks differ in shape');
  }
  let hits = 0;
  let total = 0;
  for (let i = 0; i < canopy.data.length; i++) {
    if (valid.data[i] === 1) {
      total++;
      if (canopy.data[i] === 1) hits++;
    }
  }
  return total === 0 ? Number.NaN : hits / total;
}

/** Mean NDVI over valid pixels. NaN when nothing is valid. */
export function meanNdvi(g: Grid, valid: BoolGrid): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i]!;
    if (valid.data[i] === 1 && !Number.isNaN(v)) {
      sum += v;
      n++;
    }
  }
  return n === 0 ? Number.NaN : sum / n;
}
