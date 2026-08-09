/**
 * Shared drawing helpers for the product images.
 *
 * These paint real Grids and real Polygons onto a Surface, so an image is a
 * rendering of the committed data rather than an illustration of it.
 */

import type { Grid, Polygon, Tree } from '@canopy/core';
import type { Surface } from '@canopy/render';
import { ink, lstColor } from '@canopy/render';

/** The NDVI ramp, matching apps/web/src/design/tokens.ts. */
const NDVI_RAMP = [
  '#8c7a5e',
  '#a89b6f',
  '#bdb27c',
  '#a8bd7c',
  '#84ad68',
  '#5f9b57',
  '#3d8748',
  '#25703b',
  '#12592f',
  '#064023',
] as const;

export function ndviColour(v: number): string {
  if (!Number.isFinite(v)) return ink.unknown;
  const t = Math.min(1, Math.max(0, (v - 0) / 0.8));
  return NDVI_RAMP[Math.min(NDVI_RAMP.length - 1, Math.floor(t * NDVI_RAMP.length))]!;
}

export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Extent in projected metres. */
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly scale: number;
  readonly offX: number;
  readonly offY: number;
}

/** Fit a yard polygon into a rectangle, preserving aspect ratio. */
export function viewportFor(
  yard: Polygon,
  box: { x: number; y: number; w: number; h: number },
  padM = 60,
): Viewport {
  const xs = yard.outer.map((p) => p[0]);
  const ys = yard.outer.map((p) => p[1]);
  const minX = Math.min(...xs) - padM;
  const maxX = Math.max(...xs) + padM;
  const minY = Math.min(...ys) - padM;
  const maxY = Math.max(...ys) + padM;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale = Math.min(box.w / spanX, box.h / spanY);
  return {
    ...box,
    minX,
    maxX,
    minY,
    maxY,
    scale,
    offX: box.x + (box.w - spanX * scale) / 2,
    offY: box.y + (box.h - spanY * scale) / 2,
  };
}

export function project(v: Viewport, x: number, y: number): [number, number] {
  return [v.offX + (x - v.minX) * v.scale, v.offY + (v.maxY - y) * v.scale];
}

/** Paint a grid's cells within the viewport. */
export function drawGrid(
  s: Surface,
  v: Viewport,
  grid: Grid,
  colour: (value: number) => string,
): void {
  const px = grid.transform.pixelWidth;
  const py = grid.transform.pixelHeight;
  for (let row = 0; row < grid.height; row++) {
    const top = grid.transform.originY - row * py;
    if (top < v.minY || top - py > v.maxY) continue;
    for (let col = 0; col < grid.width; col++) {
      const left = grid.transform.originX + col * px;
      if (left > v.maxX || left + px < v.minX) continue;
      const value = grid.data[row * grid.width + col]!;
      const [sx, sy] = project(v, left, top);
      s.rect(sx, sy, px * v.scale + 0.7, py * v.scale + 0.7, {
        fill: Number.isNaN(value) ? ink.unknown : colour(value),
      });
    }
  }
}

/** The 100 m thermal lattice, drawn so the resolution limit is visible. */
export function drawThermalLattice(s: Surface, v: Viewport, thermal: Grid): void {
  const t = thermal.transform;
  for (let row = 0; row <= thermal.height; row++) {
    const y = t.originY - row * t.pixelHeight;
    if (y < v.minY || y > v.maxY) continue;
    const [, sy] = project(v, v.minX, y);
    s.line(v.x, sy, v.x + v.w, sy, { stroke: '#f2ede9', strokeWidth: 0.6, opacity: 0.22 });
  }
  for (let col = 0; col <= thermal.width; col++) {
    const x = t.originX + col * t.pixelWidth;
    if (x < v.minX || x > v.maxX) continue;
    const [sx] = project(v, x, v.maxY);
    s.line(sx, v.y, sx, v.y + v.h, { stroke: '#f2ede9', strokeWidth: 0.6, opacity: 0.22 });
  }
}

/** The yard boundary, dashed like the app draws it. */
export function drawYard(s: Surface, v: Viewport, yard: Polygon): void {
  const pts = yard.outer.map((p) => project(v, p[0], p[1]));
  const d = `${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ')} Z`;
  s.path(d, { stroke: ink.text, strokeWidth: 2 });
}

/** Tree crowns at mature radius, plus a trunk marker. */
export function drawTrees(
  s: Surface,
  v: Viewport,
  trees: readonly Tree[],
  radii: ReadonlyMap<string, number>,
): void {
  for (const tree of trees) {
    const r = radii.get(tree.classKey) ?? 0;
    if (r <= 0) continue;
    const [sx, sy] = project(v, tree.x, tree.y);
    s.circle(sx, sy, r * v.scale, {
      fill: 'rgba(75,163,106,0.34)',
      stroke: ink.accent,
      strokeWidth: 1.3,
    });
    s.circle(sx, sy, 2.1, { fill: '#5cb87c' });
  }
}

/** A quiet panel with a hairline border. */
export function panel(
  s: Surface,
  x: number,
  y: number,
  w: number,
  h: number,
  fill: string = ink.panel,
): void {
  s.rect(x, y, w, h, { fill, stroke: ink.border, strokeWidth: 1 });
}

/** Greedy word wrap at an approximate character width. */
export function wrapText(text: string, width: number, size: number): string[] {
  const max = Math.max(8, Math.floor(width / (size * 0.52)));
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(/\s+/)) {
    const next = cur === '' ? word : `${cur} ${word}`;
    if (next.length > max) {
      if (cur !== '') out.push(cur);
      cur = word;
    } else {
      cur = next;
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** Temperature ramp legend with numeric labels — never colour alone. */
export function drawLstLegend(s: Surface, x: number, y: number, w: number): void {
  const stops = [20, 25, 30, 35, 40, 45, 50, 55];
  const cw = w / stops.length;
  s.text(x, y - 5, 'SURFACE TEMPERATURE °C', {
    size: 7,
    color: ink.textFaint,
    family: 'sans',
    bold: true,
  });
  stops.forEach((v, i) => {
    s.rect(x + i * cw, y, cw, 7, { fill: lstColor(v) });
    s.text(x + i * cw + cw / 2, y + 17, String(v), {
      size: 7,
      color: ink.textFaint,
      family: 'mono',
      align: 'center',
    });
  });
}
