/**
 * WGS84 → UTM forward projection, and planar polygon area.
 *
 * The raster layer works in projected metres because pixel geometry, crown
 * radii and yard areas are all metric quantities. Doing that arithmetic in
 * degrees would make a 7.5 m crown radius meaningless. Sentinel-2 and Landsat
 * are both delivered in UTM, so this matches the source data's own CRS rather
 * than introducing a third one.
 *
 * Standard Transverse Mercator series (Snyder / USGS 1395), WGS84 ellipsoid.
 * Accurate to well under a metre within a zone — far below the 10 m pixel that
 * consumes it.
 */

/** WGS84 semi-major axis, metres. */
const A = 6378137.0;
/** WGS84 first eccentricity squared. */
const E2 = 0.00669437999014;
/** UTM scale factor at the central meridian. */
const K0 = 0.9996;
const FALSE_EASTING = 500000;
const FALSE_NORTHING_S = 10000000;

export interface UtmZone {
  readonly zone: number;
  readonly north: boolean;
  /** EPSG code, e.g. 32612 for UTM 12N. */
  readonly epsg: number;
}

/** UTM zone containing a longitude/latitude. */
export function utmZoneFor(lon: number, lat: number): UtmZone {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const north = lat >= 0;
  return { zone, north, epsg: (north ? 32600 : 32700) + zone };
}

/** Central meridian of a UTM zone, in degrees. */
export function centralMeridian(zone: number): number {
  return (zone - 1) * 6 - 180 + 3;
}

/**
 * Project lon/lat (degrees) to UTM easting/northing (metres) in a given zone.
 *
 * The zone is passed explicitly rather than derived per point, so every vertex
 * of a polygon lands in the same coordinate system even if the polygon happens
 * to straddle a zone boundary.
 */
export function lonLatToUtm(
  lon: number,
  lat: number,
  zone: UtmZone,
): readonly [number, number] {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const lon0 = (centralMeridian(zone.zone) * Math.PI) / 180;

  const sinLat = Math.sin(latRad);
  const cosLat = Math.cos(latRad);
  const tanLat = Math.tan(latRad);

  // Radius of curvature in the prime vertical.
  const N = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const T = tanLat * tanLat;
  const ePrime2 = E2 / (1 - E2);
  const C = ePrime2 * cosLat * cosLat;
  const Adist = cosLat * (lonRad - lon0);

  // Meridional arc.
  const M =
    A *
    ((1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 * E2 * E2) / 256) * latRad -
      ((3 * E2) / 8 + (3 * E2 * E2) / 32 + (45 * E2 * E2 * E2) / 1024) *
        Math.sin(2 * latRad) +
      ((15 * E2 * E2) / 256 + (45 * E2 * E2 * E2) / 1024) * Math.sin(4 * latRad) -
      ((35 * E2 * E2 * E2) / 3072) * Math.sin(6 * latRad));

  const easting =
    K0 *
      N *
      (Adist +
        ((1 - T + C) * Adist ** 3) / 6 +
        ((5 - 18 * T + T * T + 72 * C - 58 * ePrime2) * Adist ** 5) / 120) +
    FALSE_EASTING;

  let northing =
    K0 *
    (M +
      N *
        tanLat *
        ((Adist * Adist) / 2 +
          ((5 - T + 9 * C + 4 * C * C) * Adist ** 4) / 24 +
          ((61 - 58 * T + T * T + 600 * C - 330 * ePrime2) * Adist ** 6) / 720));

  if (!zone.north) northing += FALSE_NORTHING_S;
  return [easting, northing];
}

/** Signed planar area of a ring, by the shoelace formula. */
export function signedRingArea(ring: ReadonlyArray<readonly [number, number]>): number {
  const n = ring.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    sum += xj * yi - xi * yj;
  }
  return sum / 2;
}

/** Absolute planar area of a ring, in the units of its coordinates squared. */
export function ringAreaM2(ring: ReadonlyArray<readonly [number, number]>): number {
  return Math.abs(signedRingArea(ring));
}
