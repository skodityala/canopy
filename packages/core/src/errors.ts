/**
 * Typed domain errors. §5.5.
 *
 * Never swallow one of these into a default value. A silent fallback to 0 °C is
 * worse than a crash, because it ships a wrong number to a judge. Every variant
 * surfaces to the UI as a readable explanation and into the PDF as a stated
 * limitation.
 */

export type CanopyError =
  | { readonly code: 'INSUFFICIENT_COVERAGE'; readonly coverage: number; readonly required: number }
  | { readonly code: 'NO_THERMAL_OVERLAP' }
  | { readonly code: 'FIT_UNRELIABLE'; readonly r2: number }
  | { readonly code: 'FIXTURE_MALFORMED'; readonly path: string; readonly detail: string };

/** An Error carrying a structured CanopyError, for throwing across boundaries. */
export class CanopyFailure extends Error {
  readonly detail: CanopyError;

  constructor(detail: CanopyError) {
    super(explain(detail));
    this.name = 'CanopyFailure';
    this.detail = detail;
  }
}

/** Human-readable explanation — used verbatim in the UI and the PDF. */
export function explain(e: CanopyError): string {
  switch (e.code) {
    case 'INSUFFICIENT_COVERAGE':
      return (
        `Only ${(e.coverage * 100).toFixed(1)}% of the yard has usable pixels ` +
        `(${(e.required * 100).toFixed(0)}% required). Cloud or cirrus contamination ` +
        `masked the rest, so no temperature is reported for this site.`
      );
    case 'NO_THERMAL_OVERLAP':
      return (
        'The thermal scene does not overlap this yard, so surface temperature ' +
        'cannot be measured here.'
      );
    case 'FIT_UNRELIABLE':
      return (
        `The local canopy–temperature relationship is not resolvable at this site ` +
        `(R² = ${e.r2.toFixed(2)}). Canopy cover and plan cost are reported; the ` +
        `temperature change is withheld rather than guessed.`
      );
    case 'FIXTURE_MALFORMED':
      return `Fixture at ${e.path} could not be read: ${e.detail}`;
  }
}
