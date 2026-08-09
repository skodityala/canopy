/**
 * Split conformal prediction intervals.
 *
 * WHY THIS SITS ALONGSIDE THE STUDENT-t INTERVAL RATHER THAN REPLACING IT
 *
 * The t-interval assumes residuals are normal and homoscedastic. LST residuals
 * over a neighbourhood are neither: hot impervious surfaces are noisier than
 * shaded ones (heteroscedastic) and the noise is spatially structured. When those
 * assumptions fail, the t-interval is not merely imprecise — it is confidently
 * the wrong width, and it fails in the direction that flatters the tool.
 *
 * Split conformal makes NO distributional assumption. Fit on a training split,
 * take the empirical quantile of absolute residuals on a held-out calibration
 * split, and emit ŷ ± q. The resulting interval carries a finite-sample marginal
 * coverage guarantee of at least 1 − α under exchangeability alone.
 *
 * Both intervals are reported together, deliberately. Conformal is usually the
 * wider of the two, and THAT GAP IS THE FINDING: it is the amount of confidence
 * the parametric assumption was manufacturing. A tool built to refuse
 * unsupportable claims should show its own overconfidence rather than hide it.
 *
 * MONDRIAN (group-conditional) conformal extends this by calibrating separately
 * within NDVI strata, so the interval widens where evidence is genuinely thinner
 * instead of averaging that away into a single global width.
 */

import { olsFit } from './regression.js';

export interface ConformalInterval {
  /** Point prediction. */
  readonly prediction: number;
  readonly lower: number;
  readonly upper: number;
  /** Half-width — the calibrated quantile of absolute residuals. */
  readonly halfWidth: number;
  /** Nominal coverage level, e.g. 0.95. */
  readonly level: number;
  /** Calibration points that produced the quantile. */
  readonly calibrationN: number;
}

export interface ConformalModel {
  readonly slope: number;
  readonly intercept: number;
  /** The calibrated half-width at the requested level. */
  readonly halfWidth: number;
  readonly level: number;
  readonly calibrationN: number;
  readonly trainN: number;
}

export interface IntervalComparison {
  /** Half-width of the parametric Student-t interval on a prediction. */
  readonly parametricHalfWidth: number;
  /** Half-width of the distribution-free conformal interval. */
  readonly conformalHalfWidth: number;
  /**
   * conformal / parametric. Above 1 means the t-interval was optimistic by that
   * factor — the confidence its assumptions were manufacturing.
   */
  readonly ratio: number;
}

/** mulberry32 — inline, because core carries no dependencies. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The conformal quantile.
 *
 * Uses the ⌈(n+1)(1−α)⌉ / n order statistic rather than the plain empirical
 * quantile. That finite-sample correction is what upgrades the guarantee from
 * asymptotic to exact: coverage is at least 1 − α for any n, not merely in the
 * limit. With small calibration sets the two differ materially.
 */
export function conformalQuantile(absResiduals: readonly number[], level: number): number {
  const clean = absResiduals.filter((r) => Number.isFinite(r)).sort((a, b) => a - b);
  const n = clean.length;
  if (n === 0) return Number.NaN;
  const alpha = 1 - level;
  const rank = Math.ceil((n + 1) * (1 - alpha));
  // Rank beyond n means the sample is too small to certify this level; the
  // widest observed residual is the most that can honestly be claimed.
  if (rank > n) return clean[n - 1]!;
  return clean[Math.max(0, rank - 1)]!;
}

/**
 * Fit a split conformal predictor.
 *
 * The split is seeded rather than random, because an interval that changes
 * between runs cannot be cited in a document.
 */
export function fitSplitConformal(
  x: readonly number[],
  y: readonly number[],
  opts: { level?: number; calibrationFraction?: number; seed?: number } = {},
): ConformalModel {
  const level = opts.level ?? 0.95;
  const frac = opts.calibrationFraction ?? 0.3;
  const seed = opts.seed ?? 20260809;

  const pairs: Array<readonly [number, number]> = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    if (Number.isFinite(xi) && Number.isFinite(yi)) pairs.push([xi, yi]);
  }

  const n = pairs.length;
  const degenerate: ConformalModel = {
    slope: Number.NaN,
    intercept: Number.NaN,
    halfWidth: Number.NaN,
    level,
    calibrationN: 0,
    trainN: n,
  };
  // Need at least 3 to fit and 1 to calibrate. Below that the interval is
  // undefined, and NaN says so rather than a fabricated width.
  if (n < 5) return degenerate;

  const order = Array.from({ length: n }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }

  const nCal = Math.max(1, Math.min(n - 3, Math.round(n * frac)));
  const calIdx = order.slice(0, nCal);
  const trainIdx = order.slice(nCal);

  const fit = olsFit(
    trainIdx.map((i) => pairs[i]![0]),
    trainIdx.map((i) => pairs[i]![1]),
  );
  if (!Number.isFinite(fit.slope) || !Number.isFinite(fit.intercept)) return degenerate;

  const absResiduals = calIdx.map((i) => {
    const [xi, yi] = pairs[i]!;
    return Math.abs(yi - (fit.intercept + fit.slope * xi));
  });

  return {
    slope: fit.slope,
    intercept: fit.intercept,
    halfWidth: conformalQuantile(absResiduals, level),
    level,
    calibrationN: nCal,
    trainN: trainIdx.length,
  };
}

