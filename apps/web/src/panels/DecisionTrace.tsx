/**
 * The decision trace — every gate, its input, its threshold, and its verdict.
 *
 * The refusal architecture is the product's central claim, and until now it
 * required a paragraph of explanation. This renders it as a checklist a reader
 * scans in about four seconds: three gates, each PASS or FAIL, each showing the
 * actual measured value against the actual threshold.
 *
 * It is derived entirely from the Report — nothing here re-implements a gate, so
 * the trace cannot disagree with what the pipeline did.
 */

import type { Report } from '@canopy/core';
import { R2_FULL, R2_WEAK, REQUIRED_COVERAGE } from '@canopy/core';
import { color, font, fontSize } from '../design/tokens.js';

interface Gate {
  readonly label: string;
  readonly measured: string;
  readonly threshold: string;
  readonly pass: boolean;
  /** What happens on failure — only shown when it actually failed. */
  readonly consequence?: string;
}

function gatesFor(report: Report): readonly Gate[] {
  const cov = report.measured.coverage;
  const fit = report.prediction.fit;
  const r2 = fit?.r2 ?? Number.NaN;

  const gates: Gate[] = [
    {
      label: 'Yard cloud-free coverage',
      measured: Number.isFinite(cov) ? `${(cov * 100).toFixed(1)}%` : '—',
      threshold: `≥ ${(REQUIRED_COVERAGE * 100).toFixed(0)}%`,
      pass: Number.isFinite(cov) && cov >= REQUIRED_COVERAGE,
      consequence: 'ΔT withheld — the yard is too obscured to measure',
    },
    {
      label: 'Regression fit quality',
      measured: Number.isFinite(r2) ? `R² ${r2.toFixed(3)}` : 'no fit',
      threshold: `≥ ${R2_FULL.toFixed(2)} full · ≥ ${R2_WEAK.toFixed(2)} indicative`,
      pass: Number.isFinite(r2) && r2 >= R2_WEAK,
      consequence: 'ΔT withheld — the local relationship is not resolvable',
    },
    {
      label: 'Cost citations resolved',
      measured: `${report.cost.lines.filter((l) => !l.unsourced).length}/${report.cost.lines.length} lines`,
      threshold: 'all lines',
      pass: report.cost.lines.length > 0 && !report.cost.hasUnsourcedLines,
      consequence: 'Total withheld — a price without a source is not printed',
    },
  ];
  return gates;
}

export function DecisionTrace({ report }: { report: Report }) {
  const gates = gatesFor(report);
  const suppressed = report.prediction.kind === 'suppressed';
  const verdict = suppressed
    ? { label: 'SUPPRESSED', tone: color.warn }
    : report.prediction.kind === 'weak'
      ? { label: 'INDICATIVE', tone: color.warn }
      : { label: 'ESTIMATE', tone: color.accent };

  return (
    <section className="panel" style={{ padding: 'var(--sp-md)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 'var(--sp-sm)',
          marginBottom: 'var(--sp-sm)',
        }}
      >
        <div className="section-label">DECISION TRACE</div>
        <span className="chip" style={{ color: verdict.tone }}>
          ⬤ {verdict.label}
        </span>
      </div>

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--sp-sm)' }}>
        {gates.map((g) => (
          <li key={g.label}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr auto',
                alignItems: 'baseline',
                gap: 'var(--sp-sm)',
              }}
            >
              {/* Glyph as well as colour — never colour alone. */}
              <span
                aria-hidden="true"
                style={{
                  color: g.pass ? color.accent : color.warn,
                  fontWeight: font.weightBold,
                  fontSize: fontSize.caption,
                }}
              >
                {g.pass ? '✓' : '✗'}
              </span>
              <span style={{ fontSize: fontSize.caption, color: color.text }}>
                {g.label}
                <span className="sr-only">{g.pass ? ' — pass' : ' — fail'}</span>
              </span>
              <span
                className="num"
                style={{
                  fontSize: fontSize.caption,
                  color: g.pass ? color.textMuted : color.warn,
                  fontWeight: font.weightBold,
                }}
              >
                {g.measured}
              </span>
            </div>
            <div
              style={{
                paddingLeft: 'var(--sp-lg)',
                fontSize: fontSize.method,
                color: color.textFaint,
                lineHeight: 1.45,
              }}
            >
              threshold {g.threshold}
              {!g.pass && g.consequence !== undefined && (
                <>
                  {' · '}
                  <span style={{ color: color.warn }}>{g.consequence}</span>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>

      {suppressed && (
        <p
          style={{
            margin: 'var(--sp-md) 0 0',
            paddingTop: 'var(--sp-sm)',
            borderTop: `1px solid ${color.border}`,
            fontSize: fontSize.method,
            color: color.textMuted,
            lineHeight: 1.5,
          }}
        >
          Canopy cover, the planting plan and the measured yard temperature remain valid
          and are shown above. Only the unsupported claim is withheld.
        </p>
      )}
    </section>
  );
}
