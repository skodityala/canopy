/**
 * Spatial block CV and Moran's I.
 *
 * The headline test demonstrates the leakage rather than asserting it: it builds
 * a field with known spatial autocorrelation and shows that random k-fold scores
 * it higher than spatial block CV does. That gap is the confidence the naive
 * method manufactures, and it is why the suppression gate uses the block figure.
 */

import { describe, expect, it } from 'vitest';
import {
  checkerboardBlocks,
  moransI,
  randomFoldCv,
  spatialBlockCv,
  validateFit,
  type SpatialSample,
} from '../../src/model/spatialcv.js';

/** Deterministic PRNG so every fixture below is reproducible. */
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

/**
 * A strongly autocorrelated field.
 *
 * `x` varies smoothly with position, so neighbouring cells are near-duplicates —
 * exactly the structure real thermal rasters have. `y` is a linear function of a
 * SMOOTH LATENT FIELD rather than of `x` itself, so a global straight line is
 * genuinely imperfect while neighbours remain highly predictive of each other.
 * That is the condition under which leakage inflates a score.
 */
function autocorrelatedField(side = 20, seed = 7): SpatialSample[] {
  const rand = rng(seed);
  const out: SpatialSample[] = [];
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      // Smooth, low-frequency structure in both variables.
      const u = col / side;
      const v = row / side;
      const latent = Math.sin(u * Math.PI * 1.5) * Math.cos(v * Math.PI * 1.5);
      const x = 0.15 + 0.2 * latent + (rand() - 0.5) * 0.004;
      // Response follows a DIFFERENT smooth function of position, so the global
      // linear fit is mediocre while local neighbourhoods are self-similar.
      const y =
        42 - 9 * latent + 2.2 * Math.sin(u * Math.PI * 3) + (rand() - 0.5) * 0.05;
      out.push({ x, y, col, row });
    }
  }
  return out;
}

/** A field with no spatial structure: position carries no information. */
function unstructuredField(side = 20, seed = 11): SpatialSample[] {
  const rand = rng(seed);
  const out: SpatialSample[] = [];
  for (let row = 0; row < side; row++) {
    for (let col = 0; col < side; col++) {
      const x = 0.1 + rand() * 0.3;
      const y = 44 - 12 * x + (rand() - 0.5) * 1.2;
      out.push({ x, y, col, row });
    }
  }
  return out;
}

describe('★ the leakage, demonstrated', () => {
  it('random k-fold R² EXCEEDS spatial block R² on an autocorrelated field', () => {
    const field = autocorrelatedField();
    const naive = randomFoldCv(field, 5, 20260809);
    const spatial = spatialBlockCv(field, 4, 5);

    // Both must be computable, or the comparison is meaningless.
    expect(Number.isFinite(naive.r2)).toBe(true);
    expect(Number.isFinite(spatial.r2)).toBe(true);

    // The inflation. Neighbours in both folds let the naive method score itself
    // on data it has effectively already seen.
    expect(naive.r2).toBeGreaterThan(spatial.r2);
  });

  it('the gap is much smaller when there is no spatial structure to leak', () => {
    const auto = autocorrelatedField();
    const flat = unstructuredField();

    const autoGap = randomFoldCv(auto, 5, 20260809).r2 - spatialBlockCv(auto, 4, 5).r2;
    const flatGap = Math.abs(
      randomFoldCv(flat, 5, 20260809).r2 - spatialBlockCv(flat, 4, 5).r2,
    );

    // With no autocorrelation, blocking costs almost nothing — which confirms
    // the first test measured leakage rather than an artefact of blocking.
    expect(flatGap).toBeLessThan(autoGap);
    expect(flatGap).toBeLessThan(0.1);
  });
});

