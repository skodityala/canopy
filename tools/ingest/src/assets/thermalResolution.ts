/**
 * "Why we report a yard mean and never a per-tree temperature."
 *
 * The single most valuable diagram in the project: it shows the instrument's
 * resolution limit and the decision that follows from it. A judge who sees this
 * understands both that we know the limit and that we chose to say so.
 *
 * Every number is read from the real analysis — the thermal cell values, the
 * cell count, and the yard geometry all come from the committed fixture.
 */

import type { Surface } from '@canopy/render';
import { ink, lstColor } from '@canopy/render';
import { yardCellMask, countMask } from '@canopy/core';
import type { BuiltReport } from '../pipeline.js';
import { drawLstLegend, project, viewportFor, wrapText } from './draw.js';

export interface Box {
  readonly width: number;
  readonly height: number;
}

export function drawThermalResolution(s: Surface, built: BuiltReport, box: Box): void {
  const { analysis, scene, report } = built;
  const M = 44;

  s.text(M, 46, 'WHY WE REPORT A YARD MEAN — NEVER A PER-TREE TEMPERATURE', {
    size: 12,
    color: ink.text,
    family: 'sans',
    bold: true,
  });
  s.text(M, 64, `${report.school.name} · ${report.imagery.spacecraft.replace('_', ' ')} Band 10`, {
    size: 8.5,
    color: ink.textMuted,
    family: 'sans',
  });

  // The thermal grid, zoomed so individual 100 m cells are legible.
  const mapW = 430;
  const mapH = 400;
  const mapY = 96;
  const v = viewportFor(scene.meta.yard, { x: M, y: mapY, w: mapW, h: mapH }, 130);

  const t = analysis.lst.transform;
  const yardMask = yardCellMask(scene.meta.yard, analysis.lst);

  // Paint each thermal cell, label it with its temperature, and outline the
  // ones that actually contribute to the reported mean.
  for (let row = 0; row < analysis.lst.height; row++) {
    const top = t.originY - row * t.pixelHeight;
    if (top < v.minY || top - t.pixelHeight > v.maxY) continue;
    for (let col = 0; col < analysis.lst.width; col++) {
      const left = t.originX + col * t.pixelWidth;
      if (left > v.maxX || left + t.pixelWidth < v.minX) continue;

      const idx = row * analysis.lst.width + col;
      const value = analysis.lst.data[idx]!;
      const inYard = yardMask.data[idx] === 1;
      const [sx, sy] = project(v, left, top);
      const w = t.pixelWidth * v.scale;
      const h = t.pixelHeight * v.scale;

      s.rect(sx, sy, w, h, {
        fill: Number.isNaN(value) ? ink.unknown : lstColor(value),
        stroke: ink.bg,
        strokeWidth: 1,
      });

      if (w > 34) {
        s.text(sx + w / 2, sy + h / 2 + 3, Number.isNaN(value) ? '—' : value.toFixed(1), {
          size: 8,
          color: '#12100f',
          family: 'mono',
          bold: inYard,
          align: 'center',
        });
      }
      // Contributing cells get a bright outline.
      if (inYard) {
        s.rect(sx + 1.5, sy + 1.5, w - 3, h - 3, {
          fill: 'none',
          stroke: ink.accent,
          strokeWidth: 2,
        });
      }
    }
  }

  // The yard polygon on top, so the mismatch of scales is visible.
  const pts = scene.meta.yard.outer.map((p) => project(v, p[0], p[1]));
  s.path(
    `${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} Z`,
    { fill: 'rgba(242,237,233,0.14)', stroke: ink.text, strokeWidth: 2.5 },
  );

  drawLstLegend(s, M, mapY + mapH + 34, mapW);

  // ── Right column: the reasoning.
  const rx = M + mapW + 46;
  const rw = box.width - rx - M;
  let y = mapY + 6;

  const cellCount = countMask(yardMask);
  const facts: Array<readonly [string, string]> = [
    ['Native thermal resolution', '100 m'],
    ['Recess yard span', `≈ ${Math.round(Math.sqrt(report.school.yardAreaM2))} m`],
    ['Cells intersecting the yard', `${cellCount}`],
    ['Cells with usable data', `${report.measured.thermalPixels}`],
    ['Reported yard mean', `${report.measured.lstMeanC.toFixed(1)} °C`],
  ];

  for (const [label, value] of facts) {
    s.text(rx, y, label.toUpperCase(), { size: 7, color: ink.textFaint, family: 'sans', bold: true });
    s.text(rx + rw, y, value, {
      size: 11,
      color: ink.text,
      family: 'mono',
      bold: true,
      align: 'right',
    });
    y += 12;
    s.line(rx, y, rx + rw, y, { stroke: ink.border, strokeWidth: 0.75 });
    y += 16;
  }

  y += 12;
  s.rect(rx, y, rw, 96, { fill: ink.panel, stroke: ink.accent, strokeWidth: 1 });
  s.text(rx + 12, y + 20, '✓  WHAT WE REPORT', {
    size: 8,
    color: ink.accent,
    family: 'sans',
    bold: true,
  });
  let ly = y + 34;
  for (const line of wrapText(
    `A yard-scale mean over ${report.measured.thermalPixels} cloud-free thermal cells, always shown with that count.`,
    rw - 24,
    7.5,
  )) {
    s.text(rx + 12, ly, line, { size: 7.5, color: ink.textMuted, family: 'sans' });
    ly += 10;
  }

  y += 110;
  s.rect(rx, y, rw, 96, { fill: ink.panel, stroke: ink.danger, strokeWidth: 1 });
  s.text(rx + 12, y + 20, '✗  WHAT WE REFUSE TO REPORT', {
    size: 8,
    color: ink.danger,
    family: 'sans',
    bold: true,
  });
  ly = y + 34;
  for (const line of wrapText(
    'A temperature for any single tree. One 100 m cell is larger than the entire planting area — the sensor cannot resolve it, so the claim would be fabricated.',
    rw - 24,
    7.5,
  )) {
    s.text(rx + 12, ly, line, { size: 7.5, color: ink.textMuted, family: 'sans' });
    ly += 10;
  }

  s.text(
    M,
    box.height - 22,
    `Acquisition ${report.imagery.thermalDate} at ${report.imagery.localOverpassTime} local overpass — peak afternoon yard temperature is higher than measured here.`,
    { size: 7, color: ink.textFaint, family: 'sans' },
  );
}
