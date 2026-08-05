/**
 * Summary statistics over masked grids. All ignore NaN and all report `n`,
 * because every temperature that reaches a judge is shown with its pixel count.
 */

import type { BoolGrid, Grid } from '../types.js';

export interface Summary {
  readonly mean: number;
  readonly sd: number;
  readonly min: number;
  readonly max: number;
  readonly n: number;
}

const EMPTY: Summary = {
  mean: Number.NaN,
  sd: Number.NaN,
  min: Number.NaN,
  max: Number.NaN,
  n: 0,
};

/** Collect valid values of a grid inside a mask. */
export function valuesIn(g: Grid, mask: BoolGrid): number[] {
  const out: number[] = [];
  for (let i = 0; i < g.data.length; i++) {
    const v = g.data[i]!;
    if (mask.data[i] === 1 && !Number.isNaN(v)) out.push(v);
  }
  return out;
}

/** Mean, sample SD, range and count. Zero valid pixels yields n = 0 and NaNs. */
export function summarise(g: Grid, mask: BoolGrid): Summary {
  const vals = valuesIn(g, mask);
  if (vals.length === 0) return EMPTY;
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of vals) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const mean = sum / vals.length;
  let ss = 0;
  for (const v of vals) ss += (v - mean) ** 2;
  const sd = vals.length > 1 ? Math.sqrt(ss / (vals.length - 1)) : 0;
  return { mean, sd, min, max, n: vals.length };
}

/** Linear-interpolated percentile, p in [0, 100]. NaN when empty. */
export function percentile(values: readonly number[], p: number): number {
  const clean = values.filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
  if (clean.length === 0) return Number.NaN;
  if (clean.length === 1) return clean[0]!;
  const idx = (clean.length - 1) * (Math.min(100, Math.max(0, p)) / 100);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return clean[lo]!;
  return clean[lo]! + (clean[hi]! - clean[lo]!) * (idx - lo);
}
