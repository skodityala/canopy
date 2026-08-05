/**
 * Design tokens — committed before the first component. §7.
 *
 * Rules encoded here rather than left to discipline:
 *   - The map is the hero. Panels are quiet: low-chroma, recessive.
 *   - No purple gradient. No default shadcn spacing scale.
 *   - ONE temperature ramp (inferno family), used in the map, the PDF and the
 *     video. A separate green ramp for NDVI. Never the same ramp for two
 *     quantities.
 *   - Colour-blind safe: colour never carries meaning alone. Every coded value
 *     also renders a number or a label.
 *   - Numbers use tabular figures so a live-updating ΔT does not jitter.
 */

/** Spacing scale, in px. Deliberately not Tailwind's default rhythm. */
export const space = {
  xs: 3,
  sm: 6,
  md: 11,
  lg: 18,
  xl: 29,
  xxl: 47,
} as const;

export const radius = {
  sm: 2,
  md: 4,
  lg: 7,
  pill: 999,
} as const;

/**
 * Surfaces. A near-black slate with a faint warm cast — chosen so the inferno
 * temperature ramp reads as heat against it rather than fighting a cool blue.
 */
export const color = {
  /** Deepest surface — the app background behind the map. */
  bg: '#12100f',
  /** Panel surface. */
  surface: '#1c1917',
  /** Raised panel / hover. */
  surfaceRaised: '#262220',
  /** Hairline borders. */
  border: '#332e2b',
  borderStrong: '#4a433f',

  /** Primary text — not pure white; pure white on near-black vibrates. */
  text: '#f2ede9',
  textMuted: '#a89f99',
  /** For method labels and citations: legible, clearly secondary. */
  textFaint: '#7d746e',

  /** Single accent. Canopy green, used for actions and canopy quantities. */
  accent: '#4ba36a',
  accentHover: '#5cb87c',
  accentMuted: '#2c5f40',

  /** Status colours, each paired with an icon or label in use. */
  warn: '#d99a2b',
  danger: '#cf5b4a',
  /** Suppressed / unknown — deliberately grey, never a temperature colour. */
  unknown: '#6b625d',
} as const;

/**
 * Land surface temperature ramp — perceptually uniform, inferno family.
 * Used identically in the map overlay, the PDF and the video.
 */
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

/** NDVI ramp — clearly distinct from the LST ramp. Bare ground → dense canopy. */
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

/** Domain of the LST ramp, °C. Values outside clamp to the end stops. */
export const lstDomainC = { min: 20, max: 55 } as const;

/** Domain of the NDVI ramp. */
export const ndviDomain = { min: 0, max: 0.8 } as const;

/**
 * Sample a ramp at t ∈ [0,1] with discrete stops. Discrete rather than
 * interpolated so the map legend and the PDF legend are byte-identical.
 */
export function sampleRamp(ramp: readonly string[], t: number): string {
  if (!Number.isFinite(t)) return color.unknown;
  const clamped = Math.min(1, Math.max(0, t));
  const idx = Math.min(ramp.length - 1, Math.floor(clamped * ramp.length));
  return ramp[idx]!;
}

/** Colour for a surface temperature in °C. Unknown values are grey, never hot. */
export function lstColor(celsius: number): string {
  if (!Number.isFinite(celsius)) return color.unknown;
  const { min, max } = lstDomainC;
  return sampleRamp(lstRamp, (celsius - min) / (max - min));
}

/** Colour for an NDVI value. */
export function ndviColor(value: number): string {
  if (!Number.isFinite(value)) return color.unknown;
  const { min, max } = ndviDomain;
  return sampleRamp(ndviRamp, (value - min) / (max - min));
}

/**
 * Type. One display face for numbers with tabular figures, one text face.
 * Two weights each — that is the whole type system.
 */
export const font = {
  /** Numbers, metrics, the ΔT readout. Tabular so digits do not shift width. */
  display: "'IBM Plex Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  text: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
  weightNormal: 400,
  weightBold: 600,
} as const;

/** Type scale, px. */
export const fontSize = {
  /** Method labels and citations. Small but never below 11px. */
  method: 11,
  caption: 12,
  body: 14,
  subhead: 17,
  metric: 30,
  /** The hero number — the ΔT in the metrics panel. */
  hero: 47,
} as const;

export const lineHeight = {
  tight: 1.15,
  normal: 1.5,
} as const;

/** Elevation. Restrained — two levels, no glow. */
export const shadow = {
  panel: '0 1px 2px rgba(0,0,0,0.4), 0 4px 16px rgba(0,0,0,0.3)',
  raised: '0 2px 4px rgba(0,0,0,0.5), 0 8px 28px rgba(0,0,0,0.4)',
} as const;

export const motion = {
  /** Number transitions. Long enough to read as a change, short enough to feel live. */
  metric: '220ms cubic-bezier(0.22, 0.61, 0.36, 1)',
  panel: '160ms ease-out',
} as const;

/** Z-index ladder, so panel/map stacking is not ad hoc. */
export const z = {
  map: 0,
  mapOverlay: 10,
  panel: 20,
  modal: 40,
  toast: 50,
} as const;
