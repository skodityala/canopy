/**
 * The cost table.
 *
 * Renders the uncited state honestly: a line with no resolvable source shows
 * UNSOURCED rather than a dollar figure, and the headline total is withheld
 * entirely if any line is missing its citation. That behaviour comes from
 * `CostBreakdown.hasUnsourcedLines` in the core — this component only displays
 * it, so the UI cannot accidentally print a number the model refused to stand
 * behind.
 */

import type { CostBreakdown } from '@canopy/core';
import { formatCostRange } from '@canopy/core';
import { color, font, fontSize, lineHeight, radius, space } from '../design/tokens.js';

const money = (v: number, currency: string): string =>
  Number.isFinite(v)
    ? v.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 })
    : '—';

export function CostPanel({ cost }: { cost: CostBreakdown }) {
  if (cost.lines.length === 0) {
    return (
      <p
        style={{
          margin: 0,
          font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.normal} ${font.text}`,
          color: color.textMuted,
        }}
      >
        Place trees on the map to generate a costed plan.
      </p>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.md }}>
      <div
        style={{
          font: `${font.weightBold} ${fontSize.method}px/${lineHeight.tight} ${font.text}`,
          color: color.textFaint,
          letterSpacing: '0.08em',
        }}
      >
        COSTED PLAN
      </div>

      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.normal} ${font.text}`,
        }}
      >
        <thead>
          <tr style={{ color: color.textFaint, textAlign: 'left' }}>
            <th style={{ fontSize: fontSize.method, fontWeight: font.weightBold, paddingBottom: space.xs }}>ITEM</th>
            <th style={{ fontSize: fontSize.method, fontWeight: font.weightBold, textAlign: 'right' }}>QTY</th>
            <th style={{ fontSize: fontSize.method, fontWeight: font.weightBold, textAlign: 'right' }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {cost.lines.map((line) => (
            <tr key={line.key} style={{ borderTop: `1px solid ${color.border}` }}>
              <td style={{ padding: `${space.sm}px 0`, color: color.text }}>
                {line.label}
                <div
                  style={{
                    font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
                    color: line.unsourced ? color.warn : color.textFaint,
                    marginTop: 2,
                  }}
                >
                  {line.unsourced
                    ? 'No resolvable source — excluded from the total.'
                    : `${line.source.source_name} · retrieved ${line.source.source_retrieved}`}
                </div>
              </td>
              <td
                style={{
                  textAlign: 'right',
                  fontFamily: font.display,
                  color: color.textMuted,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {line.quantity}
              </td>
              <td
                style={{
                  textAlign: 'right',
                  fontFamily: font.display,
                  color: line.unsourced ? color.warn : color.text,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {line.unsourced
                  ? 'UNSOURCED'
                  : `${money(line.totalLow, cost.currency)}–${money(line.totalHigh, cost.currency)}`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {cost.hasUnsourcedLines ? (
        <div
          style={{
            background: '#241a0c',
            border: `1px solid ${color.warn}`,
            borderRadius: radius.md,
            padding: space.md,
          }}
        >
          <div
            style={{
              font: `${font.weightBold} ${fontSize.caption}px/${lineHeight.tight} ${font.text}`,
              color: color.warn,
              letterSpacing: '0.04em',
            }}
          >
            TOTAL WITHHELD
          </div>
          <p
            style={{
              margin: `${space.xs}px 0 0`,
              font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
              color: color.textMuted,
            }}
          >
            {formatCostRange(cost)}. Canopy will not print a cost it cannot attribute to a
            real published figure.
          </p>
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            borderTop: `1px solid ${color.borderStrong}`,
            paddingTop: space.md,
          }}
        >
          <span
            style={{
              font: `${font.weightBold} ${fontSize.body}px/${lineHeight.tight} ${font.text}`,
              color: color.text,
            }}
          >
            TOTAL
          </span>
          <span
            style={{
              font: `${font.weightBold} ${fontSize.subhead}px/${lineHeight.tight} ${font.display}`,
              color: color.accent,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatCostRange(cost)}
          </span>
        </div>
      )}

      <div
        style={{
          font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
          color: color.textFaint,
        }}
      >
        {cost.region} · figures last verified {cost.lastVerified}
      </div>
    </div>
  );
}
