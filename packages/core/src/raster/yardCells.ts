/**
 * Which coarse cells a yard actually touches.
 *
 * Pixel-centre containment is the wrong test at the thermal scale. A 9,000 m²
 * recess yard is about 95 m across, so on a 100 m grid it may contain only ONE
 * cell centre while genuinely overlapping three or four cells. Reporting "mean
 * of 1 thermal pixel" would understate the sampling and invite exactly the
 * question §4.4 exists to pre-empt.
 *
 * So yard-scale thermal statistics use area overlap: a cell counts when a
 * meaningful share of it lies inside the yard. The share is explicit and stated
 * on screen, because it is a methodological choice, not an implementation
 * detail.
 */

import type { BoolGrid, Grid, Polygon } from '../types.js';
import { makeBoolGrid } from '../types.js';
import { pointInPolygon } from './mask.js';

/**
 * Minimum fraction of a coarse cell that must fall inside the yard for that
 * cell's temperature to enter the yard mean.
 *
 * 0.15 keeps cells that clip a corner of the yard while excluding ones that
 * merely graze it. Raising it toward 0.5 gives a tighter but smaller sample.
 */
export const MIN_CELL_OVERLAP = 0.15;

/** Sub-sampling resolution per cell edge when estimating overlap. */
const SUBSAMPLES = 8;

/**
 * Fraction of each cell of `like` that lies inside `poly`, by regular
 * sub-sampling. Deterministic, and accurate to ~1/64 of a cell.
 */
export function cellOverlapFraction(poly: Polygon, like: Grid): Grid {
  const t = like.transform;
  const data = new Float64Array(like.width * like.height);
  const stepX = t.pixelWidth / SUBSAMPLES;
  const stepY = t.pixelHeight / SUBSAMPLES;

  for (let row = 0; row < like.height; row++) {
    const top = t.originY - row * t.pixelHeight;
    for (let col = 0; col < like.width; col++) {
      const left = t.originX + col * t.pixelWidth;
      let hits = 0;
      for (let sy = 0; sy < SUBSAMPLES; sy++) {
        const y = top - (sy + 0.5) * stepY;
        for (let sx = 0; sx < SUBSAMPLES; sx++) {
          const x = left + (sx + 0.5) * stepX;
          if (pointInPolygon(poly, x, y)) hits++;
        }
      }
      data[row * like.width + col] = hits / (SUBSAMPLES * SUBSAMPLES);
    }
  }

  return { width: like.width, height: like.height, data, transform: t };
}

/**
 * Mask of cells that overlap the yard by at least `minOverlap`.
 *
 * Use this for yard-scale thermal statistics. For the fine optical grid,
 * `rasterisePolygon` remains correct — at 10 m the centre test is accurate
 * enough and far cheaper.
 */
export function yardCellMask(
  poly: Polygon,
  like: Grid,
  minOverlap = MIN_CELL_OVERLAP,
): BoolGrid {
  const frac = cellOverlapFraction(poly, like);
  const out = makeBoolGrid(like.width, like.height, like.transform);
  for (let i = 0; i < out.data.length; i++) {
    out.data[i] = frac.data[i]! >= minOverlap ? 1 : 0;
  }
  return out;
}
