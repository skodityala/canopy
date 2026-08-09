/**
 * drawReport — the deliverable artifact, written ONCE against Surface. §5.2.
 *
 * The same function produces the PDF a judge downloads and the SVG in the
 * README, so the two can never disagree.
 *
 * Two structural rules this file exists to enforce:
 *   1. No figure is drawn without its method line. The helpers take `method` as
 *      a required argument, mirroring <Measured> on the web side.
 *   2. The suppressed prediction renders as an explicit refusal with its reason
 *      — never as a blank, and never as a zero. The Prediction union forces the
 *      branch, so this cannot be forgotten.
 */

import type { Report } from '@canopy/core';
import { formatCostRange } from '@canopy/core';
import type { Surface } from './Surface.js';
import { PAGE_WIDTH } from './Surface.js';
import { ink, layout, lstColor } from './theme.js';

const X = layout.marginX;
const W = layout.contentWidth;

interface Cursor {
  y: number;
}

function heading(s: Surface, c: Cursor, text: string): void {
  s.text(X, c.y, text.toUpperCase(), {
    size: 8.5,
    color: ink.textFaint,
    family: 'sans',
    bold: true,
  });
  c.y += 6;
  s.line(X, c.y, X + W, c.y, { stroke: ink.border, strokeWidth: 0.75 });
  c.y += 16;
}

/** A figure with its method label. `method` is required by signature. */
function figure(
  s: Surface,
  c: Cursor,
  opts: {
    label: string;
    value: string;
    unit?: string | undefined;
    method: string;
    x?: number | undefined;
    width?: number | undefined;
    size?: number | undefined;
    color?: string | undefined;
    caveat?: string | undefined;
  },
): void {
  const x = opts.x ?? X;
  const size = opts.size ?? 25;
  s.text(x, c.y, opts.label, { size: 8.5, color: ink.textMuted, family: 'sans' });
  const valueY = c.y + size * 0.95;
  s.text(x, valueY, opts.value, {
    size,
    color: opts.color ?? ink.text,
    family: 'mono',
    bold: true,
  });
  if (opts.unit !== undefined) {
    const w = s.measureText(opts.value, { size, color: ink.text, family: 'mono', bold: true });
    s.text(x + w + 4, valueY, opts.unit, {
      size: size * 0.44,
      color: ink.textMuted,
      family: 'mono',
    });
  }
  let my = valueY + 11;
  if (opts.caveat !== undefined) {
    s.text(x, my, opts.caveat, { size: 7.5, color: ink.warn, family: 'sans', bold: true });
    my += 9;
  }
  for (const line of wrap(opts.method, opts.width ?? W, 7)) {
    s.text(x, my, line, { size: 7, color: ink.textFaint, family: 'sans' });
    my += 8.5;
  }
  c.y = my;
}

/** Greedy wrap using the surface's own metrics, so both backends agree. */
function wrap(text: string, width: number, size: number): string[] {
  const perChar = size * 0.52;
  const max = Math.max(8, Math.floor(width / perChar));
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const next = cur === '' ? word : `${cur} ${word}`;
    if (next.length > max) {
      if (cur !== '') lines.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur !== '') lines.push(cur);
  return lines;
}

/** Horizontal bar comparison — the canopy before/after chart. */
function barPair(
  s: Surface,
  c: Cursor,
  opts: {
    beforePct: number;
    afterPct: number;
    scaleMaxPct: number;
  },
): void {
  const barW = W - 92;
  const rows: Array<[string, number, string]> = [
    ['before', opts.beforePct, ink.textMuted],
    ['after', opts.afterPct, ink.accent],
  ];
  for (const [label, pct, colour] of rows) {
    s.text(X, c.y + 8, label, { size: 8, color: ink.textMuted, family: 'sans' });
    s.rect(X + 40, c.y, barW, 11, { fill: ink.panelRaised });
    const frac = Number.isFinite(pct)
      ? Math.min(1, Math.max(0, pct / opts.scaleMaxPct))
      : 0;
    if (frac > 0) s.rect(X + 40, c.y, barW * frac, 11, { fill: colour });
    s.text(X + 40 + barW + 8, c.y + 8.5, Number.isFinite(pct) ? `${pct.toFixed(1)}%` : '—', {
      size: 9,
      color: ink.text,
      family: 'mono',
      bold: true,
    });
    c.y += 17;
  }
}

