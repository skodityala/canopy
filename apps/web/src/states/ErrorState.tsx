/**
 * The error state. §7.1
 *
 * A typed `CanopyError` becomes a readable sentence plus a concrete next step.
 * Nothing here invents a fallback value — that is the whole point of the type
 * existing. The error code is shown too, because a judge asking "what actually
 * failed?" deserves an answer rather than "Something went wrong."
 */

import type { CanopyError } from '@canopy/core';
import { explain } from '@canopy/core';
import { color, font, fontSize, lineHeight, radius, space } from '../design/tokens.js';

/** What a student can actually do about each failure. */
function remedyFor(e: CanopyError): string {
  switch (e.code) {
    case 'INSUFFICIENT_COVERAGE':
      return 'Try another schoolyard, or the same one on a clearer acquisition date. Canopy will not average the pixels that survived — that would report a temperature the imagery cannot support.';
    case 'NO_THERMAL_OVERLAP':
      return 'This yard sits outside the thermal scene. Pick a school inside the committed extent, or ingest a scene that covers it.';
    case 'FIT_UNRELIABLE':
      return 'Canopy cover and plan cost are still valid here — only the temperature change is withheld. A larger neighbourhood extent may resolve the relationship.';
    case 'FIXTURE_MALFORMED':
      return 'Re-run `npm run fixtures` to regenerate the committed fixtures, then reload.';
  }
}

export function ErrorState({ error, schoolName }: { error: CanopyError; schoolName: string }) {
  return (
    <div
      role="alert"
      style={{
        background: color.surface,
        border: `1px solid ${color.danger}`,
        borderRadius: radius.lg,
        padding: space.xl,
        display: 'flex',
        flexDirection: 'column',
        gap: space.md,
        maxWidth: 560,
        margin: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: space.sm }}>
        {/* Shape as well as colour — never colour alone. §7.2 */}
        <span aria-hidden="true" style={{ color: color.danger, fontSize: fontSize.subhead }}>
          ▲
        </span>
        <span
          style={{
            font: `${font.weightBold} ${fontSize.caption}px/${lineHeight.tight} ${font.text}`,
            color: color.danger,
            letterSpacing: '0.06em',
          }}
        >
          COULD NOT MEASURE {schoolName.toUpperCase()}
        </span>
      </div>

      <p
        style={{
          margin: 0,
          font: `${font.weightNormal} ${fontSize.body}px/${lineHeight.normal} ${font.text}`,
          color: color.text,
        }}
      >
        {explain(error)}
      </p>

      <p
        style={{
          margin: 0,
          font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.normal} ${font.text}`,
          color: color.textMuted,
        }}
      >
        {remedyFor(error)}
      </p>

      <code
        style={{
          font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.display}`,
          color: color.textFaint,
          background: color.bg,
          border: `1px solid ${color.border}`,
          borderRadius: radius.sm,
          padding: `${space.xs}px ${space.sm}px`,
          alignSelf: 'flex-start',
        }}
      >
        CanopyError · {error.code}
      </code>
    </div>
  );
}
