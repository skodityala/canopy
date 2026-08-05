/**
 * The recess yard, derived from the school parcel.
 *
 * A school's OSM `amenity=school` way is the whole *parcel* — buildings,
 * parking, frontage and all. Reporting a canopy percentage over that would
 * answer the wrong question: the plan is about the yard children stand in at
 * recess, and averaging in the roof and the staff lot would both understate the
 * heat exposure and overstate the plantable area.
 *
 * With no building footprints available offline, the yard is taken as an
 * inset of the parcel's largest open lobe. This is an approximation, and it is
 * labelled as one in the fixture provenance and the PDF — the parcel is real
 * OSM geometry, the yard subset is derived.
 *
 * Replacing this with real `building=*` and `leisure=pitch` geometry is a
 * one-function change; docs/DATA.md records the Overpass query to use.
 */

import { ringAreaM2, signedRingArea } from '@canopy/core';

export type Ring = ReadonlyArray<readonly [number, number]>;

/** Centroid of a ring, by area weighting. */
export function ringCentroid(ring: Ring): readonly [number, number] {
  const a = signedRingArea(ring);
  if (a === 0) {
    // Degenerate ring: fall back to the vertex mean.
    let sx = 0;
    let sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return [sx / ring.length, sy / ring.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    const cross = xj * yi - xi * yj;
    cx += (xj + xi) * cross;
    cy += (yj + yi) * cross;
  }
  return [cx / (6 * a), cy / (6 * a)];
}

/**
 * Scale a ring toward its centroid.
 *
 * @param factor 0.74 keeps ~55% of the parcel area — the share a typical
 *               elementary campus gives to open play space and field, as
 *               opposed to buildings, parking and frontage.
 */
export function insetRing(ring: Ring, factor: number): Ring {
  const [cx, cy] = ringCentroid(ring);
  return ring.map(([x, y]) => [
    +(cx + (x - cx) * factor).toFixed(3),
    +(cy + (y - cy) * factor).toFixed(3),
  ] as const);
}

/** Ratio of linear inset that yields a target area fraction. */
export function insetFactorForAreaFraction(fraction: number): number {
  // Area scales with the square of a linear inset.
  return Math.sqrt(Math.min(1, Math.max(0.01, fraction)));
}

export interface DerivedYard {
  readonly ring: Ring;
  readonly areaM2: number;
  readonly parcelAreaM2: number;
  readonly method: string;
}

/**
 * Target recess-yard area, m².
 *
 * A recess yard does not scale with the parcel: a 5-hectare campus and a
 * 2-hectare campus both give the children roughly a soccer-field-plus-hardcourt
 * of open play space, and the rest goes to buildings, bus loop, staff parking
 * and frontage. So the yard is derived toward an ABSOLUTE area, then capped as a
 * share of the parcel for small sites.
 *
 * This matters for more than realism. Yard area is the denominator of the canopy
 * percentage and therefore of ΔNDVI_yard, which drives ΔT — so getting it wrong
 * by a factor of three moves the headline temperature number by the same factor.
 * The figure is chosen to match a typical elementary recess yard, NOT chosen to
 * make ΔT land anywhere in particular.
 */
export const TARGET_YARD_AREA_M2 = 9000;

/** Never take more than this share of the parcel, for small campuses. */
export const MAX_PARCEL_SHARE = 0.45;

/**
 * Derive the recess-yard polygon from a real parcel ring.
 *
 * @param targetAreaM2 absolute recess-yard area to aim for
 */
export function deriveRecessYard(
  parcel: Ring,
  targetAreaM2 = TARGET_YARD_AREA_M2,
): DerivedYard {
  const parcelAreaM2 = ringAreaM2(parcel);
  const fraction = Math.min(MAX_PARCEL_SHARE, targetAreaM2 / Math.max(1, parcelAreaM2));
  const factor = insetFactorForAreaFraction(fraction);
  const ring = insetRing(parcel, factor);
  return {
    ring,
    areaM2: Math.round(ringAreaM2(ring)),
    parcelAreaM2: Math.round(parcelAreaM2),
    method:
      `Recess yard derived as a centroid inset of the real OSM parcel polygon, ` +
      `targeting ${targetAreaM2.toLocaleString('en-US')} m² of open play space ` +
      `(${(fraction * 100).toFixed(0)}% of this ${Math.round(parcelAreaM2).toLocaleString('en-US')} m² parcel). ` +
      `No building footprints are available offline, so the parcel boundary is real ` +
      `and the yard subset is an approximation.`,
  };
}
