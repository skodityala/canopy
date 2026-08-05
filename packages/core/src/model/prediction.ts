/**
 * Δcanopy → ΔLST, gated on fit quality. §4.5.
 *
 * The tempting move is to look up a literature constant — "trees reduce
 * temperature by X°" — and multiply. Published urban-cooling figures vary by an
 * order of magnitude across climates, so any borrowed constant dies to one
 * informed question. Instead β₁ comes from an OLS fit on *this school's own
 * scene*, computed live, and the claim is suppressed when that fit is too weak
 * to support it.
 *
 * `Prediction` is a discriminated union on purpose: the UI and the PDF are both
 * forced by the type system to handle `suppressed`. That is how the refusal
 * stops being a demo trick and becomes an architectural property.
 */

import type { Fit } from './regression.js';
import { REQUIRED_COVERAGE } from '../raster/mask.js';

/** R² at or above this gets a full estimate. */
export const R2_FULL = 0.5;
/** R² at or above this, but below R2_FULL, is shown flagged as indicative. */
export const R2_WEAK = 0.3;

export type Prediction =
  | {
      readonly kind: 'ok';
      readonly deltaC: number;
      readonly ci95: readonly [number, number];
      readonly fit: Fit;
    }
  | {
      readonly kind: 'weak';
      readonly deltaC: number;
      readonly ci95: readonly [number, number];
      readonly fit: Fit;
      /** Shown verbatim next to the number. */
      readonly caveat: string;
    }
  | {
      readonly kind: 'suppressed';
      readonly reason: 'low_r2' | 'insufficient_coverage' | 'no_fit';
      readonly fit: Fit | null;
      readonly explanation: string;
    };

/**
 * Predict the yard-mean surface-temperature change from a yard-mean NDVI shift.
 *
 *     ΔLST ≈ β₁ · ΔNDVI_yard
 *
 * The CI on ΔT is the CI on β₁ scaled by ΔNDVI, so a wide slope interval
 * honestly widens the reported temperature interval.
 *
 * @param coverage fraction of the yard with usable pixels (0..1)
 */
export function predictDeltaLST(
  fit: Fit | null,
  deltaNdviYard: number,
  coverage: number,
): Prediction {
  // Coverage is checked first: with a cloud-occluded yard the fit may look fine
  // while the yard's own measurement is not trustworthy.
  if (!Number.isFinite(coverage) || coverage < REQUIRED_COVERAGE) {
    const pct = Number.isFinite(coverage) ? (coverage * 100).toFixed(1) : '0.0';
    return {
      kind: 'suppressed',
      reason: 'insufficient_coverage',
      fit,
      explanation:
        `Only ${pct}% of this yard has cloud-free pixels ` +
        `(${(REQUIRED_COVERAGE * 100).toFixed(0)}% required). ` +
        `No temperature change is reported for this site.`,
    };
  }

  if (fit === null || !Number.isFinite(fit.slope) || !Number.isFinite(fit.r2)) {
    return {
      kind: 'suppressed',
      reason: 'no_fit',
      fit,
      explanation:
        'The local canopy–temperature regression could not be fitted at this site, ' +
        'so no temperature change is reported.',
    };
  }

  if (fit.r2 < R2_WEAK) {
    return {
      kind: 'suppressed',
      reason: 'low_r2',
      fit,
      explanation:
        `The canopy–temperature relationship is not resolvable at this site ` +
        `(R² = ${fit.r2.toFixed(2)}, below ${R2_WEAK}). Canopy cover and plan cost ` +
        `are still reported; the temperature change is withheld rather than guessed.`,
    };
  }

  if (!Number.isFinite(deltaNdviYard)) {
    return {
      kind: 'suppressed',
      reason: 'no_fit',
      fit,
      explanation: 'The yard-mean NDVI shift could not be computed, so no ΔT is reported.',
    };
  }

  const deltaC = fit.slope * deltaNdviYard;
  const ends: [number, number] = [
    fit.slopeCI95[0] * deltaNdviYard,
    fit.slopeCI95[1] * deltaNdviYard,
  ];
  // A negative ΔNDVI would flip the interval's order; sort so lo ≤ hi always.
  const ci95: readonly [number, number] = [Math.min(...ends), Math.max(...ends)];

  if (fit.r2 < R2_FULL) {
    return {
      kind: 'weak',
      deltaC,
      ci95,
      fit,
      caveat: `weak local fit (R² = ${fit.r2.toFixed(2)}) — indicative only`,
    };
  }

  return { kind: 'ok', deltaC, ci95, fit };
}

/**
 * The method sentence that must accompany any displayed ΔT. Phrased as
 * "associated with", never "will cause" — this is a correlational fit, not a
 * physical simulation.
 */
export function methodLabel(fit: Fit, maturityYears: number): string {
  return (
    `OLS LST ~ NDVI · R² = ${fit.r2.toFixed(2)} · n = ${fit.n.toLocaleString('en-US')} px · ` +
    `associated change at ~${maturityYears}-year crown maturity`
  );
}