/**
 * The temperature block. Branches on the Prediction union — the suppressed case
 * is a first-class layout, not an error path.
 */
function temperatureBlock(s: Surface, c: Cursor, report: Report): void {
  heading(s, c, 'Surface temperature');

  const m = report.measured;
  const measuredMethod =
    `${report.imagery.spacecraft.replace('_', ' ')} B10 thermal, ${report.imagery.thermalDate}, ` +
    `${report.imagery.localOverpassTime} local overpass · mean of ${m.thermalPixels} ` +
    `thermal pixel${m.thermalPixels === 1 ? '' : 's'} at 100 m native · ` +
    `peak afternoon yard temperature is higher than at overpass.`;

  figure(s, c, {
    label: 'MEASURED, RECESS YARD',
    value: Number.isFinite(m.lstMeanC) ? m.lstMeanC.toFixed(1) : '—',
    unit: '°C',
    method: measuredMethod,
    color: lstColor(m.lstMeanC),
    width: W * 0.52,
  });

  c.y += 10;

  const p = report.prediction;
  if (p.kind === 'suppressed') {
    // The money state: the number is absent AND the reason is present.
    s.rect(X, c.y, W, 46, { fill: ink.panelRaised, stroke: ink.warn, strokeWidth: 0.75 });
    s.text(X + 10, c.y + 14, 'PREDICTED CHANGE — WITHHELD', {
      size: 8.5,
      color: ink.warn,
      family: 'sans',
      bold: true,
    });
    let ly = c.y + 26;
    for (const line of wrap(p.explanation, W - 20, 7.5)) {
      s.text(X + 10, ly, line, { size: 7.5, color: ink.textMuted, family: 'sans' });
      ly += 9;
    }
    c.y += 54;
    return;
  }

  const delta = p.deltaC;
  figure(s, c, {
    label: 'PREDICTED CHANGE AFTER PLANTING',
    value: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}`,
    unit: '°C',
    method: report.deltaMethod ?? '',
    color: delta < 0 ? ink.accent : ink.danger,
    caveat: p.kind === 'weak' ? p.caveat : undefined,
    width: W * 0.62,
  });

  s.text(X, c.y + 2, `95% CI  ${p.ci95[0].toFixed(1)} … ${p.ci95[1].toFixed(1)} °C`, {
    size: 8,
    color: ink.textMuted,
    family: 'mono',
  });
  c.y += 14;

  if (report.predictedLstMeanC !== null) {
    s.text(
      X,
      c.y,
      `Yard mean would move ${m.lstMeanC.toFixed(1)} °C → ${report.predictedLstMeanC.toFixed(1)} °C ` +
        `(associated with the modelled canopy gain, not a causal claim).`,
      { size: 7.5, color: ink.textFaint, family: 'sans' },
    );
    c.y += 12;
  }
}

function costBlock(s: Surface, c: Cursor, report: Report): void {
  heading(s, c, 'Costed plan');
  const cost = report.cost;

  if (cost.lines.length === 0) {
    s.text(X, c.y, 'No trees placed yet — place trees to generate a costed plan.', {
      size: 8.5,
      color: ink.textMuted,
      family: 'sans',
    });
    c.y += 14;
    return;
  }

  const colQty = X + W * 0.52;
  const colUnit = X + W * 0.64;
  const colTotal = X + W;

  s.text(X, c.y, 'ITEM', { size: 7, color: ink.textFaint, family: 'sans', bold: true });
  s.text(colQty, c.y, 'QTY', { size: 7, color: ink.textFaint, family: 'sans', bold: true });
  s.text(colUnit, c.y, 'UNIT RANGE', {
    size: 7,
    color: ink.textFaint,
    family: 'sans',
    bold: true,
  });
  s.text(colTotal, c.y, 'TOTAL', {
    size: 7,
    color: ink.textFaint,
    family: 'sans',
    bold: true,
    align: 'right',
  });
  c.y += 5;
  s.line(X, c.y, X + W, c.y, { stroke: ink.border, strokeWidth: 0.5 });
  c.y += 11;

  const money = (v: number): string =>
    Number.isFinite(v)
      ? v.toLocaleString('en-US', {
          style: 'currency',
          currency: cost.currency,
          maximumFractionDigits: 0,
        })
      : '—';

  for (const line of cost.lines) {
    s.text(X, c.y, line.label, { size: 8, color: ink.text, family: 'sans' });
    s.text(colQty, c.y, String(line.quantity), {
      size: 8,
      color: ink.textMuted,
      family: 'mono',
    });
    s.text(
      colUnit,
      c.y,
      line.unsourced ? 'no source' : `${money(line.unitLow)}–${money(line.unitHigh)}`,
      { size: 8, color: line.unsourced ? ink.warn : ink.textMuted, family: 'mono' },
    );
    s.text(
      colTotal,
      c.y,
      line.unsourced ? 'UNSOURCED' : `${money(line.totalLow)}–${money(line.totalHigh)}`,
      {
        size: 8,
        color: line.unsourced ? ink.warn : ink.text,
        family: 'mono',
        align: 'right',
      },
    );
    c.y += 11;
    // The citation, on its own line, under the item it justifies.
    const cite = line.unsourced
      ? 'This line has no resolvable source, so it is excluded from the total.'
      : `${line.source.source_name} · retrieved ${line.source.source_retrieved}`;
    s.text(X + 8, c.y, cite, { size: 6.5, color: ink.textFaint, family: 'sans' });
    c.y += 12;
  }

  c.y += 2;
  s.line(X, c.y, X + W, c.y, { stroke: ink.border, strokeWidth: 0.5 });
  c.y += 14;

  if (cost.hasUnsourcedLines) {
    s.rect(X, c.y - 10, W, 30, { fill: ink.panelRaised, stroke: ink.warn, strokeWidth: 0.75 });
    s.text(X + 10, c.y + 2, 'TOTAL WITHHELD', {
      size: 8.5,
      color: ink.warn,
      family: 'sans',
      bold: true,
    });
    s.text(
      X + 10,
      c.y + 13,
      'One or more line items lack a resolvable source, so no headline cost is printed.',
      { size: 7.5, color: ink.textMuted, family: 'sans' },
    );
    c.y += 30;
  } else {
    s.text(X, c.y, 'TOTAL', { size: 10, color: ink.text, family: 'sans', bold: true });
    s.text(X + W, c.y, formatCostRange(cost), {
      size: 12,
      color: ink.accent,
      family: 'mono',
      bold: true,
      align: 'right',
    });
    c.y += 14;
    s.text(X, c.y, `Region: ${cost.region} · figures last verified ${cost.lastVerified}`, {
      size: 7,
      color: ink.textFaint,
      family: 'sans',
    });
    c.y += 12;
  }
}

/** The full report. Single A4 page. */
export function drawReport(s: Surface, report: Report): void {
  const c: Cursor = { y: layout.marginTop };

  // Masthead.
  s.text(X, c.y, 'CANOPY', { size: 13, color: ink.accent, family: 'sans', bold: true });
  s.text(X + W, c.y, `Generated ${report.generatedFor}`, {
    size: 7.5,
    color: ink.textFaint,
    family: 'sans',
    align: 'right',
  });
  c.y += 20;

  s.text(X, c.y, 'Schoolyard shade plan', {
    size: 19,
    color: ink.text,
    family: 'sans',
    bold: true,
  });
  c.y += 18;
  s.text(X, c.y, `${report.school.name} · ${report.school.city}, ${report.school.state}`, {
    size: 10,
    color: ink.textMuted,
    family: 'sans',
  });
  c.y += 12;
  s.text(X, c.y, `Yard area ${report.school.yardAreaM2.toLocaleString('en-US')} m²`, {
    size: 8,
    color: ink.textFaint,
    family: 'mono',
  });
  c.y += 16;

  // Synthetic badge — visible whenever the fixture is not real data.
  if (report.school.synthetic) {
    s.rect(X, c.y, W, 20, { fill: '#3a2a12', stroke: ink.warn, strokeWidth: 0.75 });
    s.text(X + 8, c.y + 13, 'SYNTHETIC IMAGERY', {
      size: 8,
      color: ink.warn,
      family: 'sans',
      bold: true,
    });
    s.text(
      X + 118,
      c.y + 13,
      'Pixel values are generated, not observed. Yard geometry is real OSM data.',
      { size: 7.5, color: ink.textMuted, family: 'sans' },
    );
    c.y += 30;
  }

  // Canopy.
  heading(s, c, 'Canopy cover');
  const plan = report.plan;
  const scaleMax = Math.max(40, Math.ceil((plan.canopyPctAfter + 6) / 10) * 10);
  barPair(s, c, {
    beforePct: plan.canopyPctBefore,
    afterPct: plan.canopyPctAfter,
    scaleMaxPct: scaleMax,
  });
  c.y += 4;
  s.text(
    X,
    c.y,
    `${plan.treeCount} trees · crown union ${Math.round(plan.unionCrownM2).toLocaleString('en-US')} m² ` +
      `after ${(plan.overlapFraction * 100).toFixed(1)}% geometric overlap · ` +
      `effective new shade ${Math.round(plan.effectiveAddedM2).toLocaleString('en-US')} m²`,
    { size: 7.5, color: ink.textFaint, family: 'sans' },
  );
  c.y += 10;
  s.text(
    X,
    c.y,
    `Canopy classified at NDVI ≥ ${report.imagery.ndviCanopyThreshold} · ` +
      `crown radii projected at ~${plan.maturityYears}-year maturity`,
    { size: 7.5, color: ink.textFaint, family: 'sans' },
  );
  c.y += 20;

  temperatureBlock(s, c, report);
  c.y += 8;
  costBlock(s, c, report);
  c.y += 10;

  // Limitations — always present, never omitted.
  heading(s, c, 'Limitations');
  for (const lim of report.limitations) {
    s.circle(X + 2, c.y - 2.5, 1.4, { fill: ink.textFaint });
    let first = true;
    for (const line of wrap(lim, W - 12, 7)) {
      s.text(X + 9, c.y, line, { size: 7, color: ink.textMuted, family: 'sans' });
      c.y += 8.5;
      first = false;
    }
    void first;
    c.y += 2.5;
  }

  // Method footer.
  c.y += 4;
  s.line(X, c.y, X + W, c.y, { stroke: ink.border, strokeWidth: 0.5 });
  c.y += 10;
  const methodLines = [
    'NDVI = (NIR − RED)/(NIR + RED)        L_λ = M_L·Q_cal + A_L',
    'BT = K₂/ln(K₁/L_λ + 1)                P_v = ((NDVI−0.2)/0.3)²',
    'ε = 0.004·P_v + 0.986                 LST = BT/(1 + (λ·BT/ρ)·ln ε)',
    'ΔT = β₁ · ΔNDVI_yard                  β₁ from local OLS fit',
  ];
  for (const line of methodLines) {
    s.text(X, c.y, line, { size: 6.5, color: ink.textFaint, family: 'mono' });
    c.y += 8;
  }

  s.text(
    PAGE_WIDTH / 2,
    826,
    `${report.imagery.opticalSceneId} · ${report.imagery.thermalSceneId} · full method in docs/METHOD.md`,
    { size: 6.5, color: ink.textFaint, family: 'sans', align: 'center' },
  );
}
