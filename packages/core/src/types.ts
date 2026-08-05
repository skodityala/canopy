/**
 * Core geometry and raster types.
 *
 * Convention that runs through the whole codebase: an *unknown* value is
 * `NaN` inside a Grid and `null` at a scalar boundary. It is never 0 and never
 * Infinity. A pixel with no signal is unknown, and that unknown-ness
 * propagates honestly into every aggregate. See §4.2.
 */

/** Affine georeference for a north-up raster. Units are metres (projected CRS). */
export interface GeoTransform {
  /** Easting of the *outer* edge of the top-left pixel. */
  readonly originX: number;
  /** Northing of the *outer* edge of the top-left pixel. */
  readonly originY: number;
  /** Pixel width in metres. */
  readonly pixelWidth: number;
  /** Pixel height in metres, positive (rows increase southward). */
  readonly pixelHeight: number;
  /** EPSG code of the projected CRS, e.g. 32612 for UTM 12N. */
  readonly epsg: number;
}

/** A 2-D float raster. `NaN` marks an unknown/no-data cell. */
export interface Grid {
  readonly width: number;
  readonly height: number;
  readonly data: Float64Array;
  readonly transform: GeoTransform;
}

/** A 2-D boolean raster, same shape conventions as Grid. */
export interface BoolGrid {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
  readonly transform: GeoTransform;
}

/** A single planar ring in projected metres: [x, y] pairs, implicitly closed. */
export type Ring = ReadonlyArray<readonly [number, number]>;

/** Simple polygon with an outer ring and optional holes, in projected metres. */
export interface Polygon {
  readonly outer: Ring;
  readonly holes?: ReadonlyArray<Ring>;
}

/**
 * Per-scene Landsat calibration constants, parsed from the scene's `_MTL.txt`.
 * These are never hardcoded — they differ per scene and between L8 and L9.
 * See §4.3.
 */
export interface MtlConstants {
  /** RADIANCE_MULT_BAND_10 */
  readonly radianceMult: number;
  /** RADIANCE_ADD_BAND_10 */
  readonly radianceAdd: number;
  /** K1_CONSTANT_BAND_10 (W·m⁻²·sr⁻¹·µm⁻¹) */
  readonly k1: number;
  /** K2_CONSTANT_BAND_10 (K) */
  readonly k2: number;
  /** Spacecraft, e.g. "LANDSAT_9" — carried so the report can name the sensor. */
  readonly spacecraft: string;
  /** Scene acquisition date, ISO yyyy-mm-dd. */
  readonly acquisitionDate: string;
  /** Local overpass time, e.g. "10:42" — a scored honesty label. See §4.4. */
  readonly localOverpassTime: string;
  /** Scene identifier for provenance. */
  readonly sceneId: string;
}

export function makeGrid(
  width: number,
  height: number,
  transform: GeoTransform,
  fill = Number.NaN,
): Grid {
  const data = new Float64Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data, transform };
}

export function makeBoolGrid(
  width: number,
  height: number,
  transform: GeoTransform,
  fill = 0,
): BoolGrid {
  const data = new Uint8Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data, transform };
}

/** Read a cell, returning `null` for out-of-bounds or NaN. */
export function at(g: Grid, col: number, row: number): number | null {
  if (col < 0 || row < 0 || col >= g.width || row >= g.height) return null;
  const v = g.data[row * g.width + col]!;
  return Number.isNaN(v) ? null : v;
}

/** True when two grids share dimensions and pixel geometry. */
export function sameShape(a: Grid | BoolGrid, b: Grid | BoolGrid): boolean {
  return (
    a.width === b.width &&
    a.height === b.height &&
    a.transform.pixelWidth === b.transform.pixelWidth &&
    a.transform.pixelHeight === b.transform.pixelHeight &&
    a.transform.originX === b.transform.originX &&
    a.transform.originY === b.transform.originY &&
    a.transform.epsg === b.transform.epsg
  );
}

/** Centre coordinate of a pixel, in projected metres. */
export function pixelCentre(
  t: GeoTransform,
  col: number,
  row: number,
): readonly [number, number] {
  return [
    t.originX + (col + 0.5) * t.pixelWidth,
    t.originY - (row + 0.5) * t.pixelHeight,
  ];
}
