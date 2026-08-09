/**
 * The school picker. Keyboard-reachable by construction — it is a list of real
 * buttons, so tab order and Enter/Space come for free rather than being bolted
 * on with key handlers. §7.2
 */

import type { SchoolMeta } from '@canopy/core';
import { color, font, fontSize, lineHeight, radius, space } from '../design/tokens.js';

export interface SchoolPickerProps {
  readonly schools: readonly SchoolMeta[];
  readonly selected: string | null;
  readonly onSelect: (slug: string) => void;
}

export function SchoolPicker({ schools, selected, onSelect }: SchoolPickerProps) {
  return (
    <nav aria-label="Schoolyards">
      <div
        style={{
          font: `${font.weightBold} ${fontSize.method}px/${lineHeight.tight} ${font.text}`,
          color: color.textFaint,
          letterSpacing: '0.08em',
          marginBottom: space.md,
        }}
      >
        SCHOOLYARD
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: space.xs }}>
        {schools.map((s) => {
          const active = s.slug === selected;
          return (
            <li key={s.slug}>
              <button
                type="button"
                onClick={() => onSelect(s.slug)}
                aria-current={active ? 'true' : undefined}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: active ? color.surfaceRaised : 'transparent',
                  border: `1px solid ${active ? color.accentMuted : 'transparent'}`,
                  borderRadius: radius.md,
                  padding: `${space.sm}px ${space.md}px`,
                  color: active ? color.text : color.textMuted,
                  font: `${active ? font.weightBold : font.weightNormal} ${fontSize.body}px/${lineHeight.tight} ${font.text}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <span>{s.name}</span>
                <span
                  style={{
                    font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.display}`,
                    color: color.textFaint,
                  }}
                >
                  {s.city}, {s.state} · {s.yardAreaM2.toLocaleString('en-US')} m²
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
