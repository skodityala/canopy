/**
 * Greedy submodular tree placement, with a proven approximation bound.
 *
 * WHY THIS REPLACES THE LATTICE HEURISTIC
 *
 * Shade coverage of a yard by a set of tree crowns is a COVERAGE FUNCTION: the
 * value of a set is the weighted area of ground covered by at least one crown.
 * Coverage functions are monotone (adding a tree never removes shade) and
 * SUBMODULAR (adding a tree to a large set overlaps existing crowns more, so its
 * marginal gain is smaller than adding it to a subset). Maximising a monotone
 * submodular function under a cardinality constraint is NP-hard, but greedy
 * achieves a (1 − 1/e) ≈ 0.632 approximation of the optimal set of the same size
 * — Nemhauser, Wolsey & Fisher 1978 — and that bound is tight unless P = NP.
 *
 * The practical consequence: "why these positions?" stops being "we scored a
 * lattice" and becomes "greedy maximisation of a monotone submodular
 * temperature-weighted coverage objective, provably within 63.2% of optimal."
 *
 * Submodularity is not assumed here — `submodular.test.ts` asserts the
 * diminishing-returns inequality numerically across many set triples, so an
 * objective that silently stopped being submodular would fail the build and
 * invalidate the bound rather than quietly voiding it.
 */

import type { PlantingClass, Tree } from './canopy.js';
import type { Grid, Polygon } from '../types.js';
import { at } from '../types.js';
import { pointInPolygon } from '../raster/mask.js';

/** (1 − 1/e). The proven worst-case ratio of greedy to the optimal same-size set. */
export const GREEDY_APPROXIMATION_RATIO = 1 - 1 / Math.E;

/** A discretised patch of yard ground, with a value weight. */
export interface CoverageCell {
  readonly x: number;
  readonly y: number;
  /** 0..1, from surface temperature. Hotter ground is worth more to shade. */
  readonly weight: number;
  readonly areaM2: number;
}

export interface CandidateSite {
  readonly x: number;
  readonly y: number;
  readonly classKey: string;
}

export interface GreedyStep {
  readonly site: CandidateSite;
  readonly marginalGain: number;
  readonly cumulativeValue: number;
  readonly evaluations: number;
}

export interface GreedyResult {
  readonly chosen: readonly CandidateSite[];
  readonly steps: readonly GreedyStep[];
  readonly objectiveValue: number;
  /** Weighted area of the whole yard — the value of covering everything. */
  readonly maxPossibleValue: number;
  readonly approximationRatio: number;
  readonly evaluations: number;
  /** Evaluations a naive non-lazy greedy would have performed. */
  readonly naiveEvaluations: number;
}

const DEFAULT_CELL_M = 2;
const DEFAULT_SPACING_M = 6;
const DEFAULT_EDGE_BUFFER_M = 6;

/** Median of a numeric list. Deterministic: sorts a copy. */
function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Nearest-cell sample of a grid at a projected coordinate. */
function sampleAt(g: Grid, x: number, y: number): number | null {
  const col = Math.floor((x - g.transform.originX) / g.transform.pixelWidth);
  const row = Math.floor((g.transform.originY - y) / g.transform.pixelHeight);
  return at(g, col, row);
}

/**
 * Discretise the yard into weighted coverage cells.
 *
 * ★ TEMPERATURE WEIGHTING: cooling a 48 °C patch is worth more than cooling a
 * 32 °C one, so each cell's weight is its normalised surface temperature.
 *
 * ★ UNKNOWN HANDLING: a cell whose LST is unknown gets the MEDIAN weight of the
 * known cells, not zero. Weight zero would assert "worthless to shade", which is
 * a claim the data does not support — the same reason unknown is never 0
 * anywhere else in this codebase. If no cell has a known temperature the field
 * carries no information, so all weights fall back to 1 (uniform).
 */