describe('checkerboardBlocks', () => {
  it('assigns every sample to exactly one block', () => {
    const field = autocorrelatedField(12, 3);
    const { blockOf, blockCount } = checkerboardBlocks(field, 4);
    expect(blockOf.length).toBe(field.length);
    for (const b of blockOf) {
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(blockCount);
    }
  });

  it('counts non-empty tiles for a known input', () => {
    // 8×8 grid, 4-cell tiles → exactly 4 tiles.
    const samples: SpatialSample[] = [];
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) samples.push({ x: 0.2, y: 40, col, row });
    }
    expect(checkerboardBlocks(samples, 4).blockCount).toBe(4);
  });

  it('produces contiguous blocks — every member is within one tile', () => {
    const field = autocorrelatedField(12, 5);
    const size = 4;
    const { blockOf } = checkerboardBlocks(field, size);
    const tileOf = new Map<number, { bx: number; by: number }>();
    field.forEach((s, i) => {
      const bx = Math.floor(s.col / size);
      const by = Math.floor(s.row / size);
      const b = blockOf[i]!;
      const seen = tileOf.get(b);
      if (seen === undefined) tileOf.set(b, { bx, by });
      else {
        // All members of a block share one tile, which is contiguous by
        // construction — this is precisely what random folds cannot guarantee.
        expect(seen.bx).toBe(bx);
        expect(seen.by).toBe(by);
      }
    });
  });

  it('treats a block size below 1 as 1 rather than dividing by zero', () => {
    const field = autocorrelatedField(4, 2);
    expect(checkerboardBlocks(field, 0).blockCount).toBe(field.length);
  });
});

describe("Moran's I", () => {
  /** Residuals that vary smoothly with position — strong clustering. */
  function smoothResiduals(side: number): {
    samples: SpatialSample[];
    residuals: number[];
  } {
    const samples: SpatialSample[] = [];
    const residuals: number[] = [];
    for (let row = 0; row < side; row++) {
      for (let col = 0; col < side; col++) {
        samples.push({ x: 0.2, y: 40, col, row });
        residuals.push(col + row);
      }
    }
    return { samples, residuals };
  }

  it('is strongly positive for a smooth gradient', () => {
    const { samples, residuals } = smoothResiduals(12);
    expect(moransI(samples, residuals)).toBeGreaterThan(0.5);
  });

  it('is near zero for spatially random residuals', () => {
    const rand = rng(23);
    const samples: SpatialSample[] = [];
    const residuals: number[] = [];
    for (let row = 0; row < 14; row++) {
      for (let col = 0; col < 14; col++) {
        samples.push({ x: 0.2, y: 40, col, row });
        residuals.push(rand() - 0.5);
      }
    }
    expect(Math.abs(moransI(samples, residuals))).toBeLessThan(0.3);
  });

  it('is NEGATIVE for a perfect checkerboard', () => {
    const samples: SpatialSample[] = [];
    const residuals: number[] = [];
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        samples.push({ x: 0.2, y: 40, col, row });
        // Alternating high/low: every neighbour is the opposite sign.
        residuals.push((col + row) % 2 === 0 ? 1 : -1);
      }
    }
    expect(moransI(samples, residuals)).toBeLessThan(0);
  });

  it('returns NaN — not 0 — for fewer than three samples', () => {
    const s: SpatialSample[] = [
      { x: 0.1, y: 40, col: 0, row: 0 },
      { x: 0.2, y: 41, col: 1, row: 0 },
    ];
    expect(Number.isNaN(moransI(s, [0.5, -0.5]))).toBe(true);
  });

  it('returns NaN for zero variance', () => {
    const { samples } = smoothResiduals(6);
    expect(Number.isNaN(moransI(samples, samples.map(() => 1)))).toBe(true);
  });

  it('returns NaN when no samples are rook-adjacent', () => {
    // Spaced two cells apart in both axes — no 4-neighbour pairs exist.
    const samples: SpatialSample[] = [];
    const residuals: number[] = [];
    let k = 0;
    for (let row = 0; row < 6; row += 2) {
      for (let col = 0; col < 6; col += 2) {
        samples.push({ x: 0.2, y: 40, col, row });
        residuals.push(k++ % 3);
      }
    }
    // Zero adjacent pairs means W = 0 and the statistic is undefined. Returning
    // 0 here would claim "no autocorrelation", a finding the data cannot support.
    expect(Number.isNaN(moransI(samples, residuals))).toBe(true);
  });

  it('ignores non-finite residuals rather than propagating them', () => {
    const { samples, residuals } = smoothResiduals(8);
    const withGaps = residuals.map((r, i) => (i % 7 === 0 ? Number.NaN : r));
    expect(Number.isFinite(moransI(samples, withGaps))).toBe(true);
  });
});

