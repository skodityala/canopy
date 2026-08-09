/**
 * Regenerate the committed visual assets. §5.2.
 *
 * Usage: npm run assets
 *
 * `report-preview.svg` is the README hero image, emitted by the SAME renderer
 * that produces the PDF. It cannot drift from the real artifact, because it is
 * the real artifact drawn to a different surface — and a test regenerates it and
 * compares, so forgetting to re-run this fails CI rather than shipping a stale
 * picture.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SvgSurface, drawReport } from '@canopy/render';
import { buildForSlug } from './pipeline.js';
import { renderSuppressedPreview } from './assets/suppressedPreview.js';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const ASSETS = join(ROOT, 'docs', 'assets');

/** The hero school, whose report is the README's opening image. */
export const HERO_SLUG = 'cactus-wren';
/** The cloud-occluded school, whose refusal is the second image. */
export const FAILURE_SLUG = 'dos-rios';

export async function renderReportSvg(slug: string): Promise<string> {
  const { report } = await buildForSlug(slug);
  const surface = new SvgSurface();
  drawReport(surface, report);
  return surface.toSvg();
}

async function main(): Promise<void> {
  await mkdir(ASSETS, { recursive: true });

  const hero = await renderReportSvg(HERO_SLUG);
  await writeFile(join(ASSETS, 'report-preview.svg'), hero);
  process.stdout.write(`report-preview.svg      ${hero.length.toLocaleString('en-US')} bytes\n`);

  const failure = await renderReportSvg(FAILURE_SLUG);
  await writeFile(join(ASSETS, 'report-suppressed.svg'), failure);
  process.stdout.write(
    `report-suppressed.svg   ${failure.length.toLocaleString('en-US')} bytes\n`,
  );

  const detail = await renderSuppressedPreview();
  await writeFile(join(ASSETS, 'suppression-detail.svg'), detail);
  process.stdout.write(
    `suppression-detail.svg  ${detail.length.toLocaleString('en-US')} bytes\n`,
  );
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