export function buildCoverageCells(
  yard: Polygon,
  lst: Grid,
  cellM: number = DEFAULT_CELL_M,
): CoverageCell[] {
  const step = Math.max(0.5, cellM);
  const xs = yard.outer.map((p) => p[0]);
  const ys = yard.outer.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const pts: Array<{ x: number; y: number; t: number | null }> = [];
  for (let y = minY + step / 2; y <= maxY; y += step) {
    for (let x = minX + step / 2; x <= maxX; x += step) {
      if (!pointInPolygon(yard, x, y)) continue;
      pts.push({ x, y, t: sampleAt(lst, x, y) });
    }
  }

  const known = pts.map((p) => p.t).filter((t): t is number => t !== null);
  const areaM2 = step * step;

  if (known.length === 0) {
    return pts.map((p) => ({ x: p.x, y: p.y, weight: 1, areaM2 }));
  }

  const tMin = Math.min(...known);
  const tMax = Math.max(...known);
  const span = tMax - tMin;
  const norm = (t: number): number => (span === 0 ? 1 : (t - tMin) / span);
  const fallback = span === 0 ? 1 : norm(median(known));

  return pts.map((p) => ({
    x: p.x,
    y: p.y,
    weight: p.t === null ? fallback : norm(p.t),
    areaM2,
  }));
}

/** A deterministic lattice of plantable positions, one per class per position. */
export function candidateSites(
  yard: Polygon,
  classes: readonly PlantingClass[],
  spacingM: number = DEFAULT_SPACING_M,
  edgeBufferM: number = DEFAULT_EDGE_BUFFER_M,
): CandidateSite[] {
  const step = Math.max(1, spacingM);
  const xs = yard.outer.map((p) => p[0]);
  const ys = yard.outer.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const inside = (x: number, y: number): boolean =>
    pointInPolygon(yard, x, y) &&
    (edgeBufferM <= 0 ||
      (pointInPolygon(yard, x + edgeBufferM, y) &&
        pointInPolygon(yard, x - edgeBufferM, y) &&
        pointInPolygon(yard, x, y + edgeBufferM) &&
        pointInPolygon(yard, x, y - edgeBufferM)));

  const out: CandidateSite[] = [];
  for (let y = minY + step / 2; y <= maxY; y += step) {
    for (let x = minX + step / 2; x <= maxX; x += step) {
      if (!inside(x, y)) continue;
      for (const c of classes) {
        if (c.crownRadiusM <= 0) continue;
        out.push({ x: +x.toFixed(2), y: +y.toFixed(2), classKey: c.key });
      }
    }
  }
  return out;
}

/** Cells covered by a site, as an index set into `cells`. */
function coveredBy(
  site: CandidateSite,
  radius: number,
  cells: readonly CoverageCell[],
): number[] {
  const r2 = radius * radius;
  const out: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    const dx = c.x - site.x;
    const dy = c.y - site.y;
    if (dx * dx + dy * dy <= r2) out.push(i);
  }
  return out;
}

/**
 * The objective: weighted area covered by AT LEAST ONE crown.
 *
 * The union — not the sum — is what makes this submodular and non-additive. Two
 * overlapping crowns are worth less than two disjoint ones, which is exactly the
 * diminishing return greedy exploits.
 */
export function coverageValue(
  sites: readonly CandidateSite[],
  radii: ReadonlyMap<string, number>,
  cells: readonly CoverageCell[],
): number {
  if (sites.length === 0 || cells.length === 0) return 0;
  const hit = new Uint8Array(cells.length);
  for (const s of sites) {
    const r = radii.get(s.classKey) ?? 0;
    if (r <= 0) continue;
    for (const i of coveredBy(s, r, cells)) hit[i] = 1;
  }
  let total = 0;
  for (let i = 0; i < cells.length; i++) {
    if (hit[i] === 1) {
      const c = cells[i]!;
      total += c.weight * c.areaM2;
    }
  }
  return total;
}

/** Deterministic tie-break, so an identical input always yields an identical plan. */
function compareSites(a: CandidateSite, b: CandidateSite): number {
  if (a.x !== b.x) return a.x - b.x;
  if (a.y !== b.y) return a.y - b.y;
  return a.classKey.localeCompare(b.classKey);
}

