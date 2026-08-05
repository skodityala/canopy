/**
 * Ordinary least squares with R² and a 95% confidence interval on the slope.
 * §4.5.
 *
 * The whole ΔT claim rests on this fit, so the CI is computed from a real
 * Student-t quantile at n−2 degrees of freedom rather than a hardcoded 1.96.
 * With ~1,200 thermal pixels the two nearly coincide, but a judge asking "where
 * does that interval come from?" gets a correct answer instead of a shrug.
 */

export interface Fit {
  readonly slope: number;
  readonly intercept: number;
  readonly r2: number;
  readonly n: number;
  readonly slopeCI95: readonly [number, number];
  /** Standard error of the slope — kept so the PDF can show it. */
  readonly slopeSE: number;
}

/**
 * Regularised incomplete beta function, continued-fraction form
 * (Lentz's algorithm). Used for the Student-t CDF.
 */
function incompleteBeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lbeta =
    lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) {
    return Math.exp(lbeta) * betaCF(a, b, x) / a;
  }
  return 1 - Math.exp(lbeta) * betaCF(b, a, 1 - x) / b;
}

function betaCF(a: number, b: number, x: number): number {
  const MAXIT = 200;
  const EPS = 3e-14;
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

/**
 * Lanczos approximation to ln Γ(z), for z ≥ 0.5.
 *
 * The usual reflection branch for z < 0.5 is omitted deliberately: the only
 * callers pass df/2, 0.5, or their sum, and `tCritical` rejects df ≤ 0, so z is
 * never below 0.5. Carrying an unreachable branch would be dead code that no
 * test can honestly cover.
 */
function lnGamma(z: number): number {
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012,
    9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const zz = z - 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < g.length; i++) x += g[i]! / (zz + i + 1);
  const t = zz + g.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (zz + 0.5) * Math.log(t) - t + Math.log(x);
}

/** Two-sided Student-t CDF at t with df degrees of freedom. */
export function tCDF(t: number, df: number): number {
  const x = df / (df + t * t);
  const p = 0.5 * incompleteBeta(df / 2, 0.5, x);
  return t > 0 ? 1 - p : p;
}

/**
 * Two-sided critical value t such that P(|T| ≤ t) = 1 − alpha, by bisection on
 * the CDF. Monotone and well-behaved, so bisection is both simple and exact to
 * the tolerance.
 */
export function tCritical(df: number, alpha = 0.05): number {
  if (!Number.isFinite(df) || df <= 0) return Number.NaN;
  const target = 1 - alpha / 2;
  let lo = 0;
  let hi = 1000;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tCDF(mid, df) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Fit y = intercept + slope·x.
 *
 * Degenerate inputs return an explicit NaN fit with n recorded, never a
 * confident-looking zero slope:
 *   - fewer than 3 points (no residual degrees of freedom)
 *   - zero variance in x (vertical / single-valued predictor)
 *
 * Perfectly collinear input returns r2 === 1 exactly.
 */
export function olsFit(x: readonly number[], y: readonly number[]): Fit {
  if (x.length !== y.length) {
    throw new Error('olsFit: x and y differ in length');
  }
  // Drop pairs where either side is unknown.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = y[i]!;
    if (Number.isFinite(xi) && Number.isFinite(yi)) {
      xs.push(xi);
      ys.push(yi);
    }
  }
  const n = xs.length;
  const degenerate: Fit = {
    slope: Number.NaN,
    intercept: Number.NaN,
    r2: Number.NaN,
    n,
    slopeCI95: [Number.NaN, Number.NaN],
    slopeSE: Number.NaN,
  };
  if (n < 3) return degenerate;

  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    const dy = ys[i]! - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return degenerate;

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  // Residual sum of squares, computed directly for numerical honesty.
  let rss = 0;
  for (let i = 0; i < n; i++) {
    const resid = ys[i]! - (intercept + slope * xs[i]!);
    rss += resid * resid;
  }

  // syy === 0 means y is constant: the model explains nothing and R² is
  // undefined (0/0). Report NaN rather than 1.
  const r2 = syy === 0 ? Number.NaN : Math.max(0, Math.min(1, 1 - rss / syy));

  const df = n - 2;
  const mse = rss / df;
  const slopeSE = Math.sqrt(mse / sxx);
  const tc = tCritical(df, 0.05);
  const half = tc * slopeSE;

  return {
    slope,
    intercept,
    r2,
    n,
    slopeCI95: [slope - half, slope + half],
    slopeSE,
  };
}
