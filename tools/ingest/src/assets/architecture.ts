/**
 * The pipeline architecture, with the refusal gates drawn as gates.
 *
 * The visual hierarchy carries the argument. Ordinary modules are quiet
 * rectangles; the three points where the system REFUSES to emit a number are
 * amber diamonds with explicit failure branches leading to terminal refusal
 * boxes. A judge scanning this for four seconds should see "this thing has
 * checkpoints" before they read a single label — that contrast is the project's
 * central claim, so it gets the strongest visual treatment on the page.
 */

import type { Surface } from '@canopy/render';
import { ink } from '@canopy/render';
import type { Box } from './thermalResolution.js';
import { wrapText } from './draw.js';

interface Node {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A quiet module box: title, then optional detail lines. */
function moduleBox(
  s: Surface,
  n: Node,
  title: string,
  detail: readonly string[],
  accent: string = ink.border,
): void {
  s.rect(n.x, n.y, n.w, n.h, { fill: ink.panel, stroke: accent, strokeWidth: 1 });
  s.text(n.x + 10, n.y + 17, title, {
    size: 8.5,
    color: ink.text,
    family: 'mono',
    bold: true,
  });
  let y = n.y + 31;
  for (const line of detail) {
    for (const wrapped of wrapText(line, n.w - 20, 6.5)) {
      s.text(n.x + 10, y, wrapped, { size: 6.5, color: ink.textFaint, family: 'sans' });
      y += 9;
    }
  }
}

/**
 * A gate. Amber, diamond-shaped, and visually louder than any module — because
 * the gates are the thing that distinguishes this pipeline from a conventional
 * one that always emits a value.
 */
function gate(s: Surface, cx: number, cy: number, halfW: number, halfH: number, label: string): void {
  s.path(
    `M${cx},${cy - halfH} L${cx + halfW},${cy} L${cx},${cy + halfH} L${cx - halfW},${cy} Z`,
    { fill: '#241a0c', stroke: ink.warn, strokeWidth: 2 },
  );
  s.text(cx, cy + 3, label, {
    size: 8,
    color: ink.warn,
    family: 'sans',
    bold: true,
    align: 'center',
  });
}

/** A terminal refusal box — where a gate's NO branch ends. */
function refusal(s: Surface, n: Node, verdict: string, detail: string): void {
  s.rect(n.x, n.y, n.w, n.h, { fill: '#241a0c', stroke: ink.warn, strokeWidth: 1.5 });
  s.text(n.x + 10, n.y + 16, verdict, {
    size: 8,
    color: ink.warn,
    family: 'mono',
    bold: true,
  });
  let y = n.y + 29;
  for (const line of wrapText(detail, n.w - 20, 6.5)) {
    s.text(n.x + 10, y, line, { size: 6.5, color: ink.textMuted, family: 'sans' });
    y += 9;
  }
}

/** Straight connector with a filled arrowhead at the far end. */
function arrow(
  s: Surface,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  colour: string = ink.textMuted,
  label?: string,
): void {
  s.line(x1, y1, x2, y2, { stroke: colour, strokeWidth: 1.2 });
  const angle = Math.atan2(y2 - y1, x2 - x1);
  const size = 6;
  const ax = x2 - size * Math.cos(angle);
  const ay = y2 - size * Math.sin(angle);
  const spread = 0.42;
  s.path(
    `M${x2.toFixed(1)},${y2.toFixed(1)} ` +
      `L${(ax - size * spread * Math.sin(angle)).toFixed(1)},${(ay + size * spread * Math.cos(angle)).toFixed(1)} ` +
      `L${(ax + size * spread * Math.sin(angle)).toFixed(1)},${(ay - size * spread * Math.cos(angle)).toFixed(1)} Z`,
    { fill: colour },
  );
  if (label !== undefined) {
    s.text((x1 + x2) / 2 + 5, (y1 + y2) / 2 - 4, label, {
      size: 6.5,
      color: colour,
      family: 'sans',
      bold: true,
    });
  }
}

/** A labelled band grouping several modules. */
function band(s: Surface, n: Node, label: string): void {
  s.rect(n.x, n.y, n.w, n.h, { fill: '#171412', stroke: ink.border, strokeWidth: 1 });
  s.text(n.x + 10, n.y + 14, label, {
    size: 7,
    color: ink.textFaint,
    family: 'mono',
    bold: true,
  });
}

export function drawArchitecture(s: Surface, box: Box): void {
  const M = 36;

  s.text(M, 42, 'PIPELINE — AND THE THREE PLACES IT REFUSES', {
    size: 13,
    color: ink.text,
    family: 'sans',
    bold: true,
  });
  s.text(M, 60, 'Amber diamonds are gates. Every one of them can stop a number from being printed.', {
    size: 8,
    color: ink.textMuted,
    family: 'sans',
  });

  const colW = 196;
  const leftX = M;
  const midX = M + colW + 46;
  const rightX = midX + colW + 46;

  // ── Inputs.
  band(s, { x: leftX, y: 80, w: colW, h: 176 }, 'fixtures/schools/<slug>');
  moduleBox(
    s,
    { x: leftX + 10, y: 100, w: colW - 20, h: 42 },
    'Sentinel-2 B4/B8',
    ['red + NIR reflectance, 10 m'],
  );
  moduleBox(
    s,
    { x: leftX + 10, y: 150, w: colW - 20, h: 42 },
    'Landsat 8/9 B10',
    ['thermal digital numbers, 100 m'],
  );
  moduleBox(
    s,
    { x: leftX + 10, y: 200, w: colW - 20, h: 42 },
    'Landsat QA_PIXEL',
    ['cloud / cirrus / shadow bits'],
  );
  s.text(leftX + 10, 268, 'committed JSON · no network at runtime', {
    size: 6.5,
    color: ink.textFaint,
    family: 'sans',
  });

  // ── raster/ band.
  band(s, { x: midX, y: 80, w: colW, h: 250 }, 'packages/core/src/raster/');
  moduleBox(
    s,
    { x: midX + 10, y: 100, w: colW - 20, h: 46 },
    'ndvi.ts',
    ['(NIR − Red)/(NIR + Red)', 'null on zero-signal pixel, never 0'],
  );
  moduleBox(
    s,
    { x: midX + 10, y: 154, w: colW - 20, h: 54 },
    'lst.ts',
    ['DN → radiance → brightness temp', '→ emissivity (Sobrino) → °C', 'Kelvin throughout; °C once, at the end'],
  );
  moduleBox(
    s,
    { x: midX + 10, y: 216, w: colW - 20, h: 42 },
    'mask.ts',
    ['QA bits → cloud mask', 'yard coverage ratio'],
  );
  moduleBox(
    s,
    { x: midX + 10, y: 266, w: colW - 20, h: 42 },
    'resample.ts',
    ['area-weighted 10 m → 100 m', 'not nearest-neighbour'],
  );

  arrow(s, leftX + colW, 168, midX, 168);

  // ── GATE 1 — coverage.
  const g1y = 372;
  gate(s, midX + colW / 2, g1y, 108, 40, 'coverage ≥ 80% ?');
  arrow(s, midX + colW / 2, 330, midX + colW / 2, g1y - 40);
  refusal(
    s,
    { x: leftX, y: g1y - 34, w: colW - 8, h: 68 },
    'SUPPRESSED',
    'insufficient_coverage — no temperature is reported for this yard.',
  );
  arrow(s, midX + colW / 2 - 108, g1y, leftX + colW - 8, g1y, ink.warn, 'NO');

  // ── model/ band.
  band(s, { x: rightX, y: 80, w: colW, h: 250 }, 'packages/core/src/model/');
  moduleBox(
    s,
    { x: rightX + 10, y: 100, w: colW - 20, h: 54 },
    'regression.ts',
    ['OLS: LST ~ NDVI on this scene', 'β₁, R², n, 95% CI', 'real Student-t quantile'],
    ink.accent,
  );
  moduleBox(
    s,
    { x: rightX + 10, y: 162, w: colW - 20, h: 46 },
    'canopy.ts',
    ['crown union, 0.5 m quadrature', 'overlap measured, not assumed'],
  );
  moduleBox(
    s,
    { x: rightX + 10, y: 216, w: colW - 20, h: 46 },
    'prediction.ts',
    ['ΔLST ≈ β₁ · ΔNDVI_yard', 'CI scaled through'],
  );
  moduleBox(
    s,
    { x: rightX + 10, y: 270, w: colW - 20, h: 38 },
    'cost.ts',
    ['itemised · citation required per line'],
  );

  arrow(s, midX + colW, 168, rightX, 168);

  // ── GATE 2 — fit quality.
  gate(s, rightX + colW / 2, g1y, 112, 40, 'R² threshold ?');
  arrow(s, rightX + colW / 2, 330, rightX + colW / 2, g1y - 40);

  const outcomes: Array<readonly [string, string, string]> = [
    ['R² ≥ 0.50', 'ESTIMATE', ink.accent],
    ['R² ≥ 0.30', 'INDICATIVE', ink.warn],
    ['R² < 0.30', 'SUPPRESSED', ink.warn],
  ];
  let oy = g1y + 62;
  for (const [cond, verdict, colour] of outcomes) {
    s.text(rightX + 10, oy, cond, { size: 7, color: ink.textFaint, family: 'mono' });
    s.text(rightX + 78, oy, `▶  ${verdict}`, {
      size: 7.5,
      color: colour,
      family: 'sans',
      bold: true,
    });
    oy += 15;
  }
  arrow(s, rightX + colW / 2, g1y + 40, rightX + colW / 2, g1y + 52, ink.warn);

  // ── GATE 3 — citations.
  const g3y = 522;
  gate(s, midX + colW / 2, g3y, 112, 40, 'every line cited ?');
  refusal(
    s,
    { x: leftX, y: g3y - 34, w: colW - 8, h: 68 },
    'UNSOURCED',
    'That line is excluded and the headline total is withheld entirely.',
  );
  arrow(s, midX + colW / 2 - 112, g3y, leftX + colW - 8, g3y, ink.warn, 'NO');
  arrow(s, rightX + colW / 2, g1y + 118, midX + colW / 2 + 112, g3y - 12);

  // ── Report.
  moduleBox(
    s,
    { x: midX, y: g3y + 74, w: colW * 2 + 46, h: 54 },
    'report/buildReport.ts  →  packages/render',
    [
      'One renderer, two backends: the PDF a facilities office receives and the SVG in this README',
      'are the same code — so the documentation cannot drift from the artifact.',
    ],
    ink.accent,
  );
  arrow(s, midX + colW / 2, g3y + 40, midX + colW / 2, g3y + 74);

  // ── Side annotations: the dependency rule and the ports.
  const noteY = 620;
  s.rect(leftX, noteY, colW - 8, 118, { fill: ink.panel, stroke: ink.accent, strokeWidth: 1 });
  s.text(leftX + 10, noteY + 18, 'THE DEPENDENCY RULE', {
    size: 7,
    color: ink.accent,
    family: 'sans',
    bold: true,
  });
  let ny = noteY + 34;
  for (const line of wrapText(
    'packages/core imports nothing. Zero I/O, zero DOM, zero network — enforced by an empty `types` array in its tsconfig and by a test that greps the source. Importing node:fs there is a compile error.',
    colW - 28,
    6.5,
  )) {
    s.text(leftX + 10, ny, line, { size: 6.5, color: ink.textMuted, family: 'sans' });
    ny += 9;
  }

  s.text(midX, noteY + 18, 'PORT BOUNDARY', {
    size: 7,
    color: ink.textFaint,
    family: 'sans',
    bold: true,
  });
  const ports: Array<readonly [string, string]> = [
    ['ImageryPort', 'fixture adapter (default, offline) · real COG scenes drop in unchanged'],
    ['CostModelPort', 'cited regional JSON — data, not a service'],
    ['BasemapPort', 'bundled offline tiles'],
  ];
  let py = noteY + 36;
  for (const [name, detail] of ports) {
    s.text(midX, py, name, { size: 7.5, color: ink.text, family: 'mono', bold: true });
    py += 10;
    for (const line of wrapText(detail, colW * 2, 6.5)) {
      s.text(midX + 8, py, line, { size: 6.5, color: ink.textFaint, family: 'sans' });
      py += 9;
    }
    py += 4;
  }
}
