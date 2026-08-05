/**
 * Numerical edge cases in the Student-t machinery.
 *
 * The incomplete-beta continued fraction and the log-gamma reflection are the
 * least-exercised code in the project and the most consequential: they produce
 * the confidence interval printed next to the temperature claim. These tests
 * push them into the branches ordinary data never reaches.
 */

import { describe, expect, it } from 'vitest';
import { olsFit, tCDF, tCritical } from '../../src/model/regression.js';

describe('tCDF — distribution tails and symmetry', () => {
  it('is 0.5 at t = 0 for any df', () => {
    for (const df of [1, 2, 5, 30, 500]) {
      expect(tCDF(0, df)).toBeCloseTo(0.5, 10);
    }
  });

  it('approaches 1 and 0 in the far tails', () => {
    // Drives incompleteBeta toward x → 0, the early-return branch.
    expect(tCDF(1e8, 5)).toBeCloseTo(1, 12);
    expect(tCDF(-1e8, 5)).toBeCloseTo(0, 12);
    expect(tCDF(1e300, 3)).toBeCloseTo(1, 12);
    expect(tCDF(-1e300, 3)).toBeCloseTo(0, 12);
  });

  it('is monotonically increasing in t', () => {
    let prev = -Infinity;
    for (const t of [-6, -3, -1.5, -0.4, 0, 0.4, 1.5, 3, 6]) {
      const p = tCDF(t, 8);
      expect(p).toBeGreaterThan(prev);
      prev = p;
    }
  });

  it('matches known one-sided probabilities', () => {
    // At df=10, t=2.228 is the 97.5th percentile.
    expect(tCDF(2.228, 10)).toBeCloseTo(0.975, 3);
    expect(tCDF(-2.228, 10)).toBeCloseTo(0.025, 3);
    // At df=1 (Cauchy), t=1 is the 75th percentile exactly.
    expect(tCDF(1, 1)).toBeCloseTo(0.75, 6);
  });

  it('exercises both incomplete-beta branches via small and large df', () => {
    // The x < (a+1)/(a+b+2) test flips between these two regimes.
    expect(tCDF(0.2, 1)).toBeGreaterThan(0.5);
    expect(tCDF(0.2, 2000)).toBeGreaterThan(0.5);
    expect(tCDF(8, 1)).toBeLessThan(1);
    expect(tCDF(8, 2000)).toBeCloseTo(1, 8);
  });

  it('handles fractional degrees of freedom', () => {
    // Fractional df drives lnGamma with non-integer arguments.
    const p = tCDF(1.5, 4.5);
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(1);
  });
});

describe('tCritical — extremes', () => {
  it('is very large for df = 1 and tends to 1.96 for huge df', () => {
    expect(tCritical(1, 0.05)).toBeCloseTo(12.706, 2);
    expect(tCritical(1e6, 0.05)).toBeCloseTo(1.96, 3);
  });

  it('widens as alpha shrinks', () => {
    const a10 = tCritical(10, 0.1);
    const a05 = tCritical(10, 0.05);
    const a01 = tCritical(10, 0.01);
    expect(a10).toBeLessThan(a05);
    expect(a05).toBeLessThan(a01);
    // Known: t(0.01, df=10) ≈ 3.169
    expect(a01).toBeCloseTo(3.169, 2);
  });

  it('returns NaN for a non-finite or non-positive df', () => {
    expect(Number.isNaN(tCritical(Number.NaN))).toBe(true);
    expect(Number.isNaN(tCritical(Infinity))).toBe(true);
    expect(Number.isNaN(tCritical(0))).toBe(true);
    expect(Number.isNaN(tCritical(-1))).toBe(true);
  });
});

describe('olsFit — numerically hostile input', () => {
  it('survives values spanning many orders of magnitude', () => {
    const x = [1e-8, 2e-8, 3e-8, 4e-8, 5e-8];
    const y = [1e8, 2e8, 3e8, 4e8, 5e8];
    const f = olsFit(x, y);
    expect(f.r2).toBeCloseTo(1, 8);
    expect(Number.isFinite(f.slope)).toBe(true);
  });

  it('handles a near-vertical relationship without producing Infinity', () => {
    const f = olsFit([1, 1 + 1e-12, 1 + 2e-12], [5, 500, 5000]);
    // Either a finite slope or an explicit NaN — never Infinity.
    expect(f.slope === f.slope ? Number.isFinite(f.slope) || Number.isNaN(f.slope) : true).toBe(
      true,
    );
    expect(f.slope).not.toBe(Infinity);
    expect(f.slope).not.toBe(-Infinity);
  });

  it('is exactly r2 = 1 for a horizontal-x, perfectly linear set at n = 3', () => {
    const f = olsFit([0, 1, 2], [3, 5, 7]);
    expect(f.n).toBe(3);
    expect(f.r2).toBe(1);
    expect(f.slope).toBeCloseTo(2, 12);
    // df = 1, so the interval is wide but finite.
    expect(Number.isFinite(f.slopeCI95[0])).toBe(true);
    expect(Number.isFinite(f.slopeCI95[1])).toBe(true);
  });

  it('drops Infinity and NaN pairs rather than propagating them', () => {
    const f = olsFit([1, 2, Infinity, 4, 5, -Infinity], [1, 2, 3, 4, 5, 6]);
    expect(f.n).toBe(4);
    expect(Number.isFinite(f.slope)).toBe(true);
  });

  it('reports a zero-width interval for a noiseless fit', () => {
    const f = olsFit([1, 2, 3, 4, 5, 6], [2, 4, 6, 8, 10, 12]);
    expect(f.slopeSE).toBeCloseTo(0, 10);
    expect(f.slopeCI95[1] - f.slopeCI95[0]).toBeCloseTo(0, 8);
  });

  it('produces a large but finite interval at the minimum viable n', () => {
    const f = olsFit([1, 2, 3], [1, 4, 2]);
    expect(f.n).toBe(3);
    expect(Number.isFinite(f.slopeSE)).toBe(true);
    expect(f.slopeCI95[1]).toBeGreaterThan(f.slopeCI95[0]);
  });
});
