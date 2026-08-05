/**
 * The offline guarantee, enforced rather than asserted.
 *
 * Runtime packages must not contain a network call. `tools/ingest` and the
 * gated STAC adapter may; everything the demo path touches may not. This makes
 * "runs offline" a test that fails loudly instead of a claim in a README.
 */

import { describe, expect, it } from 'vitest';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

/** Directories whose source must be network-free. */
const RUNTIME_GLOBS = [
  'packages/core/src',
  'packages/pdf/src',
  'apps/web/src',
];

/** Fixture adapters are runtime too; STAC is deliberately excluded. */
const ADAPTER_ROOT = 'packages/adapters';

const FORBIDDEN =
  /\b(fetch|axios|node-fetch|undici|XMLHttpRequest|EventSource|WebSocket)\b|from\s+['"](node:)?(http|https|net|dns|tls)['"]|require\(\s*['"](node:)?(http|https|net|dns|tls)['"]\s*\)/;

async function walk(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      out.push(...(await walk(p)));
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

async function runtimeSourceFiles(): Promise<string[]> {
  const files: string[] = [];
  for (const g of RUNTIME_GLOBS) {
    files.push(...(await walk(join(ROOT, g))));
  }
  // Every adapter except the intentionally-networked STAC one.
  const adapterDir = join(ROOT, ADAPTER_ROOT);
  let adapters: string[] = [];
  try {
    adapters = (await readdir(adapterDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && !d.name.includes('stac'))
      .map((d) => d.name);
  } catch {
    adapters = [];
  }
  for (const a of adapters) {
    files.push(...(await walk(join(adapterDir, a, 'src'))));
  }
  return files;
}

describe('offline guarantee', () => {
  it('finds runtime source to check (guards against a vacuously passing test)', async () => {
    const files = await runtimeSourceFiles();
    expect(files.length).toBeGreaterThan(5);
  });

  it('runtime packages contain no network imports or calls', async () => {
    const files = await runtimeSourceFiles();
    const offenders: string[] = [];
    for (const f of files) {
      const src = await readFile(f, 'utf8');
      // Strip comments so prose about fetch/http does not trip the check.
      const code = src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1');
      if (FORBIDDEN.test(code)) {
        offenders.push(relative(ROOT, f));
      }
    }
    expect(offenders, `network access found in runtime packages: ${offenders.join(', ')}`).toEqual(
      [],
    );
  });

  it('core declares no runtime dependencies at all', async () => {
    const pkg = JSON.parse(
      await readFile(join(ROOT, 'packages/core/package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
