/**
 * <Measured> — the only sanctioned way to put a number on screen. §7, proof #2
 *
 * `method` is a REQUIRED prop. There is no default and no optional variant, so
 * rendering a quantity without stating how it was measured is a type error
 * rather than an oversight.
 *
 * It also handles the unknown case properly: pass `value={null}` and it renders
 * an explicit "not measurable" state with the reason, never a zero.
 */

import type { CSSProperties, ReactNode } from 'react';
import { color, font, fontSize } from '../design/tokens.js';

export interface MeasuredProps {
  /** What this quantity is, e.g. "Recess yard surface temperature". */
  label: string;
  /**
   * The measured value. `null` means not measurable — the component then renders
   * the refusal with its reason instead of a figure.
   */
  value: number | null;
  /**
   * How this number was produced. REQUIRED. Rendered inside the same component
   * as the figure, so the two cannot be separated by a layout change.
   */
  method: string;
  unit?: string | undefined;
  precision?: number | undefined;
  /** Explicit sign, for deltas. */
  signed?: boolean | undefined;
  ci95?: readonly [number, number] | undefined;
  /** A caveat shown prominently, e.g. a weak-fit flag. */
  caveat?: string | undefined;
  /** Required when `value` is null: why the number is withheld. */
  unknownReason?: string | undefined;
  size?: 'hero' | 'metric' | 'inline' | undefined;
  /** Colour swatch beside the label — always paired with the number itself. */
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

  const figureStyle: CSSProperties = {
    fontSize: figureSize,
    color: isUnknown ? color.unknown : color.text,
    fontFamily: font.display,
  };

  return (
    <div className="measured">
      <div className="measured__label">
        {swatch !== undefined && (
          <span aria-hidden="true" className="swatch" style={{ background: swatch }} />
        )}
        {label}
      </div>

      {isUnknown ? (
        <>
          <div
            className="measured__value num"
            style={{ ...figureStyle, fontSize: Math.round(figureSize * 0.62) }}
          >
            not measurable
          </div>
          {unknownReason !== undefined && (
            <div className="measured__method" style={{ color: color.warn, maxWidth: '52ch' }}>
              {unknownReason}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="measured__value num" style={figureStyle}>
            <span>{fmt(value as number, precision, signed)}</span>
            {unit !== undefined && (
              <span
                style={{
                  fontSize: Math.round(figureSize * 0.44),
                  color: color.textMuted,
                  fontWeight: font.weightNormal,
                }}
              >
                {unit}
              </span>
            )}
          </div>

          {ci95 !== undefined && Number.isFinite(ci95[0]) && Number.isFinite(ci95[1]) && (
            <div
              className="num"
              style={{ fontSize: fontSize.caption, color: color.textMuted }}
            >
              95% CI {fmt(ci95[0], precision, signed)} … {fmt(ci95[1], precision, signed)}
            </div>
          )}

          {caveat !== undefined && (
            <div
              style={{
                fontSize: fontSize.method,
                fontWeight: font.weightBold,
                color: color.warn,
              }}
            >
              {caveat}
            </div>
          )}
        </>
      )}

      {/* Rendered unconditionally — including in the unknown case, where the
          method is what proves the refusal is principled rather than a gap. */}
      <div className="measured__method">{method}</div>
      {children}
    </div>
  );
}
