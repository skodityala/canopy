/**
 * The map. The hero of the layout. §7
 *
 * Canvas rather than MapLibre: the committed fixtures are already projected
 * rasters in UTM metres, so there is nothing to fetch and no tile server to
 * depend on. Drawing them directly keeps the offline guarantee absolute — there
 * is no code path that could reach for a tile — and removes a heavy dependency
 * whose only job would be to display data already held in memory.
 *
 * Four layers, bottom to top:
 *   1. the raster (NDVI or LST, per the toggle)
 *   2. the thermal pixel grid, so the 100 m resolution limit is visible
 *   3. the yard polygon
 *   4. tree crowns, and a keyboard cursor when the map has focus
 *
 * KEYBOARD PATH: placing trees is the core interaction, so it cannot be
 * mouse-only. The canvas is focusable; arrow keys move a crosshair in yard
 * metres, Enter/Space plants at the cursor. Position is announced to screen
 * readers via a live region rather than left as a purely visual affordance.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Grid, Polygon, Tree } from '@canopy/core';
import { pointInPolygon } from '@canopy/core';
import { color, lstColor, ndviColor } from '../design/tokens.js';

export type Layer = 'ndvi' | 'lst';

export interface MapViewProps {
  readonly ndvi: Grid;
  readonly lst: Grid;
  readonly yard: Polygon;
  readonly trees: readonly Tree[];
  readonly crownRadii: ReadonlyMap<string, number>;
  readonly layer: Layer;
  /** Called with projected metres when the user places a tree. */
  readonly onPlace?: ((x: number, y: number) => void) | undefined;
  readonly showThermalGrid: boolean;
}

/** Padding around the yard, metres, so the yard is not flush to the edge. */
const VIEW_PAD_M = 70;
/** Arrow-key step, metres. Shift multiplies it. */
const STEP_M = 5;
const STEP_COARSE_M = 20;

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
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [focused, setFocused] = useState(false);

  // View window in projected metres, from the yard extent.
  const xs = yard.outer.map((p) => p[0]);
  const ys = yard.outer.map((p) => p[1]);
  const minX = Math.min(...xs) - VIEW_PAD_M;
  const maxX = Math.max(...xs) + VIEW_PAD_M;
  const minY = Math.min(...ys) - VIEW_PAD_M;
  const maxY = Math.max(...ys) + VIEW_PAD_M;
  const spanX = maxX - minX;
  const spanY = maxY - minY;

  const centre = {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (cssW === 0 || cssH === 0) return;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

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
    const pw = grid.transform.pixelWidth;
    const ph = grid.transform.pixelHeight;

    for (let row = 0; row < grid.height; row++) {
      const cellTop = grid.transform.originY - row * ph;
      if (cellTop < minY || cellTop - ph > maxY) continue;
      for (let col = 0; col < grid.width; col++) {
        const cellLeft = grid.transform.originX + col * pw;
        if (cellLeft > maxX || cellLeft + pw < minX) continue;
        const v = grid.data[row * grid.width + col]!;
        // Unknown pixels render as the explicit unknown grey, never as a value.
        ctx.fillStyle = Number.isNaN(v) ? color.unknown : paint(v);
        const [sx, sy] = toPx(cellLeft, cellTop);
        ctx.fillRect(sx, sy, pw * scale + 1, ph * scale + 1);
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

    // ── Layer 3: the yard polygon.
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

    // ── Layer 4a: tree crowns at mature radius.
    for (const tree of trees) {
      const r = crownRadii.get(tree.classKey) ?? 0;
      if (r <= 0) continue;
      const [sx, sy] = toPx(tree.x, tree.y);
      ctx.beginPath();
      ctx.arc(sx, sy, r * scale, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(75,163,106,0.32)';
      ctx.fill();
      ctx.strokeStyle = color.accent;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(sx, sy, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = color.accentHover;
      ctx.fill();
    }

    // ── Layer 4b: the keyboard cursor, only while the map has focus.
    if (focused && cursor !== null) {
      const [cx, cy] = toPx(cursor.x, cursor.y);
      const inside = pointInPolygon(yard, cursor.x, cursor.y);
      ctx.strokeStyle = inside ? color.accentHover : color.warn;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx - 11, cy);
      ctx.lineTo(cx + 11, cy);
      ctx.moveTo(cx, cy - 11);
      ctx.lineTo(cx, cy + 11);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }, [
    ndvi, lst, yard, trees, crownRadii, layer, showThermalGrid,
    minX, maxX, minY, maxY, spanX, spanY, cursor, focused,
  ]);

  /** Translate a click back into projected metres. */
  const handleClick = useCallback(
    (ev: React.MouseEvent<HTMLCanvasElement>): void => {
      if (onPlace === undefined) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const scale = Math.min(rect.width / spanX, rect.height / spanY);
      const offX = (rect.width - spanX * scale) / 2;
      const offY = (rect.height - spanY * scale) / 2;
      onPlace(
        minX + (ev.clientX - rect.left - offX) / scale,
        maxY - (ev.clientY - rect.top - offY) / scale,
      );
    },
    [onPlace, minX, maxY, spanX, spanY],
  );

  /** Arrow keys move the cursor; Enter/Space plants. */
  const handleKeyDown = useCallback(
    (ev: React.KeyboardEvent<HTMLCanvasElement>): void => {
      if (onPlace === undefined) return;
      const step = ev.shiftKey ? STEP_COARSE_M : STEP_M;
      const at = cursor ?? centre;

      const move = (dx: number, dy: number) => {
        ev.preventDefault();
        setCursor({
          x: Math.min(maxX, Math.max(minX, at.x + dx)),
          y: Math.min(maxY, Math.max(minY, at.y + dy)),
        });
      };

      switch (ev.key) {
        case 'ArrowLeft':  return move(-step, 0);
        case 'ArrowRight': return move(step, 0);
        case 'ArrowUp':    return move(0, step);
        case 'ArrowDown':  return move(0, -step);
        case 'Enter':
        case ' ':
          ev.preventDefault();
          onPlace(at.x, at.y);
          return;
        case 'Home':
          ev.preventDefault();
          setCursor(centre);
          return;
        default:
          return;
      }
    },
    [onPlace, cursor, centre, minX, maxX, minY, maxY],
  );

  const interactive = onPlace !== undefined;
  const cursorInYard = cursor !== null && pointInPolygon(yard, cursor.x, cursor.y);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`map-canvas${interactive ? ' map-canvas--interactive' : ''}`}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          setFocused(true);
          if (cursor === null) setCursor(centre);
        }}
        onBlur={() => setFocused(false)}
        tabIndex={interactive ? 0 : -1}
        role={interactive ? 'application' : 'img'}
        aria-label={
          interactive
            ? `Schoolyard map, ${layer === 'ndvi' ? 'vegetation index' : 'surface temperature'} layer, ` +
              `${trees.length} trees planned. Use arrow keys to move the planting cursor, ` +
              `Enter to plant a tree, Home to recentre. Hold Shift for larger steps.`
            : `${layer === 'ndvi' ? 'Vegetation index' : 'Surface temperature'} map of the schoolyard ` +
              `with ${trees.length} planned trees`
        }
      />
      {/* Cursor position announced to screen readers, not left purely visual. */}
      <div aria-live="polite" className="sr-only">
        {focused && cursor !== null
          ? `Planting cursor ${cursorInYard ? 'inside' : 'outside'} the yard. ` +
            `${trees.length} trees planned.`
          : ''}
      </div>
    </>
  );
}
