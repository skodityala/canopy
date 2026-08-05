/**
 * Crown geometry — turning "12 trees" into a canopy-area number. §4.6.
 *
 * `overlap_factor` is computed from the actual placed positions, never guessed.
 * Two trees 6 m apart with 5 m radii overlap substantially, and a judge can see
 * that on the map — so the arithmetic has to agree with the picture.
 *
 * Union area of overlapping circles has no simple closed form, so this uses a
 * deterministic grid quadrature at a stated cell size. Deterministic matters:
 * a Monte-Carlo estimate would make the PDF's numbers change between renders,
 * which breaks the golden test and, worse, means the artifact is not
 * reproducible.
 */

import type { Polygon } from '../types.js';
import { pointInPolygon } from '../raster/mask.js';

export interface Tree {
  readonly id: string;
  /** Position in projected metres, matching the fixture's CRS. */
  readonly x: number;
  readonly y: number;
  readonly classKey: string;
}

/**
 * A planting class. Radii are ⚠️ VERIFY-per-region and live in the cost model
 * JSON alongside their citation, not hardcoded here.
 */
export interface PlantingClass {
  readonly key: string;
  readonly label: string;
  /** Mature crown radius in metres, at the stated maturity horizon. */
  readonly crownRadiusM: number;
  /** Years to the stated mature crown — printed as "at ~N-year maturity". */
  readonly maturityYears: number;
}

/** Quadrature cell size in metres. 0.5 m gives ≈0.1% area error at r ≈ 7 m. */
export const QUADRATURE_CELL_M = 0.5;

/** Crown area of a single tree. */
export function crownAreaM2(radiusM: number): number {
  if (!Number.isFinite(radiusM) || radiusM <= 0) return 0;
  return Math.PI * radiusM * radiusM;
}

/** Sum of crown areas, ignoring overlap — the upper bound on union area. */
export function summedCrownAreaM2(
  trees: readonly Tree[],
  radii: ReadonlyMap<string, number>,
): number {
  let total = 0;
  for (const t of trees) total += crownAreaM2(radii.get(t.classKey) ?? 0);
  return total;
}

/**
 * Exact lens area of two overlapping circles — used to unit-test the
 * quadrature against a closed form for the two-tree case.
 */
export function circleIntersectionAreaM2(
  x1: number, y1: number, r1: number,
  x2: number, y2: number, r2: number,
): number {
  const d = Math.hypot(x2 - x1, y2 - y1);
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) {
    const rMin = Math.min(r1, r2);
    return Math.PI * rMin * rMin;
  }
  const a1 = Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const a2 = Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  return r1 * r1 * (a1 - Math.sin(2 * a1) / 2) + r2 * r2 * (a2 - Math.sin(2 * a2) / 2);
}

/**
 * Union area of all crowns, by deterministic quadrature.
 *
 * Guaranteed ≤ Σ crownArea, because overlap can only subtract.
 *
 * @param clip optional yard polygon — crown area outside the yard does not
 *             shade the yard and must not be counted.
 */
export function unionCanopyAreaM2(
  trees: readonly Tree[],
  radii: ReadonlyMap<string, number>,
  clip?: Polygon,
  cell = QUADRATURE_CELL_M,
): number {
  const active = trees
    .map((t) => ({ t, r: radii.get(t.classKey) ?? 0 }))
    .filter((e) => e.r > 0);
  if (active.length === 0) return 0;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { t, r } of active) {
    if (t.x - r < minX) minX = t.x - r;
    if (t.x + r > maxX) maxX = t.x + r;
    if (t.y - r < minY) minY = t.y - r;
    if (t.y + r > maxY) maxY = t.y + r;
  }

  const cols = Math.max(1, Math.ceil((maxX - minX) / cell));
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell));
  const cellArea = cell * cell;
  let area = 0;

  for (let row = 0; row < rows; row++) {
    const py = minY + (row + 0.5) * cell;
    for (let col = 0; col < cols; col++) {
      const px = minX + (col + 0.5) * cell;
      let covered = false;
      for (const { t, r } of active) {
        const dx = px - t.x;
        const dy = py - t.y;
        if (dx * dx + dy * dy <= r * r) {
          covered = true;
          break;
        }
      }
      if (!covered) continue;
      if (clip && !pointInPolygon(clip, px, py)) continue;
      area += cellArea;
    }
  }
  // Quadrature can exceed the analytic sum by a fraction of a cell at the
  // boundary; clamp so the documented invariant union ≤ Σ crowns always holds.
  return Math.min(area, summedCrownAreaM2(trees, radii));
}

/**
 * Geometric overlap fraction actually realised by the placement, 0..1.
 * This is the number printed as "after N% geometric overlap".
 */
export function overlapFraction(
  trees: readonly Tree[],
  radii: ReadonlyMap<string, number>,
  clip?: Polygon,
): number {
  const summed = summedCrownAreaM2(trees, radii);
  if (summed === 0) return 0;
  return 1 - unionCanopyAreaM2(trees, radii, clip) / summed;
}

/** Canopy percentage after planting, clamped to [0, 100]. */
export function canopyPctAfter(
  existingM2: number,
  addedM2: number,
  yardM2: number,
): number {
  if (!Number.isFinite(yardM2) || yardM2 <= 0) return Number.NaN;
  const pct = ((existingM2 + addedM2) / yardM2) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Added canopy that does not already sit under existing canopy.
 *
 * Planting a tree over an already-shaded patch adds no new shade, so the naive
 * `existing + new` would double-count. Scaling by the unshaded fraction is a
 * first-order correction; it is stated as such in the method notes.
 */
export function effectiveAddedCanopyM2(
  unionNewM2: number,
  existingCanopyFraction: number,
): number {
  if (!Number.isFinite(existingCanopyFraction)) return unionNewM2;
  const free = Math.min(1, Math.max(0, 1 - existingCanopyFraction));
  return unionNewM2 * free;
}

/**
 * Shape of the crown-growth curve, for the 5 / 15 / 30-year projection.
 * Sigmoid-ish and explicitly labelled a *projection*, never a measurement.
 */
export function crownRadiusAtYear(
  matureRadiusM: number,
  maturityYears: number,
  year: number,
): number {
  if (year <= 0) return 0;
  if (maturityYears <= 0) return matureRadiusM;
  const frac = 1 - Math.exp((-2.5 * year) / maturityYears);
  const norm = 1 - Math.exp(-2.5);
  return matureRadiusM * Math.min(1, frac / norm);
}
