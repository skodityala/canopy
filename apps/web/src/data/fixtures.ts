/**
 * The committed fixtures, imported statically so Vite inlines them into the
 * bundle. This is what makes the app work with the network cable pulled: there
 * is no fetch, no `fs`, and no runtime data loading — the imagery ships inside
 * the JavaScript.
 */

import type { FixtureBundle } from '@canopy/imagery-fixture';

import cwMeta from '../../../../fixtures/schools/cactus-wren/meta.json';
import cwYard from '../../../../fixtures/schools/cactus-wren/yard.json';
import cwRed from '../../../../fixtures/schools/cactus-wren/red.json';
import cwNir from '../../../../fixtures/schools/cactus-wren/nir.json';
import cwTh from '../../../../fixtures/schools/cactus-wren/thermal.json';
import cwQa from '../../../../fixtures/schools/cactus-wren/qa.json';

import jjMeta from '../../../../fixtures/schools/john-jacobs/meta.json';
import jjYard from '../../../../fixtures/schools/john-jacobs/yard.json';
import jjRed from '../../../../fixtures/schools/john-jacobs/red.json';
import jjNir from '../../../../fixtures/schools/john-jacobs/nir.json';
import jjTh from '../../../../fixtures/schools/john-jacobs/thermal.json';
import jjQa from '../../../../fixtures/schools/john-jacobs/qa.json';

import srMeta from '../../../../fixtures/schools/sunridge/meta.json';
import srYard from '../../../../fixtures/schools/sunridge/yard.json';
import srRed from '../../../../fixtures/schools/sunridge/red.json';
import srNir from '../../../../fixtures/schools/sunridge/nir.json';
import srTh from '../../../../fixtures/schools/sunridge/thermal.json';
import srQa from '../../../../fixtures/schools/sunridge/qa.json';

import drMeta from '../../../../fixtures/schools/dos-rios/meta.json';
import drYard from '../../../../fixtures/schools/dos-rios/yard.json';
import drRed from '../../../../fixtures/schools/dos-rios/red.json';
import drNir from '../../../../fixtures/schools/dos-rios/nir.json';
import drTh from '../../../../fixtures/schools/dos-rios/thermal.json';
import drQa from '../../../../fixtures/schools/dos-rios/qa.json';

/** Cast at the boundary: JSON has no types, the adapter validates the shape. */
const entry = (
  meta: unknown,
  yard: unknown,
  red: unknown,
  nir: unknown,
  thermal: unknown,
  qa: unknown,
) =>
  ({ meta, yard, red, nir, thermal, qa }) as unknown as FixtureBundle[string];

export const FIXTURES: FixtureBundle = {
  'cactus-wren': entry(cwMeta, cwYard, cwRed, cwNir, cwTh, cwQa),
  'john-jacobs': entry(jjMeta, jjYard, jjRed, jjNir, jjTh, jjQa),
  sunridge: entry(srMeta, srYard, srRed, srNir, srTh, srQa),
  'dos-rios': entry(drMeta, drYard, drRed, drNir, drTh, drQa),
};

export const FIXTURE_SLUGS = Object.keys(FIXTURES);
