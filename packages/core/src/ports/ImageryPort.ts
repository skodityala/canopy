/**
 * ImageryPort — where rasters come from.
 *
 * The LOCAL adapter reads committed fixtures and is the default, because the
 * offline demo is a scored differentiator. The STAC adapter is optional and
 * gated behind a flag for events that require live data.
 */

import type { Grid, MtlConstants, Polygon } from '../types.js';

export interface SchoolMeta {
  readonly slug: string;
  readonly name: string;
  readonly city: string;
  readonly state: string;
  /** Yard polygon in the fixture's projected CRS, metres. */
  readonly yard: Polygon;
  readonly yardAreaM2: number;
  /**
   * Per-site NDVI canopy threshold, hand-validated against visible imagery.
   * Documented in the PDF — see §4.2.
   */
  readonly ndviCanopyThreshold: number;
  /** Why this threshold, in one sentence. Printed in the PDF. */
  readonly thresholdRationale: string;
  readonly mtl: MtlConstants;
  /** Sentinel-2 scene id and date for the NDVI source. */
  readonly opticalSceneId: string;
  readonly opticalDate: string;
  /** True when the fixture's rasters are synthetic. Must surface in the UI. */
  readonly synthetic: boolean;
  /** Provenance note, rendered in the PDF and docs/DATA.md. */
  readonly provenance: string;
}

export interface SchoolScene {
  readonly meta: SchoolMeta;
  /** Sentinel-2 B8 reflectance, 10 m. */
  readonly nir: Grid;
  /** Sentinel-2 B4 reflectance, 10 m. */
  readonly red: Grid;
  /** Landsat B10 thermal digital numbers, 100 m native. */
  readonly thermalDn: Grid;
  /** Landsat QA_PIXEL, co-registered with thermalDn. */
  readonly qa: Grid;
}

export interface ImageryPort {
  /** Slugs of every available school. */
  list(): Promise<readonly SchoolMeta[]>;
  /** Full scene for one school. Throws CanopyFailure on a malformed fixture. */
  load(slug: string): Promise<SchoolScene>;
}
