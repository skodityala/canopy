/** Model layer: regression, crown geometry, the R² gate, and cost citation rules. */

import { describe, expect, it } from 'vitest';
import { olsFit, tCritical, tCDF } from '../src/model/regression.js';
import {
  QUADRATURE_CELL_M,
  canopyPctAfter,
  circleIntersectionAreaM2,
  crownAreaM2,
  crownRadiusAtYear,
  effectiveAddedCanopyM2,
  overlapFraction,
  summedCrownAreaM2,
  unionCanopyAreaM2,
  type Tree,
} from '../src/model/canopy.js';
import {
  R2_FULL,
  R2_WEAK,
  methodLabel,
  predictDeltaLST,
} from '../src/model/prediction.js';
import { REQUIRED_COVERAGE } from '../src/raster/mask.js';
import {
  costPlan,
  formatCostRange,
  isSourced,
  type CostModel,
} from '../src/model/cost.js';

describe('§4.5 OLS — Student-t critical values match published tables', () => {
  // Verified against standard two-sided t tables at alpha = 0.05.
  const table: Array<[number, number]> = [
    [1, 12.706],
    [2, 4.303],
    [3, 3.182],
    [5, 2.571],
    [10, 2.228],
    [20, 2.086],
    [30, 2.042],
    [60, 2.0],
    [120, 1.98],
    [1000, 1.962],
  ];

  for (const [df, expected] of table) {
    it(`t(0.05, df=${df}) ≈ ${expected}`, () => {
      expect(tCritical(df, 0.05)).toBeCloseTo(expected, 2);
    });
  }

  it('approaches the normal 1.96 as df grows', () => {
    expect(tCritical(100000, 0.05)).toBeCloseTo(1.96, 2);
  });

  it('tCDF is symmetric about zero', () => {
    expect(tCDF(0, 10)).toBeCloseTo(0.5, 6);
    expect(tCDF(2.228, 10) + tCDF(-2.228, 10)).toBeCloseTo(1, 6);
  });

  it('returns NaN for a nonsensical df instead of a plausible number', () => {
    expect(Number.isNaN(tCritical(0))).toBe(true);
    expect(Number.isNaN(tCritical(-4))).toBe(true);
  });
});

describe('§4.5 OLS — fit behaviour', () => {
  it('property: perfectly collinear input returns r2 === 1', () => {
    const f = olsFit([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]);
    expect(f.r2).toBe(1);
    expect(f.slope).toBeCloseTo(2, 12);
    expect(f.intercept).toBeCloseTo(0, 12);
    expect(f.n).toBe(5);
  });

  it('recovers a known negative slope — the LST~NDVI case', () => {
    const ndvi = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
    const lst = [42.0, 40.5, 39.2, 38.1, 36.4, 35.2];
    const f = olsFit(ndvi, lst);
    expect(f.slope).toBeLessThan(0);
    expect(f.r2).toBeGreaterThan(0.99);
    // The CI must bracket the point estimate.
    expect(f.slopeCI95[0]).toBeLessThan(f.slope);
    expect(f.slopeCI95[1]).toBeGreaterThan(f.slope);
  });

  it('widens the CI as scatter increases', () => {
    const x = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const tight = olsFit(x, x.map((v) => 40 - 10 * v));
    const noisy = olsFit(x, [40, 33, 39, 31, 38, 30, 37, 29]);
    const w = (f: typeof tight) => f.slopeCI95[1] - f.slopeCI95[0];
    expect(w(noisy)).toBeGreaterThan(w(tight));
  });

  it('drops non-finite pairs and reports the surviving n', () => {
    const f = olsFit([1, 2, Number.NaN, 4, 5], [2, 4, 6, Number.NaN, 10]);
    expect(f.n).toBe(3);
    expect(f.r2).toBe(1);
  });

  it('returns an explicit NaN fit with too few points — never a confident slope', () => {
    for (const f of [olsFit([], []), olsFit([1], [2]), olsFit([1, 2], [3, 4])]) {
      expect(Number.isNaN(f.slope)).toBe(true);
      expect(Number.isNaN(f.r2)).toBe(true);
      expect(Number.isNaN(f.slopeCI95[0])).toBe(true);
    }
  });

  it('returns NaN when x has zero variance', () => {
    const f = olsFit([5, 5, 5, 5], [1, 2, 3, 4]);
    expect(Number.isNaN(f.slope)).toBe(true);
    expect(f.n).toBe(4);
  });

  it('returns NaN r2 when y is constant — 0/0 is undefined, not perfect', () => {
    const f = olsFit([1, 2, 3, 4], [7, 7, 7, 7]);
    expect(Number.isNaN(f.r2)).toBe(true);
  });

  it('keeps r2 within [0,1]', () => {
    const f = olsFit([1, 2, 3, 4, 5, 6], [3, 1, 4, 1, 5, 9]);
    expect(f.r2).toBeGreaterThanOrEqual(0);
    expect(f.r2).toBeLessThanOrEqual(1);
  });

  it('throws on mismatched input lengths', () => {
    expect(() => olsFit([1, 2, 3], [1, 2])).toThrow(/length/);
  });
});

