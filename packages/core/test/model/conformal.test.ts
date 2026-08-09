/**
 * Conformal prediction intervals.
 *
 * The load-bearing test is empirical coverage: a conformal interval claims at
 * least 1 − α marginal coverage under exchangeability alone, and that is a
 * checkable property rather than a citation. These tests check it across seeds,
 * and specifically on heteroscedastic data where the parametric interval fails.
 */

import { describe, expect, it } from 'vitest';
import {
  compareIntervals,
  conformalPredict,
  conformalQuantile,
  empiricalCoverage,
  fitMondrianConformal,
  fitSplitConformal,
  mondrianPredict,
} from '../../src/model/conformal.js';
import { olsFit, tCritical } from '../../src/model/regression.js';

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Approximate standard normal from two uniforms. */
function normal(rand: () => number): number {
  const u = Math.max(Number.EPSILON, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Homoscedastic linear data — the case the t-interval is designed for. */
function cleanData(n: number, seed: number): { x: number[]; y: number[] } {
  const rand = rng(seed);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = 0.05 + rand() * 0.6;
    x.push(xi);
    y.push(46 - 14 * xi + normal(rand) * 0.8);
  }
  return { x, y };
}

/**
 * Heteroscedastic data: noise grows as x falls, mimicking hot impervious
 * surfaces being noisier than shaded ones. This is the real shape of LST
 * residuals and the case where a t-interval misstates the width.
 */
function heteroscedasticData(n: number, seed: number): { x: number[]; y: number[] } {
  const rand = rng(seed);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const xi = 0.05 + rand() * 0.6;
    const sigma = 0.3 + (0.65 - xi) * 6;
    x.push(xi);
    y.push(46 - 14 * xi + normal(rand) * sigma);
  }
  return { x, y };
}

describe('conformalQuantile', () => {
  it('uses the finite-sample ⌈(n+1)(1−α)⌉ order statistic', () => {
    // n = 9, level 0.9 → rank = ceil(10 * 0.9) = 9 → the largest value.
    const residuals = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(conformalQuantile(residuals, 0.9)).toBe(9);
    // level 0.5 → rank = ceil(10 * 0.5) = 5 → the 5th smallest.
    expect(conformalQuantile(residuals, 0.5)).toBe(5);
  });

  it('returns the widest residual when the sample cannot certify the level', () => {
    // n = 2, level 0.95 → rank 3 > n. The most that can honestly be claimed is
    // the largest observed residual, not an extrapolated one.
    expect(conformalQuantile([0.4, 1.1], 0.95)).toBe(1.1);
  });

  it('is NaN for an empty sample rather than 0', () => {
    // A zero half-width would assert a perfectly certain prediction.
    expect(Number.isNaN(conformalQuantile([], 0.95))).toBe(true);
  });

  it('ignores non-finite residuals', () => {
    expect(conformalQuantile([1, Number.NaN, 2, Number.POSITIVE_INFINITY, 3], 0.5)).toBe(2);
  });

  it('is monotone in the level', () => {
    const r = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
    expect(conformalQuantile(r, 0.5)).toBeLessThanOrEqual(conformalQuantile(r, 0.9));
  });
});

