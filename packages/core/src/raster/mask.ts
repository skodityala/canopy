/**
 * Cloud masking and yard geometry. §4.4.
 *
 * This module is the machinery behind the on-camera failure case: when cloud or
 * cirrus masks too much of a yard, Canopy must refuse to report a temperature
 * rather than average whatever pixels survived. The refusal is a typed outcome,
 * not a warning string.
 */

import type { BoolGrid, Grid, Polygon } from '../types.js';
import { makeBoolGrid, pixelCentre } from '../types.js';

/**
 * Minimum fraction of a yard that must have usable pixels before a temperature
 * is reported. Below this, `predictDeltaLST` returns `suppressed`. §4.4.
 */
export const REQUIRED_COVERAGE = 0.8;

/**
 * Landsat Collection 2 QA_PIXEL bit assignments (Level-1 quality band).
 * Bit 0 fill · 1 dilated cloud · 2 cirrus · 3 cloud · 4 cloud shadow · 5 snow.
 */
export const QA_BIT = {
  FILL: 0,
  DILATED_CLOUD: 1,
  CIRRUS: 2,
  CLOUD: 3,
  CLOUD_SHADOW: 4,
  SNOW: 5,
} as const;

/** Bits that make a pixel unusable for surface-temperature measurement. */
const UNUSABLE_BITS = [
  QA_BIT.FILL,
  QA_BIT.DILATED_CLOUD,
  QA_BIT.CIRRUS,
  QA_BIT.CLOUD,
  QA_BIT.CLOUD_SHADOW,
  QA_BIT.SNOW,
] as const;

/**
 * QA band → usable-pixel mask. 1 = usable, 0 = masked.
 *
 * Named `cloudMaskFromQA` per §5.3; the returned grid marks *clear* pixels, so
 * it can be intersected directly with the yard mask.
 */
export function cloudMaskFromQA(qa: Grid): BoolGrid {
  const out = makeBoolGrid(qa.width, qa.height, qa.transform);
  for (let i = 0; i < qa.data.length; i++) {
    const v = qa.data[i]!;
    if (Number.isNaN(v)) {
      out.data[i] = 0;
      continue;
    }
    const bits = v >>> 0;
    let usable = 1;
    for (const bit of UNUSABLE_BITS) {
      if ((bits & (1 << bit)) !== 0) {
        usable = 0;
        break;
      }
    }
    out.data[i] = usable;
  }
  return out;
}

/** Even–odd ray casting point-in-polygon, including holes. */
export function pointInPolygon(poly: Polygon, x: number, y: number): boolean {
  if (!ringContains(poly.outer, x, y)) return false;
  for (const hole of poly.holes ?? []) {
    if (ringContains(hole, x, y)) return false;
  }
  return true;
}

function ringContains(ring: Ring_, x: number, y: number): boolean {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if (yi > y !== yj > y) {
      const t = (y - yi) / (yj - yi);
      if (x < xi + t * (xj - xi)) inside = !inside;
    }
  }
  return inside;
}

type Ring_ = ReadonlyArray<readonly [number, number]>;

/** Rasterise a yard polygon onto a grid's geometry by pixel-centre containment. */
export function rasterisePolygon(poly: Polygon, like: Grid): BoolGrid {
  const out = makeBoolGrid(like.width, like.height, like.transform);
  for (let row = 0; row < like.height; row++) {
    for (let col = 0; col < like.width; col++) {
      const [x, y] = pixelCentre(like.transform, col, row);
      out.data[row * like.width + col] = pointInPolygon(poly, x, y) ? 1 : 0;
    }
  }
  return out;
}

/** Element-wise AND of two same-shape masks. */
export function intersectMasks(a: BoolGrid, b: BoolGrid): BoolGrid {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error('intersectMasks: shape mismatch');
  }
  const out = makeBoolGrid(a.width, a.height, a.transform);
  for (let i = 0; i < a.data.length; i++) {
    out.data[i] = a.data[i] === 1 && b.data[i] === 1 ? 1 : 0;
  }
  return out;
}

/** Count of set bits in a mask. */
export function countMask(m: BoolGrid): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i] === 1) n++;
  return n;
}

/**
 * Fraction (0..1) of the yard's pixels that are usable.
 *
 * Returns 0 when the yard does not intersect the grid at all — the caller
 * distinguishes that from partial cloud via `NO_THERMAL_OVERLAP`.
 */
export function validCoverage(usable: BoolGrid, yard: Polygon, like: Grid): number {
  const yardMask = rasterisePolygon(yard, like);
  const yardPixels = countMask(yardMask);
  if (yardPixels === 0) return 0;
  return countMask(intersectMasks(yardMask, usable)) / yardPixels;
}

/** True when coverage clears the reporting bar. */
export function coverageIsSufficient(coverage: number, required = REQUIRED_COVERAGE): boolean {
  return Number.isFinite(coverage) && coverage >= required;
}
