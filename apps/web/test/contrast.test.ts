/**
 * Contrast audit, as a test.
 *
 * The design tokens claim WCAG AA compliance. This computes the actual WCAG 2.1
 * contrast ratio for every text colour against every surface colour and fails if
 * any pair falls short — so the claim is checked rather than asserted, and a
 * future token change that breaks legibility fails the build.
 *
 * This caught three real failures when it was first written:
 *   textFaint  3.45:1  →  #918882  4.54:1   (carries every method label)
 *   danger     3.94:1  →  #da6655  4.51:1
 *   unknown    2.65:1  →  #918883  4.54:1
 *
 * textFaint mattered most. It renders the method line under every figure, which
 * is the text the whole product exists to make legible, and it was failing AA.
 */

import { describe, expect, it } from 'vitest';
import { color, lstRamp, ndviRamp } from '../src/design/tokens.js';

/** WCAG 2.1 relative luminance of an sRGB channel. */
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.1 contrast ratio between two colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every surface a foreground can land on. */
const SURFACES: ReadonlyArray<readonly [string, string]> = [
  ['bg', color.bg],
  ['surface', color.surface],
  ['surfaceRaised', color.surfaceRaised],
];

/** Foregrounds that carry text, and therefore need 4.5:1. */
const TEXT_COLOURS: ReadonlyArray<readonly [string, string]> = [
  ['text', color.text],
  ['textMuted', color.textMuted],
  ['textFaint', color.textFaint],
  ['accent', color.accent],
  ['accentHover', color.accentHover],
  ['warn', color.warn],
  ['danger', color.danger],
  ['unknown', color.unknown],
];

const AA_NORMAL = 4.5;
const AA_UI = 3.0;

describe('WCAG AA — text contrast', () => {
  for (const [fgName, fg] of TEXT_COLOURS) {
    for (const [bgName, bg] of SURFACES) {
      it(`${fgName} on ${bgName} clears ${AA_NORMAL}:1`, () => {
        const ratio = contrastRatio(fg, bg);
        expect(
          ratio,
          `${fgName} (${fg}) on ${bgName} (${bg}) is ${ratio.toFixed(2)}:1, below AA ${AA_NORMAL}:1`,
        ).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }

  it('primary text is comfortably above the minimum, not just at it', () => {
    // Body copy should have headroom, not sit on the threshold.
    expect(contrastRatio(color.text, color.surfaceRaised)).toBeGreaterThan(10);
  });
});

describe('WCAG AA — non-text UI components', () => {
  it('the focus ring clears 3:1 against every surface', () => {
    for (const [name, bg] of SURFACES) {
      const ratio = contrastRatio(color.borderFocus, bg);
      expect(ratio, `borderFocus on ${name} is ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        AA_UI,
      );
    }
  });

  it('the accent clears 3:1 as a control boundary', () => {
    for (const [, bg] of SURFACES) {
      expect(contrastRatio(color.accent, bg)).toBeGreaterThanOrEqual(AA_UI);
    }
  });
});

describe('colour is never the only signal', () => {
  it('the two data ramps are visually distinct families', () => {
    // LST is inferno (dark purple → yellow); NDVI is a green scale. Reusing one
    // ramp for two quantities would make the map ambiguous, so their midpoints
    // must not collide.
    const lstMid = lstRamp[Math.floor(lstRamp.length / 2)]!;
    const ndviMid = ndviRamp[Math.floor(ndviRamp.length / 2)]!;
    expect(lstMid).not.toBe(ndviMid);
    expect(contrastRatio(lstMid, ndviMid)).toBeGreaterThan(1.3);
  });

  it('unknown is grey, not a temperature colour', () => {
    // A masked pixel must not read as a value on the heat ramp.
    for (const stop of lstRamp) {
      expect(color.unknown).not.toBe(stop);
    }
    const h = color.unknown.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    // Near-neutral: no channel dominates by more than a small margin.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(24);
  });

  it('every ramp stop is a valid 6-digit hex colour', () => {
    for (const stop of [...lstRamp, ...ndviRamp]) {
      expect(stop).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
