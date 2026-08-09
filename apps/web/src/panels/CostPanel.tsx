/**
 * The cost table.
 *
 * Renders the uncited state honestly: a line with no resolvable source shows
 * UNSOURCED rather than a dollar figure, and the headline total is withheld
 * entirely if any line lacks a citation. That behaviour comes from
 * `CostBreakdown.hasUnsourcedLines` in the core — this component only displays
 * it, so the UI cannot print a number the model refused to stand behind.
 *
 * Citations are real links. A reader who doubts a price can click through to the
 * schedule, and the print stylesheet appends the URL so a paper copy stays
 * verifiable.
 */

import type { CostBreakdown } from '@canopy/core';
import { formatCostRange } from '@canopy/core';
import { color, font, fontSize } from '../design/tokens.js';

const money = (v: number, currency: string): string =>
  Number.isFinite(v)
    ? v.toLocaleString('en-US', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
      })
    : '—';

export function CostPanel({ cost }: { cost: CostBreakdown }) {
  if (cost.lines.length === 0) {
    return (
      <p style={{ margin: 0, fontSize: fontSize.caption, color: color.textMuted }}>
        Place trees on the map to generate a costed plan.
      </p>
    );
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-md)' }}>
      <div className="section-label">COSTED PLAN</div>

      <table className="cost-table">
        <caption className="sr-only">
          Itemised cost for the proposed planting plan in {cost.region}
        </caption>
        <thead>
          <tr>
            <th scope="col">ITEM</th>
            <th scope="col" style={{ textAlign: 'right' }}>QTY</th>
            <th scope="col" style={{ textAlign: 'right' }}>TOTAL</th>
          </tr>
        </thead>
        <tbody>
          {cost.lines.map((line) => (
            <tr key={line.key}>
              <td style={{ color: color.text }}>
                {line.label}
                <div
                  className={`cost-cite${line.unsourced ? ' cost-cite--unsourced' : ''}`}
                >
                  {line.unsourced ? (
                    'No resolvable source — excluded from the total.'
                  ) : (
                    <>
                      <a
                        href={line.source.source_url}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {line.source.source_name}
                      </a>
                      {' · retrieved '}
                      {line.source.source_retrieved}
                    </>
                  )}
                </div>
              </td>
              <td className="num" style={{ color: color.textMuted }}>
                {line.quantity}
              </td>
              <td
                className="num"
                style={{ color: line.unsourced ? color.warn : color.text }}
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
        <div className="panel--warn" style={{ padding: 'var(--sp-md)', borderRadius: 'var(--r-md)', borderWidth: 1, borderStyle: 'solid' }}>
          <div
            style={{
              fontSize: fontSize.caption,
              fontWeight: font.weightBold,
              color: color.warn,
              letterSpacing: '0.04em',
            }}
          >
            TOTAL WITHHELD
          </div>
          <p
            style={{
              margin: 'var(--sp-xs) 0 0',
              fontSize: fontSize.method,
              color: color.textMuted,
              lineHeight: 1.5,
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
            paddingTop: 'var(--sp-md)',
          }}
        >
          <span style={{ fontSize: fontSize.body, fontWeight: font.weightBold }}>
            TOTAL
          </span>
          <span
            className="num"
            style={{
              fontSize: fontSize.subhead,
              fontWeight: font.weightBold,
              color: color.accent,
            }}
          >
            {formatCostRange(cost)}
          </span>
        </div>
      )}

      <div style={{ fontSize: fontSize.method, color: color.textFaint }}>
        {cost.region} · figures last verified {cost.lastVerified}
      </div>
    </section>
  );
}