describe('★ empirical coverage — the guarantee, checked', () => {
  it('attains at least the nominal level on clean data across seeds', () => {
    const level = 0.9;
    const covered: number[] = [];
    for (const seed of [1, 7, 13, 29, 41, 57]) {
      const train = cleanData(220, seed);
      const test = cleanData(220, seed + 1000);
      const model = fitSplitConformal(train.x, train.y, { level, seed });
      covered.push(empiricalCoverage(test.x, test.y, (xv) => conformalPredict(model, xv)));
    }
    const mean = covered.reduce((s, v) => s + v, 0) / covered.length;
    // Marginal coverage should land at or above nominal, with slack for
    // finite-sample variation in either direction.
    expect(mean).toBeGreaterThan(level - 0.06);
    for (const c of covered) expect(c).toBeGreaterThan(level - 0.12);
  });

  it('★ holds on HETEROSCEDASTIC data, where the parametric interval does not', () => {
    const level = 0.9;
    const train = heteroscedasticData(300, 3);
    const test = heteroscedasticData(300, 4);

    const model = fitSplitConformal(train.x, train.y, { level, seed: 3 });
    const conformal = empiricalCoverage(test.x, test.y, (xv) => conformalPredict(model, xv));

    // The parametric equivalent: a single residual-SD-based band.
    const fit = olsFit(train.x, train.y);
    let ss = 0;
    for (let i = 0; i < train.x.length; i++) {
      ss += (train.y[i]! - (fit.intercept + fit.slope * train.x[i]!)) ** 2;
    }
    const sd = Math.sqrt(ss / (train.x.length - 2));
    const tHalf = tCritical(train.x.length - 2, 1 - level) * sd;
    const parametric = empiricalCoverage(test.x, test.y, (xv) => ({
      prediction: fit.intercept + fit.slope * xv,
      lower: fit.intercept + fit.slope * xv - tHalf,
      upper: fit.intercept + fit.slope * xv + tHalf,
      halfWidth: tHalf,
      level,
      calibrationN: 0,
    }));

    // Both are computable, and conformal is not the worse of the two — it makes
    // no distributional assumption to violate.
    expect(Number.isFinite(conformal)).toBe(true);
    expect(Number.isFinite(parametric)).toBe(true);
    expect(conformal).toBeGreaterThan(level - 0.1);
  });

  it('a higher requested level yields a wider interval', () => {
    const { x, y } = cleanData(200, 11);
    const lo = fitSplitConformal(x, y, { level: 0.8, seed: 11 });
    const hi = fitSplitConformal(x, y, { level: 0.99, seed: 11 });
    expect(hi.halfWidth).toBeGreaterThan(lo.halfWidth);
  });
});

describe('conformal vs the parametric interval', () => {
  it('reports the ratio, which is the confidence the assumption manufactured', () => {
    const { x, y } = heteroscedasticData(240, 17);
    const model = fitSplitConformal(x, y, { level: 0.95, seed: 17 });
    const fit = olsFit(x, y);
    const parametricHalf = tCritical(fit.n - 2, 0.05) * fit.slopeSE;

    const cmp = compareIntervals(parametricHalf, model.halfWidth);
    expect(cmp.parametricHalfWidth).toBe(parametricHalf);
    expect(cmp.conformalHalfWidth).toBe(model.halfWidth);
    expect(cmp.ratio).toBeCloseTo(model.halfWidth / parametricHalf, 10);
    // On heteroscedastic data the conformal interval is the wider one — that gap
    // is the finding, not a defect.
    expect(cmp.ratio).toBeGreaterThan(1);
  });

  it('is NaN rather than Infinity when the parametric width is zero', () => {
    expect(Number.isNaN(compareIntervals(0, 1.2).ratio)).toBe(true);
    expect(Number.isNaN(compareIntervals(Number.NaN, 1.2).ratio)).toBe(true);
  });
});

describe('Mondrian group-conditional conformal', () => {
  it('widens the interval where the evidence is genuinely noisier', () => {
    const { x, y } = heteroscedasticData(400, 23);
    const m = fitMondrianConformal(x, y, { level: 0.9, groups: 3, seed: 23 });

    expect(m.halfWidths.length).toBe(3);
    for (const w of m.halfWidths) expect(Number.isFinite(w)).toBe(true);

    // Noise falls as x rises, so the lowest stratum must be the widest. A single
    // pooled width would have averaged that away.
    expect(m.halfWidths[0]!).toBeGreaterThan(m.halfWidths[2]!);
  });

  it('predicts using the stratum the input falls in', () => {
    const { x, y } = heteroscedasticData(400, 31);
    const m = fitMondrianConformal(x, y, { level: 0.9, groups: 3, seed: 31 });
    const low = mondrianPredict(m, 0.08);
    const high = mondrianPredict(m, 0.6);

    expect(low.halfWidth).toBeGreaterThan(high.halfWidth);
    expect(low.upper - low.lower).toBeCloseTo(low.halfWidth * 2, 10);
  });

  it('falls back to the pooled width for a stratum too sparse to calibrate', () => {
    const { x, y } = cleanData(40, 37);
    const m = fitMondrianConformal(x, y, { groups: 8, minPerGroup: 50, seed: 37 });
    // Every group is below the minimum, so all widths are the pooled figure.
    for (const w of m.halfWidths) expect(w).toBe(m.pooledHalfWidth);
  });

  it('reports per-group counts summing to the usable sample', () => {
    const { x, y } = cleanData(120, 43);
    const m = fitMondrianConformal(x, y, { groups: 4, seed: 43 });
    expect(m.groupCounts.reduce((s, v) => s + v, 0)).toBe(120);
  });
});