/** Predict with a conformal interval. */
export function conformalPredict(model: ConformalModel, x: number): ConformalInterval {
  const prediction = model.intercept + model.slope * x;
  return {
    prediction,
    lower: prediction - model.halfWidth,
    upper: prediction + model.halfWidth,
    halfWidth: model.halfWidth,
    level: model.level,
    calibrationN: model.calibrationN,
  };
}

/**
 * Mondrian (group-conditional) conformal, stratified by the predictor.
 *
 * A single global half-width averages a confident region together with a sparse
 * one, so both are misreported. Calibrating within strata lets the interval widen
 * exactly where the evidence is thin. Strata with too few calibration points fall
 * back to the pooled width, and the fallback is recorded rather than silent.
 */
export interface MondrianModel {
  readonly slope: number;
  readonly intercept: number;
  readonly level: number;
  /** Strata boundaries in x, ascending. `strata.length + 1` groups exist. */
  readonly bounds: readonly number[];
  /** Half-width per group. NaN where a group had no calibration points. */
  readonly halfWidths: readonly number[];
  /** Pooled width, used where a group is too sparse to calibrate. */
  readonly pooledHalfWidth: number;
  readonly groupCounts: readonly number[];
}

export function fitMondrianConformal(
  x: readonly number[],
  y: readonly number[],
  opts: {
    level?: number;
    groups?: number;
    calibrationFraction?: number;
    seed?: number;
    minPerGroup?: number;
  } = {},
): MondrianModel {
  const level = opts.level ?? 0.95;
  const groups = Math.max(2, opts.groups ?? 3);
  const minPerGroup = opts.minPerGroup ?? 5;
  const base = fitSplitConformal(x, y, {
    level,
    ...(opts.calibrationFraction === undefined
      ? {}
      : { calibrationFraction: opts.calibrationFraction }),
    ...(opts.seed === undefined ? {} : { seed: opts.seed }),
  });

  const pairs: Array<readonly [number, number]> = [];
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    if (Number.isFinite(xi) && Number.isFinite(yi)) pairs.push([xi, yi]);
  }

  if (!Number.isFinite(base.slope) || pairs.length === 0) {
    return {
      slope: base.slope,
      intercept: base.intercept,
      level,
      bounds: [],
      halfWidths: [],
      pooledHalfWidth: base.halfWidth,
      groupCounts: [],
    };
  }

  // Equal-count strata, so boundaries follow the data rather than an arbitrary
  // split of the x range.
  const sortedX = pairs.map((p) => p[0]).sort((a, b) => a - b);
  const bounds: number[] = [];
  for (let g = 1; g < groups; g++) {
    bounds.push(sortedX[Math.floor((sortedX.length * g) / groups)]!);
  }

  const groupOf = (xv: number): number => {
    let g = 0;
    while (g < bounds.length && xv >= bounds[g]!) g++;
    return g;
  };

  const perGroup: number[][] = Array.from({ length: groups }, () => []);
  for (const [xi, yi] of pairs) {
    perGroup[groupOf(xi)]!.push(Math.abs(yi - (base.intercept + base.slope * xi)));
  }

  const halfWidths = perGroup.map((residuals) =>
    residuals.length >= minPerGroup
      ? conformalQuantile(residuals, level)
      : base.halfWidth,
  );

  return {
    slope: base.slope,
    intercept: base.intercept,
    level,
    bounds,
    halfWidths,
    pooledHalfWidth: base.halfWidth,
    groupCounts: perGroup.map((r) => r.length),
  };
}

export function mondrianPredict(model: MondrianModel, x: number): ConformalInterval {
  let g = 0;
  while (g < model.bounds.length && x >= model.bounds[g]!) g++;
  const halfWidth = model.halfWidths[g] ?? model.pooledHalfWidth;
  const prediction = model.intercept + model.slope * x;
  return {
    prediction,
    lower: prediction - halfWidth,
    upper: prediction + halfWidth,
    halfWidth,
    level: model.level,
    calibrationN: model.groupCounts[g] ?? 0,
  };
}

/** Measure how much narrower the parametric interval was. */
export function compareIntervals(
  parametricHalfWidth: number,
  conformalHalfWidth: number,
): IntervalComparison {
  return {
    parametricHalfWidth,
    conformalHalfWidth,
    ratio:
      parametricHalfWidth === 0 || !Number.isFinite(parametricHalfWidth)
        ? Number.NaN
        : conformalHalfWidth / parametricHalfWidth,
  };
}

/**
 * Empirical coverage of an interval rule on held-out data.
 *
 * This is the property that makes the conformal guarantee checkable rather than
 * asserted, and it is what the test suite exercises across seeds.
 */
export function empiricalCoverage(
  x: readonly number[],
  y: readonly number[],
  predict: (xv: number) => ConformalInterval,
): number {
  let covered = 0;
  let total = 0;
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue;
    const iv = predict(xi);
    if (!Number.isFinite(iv.lower) || !Number.isFinite(iv.upper)) continue;
    total++;
    if (yi >= iv.lower && yi <= iv.upper) covered++;
  }
  return total === 0 ? Number.NaN : covered / total;
}
