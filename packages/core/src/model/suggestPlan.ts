/**
 * Suggest a planting layout inside a yard.
 *
 * Pure and deterministic. This is a *suggestion* the student then edits by
 * dragging pins — it exists so the demo opens on a sensible plan rather than an
 * empty yard, and so the PDF has something to cost.
 *
 * Placement rules, in order:
 *   1. Only inside the yard polygon.
 *   2. Only where NDVI says the ground is currently unshaded — planting under an
 *      existing crown adds no new shade.
 *   3. Respect a minimum spacing, so crowns overlap partially rather than
 *      stacking. Overlap is then measured geometrically, never assumed.
 */

import type { Grid, Polygon, Tree } from '../index.js';
import { pointInPolygon } from '../raster/mask.js';
import { at } from '../types.js';

export interface SuggestOptions {
  /** How many trees to place. */
  readonly count: number;
  /** Class key assigned to each placed tree, cycled in order. */
  readonly classKeys: readonly string[];
  /** Minimum centre-to-centre spacing, metres. */
  readonly minSpacingM: number;
  /** Pixels at or above this NDVI already have canopy — do not plant there. */
  readonly canopyThreshold: number;
  /** Keep trees at least this far inside the yard edge, metres. */
  readonly edgeBufferM: number;
}

export const DEFAULT_SUGGEST: Omit<SuggestOptions, 'count' | 'classKeys' | 'canopyThreshold'> = {
  minSpacingM: 11,
  edgeBufferM: 6,
};

/**
 * Candidate positions on a regular lattice, scored by how hot and unshaded the
 * spot is. A lattice rather than random sampling keeps the output deterministic
 * and makes the spacing rule easy to reason about.
 */
export function suggestPlan(
  yard: Polygon,
  ndvi: Grid,
  lst: Grid,
  opts: SuggestOptions,
): readonly Tree[] {
  const xs = yard.outer.map((p) => p[0]);
  const ys = yard.outer.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const step = Math.max(2, opts.minSpacingM / 2);
  const candidates: Array<{ x: number; y: number; score: number }> = [];

  for (let y = minY + step / 2; y <= maxY; y += step) {
    for (let x = minX + step / 2; x <= maxX; x += step) {
      if (!pointInPolygon(yard, x, y)) continue;
      if (!isInteriorPoint(yard, x, y, opts.edgeBufferM)) continue;

      const nd = sampleAt(ndvi, x, y);
      if (nd === null || nd >= opts.canopyThreshold) continue;

      // Prefer the hottest, least-vegetated ground. Temperature may be unknown
      // at this point (coarse thermal grid); fall back to NDVI alone rather than
      // discarding the candidate.
      const t = sampleAt(lst, x, y);
      const heat = t === null ? 0 : t;
      candidates.push({ x, y, score: heat - nd * 10 });
    }
  }

  candidates.sort((a, b) => b.score - a.score || a.x - b.x || a.y - b.y);

  const placed: Array<{ x: number; y: number }> = [];
  const trees: Tree[] = [];
  const minSq = opts.minSpacingM * opts.minSpacingM;

  for (const c of candidates) {
    if (trees.length >= opts.count) break;
    let tooClose = false;
    for (const p of placed) {
      const dx = p.x - c.x;
      const dy = p.y - c.y;
      if (dx * dx + dy * dy < minSq) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    placed.push({ x: c.x, y: c.y });
    const classKey = opts.classKeys[trees.length % opts.classKeys.length]!;
    trees.push({
      id: `t${String(trees.length + 1).padStart(2, '0')}`,
      x: +c.x.toFixed(2),
      y: +c.y.toFixed(2),
      classKey,
    });
  }

  return trees;
}

/** Nearest-cell sample of a grid at a projected coordinate. */
function sampleAt(g: Grid, x: number, y: number): number | null {
  const col = Math.floor((x - g.transform.originX) / g.transform.pixelWidth);
  const row = Math.floor((g.transform.originY - y) / g.transform.pixelHeight);
  return at(g, col, row);
}

/** True when a point is at least `buffer` metres inside every yard edge. */
function isInteriorPoint(
  yard: Polygon,
  x: number,
  y: number,
  buffer: number,
): boolean {
  if (buffer <= 0) return true;
  // Cheap and adequate: require the four buffer-offset probes to stay inside.
  return (
    pointInPolygon(yard, x + buffer, y) &&
    pointInPolygon(yard, x - buffer, y) &&
    pointInPolygon(yard, x, y + buffer) &&
    pointInPolygon(yard, x, y - buffer)
  );
}
