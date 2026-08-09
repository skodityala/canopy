/**
 * Spatial block cross-validation, and Moran's I on the residuals.
 *
 * WHY THIS MODULE EXISTS — it is a correctness fix, not a feature.
 *
 * The pipeline fits LST ~ NDVI over the thermal cells of a neighbourhood and
 * feeds the resulting R² into the suppression gate: below 0.30 the temperature
 * claim is withheld entirely.
 *
 * Standard random k-fold cross-validation assumes independent samples. Adjacent
 * satellite pixels are not independent — a cell and its neighbour are very nearly
 * the same observation, because a hot parking lot or a shaded street spans
 * several 100 m cells. Random k-fold therefore puts near-duplicate neighbours in
 * BOTH the training and the test fold. The model is scored on data it has
 * effectively already seen, which INFLATES R².
 *
 * That inflation is not cosmetic here. R² drives the gate, so an inflated R²
 * means THE GATE FAILS TO FIRE WHEN IT SHOULD — a silent failure in the exact
 * mechanism the project is built around. A leaky validation makes the tool more
 * confident than the data warrants, which is the one direction it must never err.
 *
 * The fix is to hold out contiguous spatial BLOCKS rather than individual cells,
 * so a test block's neighbours are also held out and cannot leak into training.
 * `validateFit` reports both numbers side by side and hands the gate the spatial
 * one. Reporting both is deliberate: the gap between them is the amount of
 * confidence the naive method was manufacturing.
 */

import type { Fit } from './regression.js';
import { olsFit } from './regression.js';

/** A predictor/response pair with its integer position on the raster grid. */
export interface SpatialSample {
  /** Predictor — NDVI. */
  readonly x: number;
  /** Response — LST in °C. */
  readonly y: number;
  readonly col: number;
  readonly row: number;
}

export interface BlockAssignment {
  /** `blockOf[i]` is the dense block index of sample i. */
  readonly blockOf: readonly number[];
  /** Number of NON-EMPTY blocks. */
  readonly blockCount: number;
}

export interface CvResult {
  /** Pooled out-of-fold R². Floored at 0 — see the note in `pooledR2`. */
  readonly r2: number;
  readonly rmse: number;
  readonly folds: number;
  /** Samples that survived the finite-value filter. */
  readonly n: number;
  readonly perFoldR2: readonly number[];
}

export interface ValidationReport {
  readonly naive: CvResult;
  readonly spatial: CvResult;
  /** naive.r2 − spatial.r2. Positive means the naive estimate was inflated. */
  readonly leakage: number;
  /** Moran's I on the in-sample residuals. NaN when undefined. */
  readonly moransI: number;
  /** The R² the suppression gate must use. ALWAYS the spatial figure. */
  readonly gateR2: number;
}

export interface ValidateOptions {
  readonly blockSizeCells?: number;
  readonly kFolds?: number;
  readonly seed?: number;
}

/** Drop samples that cannot enter a fit. Unknown is excluded, never coerced. */
function finiteOnly(samples: readonly SpatialSample[]): SpatialSample[] {
  return samples.filter(
    (s) =>
      Number.isFinite(s.x) &&
      Number.isFinite(s.y) &&
      Number.isFinite(s.col) &&
      Number.isFinite(s.row),
  );
}

/** mulberry32 — inline because core carries no dependencies. */
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
 * Partition samples into square tiles of `blockSizeCells` on the raster grid.
 *
 * A tile is contiguous by construction, and tiles are disjoint, which is exactly
 * the property random folds lack. Used blocks are renumbered to a dense range so
 * `blockCount` counts non-empty blocks only.
 */
export function checkerboardBlocks(
  samples: readonly SpatialSample[],
  blockSizeCells: number,
): BlockAssignment {
  const size = Math.max(1, Math.floor(blockSizeCells));
  const dense = new Map<string, number>();
  const blockOf: number[] = [];

  for (const s of samples) {
    const bx = Math.floor(s.col / size);
    const by = Math.floor(s.row / size);
    const key = `${bx},${by}`;
    let idx = dense.get(key);
    if (idx === undefined) {
      idx = dense.size;
      dense.set(key, idx);
    }
    blockOf.push(idx);
  }

  return { blockOf, blockCount: dense.size };
}

/**
 * Pooled out-of-fold R² and RMSE.
 *
 * R² is floored at 0: a model that predicts worse than the mean of the held-out
 * data has no explanatory power, and reporting −0.4 invites the reader to treat
 * it as a magnitude. It is not clamped above, so genuine strength still shows.
 */
