/**
 * Load committed fixtures from disk into a FixtureBundle.
 *
 * Node-only, used by the fixture tests, the asset writer and the diagnostic
 * CLI. The web app does not use this — Vite inlines the JSON instead, which is
 * how the browser build stays free of `fs`.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FixtureBundle, FixtureEntry } from '@canopy/imagery-fixture';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
export const FIXTURE_DIR = join(ROOT, 'fixtures', 'schools');

export const FIXTURE_SLUGS = [
  'cactus-wren',
  'john-jacobs',
  'sunridge',
  'dos-rios',
] as const;

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function loadFixtureEntry(slug: string): Promise<FixtureEntry> {
  const dir = join(FIXTURE_DIR, slug);
  const [meta, yard, red, nir, thermal, qa] = await Promise.all([
    readJson<FixtureEntry['meta']>(join(dir, 'meta.json')),
    readJson<FixtureEntry['yard']>(join(dir, 'yard.json')),
    readJson<FixtureEntry['red']>(join(dir, 'red.json')),
    readJson<FixtureEntry['nir']>(join(dir, 'nir.json')),
    readJson<FixtureEntry['thermal']>(join(dir, 'thermal.json')),
    readJson<FixtureEntry['qa']>(join(dir, 'qa.json')),
  ]);
  return { meta, yard, red, nir, thermal, qa };
}

export async function loadFixtureBundle(): Promise<FixtureBundle> {
  const entries = await Promise.all(
    FIXTURE_SLUGS.map(async (slug) => [slug, await loadFixtureEntry(slug)] as const),
  );
  return Object.fromEntries(entries);
}
