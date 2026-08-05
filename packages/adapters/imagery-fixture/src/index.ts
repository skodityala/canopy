/**
 * Fixture imagery adapter — the LOCAL, default, offline path.
 *
 * Reads the committed JSON rasters. No network, ever: enforced by the
 * no-network guard test, not merely intended.
 *
 * The fixture data is injected as a plain record rather than read with `fs`, so
 * this adapter works unchanged in the browser (Vite inlines the JSON) and in
 * Node tests. That is the reason it takes a `FixtureBundle` instead of a path.
 */

import type { Grid, GeoTransform, ImageryPort, MtlConstants, Polygon, SchoolMeta, SchoolScene } from '@canopy/core';
import { CanopyFailure } from '@canopy/core';

export interface RasterJson {
  readonly width: number;
  readonly height: number;
  readonly data: readonly number[];
}

export interface MetaJson {
  readonly slug: string;
  readonly name: string;
  readonly city: string;
  readonly state: string;
  readonly synthetic: boolean;
  readonly provenance: string;
  readonly osmWayId: number;
  readonly yardAreaM2: number;
  readonly ndviCanopyThreshold: number;
  readonly thresholdRationale: string;
  readonly opticalSceneId: string;
  readonly opticalDate: string;
  readonly note: string;
  readonly grid: {
    readonly epsg: number;
    readonly originX: number;
    readonly originY: number;
    readonly finePixelM: number;
    readonly thermalPixelM: number;
    readonly fineSize: number;
    readonly thermalSize: number;
  };
  readonly mtl: MtlConstants;
}

export interface YardJson {
  readonly properties: {
    readonly coordinatesProjected: ReadonlyArray<readonly [number, number]>;
  };
}

/** One school's committed files. */
export interface FixtureEntry {
  readonly meta: MetaJson;
  readonly yard: YardJson;
  readonly red: RasterJson;
  readonly nir: RasterJson;
  readonly thermal: RasterJson;
  readonly qa: RasterJson;
}

export type FixtureBundle = Readonly<Record<string, FixtureEntry>>;

function transform(meta: MetaJson, pixelM: number): GeoTransform {
  return {
    originX: meta.grid.originX,
    originY: meta.grid.originY,
    pixelWidth: pixelM,
    pixelHeight: pixelM,
    epsg: meta.grid.epsg,
  };
}

function toGrid(r: RasterJson, t: GeoTransform, slug: string, which: string): Grid {
  if (r.data.length !== r.width * r.height) {
    throw new CanopyFailure({
      code: 'FIXTURE_MALFORMED',
      path: `fixtures/schools/${slug}/${which}.json`,
      detail: `expected ${r.width * r.height} values, found ${r.data.length}`,
    });
  }
  return {
    width: r.width,
    height: r.height,
    data: Float64Array.from(r.data),
    transform: t,
  };
}

function toPolygon(y: YardJson, slug: string): Polygon {
  const ring = y.properties.coordinatesProjected;
  if (!Array.isArray(ring) || ring.length < 3) {
    throw new CanopyFailure({
      code: 'FIXTURE_MALFORMED',
      path: `fixtures/schools/${slug}/yard.geojson`,
      detail: 'projected yard ring has fewer than three vertices',
    });
  }
  return { outer: ring };
}

function toMeta(entry: FixtureEntry): SchoolMeta {
  const m = entry.meta;
  return {
    slug: m.slug,
    name: m.name,
    city: m.city,
    state: m.state,
    yard: toPolygon(entry.yard, m.slug),
    yardAreaM2: m.yardAreaM2,
    ndviCanopyThreshold: m.ndviCanopyThreshold,
    thresholdRationale: m.thresholdRationale,
    mtl: m.mtl,
    opticalSceneId: m.opticalSceneId,
    opticalDate: m.opticalDate,
    synthetic: m.synthetic,
    provenance: m.provenance,
  };
}

/** Build the offline ImageryPort over a committed fixture bundle. */
export function createFixtureImageryPort(bundle: FixtureBundle): ImageryPort {
  return {
    async list(): Promise<readonly SchoolMeta[]> {
      return Object.values(bundle)
        .map(toMeta)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async load(slug: string): Promise<SchoolScene> {
      const entry = bundle[slug];
      if (entry === undefined) {
        throw new CanopyFailure({
          code: 'FIXTURE_MALFORMED',
          path: `fixtures/schools/${slug}`,
          detail: 'no such fixture in the committed bundle',
        });
      }
      const fine = transform(entry.meta, entry.meta.grid.finePixelM);
      const thermal = transform(entry.meta, entry.meta.grid.thermalPixelM);
      return {
        meta: toMeta(entry),
        nir: toGrid(entry.nir, fine, slug, 'nir'),
        red: toGrid(entry.red, fine, slug, 'red'),
        thermalDn: toGrid(entry.thermal, thermal, slug, 'thermal'),
        qa: toGrid(entry.qa, thermal, slug, 'qa'),
      };
    },
  };
}
