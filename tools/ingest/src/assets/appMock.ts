/**
 * The product, drawn as it actually renders.
 *
 * This mirrors App.tsx's three-column layout and paints the same Grids the
 * canvas paints, from the same fixtures, with the same palette. It is a
 * rendering of the product, not a mockup of it — the numbers come from
 * buildReport and would change if the method changed.
 */

import { formatCostRange } from '@canopy/core';
import type { Surface } from '@canopy/render';
import { ink, lstColor } from '@canopy/render';
import type { BuiltReport } from '../pipeline.js';
import {
  drawGrid,
  drawLstLegend,
  drawThermalLattice,
  drawTrees,
  drawYard,
  ndviColour,
  panel,
  viewportFor,
  wrapText,
} from './draw.js';

export interface AppMockOptions {
  readonly width: number;
  readonly height: number;
  readonly layer: 'lst' | 'ndvi';
}

export function drawAppMock(s: Surface, built: BuiltReport, opts: AppMockOptions): void {
  const { report, analysis, trees, classes } = built;
  const { width: W, height: H } = opts;

  const LEFT = 232;
  const RIGHT = 372;
  const PAD = 18;
  const mapX = LEFT + PAD;
  const mapW = W - LEFT - RIGHT - PAD * 2;

  // ── Left rail.
  panel(s, 0, 0, LEFT, H, ink.bg);
  s.line(LEFT, 0, LEFT, H, { stroke: ink.border, strokeWidth: 1 });

  s.text(PAD, 34, '🌳 Canopy', { size: 16, color: ink.accent, family: 'sans', bold: true });
  s.text(PAD, 50, 'Schoolyard shade plans from satellite imagery', {
    size: 7.5,
    color: ink.textFaint,
    family: 'sans',
  });

  s.text(PAD, 84, 'SCHOOLYARD', {
    size: 7,
    color: ink.textFaint,
    family: 'sans',
    bold: true,
  });

  const schools: Array<readonly [string, string]> = [
    ['Cactus Wren Elementary School', '9,004 m²'],
    ['Dos Rios Elementary School', '8,998 m²'],
    ['John Jacobs Elementary School', '9,003 m²'],
    ['Sunridge Elementary School', '9,003 m²'],
  ];
  let sy = 96;
  for (const [name, area] of schools) {
    const firstWord = name.split(' ')[0] ?? name;
    const active = report.school.name.startsWith(firstWord);
    if (active) {
      s.rect(PAD - 6, sy - 2, LEFT - PAD * 2 + 12, 32, {
        fill: ink.panelRaised,
        stroke: '#2c5f40',
        strokeWidth: 1,
      });
    }
    const short = name.replace(' Elementary School', ' Elementary');
    s.text(PAD, sy + 11, short, {
      size: 8.5,
      color: active ? ink.text : ink.textMuted,
      family: 'sans',
      bold: active,
    });
    s.text(PAD, sy + 23, `Phoenix, AZ · ${area}`, {
      size: 7,
      color: ink.textFaint,
      family: 'mono',
    });
    sy += 36;
  }

  // Layer toggle.
  s.text(PAD, sy + 22, 'MAP LAYER', { size: 7, color: ink.textFaint, family: 'sans', bold: true });
  const bw = (LEFT - PAD * 2 - 4) / 2;
  const toggles: Array<['lst' | 'ndvi', string]> = [
    ['lst', 'Temperature'],
    ['ndvi', 'Vegetation'],
  ];
  toggles.forEach(([key, label], i) => {
    const on = key === opts.layer;
    s.rect(PAD + i * (bw + 4), sy + 30, bw, 22, {
      fill: on ? '#2c5f40' : 'none',
      stroke: on ? ink.accent : ink.border,
      strokeWidth: 1,
    });
    s.text(PAD + i * (bw + 4) + bw / 2, sy + 45, label, {
      size: 8,
      color: on ? ink.text : ink.textMuted,
      family: 'sans',
      align: 'center',
    });
  });

  s.rect(PAD, sy + 64, 10, 10, { fill: ink.accent, stroke: ink.accent, strokeWidth: 1 });
  s.text(PAD + 16, sy + 73, 'Show 100 m thermal grid', {
    size: 8,
    color: ink.textMuted,
    family: 'sans',
  });

  s.text(PAD, H - 40, 'Runs fully offline.', { size: 7.5, color: ink.textFaint, family: 'sans' });
  s.text(PAD, H - 28, 'No request leaves this machine.', {
    size: 7.5,
    color: ink.textFaint,
    family: 'sans',
  });

  // ── Centre: the map is the hero.
  const mapTop = PAD;
  const mapH = H - PAD * 2 - 34;
  const v = viewportFor(report.school.synthetic ? built.scene.meta.yard : built.scene.meta.yard, {
    x: mapX,
    y: mapTop,
    w: mapW,
    h: mapH,
  });

  s.rect(mapX, mapTop, mapW, mapH, { fill: ink.bg });
  drawGrid(
    s,
    v,
    opts.layer === 'lst' ? analysis.lst : analysis.ndvi,
    opts.layer === 'lst' ? lstColor : ndviColour,
  );
  drawThermalLattice(s, v, analysis.lst);
  drawYard(s, v, built.scene.meta.yard);
  drawTrees(s, v, trees, new Map(classes.map((c) => [c.key, c.crownRadiusM])));

  drawLstLegend(s, mapX, H - PAD - 20, Math.min(360, mapW));

  // ── Right rail: the numbers, each with its method.
  const rx = W - RIGHT + PAD;
  const rw = RIGHT - PAD * 2;
  s.line(W - RIGHT, 0, W - RIGHT, H, { stroke: ink.border, strokeWidth: 1 });

  let y = 34;
  s.text(rx, y, report.school.name.replace(' Elementary School', ' Elementary'), {
    size: 14,
    color: ink.text,
    family: 'sans',
    bold: true,
  });
  y += 14;
  s.text(
    rx,
    y,
    `${report.school.city}, ${report.school.state} · yard ${report.school.yardAreaM2.toLocaleString('en-US')} m²`,
    { size: 7.5, color: ink.textFaint, family: 'mono' },
  );
  y += 22;

  // Synthetic disclosure.
  s.rect(rx, y, rw, 30, { fill: '#3a2a12', stroke: ink.warn, strokeWidth: 1 });
  s.text(rx + 8, y + 12, 'SYNTHETIC IMAGERY', {
    size: 7,
    color: ink.warn,
    family: 'sans',
    bold: true,
  });
  s.text(rx + 8, y + 23, 'Generated pixels. Yard geometry is real OSM data.', {
    size: 6.5,
    color: ink.textMuted,
    family: 'sans',
  });
  y += 44;

  // Canopy pair.
  const half = rw / 2;
  metric(s, rx, y, 'CANOPY COVER NOW', `${report.plan.canopyPctBefore.toFixed(1)}`, '%', ink.text);
  metric(
    s,
    rx + half,
    y,
    'AFTER THIS PLAN',
    `${report.plan.canopyPctAfter.toFixed(1)}`,
    '%',
    ink.accent,
  );
  y += 44;
  for (const line of wrapText(
    `Sentinel-2 B8/B4 at 10 m · NDVI ≥ ${report.imagery.ndviCanopyThreshold} classified as canopy · crown union ${Math.round(report.plan.unionCrownM2).toLocaleString('en-US')} m² after ${(report.plan.overlapFraction * 100).toFixed(1)}% measured overlap`,
    rw,
    6.5,
  )) {
    s.text(rx, y, line, { size: 6.5, color: ink.textFaint, family: 'sans' });
    y += 8;
  }
  y += 12;

  // Measured temperature.
  s.text(rx, y, 'RECESS YARD SURFACE TEMPERATURE', {
    size: 7,
    color: ink.textMuted,
    family: 'sans',
  });
  y += 26;
  s.text(rx, y, report.measured.lstMeanC.toFixed(1), {
    size: 26,
    color: lstColor(report.measured.lstMeanC),
    family: 'mono',
    bold: true,
  });
  s.text(rx + 54, y, '°C', { size: 12, color: ink.textMuted, family: 'mono' });
  y += 12;
  for (const line of wrapText(
    `${report.imagery.spacecraft.replace('_', ' ')} B10, ${report.imagery.thermalDate}, ${report.imagery.localOverpassTime} local overpass · mean of ${report.measured.thermalPixels} thermal pixels at 100 m native · peak afternoon is higher`,
    rw,
    6.5,
  )) {
    s.text(rx, y, line, { size: 6.5, color: ink.textFaint, family: 'sans' });
    y += 8;
  }
  y += 14;

  // The prediction — or the refusal.
  if (report.prediction.kind === 'suppressed') {
    s.rect(rx, y, rw, 78, { fill: '#241a0c', stroke: ink.warn, strokeWidth: 1 });
    s.text(rx + 10, y + 14, 'PREDICTED TEMPERATURE CHANGE', {
      size: 7,
      color: ink.textMuted,
      family: 'sans',
    });
    s.text(rx + 10, y + 40, 'WITHHELD', {
      size: 22,
      color: ink.warn,
      family: 'mono',
      bold: true,
    });
    s.text(rx + 10, y + 53, 'CLOUD COVER OVER THIS YARD', {
      size: 7,
      color: ink.warn,
      family: 'sans',
      bold: true,
    });
    let ey = y + 64;
    for (const line of wrapText(report.prediction.explanation, rw - 20, 6.5).slice(0, 2)) {
      s.text(rx + 10, ey, line, { size: 6.5, color: ink.textMuted, family: 'sans' });
      ey += 8;
    }
    y += 88;
    s.text(rx, y, 'Canopy cover and cost remain valid — only ΔT is withheld.', {
      size: 6.5,
      color: ink.textFaint,
      family: 'sans',
    });
    y += 16;
  } else {
    const p = report.prediction;
    s.text(rx, y, 'PREDICTED CHANGE AFTER PLANTING', {
      size: 7,
      color: ink.textMuted,
      family: 'sans',
    });
    y += 40;
    s.text(rx, y, p.deltaC.toFixed(1), {
      size: 40,
      color: ink.accent,
      family: 'mono',
      bold: true,
    });
    s.text(rx + 86, y, '°C', { size: 17, color: ink.textMuted, family: 'mono' });
    y += 15;
    s.text(rx, y, `95% CI ${p.ci95[0].toFixed(1)} … ${p.ci95[1].toFixed(1)}`, {
      size: 8,
      color: ink.textMuted,
      family: 'mono',
    });
    y += 12;
    for (const line of wrapText(report.deltaMethod ?? '', rw, 6.5)) {
      s.text(rx, y, line, { size: 6.5, color: ink.textFaint, family: 'sans' });
      y += 8;
    }
    y += 12;
  }

  // Cost.
  s.text(rx, y, 'COSTED PLAN', { size: 7, color: ink.textFaint, family: 'sans', bold: true });
  y += 12;
  for (const line of report.cost.lines.slice(0, 3)) {
    s.text(rx, y, line.label.slice(0, 40), { size: 7.5, color: ink.text, family: 'sans' });
    s.text(rx + rw, y, line.unsourced ? 'UNSOURCED' : '—', {
      size: 7.5,
      color: line.unsourced ? ink.warn : ink.text,
      family: 'mono',
      align: 'right',
    });
    y += 10;
    s.text(rx + 6, y, 'No resolvable source — excluded from the total.', {
      size: 6,
      color: ink.warn,
      family: 'sans',
    });
    y += 11;
  }

  y += 4;
  s.rect(rx, y, rw, 30, { fill: '#241a0c', stroke: ink.warn, strokeWidth: 1 });
  s.text(rx + 8, y + 12, 'TOTAL WITHHELD', {
    size: 7.5,
    color: ink.warn,
    family: 'sans',
    bold: true,
  });
  s.text(rx + 8, y + 23, formatCostRange(report.cost).slice(0, 58), {
    size: 6.5,
    color: ink.textMuted,
    family: 'sans',
  });
}

function metric(
  s: Surface,
  x: number,
  y: number,
  label: string,
  value: string,
  unit: string,
  colour: string,
): void {
  s.text(x, y, label, { size: 7, color: ink.textMuted, family: 'sans' });
  s.text(x, y + 26, value, { size: 24, color: colour, family: 'mono', bold: true });
  s.text(x + s.measureText(value, { size: 24, color: colour, family: 'mono', bold: true }) + 4, y + 26, unit, {
    size: 11,
    color: ink.textMuted,
    family: 'mono',
  });
}
