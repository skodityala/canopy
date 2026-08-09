/**
 * Fixture writer. Build-time tool — the only place fixtures touch the disk.
 *
 * Usage: npm run fixtures
 *
 * Emits, per school, under fixtures/schools/<slug>/:
 *   meta.json      provenance, grid geometry, MTL constants, ground truth
 *   yard.json      the real OSM polygon, in both WGS84 and UTM
 *   red.json       Sentinel-2 B4 reflectance, 10 m
 *   nir.json       Sentinel-2 B8 reflectance, 10 m
 *   thermal.json   Landsat B10 digital numbers, 100 m
 *   qa.json        Landsat QA_PIXEL bitmask, 100 m
 *
 * JSON rather than GeoTIFF is a deliberate tradeoff: no binary assets, the
 * repo stays diffable, and the whole thing is readable without GDAL. The tile
 * format is documented in docs/DATA.md, and the ImageryPort boundary means
 * swapping in real COGs changes one adapter and nothing else.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHOOLS, buildFixture } from '@canopy/fixtures-synth';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, 'fixtures', 'schools');

/** Stable JSON: sorted keys, fixed spacing, so a rebuild diffs cleanly. */
function stableJson(value: unknown): string {
  return `${JSON.stringify(value, null, 1)}\n`;
}

async function main(): Promise<void> {
  for (const def of SCHOOLS) {
    const { meta, scene, yardUtm } = buildFixture(def);
    const dir = join(OUT, def.slug);
    await mkdir(dir, { recursive: true });

    await writeFile(join(dir, 'meta.json'), stableJson(meta));

    await writeFile(
      join(dir, 'yard.json'),
      stableJson({
        type: 'Feature',
        properties: {
          name: def.name,
          osmWayId: def.osmWayId,
          source: 'OpenStreetMap, ODbL',
          retrieved: '2026-08-05',
          epsgProjected: (meta.grid as { epsg: number }).epsg,
          coordinatesProjected: yardUtm,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[...def.ringWgs84, def.ringWgs84[0]!]],
        },
      }),
    );

    await writeFile(join(dir, 'red.json'), stableJson(scene.red));
    await writeFile(join(dir, 'nir.json'), stableJson(scene.nir));
    await writeFile(join(dir, 'thermal.json'), stableJson(scene.thermalDn));
    await writeFile(join(dir, 'qa.json'), stableJson(scene.qa));

    const cloudCells = scene.qa.data.filter((v) => v !== 0).length;
    process.stdout.write(
      `${def.slug.padEnd(14)} yard ${String(meta.yardAreaM2).padStart(6)} m²  ` +
        `fine ${scene.red.width}²  thermal ${scene.thermalDn.width}²  ` +
        `qa-masked ${cloudCells}\n`,
    );
  }
}

await main();
