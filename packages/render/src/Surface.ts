/**
 * The abstract drawing surface. §5.2.
 *
 * One renderer, two backends. `drawReport` is written once against this
 * interface; a PDF backend produces the deliverable artifact and an SVG backend
 * produces the README hero image. The hero image cannot drift from the real
 * artifact, because it *is* the real artifact rendered through a different
 * surface — and a test regenerates it on every run to prove that.
 *
 * Coordinates are in points, y-down, origin top-left. A4 at 72 dpi is
 * 595 × 842, which is the page both backends target.
 */

export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;

export interface FillStyle {
  readonly fill?: string;
  readonly stroke?: string;
  readonly strokeWidth?: number;
  /** 0..1 */
  readonly opacity?: number;
}

export interface TextStyle {
  readonly size: number;
  readonly color: string;
  readonly bold?: boolean;
  /** 'mono' for figures — tabular, so columns align. */
  readonly family?: 'mono' | 'sans';
  readonly align?: 'left' | 'right' | 'center';
  readonly opacity?: number;
}

export interface Surface {
  rect(x: number, y: number, w: number, h: number, style: FillStyle): void;
  text(x: number, y: number, s: string, style: TextStyle): void;
  /** SVG-style path data, in the same coordinate space. */
  path(d: string, style: FillStyle): void;
  line(x1: number, y1: number, x2: number, y2: number, style: FillStyle): void;
  circle(cx: number, cy: number, r: number, style: FillStyle): void;
  /** Approximate advance width, so the renderer can right-align and wrap. */
  measureText(s: string, style: TextStyle): number;
}

/**
 * Average advance widths as a fraction of font size, measured for the two
 * font stacks the design tokens specify. Approximate by necessity — no font
 * metrics are available offline — but consistent across both backends, which is
 * what matters for layout agreement.
 */
const MONO_ADVANCE = 0.6;
const SANS_ADVANCE = 0.52;

export function approximateTextWidth(s: string, style: TextStyle): number {
  const per = style.family === 'mono' ? MONO_ADVANCE : SANS_ADVANCE;
  const weight = style.bold === true ? 1.04 : 1;
  return s.length * style.size * per * weight;
}
