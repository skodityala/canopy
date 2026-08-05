/**
 * Diagnostic: run the real pipeline over every committed fixture and print what
 * a judge would see. Not a test — a look at the numbers before they ship.
 *
 * Usage: npx vite-node tools/ingest/src/diagnose.ts
 */

import { analyseScene, countMask, intersectMasks, rasterisePolygon, cloudMaskFromQA } from '@canopy/core';
import { createFixtureImageryPort } from '@canopy/imagery-fixture';
import { loadFixtureBundle } from './loadFixtures.js';

const bundle = await loadFixtureBundle();
const port = createFixtureImageryPort(bundle);
const schools = await port.list();

for (const meta of schools) {
  const scene = await port.load(meta.slug);
  const a = analyseScene(scene);

  const yardTh = rasterisePolygon(meta.yard, scene.thermalDn);
  const usable = cloudMaskFromQA(scene.qa);
  const yardCells = countMask(yardTh);
  const clearCells = countMask(intersectMasks(yardTh, usable));

  const fit = a.fit;
  process.stdout.write(
    [
      `── ${meta.name} (${meta.slug})`,
      `   yard area          ${meta.yardAreaM2.toLocaleString('en-US')} m²`,
      `   yard thermal px    ${yardCells} (clear ${clearCells}) → coverage ${(a.coverage * 100).toFixed(1)}%`,
      `   canopy before      ${(a.canopyFractionBefore * 100).toFixed(1)}%  (threshold ${meta.ndviCanopyThreshold})`,
      `   NDVI yard mean     ${a.meanNdviYard.toFixed(3)}   canopy ${a.meanNdviCanopy.toFixed(3)}  open ${a.meanNdviOpen.toFixed(3)}`,
      `   LST yard mean      ${a.lstYard.mean.toFixed(2)} °C  sd ${a.lstYard.sd.toFixed(2)}  n=${a.thermalPixels}`,
      `   LST range          ${a.lstYard.min.toFixed(1)} … ${a.lstYard.max.toFixed(1)} °C`,
      fit
        ? `   OLS fit            slope ${fit.slope.toFixed(2)} °C/NDVI  R²=${fit.r2.toFixed(3)}  n=${fit.n}  CI[${fit.slopeCI95[0].toFixed(2)}, ${fit.slopeCI95[1].toFixed(2)}]`
        : '   OLS fit            NONE',
      `   planted slope      ${(bundle[meta.slug]!.meta as unknown as { groundTruth: { plantedSlope: number } }).groundTruth.plantedSlope}`,
      '',
    ].join('\n'),
  );
}