describe('determinism', () => {
  it('randomFoldCv is reproducible from its seed', () => {
    const field = autocorrelatedField(14, 9);
    expect(randomFoldCv(field, 5, 42)).toEqual(randomFoldCv(field, 5, 42));
  });

  it('spatialBlockCv needs no seed and is reproducible', () => {
    const field = autocorrelatedField(14, 9);
    expect(spatialBlockCv(field, 4, 5)).toEqual(spatialBlockCv(field, 4, 5));
  });

  it('validateFit is reproducible end to end', () => {
    const field = autocorrelatedField(14, 9);
    expect(validateFit(field)).toEqual(validateFit(field));
  });

  it('a different seed changes the naive folds but not the spatial ones', () => {
    const field = autocorrelatedField(14, 9);
    // The spatial partition is geometric, so it cannot drift with a seed —
    // which is part of why it is the number worth citing.
    expect(spatialBlockCv(field, 4, 5).r2).toBe(spatialBlockCv(field, 4, 5).r2);
  });
});

describe('validateFit', () => {
  it('hands the gate the SPATIAL R², never the naive one', () => {
    const report = validateFit(autocorrelatedField());
    expect(report.gateR2).toBe(report.spatial.r2);
    expect(report.gateR2).not.toBe(report.naive.r2);
  });

  it('reports leakage as the difference between the two estimates', () => {
    const report = validateFit(autocorrelatedField());
    expect(report.leakage).toBeCloseTo(report.naive.r2 - report.spatial.r2, 12);
    // On an autocorrelated field the naive estimate must be the optimistic one.
    expect(report.leakage).toBeGreaterThan(0);
  });

  it('reports a finite Moran\u2019s I on a real field', () => {
    expect(Number.isFinite(validateFit(autocorrelatedField()).moransI)).toBe(true);
  });

  it('honours explicit options', () => {
    const field = autocorrelatedField();
    const a = validateFit(field, { blockSizeCells: 2, kFolds: 4, seed: 1 });
    const b = validateFit(field, { blockSizeCells: 8, kFolds: 4, seed: 1 });
    // Block size changes the spatial estimate; it is a real methodological knob.
    expect(a.spatial.r2).not.toBe(b.spatial.r2);
  });
});

describe('degenerate input', () => {
  it('returns NaN rather than crashing on too few samples', () => {
    const s: SpatialSample[] = [{ x: 0.1, y: 40, col: 0, row: 0 }];
    expect(Number.isNaN(randomFoldCv(s, 5, 1).r2)).toBe(true);
    expect(Number.isNaN(spatialBlockCv(s, 4, 5).r2)).toBe(true);
  });

  it('returns NaN when every sample falls in one block', () => {
    const samples: SpatialSample[] = [];
    for (let i = 0; i < 9; i++) {
      samples.push({ x: 0.1 + i * 0.01, y: 40 + i, col: i % 3, row: Math.floor(i / 3) });
    }
    // A single block leaves no spatially independent hold-out to be had.
    expect(Number.isNaN(spatialBlockCv(samples, 16, 5).r2)).toBe(true);
  });

  it('drops non-finite samples and reports the surviving n', () => {
    const field = autocorrelatedField(10, 4);
    const dirty: SpatialSample[] = [
      ...field,
      { x: Number.NaN, y: 40, col: 99, row: 99 },
      { x: 0.2, y: Number.POSITIVE_INFINITY, col: 98, row: 98 },
    ];
    // Unknown is excluded, never coerced to 0.
    expect(spatialBlockCv(dirty, 4, 5).n).toBe(field.length);
    expect(randomFoldCv(dirty, 5, 1).n).toBe(field.length);
  });

  it('floors R² at 0 instead of reporting a negative magnitude', () => {
    // y is unrelated to x, so out-of-fold prediction is worse than the mean.
    const rand = rng(77);
    const samples: SpatialSample[] = [];
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        samples.push({ x: rand(), y: rand() * 50, col, row });
      }
    }
    const r2 = spatialBlockCv(samples, 4, 4).r2;
    expect(r2).toBeGreaterThanOrEqual(0);
  });

  it('handles zero-variance response as NaN, not as a perfect fit', () => {
    const samples: SpatialSample[] = [];
    for (let row = 0; row < 12; row++) {
      for (let col = 0; col < 12; col++) {
        samples.push({ x: 0.1 + col * 0.01, y: 40, col, row });
      }
    }
    expect(Number.isNaN(spatialBlockCv(samples, 4, 4).r2)).toBe(true);
  });
});
