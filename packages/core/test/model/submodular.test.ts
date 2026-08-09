/**
 * Submodular placement.
 *
 * The headline test asserts the diminishing-returns inequality numerically. That
 * matters more than it looks: the (1 − 1/e) guarantee is only valid if the
 * objective really is submodular, so this test is what licenses the claim rather
 * than decorating it. An objective that silently stopped being submodular would
 * fail here instead of quietly voiding the bound.
 */

import { describe, expect, it } from 'vitest';
import {
  GREEDY_APPROXIMATION_RATIO,
  buildCoverageCells,
  candidateSites,
  coverageValue,
  greedyPlacement,
  toTrees,
  type CandidateSite,
  type CoverageCell,
} from '../../src/model/submodular.js';
import type { PlantingClass } from '../../src/model/canopy.js';
import { makeGrid, type GeoTransform, type Grid, type Polygon } from '../../src/types.js';

const T100: GeoTransform = {
  originX: 0,
  originY: 200,
  pixelWidth: 100,
  pixelHeight: 100,
  epsg: 32612,
};

/** A 100 m square yard. */
const YARD: Polygon = {
  outer: [
    [20, 20],
    [120, 20],
    [120, 120],
    [20, 120],
  ],
};

const CLASSES: readonly PlantingClass[] = [
  { key: 'large', label: 'Large', crownRadiusM: 7.5, maturityYears: 15 },
  { key: 'medium', label: 'Medium', crownRadiusM: 5.5, maturityYears: 15 },
];

const RADII = new Map(CLASSES.map((c) => [c.key, c.crownRadiusM]));

/** Uniform-temperature grid, so weighting is neutral unless a test varies it. */
function flatLst(value = 40): Grid {
  const g = makeGrid(2, 2, T100, value);
  return g;
}

const site = (x: number, y: number, classKey = 'large'): CandidateSite => ({
  x,
  y,
  classKey,
});

/** A dense uniform cell field, for objective-level property tests. */
function uniformCells(): CoverageCell[] {
  const out: CoverageCell[] = [];
  for (let y = 22; y < 120; y += 2) {
    for (let x = 22; x < 120; x += 2) out.push({ x, y, weight: 1, areaM2: 4 });
  }
  return out;
}