describe('§4.6 crown geometry', () => {
  const radii = new Map([
    ['large', 7.5],
    ['medium', 5.5],
    ['small', 3.5],
  ]);
  const tree = (id: string, x: number, y: number, classKey: string): Tree => ({
    id,
    x,
    y,
    classKey,
  });

  it('crownAreaM2 is πr²', () => {
    expect(crownAreaM2(5)).toBeCloseTo(Math.PI * 25, 10);
    expect(crownAreaM2(7.5)).toBeCloseTo(176.7146, 3);
  });

  it('treats a non-positive or unknown radius as zero area, not NaN', () => {
    expect(crownAreaM2(0)).toBe(0);
    expect(crownAreaM2(-2)).toBe(0);
    expect(crownAreaM2(Number.NaN)).toBe(0);
  });

  it('matches the closed-form lens area for two overlapping circles', () => {
    // Quadrature vs analytic: 6 m apart, radii 5 and 5.
    const analytic =
      2 * crownAreaM2(5) - circleIntersectionAreaM2(0, 0, 5, 6, 0, 5);
    const quad = unionCanopyAreaM2(
      [tree('a', 0, 0, 'r5'), tree('b', 6, 0, 'r5')],
      new Map([['r5', 5]]),
      undefined,
      0.25,
    );
    // Quadrature converges on the analytic value to well under 1%; the
    // relative-error bound below is the meaningful assertion.
    expect(Math.abs(quad - analytic) / analytic).toBeLessThan(0.01);
  });

  it('circleIntersectionAreaM2 handles disjoint and containment cases', () => {
    expect(circleIntersectionAreaM2(0, 0, 3, 100, 0, 3)).toBe(0);
    expect(circleIntersectionAreaM2(0, 0, 3, 6, 0, 3)).toBe(0); // exactly tangent
    // Fully contained: the smaller circle's area.
    expect(circleIntersectionAreaM2(0, 0, 10, 1, 0, 2)).toBeCloseTo(Math.PI * 4, 6);
  });

  it('property: union ≤ Σ crown area, always', () => {
    const layouts: Tree[][] = [
      [tree('a', 0, 0, 'large')],
      [tree('a', 0, 0, 'large'), tree('b', 2, 0, 'large')],
      [tree('a', 0, 0, 'large'), tree('b', 100, 100, 'large')],
      [
        tree('a', 0, 0, 'medium'),
        tree('b', 4, 0, 'medium'),
        tree('c', 2, 3, 'small'),
        tree('d', 2, 3, 'small'),
      ],
    ];
    for (const trees of layouts) {
      const summed = summedCrownAreaM2(trees, radii);
      expect(unionCanopyAreaM2(trees, radii)).toBeLessThanOrEqual(summed + 1e-9);
    }
  });

  it('is additive for well-separated trees', () => {
    const trees = [tree('a', 0, 0, 'medium'), tree('b', 200, 200, 'medium')];
    const union = unionCanopyAreaM2(trees, radii, undefined, 0.25);
    expect(union).toBeCloseTo(summedCrownAreaM2(trees, radii), 0);
    expect(overlapFraction(trees, radii)).toBeLessThan(0.01);
  });

  it('reports a real overlap fraction for closely spaced trees', () => {
    const trees = [tree('a', 0, 0, 'medium'), tree('b', 5, 0, 'medium')];
    const f = overlapFraction(trees, radii);
    expect(f).toBeGreaterThan(0.15);
    expect(f).toBeLessThan(0.6);
  });

  it('is zero-area and zero-overlap for an empty plan', () => {
    expect(unionCanopyAreaM2([], radii)).toBe(0);
    expect(overlapFraction([], radii)).toBe(0);
    expect(summedCrownAreaM2([], radii)).toBe(0);
  });

  it('ignores trees whose class has no known radius rather than guessing one', () => {
    const trees = [tree('a', 0, 0, 'unknown-class')];
    expect(unionCanopyAreaM2(trees, radii)).toBe(0);
    expect(summedCrownAreaM2(trees, radii)).toBe(0);
  });

  it('clips crown area to the yard polygon', () => {
    const yard = {
      outer: [
        [0, 0],
        [20, 0],
        [20, 20],
        [0, 20],
      ] as ReadonlyArray<readonly [number, number]>,
    };
    // Centred on the corner: only about a quarter of the crown is inside.
    const trees = [tree('a', 0, 0, 'medium')];
    const clipped = unionCanopyAreaM2(trees, radii, yard, 0.25);
    const unclipped = unionCanopyAreaM2(trees, radii, undefined, 0.25);
    expect(clipped).toBeLessThan(unclipped);
    expect(clipped / unclipped).toBeGreaterThan(0.15);
    expect(clipped / unclipped).toBeLessThan(0.35);
  });

  it('uses a documented deterministic quadrature cell', () => {
    expect(QUADRATURE_CELL_M).toBe(0.5);
  });

  it('is deterministic — identical input yields identical output', () => {
    const trees = [tree('a', 1, 1, 'large'), tree('b', 6, 2, 'medium')];
    const a = unionCanopyAreaM2(trees, radii);
    const b = unionCanopyAreaM2(trees, radii);
    expect(a).toBe(b);
  });

  it('property: canopyPctAfter stays within [0,100]', () => {
    expect(canopyPctAfter(0, 0, 1000)).toBe(0);
    expect(canopyPctAfter(500, 200, 1000)).toBeCloseTo(70, 10);
    // Over-planting cannot exceed 100%.
    expect(canopyPctAfter(900, 900, 1000)).toBe(100);
    for (const [e, a, y] of [
      [0, 0, 100],
      [10, 10, 100],
      [99, 99, 100],
      [1e6, 1e6, 100],
    ] as const) {
      const v = canopyPctAfter(e, a, y);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('returns NaN canopyPctAfter for a nonsensical yard area', () => {
    expect(Number.isNaN(canopyPctAfter(10, 10, 0))).toBe(true);
    expect(Number.isNaN(canopyPctAfter(10, 10, -5))).toBe(true);
  });

  it('discounts new canopy that would land on already-shaded ground', () => {
    // Half the yard is already shaded → new crowns are half as effective.
    expect(effectiveAddedCanopyM2(1000, 0.5)).toBeCloseTo(500, 10);
    expect(effectiveAddedCanopyM2(1000, 0)).toBeCloseTo(1000, 10);
    expect(effectiveAddedCanopyM2(1000, 1)).toBeCloseTo(0, 10);
    // Unknown existing canopy must not silently zero the plan.
    expect(effectiveAddedCanopyM2(1000, Number.NaN)).toBe(1000);
  });

  it('grows crown radius monotonically toward maturity', () => {
    expect(crownRadiusAtYear(6, 15, 0)).toBe(0);
    const y5 = crownRadiusAtYear(6, 15, 5);
    const y15 = crownRadiusAtYear(6, 15, 15);
    const y30 = crownRadiusAtYear(6, 15, 30);
    expect(y5).toBeGreaterThan(0);
    expect(y5).toBeLessThan(y15);
    expect(y15).toBeCloseTo(6, 6);
    expect(y30).toBeLessThanOrEqual(6);
  });
});

describe('§4.5 the R² gate — suppression is a typed outcome', () => {
  const fit = (r2: number, slope = -8, half = 1.5) => ({
    slope,
    intercept: 45,
    r2,
    n: 1284,
    slopeCI95: [slope - half, slope + half] as readonly [number, number],
    slopeSE: half / 2,
  });

  it('reports a full estimate when R² ≥ 0.5', () => {
    const p = predictDeltaLST(fit(0.71), 0.35, 1);
    expect(p.kind).toBe('ok');
    if (p.kind !== 'ok') throw new Error('unreachable');
    expect(p.deltaC).toBeCloseTo(-2.8, 10);
    expect(p.ci95[0]).toBeLessThan(p.ci95[1]);
  });

  it('flags a weak fit between 0.3 and 0.5 but still shows the number', () => {
    const p = predictDeltaLST(fit(0.4), 0.35, 1);
    expect(p.kind).toBe('weak');
    if (p.kind !== 'weak') throw new Error('unreachable');
    expect(p.caveat).toMatch(/weak local fit/i);
    expect(p.caveat).toContain('0.40');
  });

  it('SUPPRESSES the number entirely below R² 0.3', () => {
    const p = predictDeltaLST(fit(0.12), 0.35, 1);
    expect(p.kind).toBe('suppressed');
    if (p.kind !== 'suppressed') throw new Error('unreachable');
    expect(p.reason).toBe('low_r2');
    expect(p).not.toHaveProperty('deltaC');
    expect(p.explanation).toMatch(/not resolvable/i);
  });

  it('SUPPRESSES on insufficient cloud-free coverage — the on-camera failure', () => {
    const p = predictDeltaLST(fit(0.71), 0.35, 0.42);
    expect(p.kind).toBe('suppressed');
    if (p.kind !== 'suppressed') throw new Error('unreachable');
    expect(p.reason).toBe('insufficient_coverage');
    expect(p.explanation).toMatch(/42\.0% of this yard/);
  });

  it('checks coverage before fit quality — a cloudy yard fails first', () => {
    const p = predictDeltaLST(fit(0.05), 0.35, 0.1);
    expect(p.kind).toBe('suppressed');
    if (p.kind !== 'suppressed') throw new Error('unreachable');
    expect(p.reason).toBe('insufficient_coverage');
  });

  it('suppresses with no fit at all', () => {
    const p = predictDeltaLST(null, 0.35, 1);
    expect(p.kind).toBe('suppressed');
    if (p.kind !== 'suppressed') throw new Error('unreachable');
    expect(p.reason).toBe('no_fit');
  });

  it('suppresses a NaN-slope fit rather than printing NaN °C', () => {
    const bad = { ...fit(0.8), slope: Number.NaN };
    const p = predictDeltaLST(bad, 0.35, 1);
    expect(p.kind).toBe('suppressed');
  });

  it('suppresses when the yard ΔNDVI is unknown', () => {
    const p = predictDeltaLST(fit(0.71), Number.NaN, 1);
    expect(p.kind).toBe('suppressed');
    if (p.kind !== 'suppressed') throw new Error('unreachable');
    expect(p.reason).toBe('no_fit');
  });

  it('uses the documented gate thresholds', () => {
    expect(R2_WEAK).toBe(0.3);
    expect(R2_FULL).toBe(0.5);
    expect(REQUIRED_COVERAGE).toBe(0.8);
    // Boundaries are inclusive at the lower edge of each band.
    expect(predictDeltaLST(fit(0.3), 0.2, 1).kind).toBe('weak');
    expect(predictDeltaLST(fit(0.5), 0.2, 1).kind).toBe('ok');
    expect(predictDeltaLST(fit(0.71), 0.2, REQUIRED_COVERAGE).kind).toBe('ok');
  });

  it('keeps the CI ordered even when ΔNDVI is negative (canopy removal)', () => {
    const p = predictDeltaLST(fit(0.71), -0.2, 1);
    expect(p.kind).toBe('ok');
    if (p.kind !== 'ok') throw new Error('unreachable');
    // Removing canopy should warm the yard.
    expect(p.deltaC).toBeGreaterThan(0);
    expect(p.ci95[0]).toBeLessThanOrEqual(p.ci95[1]);
  });

  it('scales the ΔT interval from the slope interval', () => {
    const p = predictDeltaLST(fit(0.71, -8, 1.5), 0.5, 1);
    if (p.kind !== 'ok') throw new Error('unreachable');
    expect(p.ci95[0]).toBeCloseTo(-9.5 * 0.5, 10);
    expect(p.ci95[1]).toBeCloseTo(-6.5 * 0.5, 10);
  });

  it('methodLabel carries R², n and the maturity horizon', () => {
    const label = methodLabel(fit(0.71), 15);
    expect(label).toContain('R² = 0.71');
    expect(label).toContain('n = 1,284 px');
    expect(label).toContain('15-year');
    // Correlational language, never causal.
    expect(label).toMatch(/associated/i);
    expect(label).not.toMatch(/will cause|causes/i);
  });
});

describe('§4.7 cost model — a line without a citation is not printable', () => {
  const sourced = {
    source_name: 'City of Phoenix Office of Heat Response and Mitigation',
    source_url: 'https://example.org/price-sheet.pdf',
    source_retrieved: '2026-08-05',
  };

  const model: CostModel = {
    region: 'Maricopa County, AZ',
    currency: 'USD',
    last_verified: '2026-08-05',
    items: [
      {
        key: 'tree_large_shade_installed',
        label: 'Large shade tree, 2" caliper, installed',
        unit: 'each',
        low: 300,
        high: 500,
        ...sourced,
      },
      {
        key: 'establishment_watering_3yr',
        label: '3-year establishment watering',
        unit: 'per tree',
        low: 60,
        high: 120,
        ...sourced,
      },
      {
        key: 'uncited_item',
        label: 'Mulch and basin',
        unit: 'per tree',
        low: 20,
        high: 40,
        source_name: '',
        source_url: '',
        source_retrieved: '',
      },
    ],
    classCostKeys: { large: 'tree_large_shade_installed' },
    perTreeItemKeys: ['establishment_watering_3yr'],
  };

  const trees: Tree[] = [
    { id: 't1', x: 0, y: 0, classKey: 'large' },
    { id: 't2', x: 10, y: 0, classKey: 'large' },
  ];

  it('validates a source needs a name, an http(s) URL and an ISO date', () => {
    expect(isSourced(sourced)).toBe(true);
    expect(isSourced({ ...sourced, source_url: '' })).toBe(false);
    expect(isSourced({ ...sourced, source_url: 'not-a-url' })).toBe(false);
    expect(isSourced({ ...sourced, source_name: '  ' })).toBe(false);
    expect(isSourced({ ...sourced, source_retrieved: 'August 2026' })).toBe(false);
  });

  it('itemises quantities from the actual plan', () => {
    const b = costPlan(trees, model);
    const purchase = b.lines.find((l) => l.key === 'tree_large_shade_installed');
    expect(purchase?.quantity).toBe(2);
    expect(purchase?.totalLow).toBe(600);
    expect(purchase?.totalHigh).toBe(1000);
    const water = b.lines.find((l) => l.key === 'establishment_watering_3yr');
    expect(water?.quantity).toBe(2);
  });

  it('totals as a range, never a point estimate', () => {
    const b = costPlan(trees, model);
    expect(b.totalLow).toBe(720);
    expect(b.totalHigh).toBe(1240);
    expect(formatCostRange(b)).toMatch(/\$720\s*–\s*\$1,240/);
  });

  it('flags an unknown cost item instead of pricing it at zero', () => {
    const b = costPlan([{ id: 'x', x: 0, y: 0, classKey: 'no-such-class' }], model);
    const line = b.lines[0]!;
    expect(line.unsourced).toBe(true);
    expect(Number.isNaN(line.totalLow)).toBe(true);
    expect(b.hasUnsourcedLines).toBe(true);
  });

  it('refuses to format a headline cost when any line lacks a citation', () => {
    const withUncited: CostModel = {
      ...model,
      perTreeItemKeys: ['establishment_watering_3yr', 'uncited_item'],
    };
    const b = costPlan(trees, withUncited);
    expect(b.hasUnsourcedLines).toBe(true);
    expect(formatCostRange(b)).toMatch(/cost not shown/i);
    expect(formatCostRange(b)).not.toMatch(/\$/);
  });

  it('excludes uncited lines from the totals rather than adding a fabricated figure', () => {
    const withUncited: CostModel = {
      ...model,
      perTreeItemKeys: ['establishment_watering_3yr', 'uncited_item'],
    };
    const b = costPlan(trees, withUncited);
    expect(b.totalLow).toBe(720);
  });

  it('produces no lines and a zero total for an empty plan', () => {
    const b = costPlan([], model);
    expect(b.lines).toEqual([]);
    expect(b.totalLow).toBe(0);
    expect(b.hasUnsourcedLines).toBe(false);
  });

  it('carries the region, currency and verification date through to the breakdown', () => {
    const b = costPlan(trees, model);
    expect(b.region).toBe('Maricopa County, AZ');
    expect(b.currency).toBe('USD');
    expect(b.lastVerified).toBe('2026-08-05');
  });
});