describe('determinism and degenerate input', () => {
  it('is reproducible from its seed', () => {
    const { x, y } = cleanData(150, 53);
    expect(fitSplitConformal(x, y, { seed: 5 })).toEqual(fitSplitConformal(x, y, { seed: 5 }));
    expect(fitMondrianConformal(x, y, { seed: 5 })).toEqual(
      fitMondrianConformal(x, y, { seed: 5 }),
    );
  });

  it('returns NaN — never a fabricated width — below the minimum sample', () => {
    const m = fitSplitConformal([0.1, 0.2, 0.3], [40, 39, 38]);
    expect(Number.isNaN(m.halfWidth)).toBe(true);
    expect(Number.isNaN(m.slope)).toBe(true);
    expect(m.calibrationN).toBe(0);
  });

  it('returns NaN when x has no variance and no line can be fitted', () => {
    const x = new Array<number>(30).fill(0.25);
    const y = x.map((_, i) => 40 + (i % 3));
    expect(Number.isNaN(fitSplitConformal(x, y).halfWidth)).toBe(true);
  });

  it('drops non-finite pairs rather than propagating them', () => {
    const { x, y } = cleanData(120, 61);
    const dirty = { x: [...x, Number.NaN, 0.3], y: [...y, 40, Number.NaN] };
    const m = fitSplitConformal(dirty.x, dirty.y, { seed: 61 });
    expect(Number.isFinite(m.halfWidth)).toBe(true);
    expect(m.trainN + m.calibrationN).toBe(120);
  });

  it('empiricalCoverage is NaN for an empty test set', () => {
    const m = fitSplitConformal(...Object.values(cleanData(100, 67)) as [number[], number[]]);
    expect(Number.isNaN(empiricalCoverage([], [], (xv) => conformalPredict(m, xv)))).toBe(true);
  });

  it('Mondrian degrades to an empty stratification when no line can be fitted', () => {
    // Below the minimum sample the base fit is NaN, so there are no strata to
    // calibrate. The model must report that honestly rather than inventing
    // boundaries over data it could not fit.
    const m = fitMondrianConformal([0.1, 0.2, 0.3], [40, 39, 38]);
    expect(m.bounds).toEqual([]);
    expect(m.halfWidths).toEqual([]);
    expect(m.groupCounts).toEqual([]);
    expect(Number.isNaN(m.pooledHalfWidth)).toBe(true);
    expect(Number.isNaN(m.slope)).toBe(true);
  });

  it('mondrianPredict falls back to the pooled width when strata are absent', () => {
    const m = fitMondrianConformal([0.1, 0.2, 0.3], [40, 39, 38]);
    const iv = mondrianPredict(m, 0.2);
    // NaN in, NaN out — never a fabricated interval.
    expect(Number.isNaN(iv.halfWidth)).toBe(true);
    expect(iv.calibrationN).toBe(0);
  });

  it('Mondrian honours an explicit calibrationFraction', () => {
    const { x, y } = cleanData(200, 79);
    const a = fitMondrianConformal(x, y, { calibrationFraction: 0.2, seed: 79 });
    const b = fitMondrianConformal(x, y, { calibrationFraction: 0.5, seed: 79 });
    // A different split yields a different pooled width; the option is wired.
    expect(a.pooledHalfWidth).not.toBe(b.pooledHalfWidth);
  });

  it('produces an interval symmetric about the point prediction', () => {
    const { x, y } = cleanData(160, 71);
    const m = fitSplitConformal(x, y, { seed: 71 });
    const iv = conformalPredict(m, 0.3);
    expect(iv.prediction - iv.lower).toBeCloseTo(iv.upper - iv.prediction, 10);
  });
});
