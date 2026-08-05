/**
 * Resampling 10 m NDVI onto the 100 m thermal grid. §4.5 step 1.
 *
 * Area-averaging, NOT nearest-neighbour. Nearest-neighbour would pick one 10 m
 * pixel to stand for a 100 m cell — throwing away 99 of the 100 pixels that
 * actually determine that cell's vegetation, and injecting noise straight into
 * the regression the ΔT claim rests on.
 */

import type { BoolGrid, Grid } from '../types.js';
import { makeGrid } from '../types.js';

/**
 * Area-weighted mean of `fine` over each cell of `coarse`'s geometry.
 *
 * Partial overlaps are weighted by their true intersection area, so a coarse
 * cell straddling the fine raster's edge is averaged over only the part that
 * exists. A coarse cell with no valid fine pixels becomes NaN — unknown, not 0.
 *
 * @param fine    high-resolution source, e.g. 10 m NDVI
 * @param coarse  grid whose geometry defines the output, e.g. 100 m thermal
 */
export function resampleToGrid(fine: Grid, coarse: Grid): Grid {
  if (fine.transform.epsg !== coarse.transform.epsg) {
    throw new Error(
      `resampleToGrid: CRS mismatch — fine is EPSG:${fine.transform.epsg}, coarse is EPSG:${coarse.transform.epsg}`,
    );
  }
  const out = makeGrid(coarse.width, coarse.height, coarse.transform);
  const ft = fine.transform;
  const ct = coarse.transform;

  for (let row = 0; row < coarse.height; row++) {
    // Coarse cell edges in projected metres.
    const cTop = ct.originY - row * ct.pixelHeight;
    const cBottom = cTop - ct.pixelHeight;
    for (let col = 0; col < coarse.width; col++) {
      const cLeft = ct.originX + col * ct.pixelWidth;
      const cRight = cLeft + ct.pixelWidth;

      // Fine-pixel index window that can possibly intersect this coarse cell.
      const c0 = Math.max(0, Math.floor((cLeft - ft.originX) / ft.pixelWidth));
      const c1 = Math.min(fine.width - 1, Math.ceil((cRight - ft.originX) / ft.pixelWidth));
      const r0 = Math.max(0, Math.floor((ft.originY - cTop) / ft.pixelHeight));
      const r1 = Math.min(fine.height - 1, Math.ceil((ft.originY - cBottom) / ft.pixelHeight));

      let weighted = 0;
      let weight = 0;
      for (let fr = r0; fr <= r1; fr++) {
        const fTop = ft.originY - fr * ft.pixelHeight;
        const fBottom = fTop - ft.pixelHeight;
        const dy = Math.min(cTop, fTop) - Math.max(cBottom, fBottom);
        if (dy <= 0) continue;
        for (let fc = c0; fc <= c1; fc++) {
          const v = fine.data[fr * fine.width + fc]!;
          if (Number.isNaN(v)) continue;
          const fLeft = ft.originX + fc * ft.pixelWidth;
          const fRight = fLeft + ft.pixelWidth;
          const dx = Math.min(cRight, fRight) - Math.max(cLeft, fLeft);
          if (dx <= 0) continue;
          const a = dx * dy;
          weighted += v * a;
          weight += a;
        }
      }
      out.data[row * coarse.width + col] = weight > 0 ? weighted / weight : Number.NaN;
    }
  }
  return out;
}

/**
 * Fraction of each coarse cell covered by set bits of a fine boolean grid.
 * Used to carry a fine-resolution yard polygon / cloud mask onto the thermal
 * grid without pretending the boundary is sharp at 100 m.
 */
export function coverageFractionToGrid(fine: BoolGrid, coarse: Grid): Grid {
  const asFloat: Grid = {
    width: fine.width,
    height: fine.height,
    transform: fine.transform,
    data: Float64Array.from(fine.data),
  };
  return resampleToGrid(asFloat, coarse);
}
