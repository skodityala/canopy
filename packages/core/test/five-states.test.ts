/**
 * The five-state flow, end to end. §7.1
 *
 * This drives the same functions App.tsx drives — the fixture ImageryPort, the
 * core pipeline, and `readyKindFor` — and asserts each of the five states is
 * reachable with the real committed data. It does not mount React: the states
 * are a property of the data and the core, and testing them at that level is
 * both faster and stricter than asserting on rendered markup.
 *
 * What this protects: the claim that all five states exist and are demoable.
 * If a fixture stops suppressing, or the error path stops being typed, this
 * fails rather than the demo failing on camera.
 */

import { describe, expect, it } from 'vitest';
import {
  analyseScene,
  buildReport,
  suggestPlan,
  DEFAULT_SUGGEST,
  CanopyFailure,
  explain,
  type CanopyError,
  type Report,
} from '@canopy/core';
import { createFixtureImageryPort } from '@canopy/imagery-fixture';
import { createLocalCostModelPort, type CostModelJson } from '@canopy/cost-local';
import { loadFixtureBundle } from '../../../tools/ingest/src/loadFixtures.js';
import costJson from '../../adapters/cost-local/data/maricopa-az.json' with { type: 'json' };
import { ALL_STATES, readyKindFor } from '../../../apps/web/src/states/ViewState.js';

const REGION = 'Maricopa County, AZ';
const costs = createLocalCostModelPort({
  [REGION]: costJson as unknown as CostModelJson,
});

async function port() {
  return createFixtureImageryPort(await loadFixtureBundle());
}

async function reportFor(slug: string, treeCount = 12): Promise<Report> {
  const imagery = await port();
  const scene = await imagery.load(slug);
  const analysis = analyseScene(scene);
  const classes = await costs.plantingClasses(REGION);
  const costModel = await costs.forRegion(REGION);
  const trees = suggestPlan(scene.meta.yard, analysis.ndvi, analysis.lst, {
    ...DEFAULT_SUGGEST,
    count: treeCount,
    classKeys: ['large_shade', 'medium_shade'],
    canopyThreshold: scene.meta.ndviCanopyThreshold,
  });
  return buildReport({
    scene,
    trees,
    classes,
    costModel,
    generatedFor: '2026-08-05',
    analysis,
  });
}

describe('state 1 — empty', () => {
  it('lists every bundled schoolyard with what the picker needs to render', async () => {
    const schools = await (await port()).list();
    expect(schools.length).toBe(4);
    for (const s of schools) {
      expect(s.name.length).toBeGreaterThan(3);
      expect(s.city).toBe('Phoenix');
      expect(s.yardAreaM2).toBeGreaterThan(1000);
      // The picker shows area, so it must never be unknown.
      expect(Number.isFinite(s.yardAreaM2)).toBe(true);
    }
  });

  it('is alphabetical, so the list order is stable across reloads', async () => {
    const names = (await (await port()).list()).map((s) => s.name);
    expect([...names].sort((a, b) => a.localeCompare(b))).toEqual(names);
  });
});

describe('state 2 — loading', () => {
  it('every school resolves to a report, so loading always terminates', async () => {
    for (const slug of ['cactus-wren', 'john-jacobs', 'sunridge', 'dos-rios']) {
      const report = await reportFor(slug);
      expect(report.school.name.length).toBeGreaterThan(3);
    }
  });
});

describe('state 3 — ready', () => {
  it('the hero school reports a supported temperature change', async () => {
    const report = await reportFor('cactus-wren');
    expect(readyKindFor(report)).toBe('ready');
    expect(report.prediction.kind).toBe('ok');
    if (report.prediction.kind === 'suppressed') throw new Error('unreachable');

    // Cooling, with an ordered interval and a method attached.
    expect(report.prediction.deltaC).toBeLessThan(0);
    expect(report.prediction.ci95[0]).toBeLessThanOrEqual(report.prediction.ci95[1]);
    expect(report.deltaMethod).toMatch(/R² = /);
    expect(report.deltaMethod).toMatch(/n = /);
    expect(report.deltaMethod).toMatch(/associated/i);
  });

  it('canopy increases and the plan is costed and itemised', async () => {
    const report = await reportFor('cactus-wren');
    expect(report.plan.treeCount).toBe(12);
    expect(report.plan.canopyPctAfter).toBeGreaterThan(report.plan.canopyPctBefore);
    expect(report.cost.lines.length).toBeGreaterThan(0);
  });

  it('the well-shaded school correctly recommends a smaller gain', async () => {
    const shaded = await reportFor('sunridge');
    const hero = await reportFor('cactus-wren');
    // Proof this is a measurement tool, not a tree-selling machine.
    expect(shaded.plan.canopyPctBefore).toBeGreaterThan(hero.plan.canopyPctBefore * 3);
    expect(shaded.plan.canopyPctDelta).toBeLessThan(hero.plan.canopyPctDelta);
  });

  it('an empty plan still renders measurements without inventing a cost', async () => {
    const report = await reportFor('cactus-wren', 0);
    expect(report.plan.treeCount).toBe(0);
    expect(report.cost.lines).toEqual([]);
    expect(report.cost.totalLow).toBe(0);
    expect(report.measured.canopyPctBefore ?? 0).not.toBeNaN();
  });
});

