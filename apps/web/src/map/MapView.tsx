/**
 * The map. The hero of the layout. §7
 *
 * Canvas rather than MapLibre: the committed fixtures are already projected
 * rasters in UTM metres, so there is nothing to fetch and no tile server to
 * depend on. Drawing them directly keeps the offline guarantee absolute — there
 * is no code path that could reach for a tile — and removes a heavy dependency
 * whose only job would be to display data we already hold in memory.
 *
 * Three layers, bottom to top:
 *   1. the raster (NDVI or LST, per the toggle)
 *   2. the thermal pixel grid, so the 100 m resolution limit is visible
 *   3. the yard polygon and the tree pins
 */

import { useEffect, useRef } from 'react';
import type { Grid, Polygon, Tree } from '@canopy/core';
import { color, lstColor, ndviColor, space } from '../design/tokens.js';

export type Layer = 'ndvi' | 'lst';

export interface MapViewProps {
  readonly ndvi: Grid;
  readonly lst: Grid;
  readonly yard: Polygon;
  readonly trees: readonly Tree[];
  readonly crownRadii: ReadonlyMap<string, number>;
  readonly layer: Layer;
  /** Called with projected metres when the user clicks to place a tree. */
  readonly onPlace?: ((x: number, y: number) => void) | undefined;
  readonly showThermalGrid: boolean;
}

/** Padding around the yard, in metres, so the yard is not flush to the edge. */
const VIEW_PAD_M = 70;

export function MapView({
  ndvi,
  lst,
  yard,
  trees,
  crownRadii,
  layer,
  onPlace,
  showThermalGrid,
}: MapViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // The view window in projected metres, derived from the yard's extent.
  const xs = yard.outer.map((p) => p[0]);
  const ys = yard.outer.map((p) => p[1]);
  const minX = Math.min(...xs) - VIEW_PAD_M;
  const maxX = Math.max(...xs) + VIEW_PAD_M;
  const minY = Math.min(...ys) - VIEW_PAD_M;
  const maxY = Math.max(...ys) + VIEW_PAD_M;
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Fit the view window to the canvas, preserving aspect ratio.
    const scale = Math.min(cssW / spanX, cssH / spanY);
    const offX = (cssW - spanX * scale) / 2;
    const offY = (cssH - spanY * scale) / 2;
    const toPx = (x: number, y: number): [number, number] => [
      offX + (x - minX) * scale,
      offY + (maxY - y) * scale,
    ];

    ctx.fillStyle = color.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    // ── Layer 1: the raster.
    const grid = layer === 'ndvi' ? ndvi : lst;
    const paint = layer === 'ndvi' ? ndviColor : lstColor;
    const px = grid.transform.pixelWidth;
    const py = grid.transform.pixelHeight;

    for (let row = 0; row < grid.height; row++) {
      const cellTop = grid.transform.originY - row * py;
      if (cellTop < minY || cellTop - py > maxY) continue;
      for (let col = 0; col < grid.width; col++) {
        const cellLeft = grid.transform.originX + col * px;
        if (cellLeft > maxX || cellLeft + px < minX) continue;
        const v = grid.data[row * grid.width + col]!;
        // Unknown pixels render as the explicit unknown grey, never as a value.
        ctx.fillStyle = Number.isNaN(v) ? color.unknown : paint(v);
        const [sx, sy] = toPx(cellLeft, cellTop);
        // +1 covers sub-pixel seams between adjacent cells.
        ctx.fillRect(sx, sy, px * scale + 1, py * scale + 1);
      }
    }

    // ── Layer 2: the thermal grid, making the 100 m limit visible.
    if (showThermalGrid) {
      ctx.strokeStyle = 'rgba(242,237,233,0.28)';
      ctx.lineWidth = 1;
      const t = lst.transform;
      for (let row = 0; row <= lst.height; row++) {
        const y = t.originY - row * t.pixelHeight;
        if (y < minY || y > maxY) continue;
        const [, sy] = toPx(minX, y);
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(cssW, sy);
        ctx.stroke();
      }
      for (let col = 0; col <= lst.width; col++) {
        const x = t.originX + col * t.pixelWidth;
        if (x < minX || x > maxX) continue;
        const [sx] = toPx(x, maxY);
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, cssH);
        ctx.stroke();
      }
    }

    // ── Layer 3a: the yard polygon.
    ctx.beginPath();
    yard.outer.forEach((p, i) => {
      const [sx, sy] = toPx(p[0], p[1]);
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    });
    ctx.closePath();
    ctx.strokeStyle = color.text;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Layer 3b: tree crowns, at their mature radius.
    for (const tree of trees) {
      const r = crownRadii.get(tree.classKey) ?? 0;
      if (r <= 0) continue;
      const [sx, sy] = toPx(tree.x, tree.y);
      const rp = r * scale;

      ctx.beginPath();
      ctx.arc(sx, sy, rp, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(75,163,106,0.32)';
      ctx.fill();
      ctx.strokeStyle = color.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Trunk marker, so the placement point is unambiguous.
      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color.accentHover;
      ctx.fill();
    }
  }, [ndvi, lst, yard, trees, crownRadii, layer, showThermalGrid, minX, maxX, minY, maxY, spanX, spanY]);

  /** Translate a click back into projected metres for the plan editor. */
  const handleClick = (ev: React.MouseEvent<HTMLCanvasElement>): void => {
    if (onPlace === undefined) return;
    const canvas = ev.currentTarget;
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(rect.width / spanX, rect.height / spanY);
    const offX = (rect.width - spanX * scale) / 2;
    const offY = (rect.height - spanY * scale) / 2;
    const x = minX + (ev.clientX - rect.left - offX) / scale;
    const y = maxY - (ev.clientY - rect.top - offY) / scale;
    onPlace(x, y);
  };

  return (
    <canvas
      ref={canvasRef}
      onClick={handleClick}
      role="img"
      aria-label={`${layer === 'ndvi' ? 'Vegetation index' : 'Surface temperature'} map of the schoolyard with ${trees.length} planned trees`}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        cursor: onPlace === undefined ? 'default' : 'crosshair',
        borderRadius: space.xs,
      }}
    />
  );
}