describe('★ submodularity — the property that licenses the (1−1/e) bound', () => {
  it('marginal gain to a SUBSET is at least the gain to a SUPERSET', () => {
    const cells = uniformCells();
    const eps = 1e-9;

    // Five (A ⊂ B, e ∉ B) triples, chosen so crowns genuinely overlap.
    const triples: Array<{ a: CandidateSite[]; b: CandidateSite[]; e: CandidateSite }> = [
      { a: [site(40, 40)], b: [site(40, 40), site(50, 40)], e: site(45, 45) },
      { a: [], b: [site(60, 60)], e: site(62, 62) },
      {
        a: [site(30, 30)],
        b: [site(30, 30), site(38, 30), site(30, 38)],
        e: site(35, 35),
      },
      {
        a: [site(70, 70), site(80, 70)],
        b: [site(70, 70), site(80, 70), site(75, 78), site(90, 70)],
        e: site(78, 74),
      },
      {
        a: [site(50, 100, 'medium')],
        b: [site(50, 100, 'medium'), site(56, 100, 'medium'), site(50, 106, 'medium')],
        e: site(53, 103, 'medium'),
      },
    ];

    for (const { a, b, e } of triples) {
      // A must be a subset of B for the inequality to apply. Compared
      // structurally — toContain uses reference identity, and these are
      // freshly constructed objects.
      const key = (s: CandidateSite) => `${s.x},${s.y},${s.classKey}`;
      const bKeys = new Set(b.map(key));
      for (const s of a) expect(bKeys.has(key(s))).toBe(true);

      const gainToA = coverageValue([...a, e], RADII, cells) - coverageValue(a, RADII, cells);
      const gainToB = coverageValue([...b, e], RADII, cells) - coverageValue(b, RADII, cells);

      expect(gainToA).toBeGreaterThanOrEqual(gainToB - eps);
    }
  });

  it('is monotone — adding a site never reduces coverage', () => {
    const cells = uniformCells();
    const sites: CandidateSite[] = [];
    let prev = 0;
    for (const s of [site(30, 30), site(60, 30), site(30, 60), site(60, 60), site(45, 45)]) {
      sites.push(s);
      const v = coverageValue(sites, RADII, cells);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('is a UNION not a sum — overlapping sites are worth less than twice one', () => {
    const cells = uniformCells();
    const one = coverageValue([site(60, 60)], RADII, cells);
    const overlapping = coverageValue([site(60, 60), site(63, 60)], RADII, cells);
    const disjoint = coverageValue([site(40, 40), site(100, 100)], RADII, cells);

    expect(overlapping).toBeLessThan(one * 2);
    // Well-separated crowns do add up, which is the contrast that proves the
    // shortfall above is overlap rather than a clamp.
    expect(disjoint).toBeGreaterThan(overlapping);
  });
});

describe('★ lazy greedy (CELF) is exact, not approximate', () => {
  /** Naive greedy, written independently here as the reference implementation. */
  function naiveGreedy(
    cells: readonly CoverageCell[],
    candidates: readonly CandidateSite[],
    count: number,
  ): { chosen: CandidateSite[]; gains: number[] } {
    const chosen: CandidateSite[] = [];
    const gains: number[] = [];
    const remaining = [...candidates].sort((a, b) =>
      a.x !== b.x ? a.x - b.x : a.y !== b.y ? a.y - b.y : a.classKey.localeCompare(b.classKey),
    );

    for (let k = 0; k < count && remaining.length > 0; k++) {
      const baseline = coverageValue(chosen, RADII, cells);
      let bestIdx = -1;
      let bestGain = -Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const gain = coverageValue([...chosen, remaining[i]!], RADII, cells) - baseline;
        if (gain > bestGain) {
          bestGain = gain;
          bestIdx = i;
        }
      }
      if (bestIdx < 0) break;
      chosen.push(remaining[bestIdx]!);
      gains.push(bestGain);
      remaining.splice(bestIdx, 1);
    }
    return { chosen, gains };
  }

  it('selects the IDENTICAL set as naive greedy, with fewer evaluations', () => {
    const cells = buildCoverageCells(YARD, flatLst(), 3);
    const candidates = candidateSites(YARD, CLASSES, 10, 6);
    expect(candidates.length).toBeGreaterThan(10);

    const lazy = greedyPlacement(cells, candidates, RADII, 6);
    const naive = naiveGreedy(cells, candidates, 6);

    // Same sites, same order — the speedup changes cost, never the answer.
    expect(lazy.chosen).toEqual(naive.chosen);
    for (let i = 0; i < naive.gains.length; i++) {
      expect(lazy.steps[i]!.marginalGain).toBeCloseTo(naive.gains[i]!, 6);
    }
    // And the saving is real.
    expect(lazy.evaluations).toBeLessThan(lazy.naiveEvaluations);
  });

  it('marginal gains diminish step by step — the curve the film shows', () => {
    // A SMALL yard, deliberately. On a 100 m yard a 7.5 m crown always finds
    // fully-disjoint ground, so every marginal gain is identical and the curve is
    // flat — correct behaviour, but it does not exercise the property. Crowns
    // must be forced to compete for the diminishing return to appear.
    const tight: Polygon = {
      outer: [
        [20, 20],
        [56, 20],
        [56, 56],
        [20, 56],
      ],
    };
    const cells = buildCoverageCells(tight, flatLst(), 1);
    const candidates = candidateSites(tight, CLASSES, 4, 4);
    const result = greedyPlacement(cells, candidates, RADII, 8);

    expect(result.steps.length).toBe(8);
    for (let i = 1; i < result.steps.length; i++) {
      // Non-increasing, which is submodularity observable in the output.
      expect(result.steps[i]!.marginalGain).toBeLessThanOrEqual(
        result.steps[i - 1]!.marginalGain + 1e-9,
      );
    }
    // Strictly decreasing over the prefix, before coverage saturates. Once the
    // yard is fully shaded every further gain is legitimately 0, and equal
    // zeroes are still non-increasing — so the strict check belongs on the
    // first steps, not the last.
    const first = result.steps[0]!.marginalGain;
    const last = result.steps[result.steps.length - 1]!.marginalGain;
    expect(last).toBeLessThan(first);
  });

  it('cumulative value equals the objective and never exceeds the maximum', () => {
    const cells = buildCoverageCells(YARD, flatLst(), 3);
    const candidates = candidateSites(YARD, CLASSES, 10, 6);
    const r = greedyPlacement(cells, candidates, RADII, 5);

    expect(r.steps[r.steps.length - 1]!.cumulativeValue).toBeCloseTo(r.objectiveValue, 6);
    expect(r.objectiveValue).toBeLessThanOrEqual(r.maxPossibleValue + 1e-9);
    expect(r.objectiveValue).toBeCloseTo(coverageValue(r.chosen, RADII, cells), 6);
  });
});

describe('temperature weighting', () => {
  it('places the first tree nearer the hot patch than the cool one', () => {
    // Left half hot, right half cool, on a 2x2 thermal grid over the yard.
    const lst = makeGrid(2, 2, T100, 30);
    lst.data[0] = 50; // top-left → covers roughly x<100, y>100
    lst.data[2] = 50; // bottom-left

    const cells = buildCoverageCells(YARD, lst, 3);
    const candidates = candidateSites(YARD, CLASSES, 10, 6);
    const r = greedyPlacement(cells, candidates, RADII, 1);

    expect(r.chosen.length).toBe(1);
    // The hot half is x < 100; the first pick must land there.
    expect(r.chosen[0]!.x).toBeLessThan(100);
  });

  it('assigns unknown-temperature cells the MEDIAN weight, never zero', () => {
    // Three known cells and one unknown, so the median of the known weights is
    // an INTERIOR value — with only two known values the median coincides with
    // an end stop and the fallback is indistinguishable from clamping.
    const lst = makeGrid(2, 2, T100, 40);
    lst.data[0] = 35;
    lst.data[1] = 40;
    lst.data[2] = 45;
    lst.data[3] = Number.NaN;

    const cells = buildCoverageCells(YARD, lst, 4);
    expect(cells.length).toBeGreaterThan(0);

    // Every weight is a real number — an unknown cell never poisons the field.
    for (const c of cells) expect(Number.isFinite(c.weight)).toBe(true);

    // The unknown cells take the MEDIAN of the known weights, which is strictly
    // positive. Note the coolest KNOWN cell correctly normalises to 0: that is a
    // measured value at the bottom of the observed range, not a missing one. The
    // invariant is that MISSING data never silently becomes the minimum.
    const distinct = [...new Set(cells.map((c) => c.weight))].sort((a, b) => a - b);
    expect(distinct.length).toBeGreaterThan(1);
    expect(distinct[distinct.length - 1]!).toBeGreaterThan(0);
    // At least one cell carries the interior fallback rather than an end stop.
    expect(cells.some((c) => c.weight > 0 && c.weight < 1)).toBe(true);
  });

  it('falls back to uniform weight when no cell has a known temperature', () => {
    const lst = makeGrid(2, 2, T100, Number.NaN);
    const cells = buildCoverageCells(YARD, lst, 5);
    expect(cells.length).toBeGreaterThan(0);
    for (const c of cells) expect(c.weight).toBe(1);
  });

  it('weights uniformly when the scene has no temperature variation', () => {
    const cells = buildCoverageCells(YARD, flatLst(42), 5);
    for (const c of cells) expect(c.weight).toBe(1);
  });
});

describe('candidate sites', () => {
  it('keeps every candidate inside the yard and off the edge', () => {
    const sites = candidateSites(YARD, CLASSES, 8, 6);
    for (const s of sites) {
      expect(s.x).toBeGreaterThan(20);
      expect(s.x).toBeLessThan(120);
      expect(s.y).toBeGreaterThan(20);
      expect(s.y).toBeLessThan(120);
    }
  });

  it('emits one candidate per class per position', () => {
    const sites = candidateSites(YARD, CLASSES, 20, 6);
    const positions = new Set(sites.map((s) => `${s.x},${s.y}`));
    expect(sites.length).toBe(positions.size * CLASSES.length);
  });

  it('skips classes with a non-positive radius rather than placing a zero crown', () => {
    const withZero: PlantingClass[] = [
      ...CLASSES,
      { key: 'broken', label: 'Broken', crownRadiusM: 0, maturityYears: 15 },
    ];
    const sites = candidateSites(YARD, withZero, 20, 6);
    expect(sites.some((s) => s.classKey === 'broken')).toBe(false);
  });
});

describe('determinism', () => {
  it('identical input yields an identical plan', () => {
    const cells = buildCoverageCells(YARD, flatLst(), 3);
    const candidates = candidateSites(YARD, CLASSES, 10, 6);
    expect(greedyPlacement(cells, candidates, RADII, 6)).toEqual(
      greedyPlacement(cells, candidates, RADII, 6),
    );
  });

  it('candidate order does not change the outcome — ties break deterministically', () => {
    const cells = buildCoverageCells(YARD, flatLst(), 3);
    const candidates = candidateSites(YARD, CLASSES, 10, 6);
    const shuffled = [...candidates].reverse();
    expect(greedyPlacement(cells, shuffled, RADII, 5).chosen).toEqual(
      greedyPlacement(cells, candidates, RADII, 5).chosen,
    );
  });
});

describe('the guarantee and degenerate input', () => {
  it('reports (1 − 1/e) exactly', () => {
    expect(GREEDY_APPROXIMATION_RATIO).toBeCloseTo(0.6321205588, 10);
  });

  it('returns an empty plan for zero candidates or zero count', () => {
    const cells = buildCoverageCells(YARD, flatLst(), 5);
    for (const r of [
      greedyPlacement(cells, [], RADII, 5),
      greedyPlacement(cells, candidateSites(YARD, CLASSES, 20, 6), RADII, 0),
    ]) {
      expect(r.chosen).toEqual([]);
      expect(r.objectiveValue).toBe(0);
      expect(r.evaluations).toBe(0);
    }
  });

  it('caps the plan at the candidate pool size', () => {
    const cells = buildCoverageCells(YARD, flatLst(), 5);
    const candidates = candidateSites(YARD, CLASSES, 40, 6);
    const r = greedyPlacement(cells, candidates, RADII, 500);
    expect(r.chosen.length).toBe(candidates.length);
  });

  it('handles a yard with no interior cells without crashing', () => {
    const sliver: Polygon = {
      outer: [
        [0, 0],
        [0.4, 0],
        [0.4, 0.4],
        [0, 0.4],
      ],
    };
    const cells = buildCoverageCells(sliver, flatLst(), 5);
    const r = greedyPlacement(cells, candidateSites(sliver, CLASSES, 5, 6), RADII, 3);
    expect(r.objectiveValue).toBe(0);
    expect(r.maxPossibleValue).toBe(0);
  });

  it('ignores a site whose class has no known radius', () => {
    const cells = uniformCells();
    expect(coverageValue([site(60, 60, 'unknown-class')], RADII, cells)).toBe(0);
  });

  it('converts chosen sites to zero-padded Tree ids', () => {
    const trees = toTrees([site(30, 30), site(40, 40, 'medium')]);
    expect(trees.map((t) => t.id)).toEqual(['t01', 't02']);
    expect(trees[1]!.classKey).toBe('medium');
  });
});
