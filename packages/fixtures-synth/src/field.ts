/**
 * Smooth scalar fields, for synthesising plausible NDVI surfaces.
 *
 * Value noise with bilinear interpolation over a coarse lattice, summed across
 * octaves. Smoothness is the point: white noise would give every 100 m thermal
 * cell nearly the same area-averaged NDVI, collapsing the regression's
 * x-variance and leaving the fixture unable to exercise the fit at all.
 */

import type { Rng } from './prng.js';

export interface Field {
  /** Sample at normalised coordinates u, v ∈ [0, 1]. */
  at(u: number, v: number): number;
}

function lattice(rng: Rng, n: number): number[][] {
  const g: number[][] = [];
  for (let j = 0; j <= n; j++) {
    const row: number[] = [];
    for (let i = 0; i <= n; i++) row.push(rng.next());
    g.push(row);
  }
  return g;
}

/** Smoothstep, so octave boundaries do not read as a visible grid. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function sampleLattice(g: number[][], n: number, u: number, v: number): number {
  const x = Math.min(0.999999, Math.max(0, u)) * n;
  const y = Math.min(0.999999, Math.max(0, v)) * n;
  const i = Math.floor(x);
  const j = Math.floor(y);
  const fx = smooth(x - i);
  const fy = smooth(y - j);
  const a = g[j]![i]!;
  const b = g[j]![i + 1]!;
  const c = g[j + 1]![i]!;
  const d = g[j + 1]![i + 1]!;
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/**
 * Fractal value noise, normalised to [0, 1].
 *
 * @param octaves lattice resolutions to sum, coarse first
 */
export function fractalField(rng: Rng, octaves: readonly number[] = [3, 7, 17]): Field {
  const layers = octaves.map((n) => ({ n, g: lattice(rng, n) }));
  let norm = 0;
  for (let k = 0; k < layers.length; k++) norm += 1 / 2 ** k;
  return {
    at(u, v) {
      let sum = 0;
      for (let k = 0; k < layers.length; k++) {
        const { n, g } = layers[k]!;
        sum += sampleLattice(g, n, u, v) / 2 ** k;
      }
      return sum / norm;
    },
  };
}

/** A field that is constant everywhere — used to build degenerate test cases. */
export function constantField(value: number): Field {
  return { at: () => value };
}
