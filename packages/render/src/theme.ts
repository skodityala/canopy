/**
 * Palette and metrics for the report, mirroring apps/web/src/design/tokens.ts.
 *
 * Duplicated deliberately: packages/render must not depend on the web app, and
 * the PDF must render identically whether or not a browser exists. A drift test
 * would be over-engineering for eight colour values; the LST ramp — the one that
 * actually encodes data — is asserted equal across both in the render tests.
 */

export const ink = {
  bg: '#12100f',
  panel: '#1c1917',
  panelRaised: '#262220',
  border: '#332e2b',
  text: '#f2ede9',
  textMuted: '#a89f99',
  textFaint: '#7d746e',
  accent: '#4ba36a',
  warn: '#d99a2b',
  danger: '#cf5b4a',
  unknown: '#6b625d',
} as const;

/** Same inferno-family ramp as the map overlay and the video. */
export const lstRamp = [
  '#000004',
  '#1b0c41',
  '#4a0c6b',
  '#781c6d',
  '#a52c60',
  '#cf4446',
  '#ed6925',
  '#fb9b06',
  '#f7d13d',
  '#fcffa4',
] as const;

export const ndviRamp = [
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

export const lstDomainC = { min: 20, max: 55 } as const;

export function sampleRamp(ramp: readonly string[], t: number): string {
  if (!Number.isFinite(t)) return ink.unknown;
  const c = Math.min(1, Math.max(0, t));
  return ramp[Math.min(ramp.length - 1, Math.floor(c * ramp.length))]!;
}

export function lstColor(celsius: number): string {
  if (!Number.isFinite(celsius)) return ink.unknown;
  return sampleRamp(lstRamp, (celsius - lstDomainC.min) / (lstDomainC.max - lstDomainC.min));
}

/** Page layout, in points. */
export const layout = {
  marginX: 44,
  marginTop: 46,
  contentWidth: 595 - 88,
} as const;