/**
 * Lazy greedy (CELF).
 *
 * Submodularity guarantees a site's marginal gain can only DECREASE as the
 * chosen set grows, so a previously computed gain is a valid UPPER BOUND. Pop the
 * best bound, re-evaluate it against the current set, and if it still beats the
 * next best bound it must be the true maximiser — no other candidate can exceed
 * its own stale bound. That yields the IDENTICAL set as naive greedy while
 * skipping most re-evaluations. It is an exact speedup, not an approximation.
 */
export function greedyPlacement(
  cells: readonly CoverageCell[],
  candidates: readonly CandidateSite[],
  radii: ReadonlyMap<string, number>,
  count: number,
): GreedyResult {
  const maxPossibleValue = cells.reduce((sum, c) => sum + c.weight * c.areaM2, 0);
  const target = Math.max(0, Math.min(Math.floor(count), candidates.length));

  const empty: GreedyResult = {
    chosen: [],
    steps: [],
    objectiveValue: 0,
    maxPossibleValue,
    approximationRatio: GREEDY_APPROXIMATION_RATIO,
    evaluations: 0,
    naiveEvaluations: 0,
  };
  if (target === 0 || cells.length === 0) return empty;

  // Precompute each candidate's covered set once; the geometry never changes.
  const ordered = [...candidates].sort(compareSites);
  const covers = ordered.map((s) => coveredBy(s, radii.get(s.classKey) ?? 0, cells));
  const cellValue = cells.map((c) => c.weight * c.areaM2);

  const hit = new Uint8Array(cells.length);
  /** Marginal gain of candidate i against the current `hit` state. */
  const gainOf = (i: number): number => {
    let g = 0;
    for (const idx of covers[i]!) if (hit[idx] === 0) g += cellValue[idx]!;
    return g;
  };

  let evaluations = 0;
  // Seed the bounds: one full pass, as naive greedy would also do.
  const bound = ordered.map((_, i) => {
    evaluations++;
    return gainOf(i);
  });
  const stale = ordered.map(() => false);
  const taken = ordered.map(() => false);

  const chosen: CandidateSite[] = [];
  const steps: GreedyStep[] = [];
  let cumulative = 0;
  let naiveEvaluations = ordered.length;

  for (let picked = 0; picked < target; picked++) {
    const stepStart = evaluations;

    // Re-evaluate stale bounds until the best is known to be exact.
    for (;;) {
      let best = -1;
      let bestVal = -Infinity;
      let second = -Infinity;
      for (let i = 0; i < ordered.length; i++) {
        if (taken[i]) continue;
        const v = bound[i]!;
        if (v > bestVal) {
          second = bestVal;
          bestVal = v;
          best = i;
        } else if (v > second) {
          second = v;
        }
      }
      if (best < 0) break;

      if (stale[best]) {
        bound[best] = gainOf(best);
        evaluations++;
        stale[best] = false;
        // Bound shrank below a rival's: loop and re-select.
        if (bound[best]! < second) continue;
      }

      // Accept. Its exact gain is at least every other candidate's upper bound.
      const gain = bound[best]!;
      for (const idx of covers[best]!) hit[idx] = 1;
      taken[best] = true;
      cumulative += gain;
      chosen.push(ordered[best]!);
      steps.push({
        site: ordered[best]!,
        marginalGain: gain,
        cumulativeValue: cumulative,
        evaluations: evaluations - stepStart,
      });
      // Every surviving bound is now potentially stale.
      for (let i = 0; i < ordered.length; i++) if (!taken[i]) stale[i] = true;
      break;
    }

    // A naive implementation rescans every remaining candidate each round.
    naiveEvaluations += ordered.length - picked - 1;
  }

  return {
    chosen,
    steps,
    objectiveValue: cumulative,
    maxPossibleValue,
    approximationRatio: GREEDY_APPROXIMATION_RATIO,
    evaluations,
    naiveEvaluations,
  };
}

/** Convert chosen sites to the existing Tree shape. */
export function toTrees(sites: readonly CandidateSite[]): Tree[] {
  return sites.map((s, i) => ({
    id: `t${String(i + 1).padStart(2, '0')}`,
    x: s.x,
    y: s.y,
    classKey: s.classKey,
  }));
}