function pooledR2(
  actual: readonly number[],
  predicted: readonly number[],
): { r2: number; rmse: number } {
  const n = actual.length;
  if (n === 0) return { r2: Number.NaN, rmse: Number.NaN };

  let sum = 0;
  for (const v of actual) sum += v;
  const mean = sum / n;

  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const a = actual[i]!;
    const p = predicted[i]!;
    ssRes += (a - p) ** 2;
    ssTot += (a - mean) ** 2;
  }

  // Zero variance in the held-out response: R² is 0/0, which is undefined.
  // NaN, never 0 — 0 would read as "explains nothing", a different claim.
  const r2 = ssTot === 0 ? Number.NaN : Math.max(0, 1 - ssRes / ssTot);
  return { r2, rmse: Math.sqrt(ssRes / n) };
}

/** Fit on the training indices, predict the held-out ones. */
function foldOutcome(
  samples: readonly SpatialSample[],
  heldOut: readonly number[],
  isHeldOut: (i: number) => boolean,
): { actual: number[]; predicted: number[]; r2: number } {
  const trainX: number[] = [];
  const trainY: number[] = [];
  for (let i = 0; i < samples.length; i++) {
    if (isHeldOut(i)) continue;
    const s = samples[i]!;
    trainX.push(s.x);
    trainY.push(s.y);
  }

  const fit: Fit = olsFit(trainX, trainY);
  const actual: number[] = [];
  const predicted: number[] = [];

  if (!Number.isFinite(fit.slope) || !Number.isFinite(fit.intercept)) {
    return { actual, predicted, r2: Number.NaN };
  }

  for (const i of heldOut) {
    const s = samples[i]!;
    actual.push(s.y);
    predicted.push(fit.intercept + fit.slope * s.x);
  }

  return { actual, predicted, r2: pooledR2(actual, predicted).r2 };
}

/**
 * Standard random k-fold.
 *
 * This exists to DEMONSTRATE the leakage, so it is honest random k-fold rather
 * than a strawman. It is seeded, because a validation number that changes
 * between runs cannot be cited.
 */
export function randomFoldCv(
  samples: readonly SpatialSample[],
  k: number,
  seed: number,
): CvResult {
  const clean = finiteOnly(samples);
  const n = clean.length;
  const folds = Math.max(2, Math.min(Math.floor(k), n));
  if (n < 3 || folds < 2) {
    return { r2: Number.NaN, rmse: Number.NaN, folds: 0, n, perFoldR2: [] };
  }

  // Fisher–Yates with a seeded PRNG.
  const order = Array.from({ length: n }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }

  const foldOf = new Array<number>(n);
  for (let pos = 0; pos < n; pos++) foldOf[order[pos]!] = pos % folds;

  const allActual: number[] = [];
  const allPredicted: number[] = [];
  const perFoldR2: number[] = [];

  for (let f = 0; f < folds; f++) {
    const heldOut: number[] = [];
    for (let i = 0; i < n; i++) if (foldOf[i] === f) heldOut.push(i);
    if (heldOut.length === 0) continue;
    const out = foldOutcome(clean, heldOut, (i) => foldOf[i] === f);
    allActual.push(...out.actual);
    allPredicted.push(...out.predicted);
    perFoldR2.push(out.r2);
  }

  const { r2, rmse } = pooledR2(allActual, allPredicted);
  return { r2, rmse, folds, n, perFoldR2 };
}

/**
 * Spatial block k-fold — the honest number.
 *
 * Whole blocks are assigned to folds round-robin over the block index, which is
 * deterministic and needs no RNG. Holding out a block also holds out its
 * interior neighbours, so the training set cannot contain a near-duplicate of a
 * test sample.
 */
