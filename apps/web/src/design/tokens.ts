/**
 * Design tokens. §7
 *
 * Committed before the first component, and the single source of truth for the
 * app, the PDF, and the generated documentation images.
 *
 * Rules encoded here rather than left to discipline:
 *   - The map is the hero. Panels are quiet: low chroma, recessive.
 *   - No purple gradient. No default shadcn spacing scale.
 *   - ONE temperature ramp (inferno family) shared by map, PDF and images.
 *     A separate green ramp for NDVI. Never the same ramp for two quantities.
 *   - Colour-blind safe: colour never carries meaning alone. Every coded value
 *     also renders a number or a label.
 *   - Numbers use tabular figures so a live-updating ΔT does not jitter.
 *
 * CONTRAST IS MEASURED, NOT EYEBALLED. Every foreground below was checked with
 * the WCAG 2.1 relative-luminance formula against all three surface colours,
 * and three of them were CHANGED as a result:
 *
 *   textFaint  #7d746e → #918882   was 3.45:1 on raised, now 4.54:1
 *   danger     #cf5b4a → #da6655   was 3.94:1 on raised, now 4.51:1
 *   unknown    #6b625d → #918883   was 2.65:1 on raised, now 4.54:1
 *
 * textFaint mattered most: it carries every method label, which is the text the
 * whole product is built to make legible. It was failing AA.
 *
 * The audit is a test — see apps/web/test/contrast.test.ts — so a future token
 * change that breaks AA fails the build rather than shipping.
 */

/** Spacing scale, px. Deliberately not Tailwind's rhythm. */
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
 * Surfaces. Near-black slate with a faint warm cast, chosen so the inferno
 * temperature ramp reads as heat against it rather than fighting a cool blue.
 */
export const color = {
  /** Deepest surface — behind the map. */
  bg: '#12100f',
  /** Panel surface. */
  surface: '#1c1917',
  /** Raised panel / hover. The WORST case for contrast, so all ratios target it. */
  surfaceRaised: '#262220',
  /** Hairline borders. Decorative only — never the sole indicator of a control. */
  border: '#332e2b',
  borderStrong: '#4a433f',
  /** Focus ring / active outline. Clears 3:1 as a UI component. */
  borderFocus: '#8f8a86',

  /** Primary text. Not pure white — pure white on near-black vibrates. 13.56:1 */
  text: '#f2ede9',
  /** Secondary text. 6.07:1 */
  textMuted: '#a89f99',
  /** Method labels and citations. Legible, clearly secondary. 4.54:1 — was 3.45 */
  textFaint: '#918882',

  /** Single accent. Canopy green, for actions and canopy quantities. 5.06:1 */
  accent: '#4ba36a',
  accentHover: '#5cb87c',
  accentMuted: '#2c5f40',
  /** Accent wash for selected rows. */
  accentWash: 'rgba(75,163,106,0.13)',

  /** Status. Each is paired with an icon or label in use, never colour alone. */
  warn: '#d99a2b',
  warnWash: '#241a0c',
  warnWashRaised: '#3a2a12',
  danger: '#da6655',
  dangerWash: '#241412',

  /** Suppressed / unknown. Deliberately grey — never a temperature colour. 4.54:1 */
  unknown: '#918883',
  /** Skeleton fill for the loading state. */
  skeleton: '#262220',
} as const;

/**
 * Land surface temperature ramp — perceptually uniform, inferno family.
 * Used identically in the map overlay, the PDF, and the README images.
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
 * Two weights each — that is the whole type system. System stacks only: no
 * downloaded fonts, so the app renders identically offline.
 */
export const font = {
  /** Numbers, metrics, the ΔT readout. Tabular so digits do not shift width. */
  display:
    "ui-monospace, 'SF Mono', SFMono-Regular, 'IBM Plex Mono', Menlo, Consolas, monospace",
  text: "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
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
  /** Number transitions. Long enough to read as change, short enough to feel live. */
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

/** Breakpoint at which the three-column layout collapses to one. */
export const breakpoint = { stack: 1080 } as const;
