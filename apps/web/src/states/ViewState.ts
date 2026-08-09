/**
 * The five interface states, as one discriminated union. §7.1
 *
 * The median entry has a happy path and a spinner. Modelling every state as a
 * variant here means the renderer must handle all of them — a missing branch is
 * a type error, not a blank screen at 2am.
 *
 * `synthetic` is deliberately NOT a variant: it is an orthogonal flag that rides
 * along with `ready` and `suppressed`, because a synthetic fixture still has a
 * full report to show. Making it a variant would have forced a choice between
 * showing the data and disclosing its provenance, when the honest answer is
 * both.
 */

import type { CanopyError, Report, SceneAnalysis, SchoolMeta, Tree } from '@canopy/core';

export interface ReadyPayload {
  readonly meta: SchoolMeta;
  readonly report: Report;
  readonly analysis: SceneAnalysis;
  readonly trees: readonly Tree[];
}

export type ViewState =
  /** No school picked yet. Shows what to do, not just what is missing. */
  | { readonly kind: 'empty'; readonly schools: readonly SchoolMeta[] }
  /** Analysis running. Skeleton on the map, never a spinner over a blank page. */
  | { readonly kind: 'loading'; readonly schools: readonly SchoolMeta[]; readonly slug: string }
  /** A typed domain error, rendered as a sentence plus what to try. */
  | {
      readonly kind: 'error';
      readonly schools: readonly SchoolMeta[];
      readonly error: CanopyError;
      readonly slug: string;
    }
  /**
   * Measurements resolved and the temperature claim is supported.
   * `report.school.synthetic` still drives the provenance badge.
   */
  | { readonly kind: 'ready'; readonly schools: readonly SchoolMeta[] } & ReadyPayload
  /**
   * ★ The money state. Measurements resolved, but the data cannot support the
   * prediction — so the number is ABSENT and the reason is PRESENT. Canopy %
   * and cost still render, because those are still measured.
   */
  | { readonly kind: 'suppressed'; readonly schools: readonly SchoolMeta[] } & ReadyPayload;

export type ViewStateKind = ViewState['kind'];

/** Every state a judge can reach, in demo order. Used by the state harness. */
export const ALL_STATES: readonly ViewStateKind[] = [
  'empty',
  'loading',
  'ready',
  'suppressed',
  'error',
];

/**
 * Decide between `ready` and `suppressed` from the report itself.
 *
 * The UI never makes this call independently — it reads the discriminated
 * `Prediction` the core produced. That is what keeps the on-camera refusal an
 * architectural property rather than a presentation trick.
 */
export function readyKindFor(report: Report): 'ready' | 'suppressed' {
  return report.prediction.kind === 'suppressed' ? 'suppressed' : 'ready';
}

/** True when this state has measurements to show. */
export function hasReport(s: ViewState): s is Extract<ViewState, { report: Report }> {
  return s.kind === 'ready' || s.kind === 'suppressed';
}

/** Human label for the state, shown in the demo harness and the a11y live region. */
export function describeState(s: ViewState): string {
  switch (s.kind) {
    case 'empty':
      return 'No school selected';
    case 'loading':
      return `Analysing ${s.slug}`;
    case 'error':
      return `Could not analyse ${s.slug}`;
    case 'ready':
      return `${s.report.school.name} — plan ready`;
    case 'suppressed':
      return `${s.report.school.name} — temperature change withheld`;
  }
}
