/**
 * SVG backend. Emits a standalone SVG string — no DOM, no browser, no network.
 *
 * This is what produces docs/assets/report-preview.svg, the README hero image.
 */

import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  approximateTextWidth,
  type FillStyle,
  type Surface,
  type TextStyle,
} from './Surface.js';

const MONO_STACK = "'IBM Plex Mono','SF Mono',Menlo,ui-monospace,monospace";
const SANS_STACK = "Inter,system-ui,-apple-system,'Segoe UI',sans-serif";

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Trim float noise so the emitted SVG is byte-stable across runs. */
function n(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2).replace(/\.?0+$/, '');
}

function fillAttrs(style: FillStyle): string {
  const parts: string[] = [];
  parts.push(`fill="${style.fill ?? 'none'}"`);
  if (style.stroke !== undefined) parts.push(`stroke="${style.stroke}"`);
  if (style.strokeWidth !== undefined) parts.push(`stroke-width="${n(style.strokeWidth)}"`);
  if (style.opacity !== undefined) parts.push(`opacity="${n(style.opacity)}"`);
  return parts.join(' ');
}

export class SvgSurface implements Surface {
  private readonly parts: string[] = [];

  constructor(private readonly background = '#12100f') {}

  rect(x: number, y: number, w: number, h: number, style: FillStyle): void {
    this.parts.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" ${fillAttrs(style)}/>`,
    );
  }

  text(x: number, y: number, s: string, style: TextStyle): void {
    const anchor =
      style.align === 'right' ? 'end' : style.align === 'center' ? 'middle' : 'start';
    const family = style.family === 'mono' ? MONO_STACK : SANS_STACK;
    const attrs = [
      `x="${n(x)}"`,
      `y="${n(y)}"`,
      `font-family="${family}"`,
      `font-size="${n(style.size)}"`,
      `fill="${style.color}"`,
    ];
    if (style.bold === true) attrs.push('font-weight="600"');
    if (anchor !== 'start') attrs.push(`text-anchor="${anchor}"`);
    if (style.family === 'mono') attrs.push('style="font-variant-numeric:tabular-nums"');
    if (style.opacity !== undefined) attrs.push(`opacity="${n(style.opacity)}"`);
    this.parts.push(`<text ${attrs.join(' ')}>${esc(s)}</text>`);
  }

  path(d: string, style: FillStyle): void {
    this.parts.push(`<path d="${d}" ${fillAttrs(style)}/>`);
  }

  line(x1: number, y1: number, x2: number, y2: number, style: FillStyle): void {
    this.parts.push(
      `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ` +
        `stroke="${style.stroke ?? style.fill ?? '#000'}" ` +
        `stroke-width="${n(style.strokeWidth ?? 1)}"` +
        (style.opacity !== undefined ? ` opacity="${n(style.opacity)}"` : '') +
        '/>',
    );
  }

  circle(cx: number, cy: number, r: number, style: FillStyle): void {
    this.parts.push(
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${fillAttrs(style)}/>`,
    );
  }

  measureText(s: string, style: TextStyle): number {
    return approximateTextWidth(s, style);
  }

  /**
   * The finished document. Deterministic for a given report.
   *
   * Defaults to the A4 page the PDF backend targets; pass explicit dimensions
   * for the wider product images, which are not page-shaped.
   */
  toSvg(width = PAGE_WIDTH, height = PAGE_HEIGHT): string {
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" ` +
        `viewBox="0 0 ${width} ${height}" role="img" ` +
        `aria-label="Canopy planting report">`,
      `<rect width="${width}" height="${height}" fill="${this.background}"/>`,
      ...this.parts,
      '</svg>',
      '',
    ].join('\n');
  }
}
