/**
 * Seeded PRNG. Deterministic by construction: the same seed yields a
 * byte-identical fixture, which is what the determinism guard asserts.
 *
 * mulberry32 — small, fast, and adequate for smooth-field synthesis. It is
 * deliberately not cryptographic: reproducibility is the requirement here, not
 * entropy.
 */

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Standard normal, via Box–Muller. */
  normal(): number;
}

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + next() * (hi - lo),
    normal: () => {
      // Guard against log(0), which would return -Infinity.
      const u = Math.max(Number.EPSILON, next());
      const v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
  };
}
