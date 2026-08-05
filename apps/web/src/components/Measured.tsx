/**
 * <Measured> — the only sanctioned way to put a number on screen. §7, proof #2.
 *
 * `method` is a REQUIRED prop. There is no default and no optional variant, so
 * rendering a quantity without stating how it was measured is a type error
 * rather than an oversight. That is proof-layer item #2 enforced by the
 * compiler instead of by discipline.
 *
 * It also handles the unknown case properly: pass `value={null}` and it renders
 * an explicit "not measurable" state with the reason, never a zero.
 */

import type { CSSProperties, ReactNode } from 'react';
import { color, font, fontSize, lineHeight, space } from '../design/tokens.js';

export interface MeasuredProps {
  /** What this quantity is, e.g. "Recess yard surface temperature". */
  label: string;
  /**
   * The measured value. `null` means not measurable — the component then
   * requires `unknownReason` and renders the refusal instead of a figure.
   */
  value: number | null;
  /**
   * How this number was produced. REQUIRED. Appears directly beneath the
   * figure, in the same component, so the two cannot be separated in layout.
   */
  method: string;
  unit?: string;
  /** Decimal places. */
  precision?: number;
  /** Explicit sign, for deltas. */
  signed?: boolean;
  /** 95% interval, rendered as "95% CI a … b". */
  ci95?: readonly [number, number] | undefined;
  /** A caveat shown prominently, e.g. a weak-fit flag. */
  caveat?: string | undefined;
  /** Required when `value` is null: why the number is withheld. */
  unknownReason?: string | undefined;
  /** Visual weight. 'hero' is the single largest number in the panel. */
  size?: 'hero' | 'metric' | 'inline';
  /** Colour swatch shown beside the label — must be paired with the number. */
  swatch?: string | undefined;
  children?: ReactNode;
}

function fmt(value: number, precision: number, signed: boolean): string {
  const s = value.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
  return signed && value > 0 ? `+${s}` : s;
}

export function Measured({
  label,
  value,
  method,
  unit,
  precision = 1,
  signed = false,
  ci95,
  caveat,
  unknownReason,
  size = 'metric',
  swatch,
  children,
}: MeasuredProps) {
  const isUnknown = value === null || !Number.isFinite(value);

  const figureSize =
    size === 'hero' ? fontSize.hero : size === 'metric' ? fontSize.metric : fontSize.body;

  const wrap: CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
  };

  const labelStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: space.sm,
    font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.normal} ${font.text}`,
    color: color.textMuted,
    letterSpacing: '0.02em',
  };

  const figureStyle: CSSProperties = {
    // Tabular figures: a live-updating ΔT must not jitter as digits change.
    fontVariantNumeric: 'tabular-nums',
    fontFeatureSettings: '"tnum" 1',
    font: `${font.weightBold} ${figureSize}px/${lineHeight.tight} ${font.display}`,
    color: isUnknown ? color.unknown : color.text,
    display: 'flex',
    alignItems: 'baseline',
    gap: space.xs,
  };

  const methodStyle: CSSProperties = {
    font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
    color: color.textFaint,
    maxWidth: '46ch',
  };

  return (
    <div style={wrap}>
      <div style={labelStyle}>
        {swatch !== undefined && (
          <span
            aria-hidden="true"
            style={{
              width: 9,
              height: 9,
              borderRadius: 2,
              background: swatch,
              flex: '0 0 auto',
            }}
          />
        )}
        {label}
      </div>

      {isUnknown ? (
        <>
          <div style={{ ...figureStyle, fontSize: Math.round(figureSize * 0.62) }}>
            not measurable
          </div>
          {unknownReason !== undefined && (
            <div style={{ ...methodStyle, color: color.warn, maxWidth: '52ch' }}>
              {unknownReason}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={figureStyle}>
            <span>{fmt(value as number, precision, signed)}</span>
            {unit !== undefined && (
              <span
                style={{
                  font: `${font.weightNormal} ${Math.round(figureSize * 0.44)}px/${lineHeight.tight} ${font.display}`,
                  color: color.textMuted,
                }}
              >
                {unit}
              </span>
            )}
          </div>

          {ci95 !== undefined && Number.isFinite(ci95[0]) && Number.isFinite(ci95[1]) && (
            <div
              style={{
                font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.normal} ${font.display}`,
                color: color.textMuted,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              95% CI {fmt(ci95[0], precision, signed)} … {fmt(ci95[1], precision, signed)}
            </div>
          )}

          {caveat !== undefined && (
            <div
              style={{
                font: `${font.weightBold} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
                color: color.warn,
              }}
            >
              {caveat}
            </div>
          )}
        </>
      )}

      {/* The method label is rendered unconditionally — including in the
          unknown case, where the method is what proves the refusal is
          principled rather than a missing feature. */}
      <div style={methodStyle}>{method}</div>
      {children}
    </div>
  );
}