describe('state 4 — suppressed (the money state)', () => {
  it('the cloud-occluded school withholds the number and states why', async () => {
    const report = await reportFor('dos-rios');
    expect(readyKindFor(report)).toBe('suppressed');
    expect(report.prediction.kind).toBe('suppressed');
    if (report.prediction.kind !== 'suppressed') throw new Error('unreachable');

    expect(report.prediction.reason).toBe('insufficient_coverage');
    expect(report.prediction.explanation.length).toBeGreaterThan(40);
    // No ΔT may leak through any field.
    expect(report.prediction).not.toHaveProperty('deltaC');
    expect(report.deltaMethod).toBeNull();
    expect(report.predictedLstMeanC).toBeNull();
  });

  it('still reports canopy cover and the costed plan — only ΔT is withheld', async () => {
    const report = await reportFor('dos-rios');
    // This is the distinction the suppressed state exists to make.
    expect(report.plan.canopyPctBefore).toBeGreaterThan(0);
    expect(report.plan.canopyPctAfter).toBeGreaterThan(report.plan.canopyPctBefore);
    expect(report.plan.treeCount).toBe(12);
    expect(report.cost.lines.length).toBeGreaterThan(0);
    expect(report.limitations.length).toBeGreaterThanOrEqual(5);
  });

  it('reports the coverage shortfall that triggered the refusal', async () => {
    const report = await reportFor('dos-rios');
    expect(report.measured.coverage).toBeLessThan(0.8);
    expect(report.measured.coverage).toBeGreaterThan(0);
    // A partial mask, not a blackout — more convincing, and exercises the ratio.
    expect(report.prediction.kind).toBe('suppressed');
  });
});

describe('state 5 — error', () => {
  it('an unknown school raises a typed CanopyFailure, not a crash', async () => {
    const imagery = await port();
    await expect(imagery.load('no-such-school')).rejects.toThrow(CanopyFailure);
  });

  it('carries a structured code the UI can branch on', async () => {
    const imagery = await port();
    try {
      await imagery.load('no-such-school');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(CanopyFailure);
      const detail = (err as CanopyFailure).detail;
      expect(detail.code).toBe('FIXTURE_MALFORMED');
      // The message shown to the user must name the path and the reason.
      expect(explain(detail)).toMatch(/no-such-school/);
    }
  });

  it('every CanopyError code renders a non-empty explanation', () => {
    const codes: CanopyError[] = [
      { code: 'INSUFFICIENT_COVERAGE', coverage: 0.5, required: 0.8 },
      { code: 'NO_THERMAL_OVERLAP' },
      { code: 'FIT_UNRELIABLE', r2: 0.1 },
      { code: 'FIXTURE_MALFORMED', path: 'x', detail: 'y' },
    ];
    for (const c of codes) {
      expect(explain(c).length).toBeGreaterThan(30);
    }
  });
});

describe('the full flow', () => {
  it('declares exactly the five states, in demo order', () => {
    expect(ALL_STATES).toEqual(['empty', 'loading', 'ready', 'suppressed', 'error']);
  });

  it('every fixture lands in ready or suppressed — never silently blank', async () => {
    const seen = new Set<string>();
    for (const slug of ['cactus-wren', 'john-jacobs', 'sunridge', 'dos-rios']) {
      seen.add(readyKindFor(await reportFor(slug)));
    }
    // Both terminal states are exercised by the committed fixtures.
    expect([...seen].sort()).toEqual(['ready', 'suppressed']);
  });

  it('every school discloses synthetic imagery', async () => {
    for (const slug of ['cactus-wren', 'john-jacobs', 'sunridge', 'dos-rios']) {
      const report = await reportFor(slug);
      expect(report.school.synthetic).toBe(true);
      expect(report.school.provenance).toMatch(/OpenStreetMap way \d+/);
      expect(report.school.provenance).toMatch(/SYNTHETIC/);
    }
  });

  it('placing a tree changes the outcome — the plan editor is live', async () => {
    const before = await reportFor('cactus-wren', 6);
    const after = await reportFor('cactus-wren', 12);
    expect(after.plan.canopyPctAfter).toBeGreaterThan(before.plan.canopyPctAfter);
    if (before.prediction.kind === 'suppressed' || after.prediction.kind === 'suppressed') {
      throw new Error('hero fixture should not suppress');
    }
    // More canopy, more cooling.
    expect(after.prediction.deltaC).toBeLessThan(before.prediction.deltaC);
  });
});
