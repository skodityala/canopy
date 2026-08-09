/**
 * The suppressed state and the synthetic-data badge. §7.1
 *
 * ★ This is the money state: the number is ABSENT and the reason is PRESENT.
 *
 * Note what it does not do — it does not hide the panel, grey everything out, or
 * show an error. The measured canopy cover and the costed plan are still real
 * and still shown. Only the claim the data cannot support is withheld. That
 * distinction is the entire argument for this component existing.
 */

import type { Prediction } from '@canopy/core';
import { color, font, fontSize, lineHeight, radius, space } from '../design/tokens.js';

/** The withheld-prediction card. Rendered where the ΔT figure would have gone. */
export function SuppressedNotice({
  prediction,
}: {
  prediction: Extract<Prediction, { kind: 'suppressed' }>;
}) {
  const reasonLabel =
    prediction.reason === 'insufficient_coverage'
      ? 'CLOUD COVER OVER THIS YARD'
      : prediction.reason === 'low_r2'
        ? 'LOCAL RELATIONSHIP NOT RESOLVABLE'
        : 'NO REGRESSION AVAILABLE';

  return (
    <section
      aria-live="polite"
      style={{
        background: '#241a0c',
        border: `1px solid ${color.warn}`,
        borderRadius: radius.md,
        padding: space.lg,
        display: 'flex',
        flexDirection: 'column',
        gap: space.sm,
      }}
    >
      <div
        style={{
          font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.tight} ${font.text}`,
          color: color.textMuted,
          letterSpacing: '0.04em',
        }}
      >
        PREDICTED TEMPERATURE CHANGE
      </div>

      {/* The refusal occupies the same visual slot the number would have, at the
          same weight, so the absence is legible rather than looking broken. */}
      <div
        style={{
          font: `${font.weightBold} ${fontSize.metric}px/${lineHeight.tight} ${font.display}`,
          color: color.warn,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        WITHHELD
      </div>

      <div
        style={{
          font: `${font.weightBold} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
          color: color.warn,
          letterSpacing: '0.04em',
        }}
      >
        {reasonLabel}
      </div>

      <p
        style={{
          margin: 0,
          font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.normal} ${font.text}`,
          color: color.textMuted,
          maxWidth: '46ch',
        }}
      >
        {prediction.explanation}
      </p>

      <p
        style={{
          margin: 0,
          font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
          color: color.textFaint,
        }}
      >
        Canopy cover and plan cost below are measured and remain valid. Only the temperature
        change is withheld.
      </p>
    </section>
  );
}

/**
 * The synthetic-imagery badge. Persistent, never dismissible.
 *
 * Presenting generated pixels as observed data would be the one unrecoverable
 * dishonesty in this project, so the disclosure is structural: it renders
 * wherever a report renders, driven by the fixture's own metadata.
 */
export function SyntheticBadge({ provenance }: { provenance: string }) {
  return (
    <div
      style={{
        background: '#3a2a12',
        border: `1px solid ${color.warn}`,
        borderRadius: radius.md,
        padding: `${space.sm}px ${space.md}px`,
        display: 'flex',
        gap: space.md,
        alignItems: 'baseline',
      }}
    >
      <span
        style={{
          font: `${font.weightBold} ${fontSize.method}px/${lineHeight.tight} ${font.text}`,
          color: color.warn,
          letterSpacing: '0.06em',
          whiteSpace: 'nowrap',
        }}
      >
        SYNTHETIC IMAGERY
      </span>
      <span
        style={{
          font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
          color: color.textMuted,
        }}
      >
        {provenance}
      </span>
    </div>
  );
}