export function spatialBlockCv(
  samples: readonly SpatialSample[],
  blockSizeCells: number,
  kFolds: number,
): CvResult {
  const clean = finiteOnly(samples);
  const n = clean.length;
  if (n < 3) {
    return { r2: Number.NaN, rmse: Number.NaN, folds: 0, n, perFoldR2: [] };
  }

  const { blockOf, blockCount } = checkerboardBlocks(clean, blockSizeCells);
  const folds = Math.max(2, Math.min(Math.floor(kFolds), blockCount));
  if (blockCount < 2) {
    // One block means every sample is its own neighbour's neighbour; there is
    // no spatially independent hold-out to be had.
    return { r2: Number.NaN, rmse: Number.NaN, folds: 0, n, perFoldR2: [] };
  }

  const foldOfBlock = new Array<number>(blockCount);
  for (let b = 0; b < blockCount; b++) foldOfBlock[b] = b % folds;

  const allActual: number[] = [];
  const allPredicted: number[] = [];
  const perFoldR2: number[] = [];

  for (let f = 0; f < folds; f++) {
    const isHeldOut = (i: number) => foldOfBlock[blockOf[i]!] === f;
    const heldOut: number[] = [];
    for (let i = 0; i < n; i++) if (isHeldOut(i)) heldOut.push(i);
    if (heldOut.length === 0 || heldOut.length === n) continue;
    const out = foldOutcome(clean, heldOut, isHeldOut);
    allActual.push(...out.actual);
    allPredicted.push(...out.predicted);
    perFoldR2.push(out.r2);
  }

  const { r2, rmse } = pooledR2(allActual, allPredicted);
  return { r2, rmse, folds, n, perFoldR2 };
}

/**
 * Moran's I on residuals, with rook (4-neighbour) contiguity weights.
 *
 *     I = (n / W) · ΣᵢΣⱼ wᵢⱼ(zᵢ − z̄)(zⱼ − z̄) / Σᵢ(zᵢ − z̄)²
 *
 * Approximately [−1, 1]. Positive means residuals cluster — the model is missing
 * spatial structure. Near zero means the residuals are spatially unstructured,
 * which is what a well-specified model should leave behind.
 *
 * Returns NaN — never 0 — when undefined. Zero is a real finding ("no spatial
 * autocorrelation"); conflating it with "could not compute" would let a
 * degenerate input masquerade as a clean result.
 */
export function moransI(
  samples: readonly SpatialSample[],
  residuals: readonly number[],
): number {
  const n = Math.min(samples.length, residuals.length);
  if (n < 3) return Number.NaN;

  let sum = 0;
  let counted = 0;
  for (let i = 0; i < n; i++) {
    const r = residuals[i]!;
    if (!Number.isFinite(r)) continue;
    sum += r;
    counted++;
  }
  if (counted < 3) return Number.NaN;
  const mean = sum / counted;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const r = residuals[i]!;
    if (!Number.isFinite(r)) continue;
    variance += (r - mean) ** 2;
  }
  if (variance === 0) return Number.NaN;

  // Index by grid position so adjacency is O(n) rather than O(n²).
  const at = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const s = samples[i]!;
    at.set(`${s.col},${s.row}`, i);
  }

  let cross = 0;
  let W = 0;
  const neighbours: ReadonlyArray<readonly [number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let i = 0; i < n; i++) {
    const s = samples[i]!;
    const ri = residuals[i]!;
    if (!Number.isFinite(ri)) continue;
    for (const [dc, dr] of neighbours) {
      const j = at.get(`${s.col + dc},${s.row + dr}`);
      if (j === undefined) continue;
      const rj = residuals[j]!;
      if (!Number.isFinite(rj)) continue;
      cross += (ri - mean) * (rj - mean);
      W += 1;
    }
  }

  // No adjacent pairs: the statistic is undefined, not zero.
  if (W === 0) return Number.NaN;

  return (counted / W) * (cross / variance);
}

/**
 * Run both validations and report them together.
 *
 * `gateR2` is the spatial figure, always. Handing the gate the naive number
 * would reintroduce exactly the leakage this module exists to remove.
 */
export function validateFit(
  samples: readonly SpatialSample[],
  opts: ValidateOptions = {},
): ValidationReport {
  const blockSizeCells = opts.blockSizeCells ?? 4;
  const kFolds = opts.kFolds ?? 5;
  const seed = opts.seed ?? 20260809;

  const naive = randomFoldCv(samples, kFolds, seed);
  const spatial = spatialBlockCv(samples, blockSizeCells, kFolds);

  // In-sample residuals, for the autocorrelation diagnostic.
  //
  // No non-finite guard on the slope here: `finiteOnly` has already dropped
  // every unusable sample, and `moransI` independently returns NaN when the
  // residuals have no variance. A defensive branch would be unreachable, and
  // unreachable code is deleted rather than covered by a test no caller can
  // trigger — see docs/DECISIONS.md ADR-16.
  const clean = finiteOnly(samples);
  const fit = olsFit(
    clean.map((s) => s.x),
    clean.map((s) => s.y),
  );
  const residuals = clean.map((s) => s.y - (fit.intercept + fit.slope * s.x));

  return {
    naive,
    spatial,
    leakage: naive.r2 - spatial.r2,
    moransI: moransI(clean, residuals),
    gateR2: spatial.r2,
  };
}
