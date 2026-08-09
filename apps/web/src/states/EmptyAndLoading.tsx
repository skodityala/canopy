/**
 * The empty and loading states.
 *
 * Both exist to avoid the two most common median-entry failures: a blank screen
 * that does not say what to do, and a spinner that does not say what is
 * happening.
 */

import type { SchoolMeta } from '@canopy/core';
import { color, font, fontSize, lineHeight, radius, space } from '../design/tokens.js';

const panel = {
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
} as const;

/** No school picked. Tells the student what to do next. */
export function EmptyState({ schools }: { schools: readonly SchoolMeta[] }) {
  return (
    <div
      style={{
        ...panel,
        padding: space.xxl,
        display: 'flex',
        flexDirection: 'column',
        gap: space.lg,
        maxWidth: 520,
        margin: 'auto',
      }}
    >
      <div
        style={{
          font: `${font.weightBold} ${fontSize.subhead}px/${lineHeight.tight} ${font.text}`,
          color: color.text,
        }}
      >
        Pick a schoolyard to measure
      </div>
      <p
        style={{
          margin: 0,
          font: `${font.weightNormal} ${fontSize.body}px/${lineHeight.normal} ${font.text}`,
          color: color.textMuted,
        }}
      >
        Canopy reads tree cover and surface temperature from satellite imagery, then costs a
        planting plan you can hand to a principal. {schools.length} schoolyards are bundled
        with this build and work with no network connection.
      </p>
      <ol
        style={{
          margin: 0,
          paddingLeft: space.lg,
          font: `${font.weightNormal} ${fontSize.body}px/1.9 ${font.text}`,
          color: color.textFaint,
        }}
      >
        <li>Choose a school from the list</li>
        <li>Read the measured canopy cover and yard temperature</li>
        <li>Place trees, and watch the predicted change update</li>
        <li>Export the costed plan as a PDF</li>
      </ol>
    </div>
  );
}

/** Skeleton bars — sized to the real content so nothing shifts on arrival. */
function Bar({ w, h = 11 }: { w: number | string; h?: number }) {
  return (
    <div
      style={{
        width: w,
        height: h,
        background: color.surfaceRaised,
        borderRadius: radius.sm,
      }}
    />
  );
}

/** Analysis in flight. A skeleton of the layout, not a spinner over nothing. */
export function LoadingState({ name }: { name: string }) {
  return (
    <div
      style={{ ...panel, padding: space.xl, display: 'flex', flexDirection: 'column', gap: space.lg }}
      aria-busy="true"
      aria-live="polite"
      aria-label={`Analysing ${name}`}
    >
      <div
        style={{
          font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.normal} ${font.text}`,
          color: color.textMuted,
        }}
      >
        Analysing {name}…
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
        <Bar w="42%" h={9} />
        <Bar w="68%" h={26} />
        <Bar w="54%" h={9} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: space.sm }}>
        <Bar w="38%" h={9} />
        <Bar w="60%" h={26} />
        <Bar w="72%" h={9} />
      </div>
      <div
        style={{
          font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
          color: color.textFaint,
        }}
      >
        Deriving NDVI at 10 m, resampling to the 100 m thermal grid, fitting LST ~ NDVI over
        the neighbourhood extent.
      </div>
    </div>
  );
}
