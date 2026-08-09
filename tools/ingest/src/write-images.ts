/**
 * Product images, drawn from real committed data through the same Surface
 * abstraction the PDF uses. §5.1, §5.2
 *
 * No browser, no screenshot tool, no network. Every pixel of every image is
 * derived from a fixture that the test suite also asserts against, so a figure
 * shown in the README is a figure the code actually produces.
 *
 * Emits:
 *   01-app-ready.svg          the product, ready state — the hero
 *   02-app-suppressed.svg     the refusal, in situ
 *   03-thermal-resolution.svg why we report a yard mean, drawn
 *   04-regression.svg         the credibility chart — LST vs NDVI, live fit
 *   05-states.svg             all five interface states, one board
 *   06-architecture.svg       module boundaries and the dependency rule
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SvgSurface } from '@canopy/render';
import { buildForSlug } from './pipeline.js';
import { drawAppMock } from './assets/appMock.js';
import { drawThermalResolution } from './assets/thermalResolution.js';
import { drawRegression } from './assets/regressionChart.js';
import { drawStateBoard } from './assets/stateBoard.js';
import { drawArchitecture } from './assets/architecture.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const OUT = join(ROOT, 'docs', 'assets');

async function main(): Promise<void> {
  await mkdir(OUT, { recursive: true });

  const hero = await buildForSlug('cactus-wren');
  const failure = await buildForSlug('dos-rios');

  const images: Array<[string, string]> = [];

  // 01 — the product in its ready state.
  {
    const s = new SvgSurface('#12100f');
    drawAppMock(s, hero, { width: 1280, height: 760, layer: 'lst' });
    images.push(['01-app-ready.svg', s.toSvg(1280, 760)]);
  }

  // 02 — the same product, refusing to report.
  {
    const s = new SvgSurface('#12100f');
    drawAppMock(s, failure, { width: 1280, height: 760, layer: 'lst' });
    images.push(['02-app-suppressed.svg', s.toSvg(1280, 760)]);
  }

  // 03 — the thermal resolution limitation.
  {
    const s = new SvgSurface('#12100f');
    drawThermalResolution(s, hero, { width: 1000, height: 620 });
    images.push(['03-thermal-resolution.svg', s.toSvg(1000, 620)]);
  }

  // 04 — the regression the temperature claim rests on.
  {
    const s = new SvgSurface('#12100f');
    drawRegression(s, hero, { width: 1000, height: 640 });
    images.push(['04-regression.svg', s.toSvg(1000, 640)]);
  }

  // 05 — all five states on one board.
  {
    const s = new SvgSurface('#12100f');
    drawStateBoard(s, hero, failure, { width: 1280, height: 800 });
    images.push(['05-states.svg', s.toSvg(1280, 800)]);
  }

  // 06 — architecture.
  {
    const s = new SvgSurface('#12100f');
    drawArchitecture(s, { width: 1100, height: 780 });
    images.push(['06-architecture.svg', s.toSvg(1100, 780)]);
  }

  for (const [name, svg] of images) {
    await writeFile(join(OUT, name), svg);
    process.stdout.write(`${name.padEnd(28)} ${svg.length.toLocaleString('en-US')} bytes\n`);
  }
}

// Write files only when this module is run as a CLI, never when it is imported.
//
// The asset-drift guard imports the render helpers from here; if writing ran on
// import, it would rewrite the very files that test compares against — masking
// staleness instead of catching it.
//
// An explicit env flag rather than an argv check: vite-node removes the script
// path from process.argv entirely (argv is just [node, vite-node]), so every
// argv-based guard silently evaluates to false and the CLI does nothing.
const invokedDirectly = process.env.CANOPY_WRITE === '1';
if (invokedDirectly) {
  await main();
}
