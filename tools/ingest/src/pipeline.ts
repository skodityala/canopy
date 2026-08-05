/**
 * Shared report-building pipeline for the CLIs and tests.
 *
 * One place decides how a fixture becomes a Report, so the diagnostic, the
 * asset writer and the golden test cannot drift apart.
 */

import {
  analyseScene,
  buildReport,
  suggestPlan,
  DEFAULT_SUGGEST,
  type PlantingClass,
  type Report,
  type SceneAnalysis,
  type SchoolScene,
  type Tree,
} from '@canopy/core';
import { createFixtureImageryPort } from '@canopy/imagery-fixture';
import { createLocalCostModelPort, type CostModelJson } from '@canopy/cost-local';
import { loadFixtureBundle } from './loadFixtures.js';
import maricopa from '@canopy/cost-local/data/maricopa-az.json' with { type: 'json' };

/** Fixed date so every generated artifact is byte-reproducible. */
export const REPORT_DATE = '2026-08-05';

export const COST_MODELS: Readonly<Record<string, CostModelJson>> = {
  'Maricopa County, AZ': maricopa as unknown as CostModelJson,
};

export interface BuiltReport {
  readonly report: Report;
  readonly analysis: SceneAnalysis;
  readonly scene: SchoolScene;
  readonly trees: readonly Tree[];
  readonly classes: readonly PlantingClass[];
}

/** How many trees the default suggested plan places. */
export const DEFAULT_TREE_COUNT = 12;

export async function buildForSlug(
  slug: string,
  treeCount = DEFAULT_TREE_COUNT,
): Promise<BuiltReport> {
  const bundle = await loadFixtureBundle();
  const imagery = createFixtureImageryPort(bundle);
  const costs = createLocalCostModelPort(COST_MODELS);

  const scene = await imagery.load(slug);
  const analysis = analyseScene(scene);

  const region = 'Maricopa County, AZ';
  const classes = await costs.plantingClasses(region);
  const costModel = await costs.forRegion(region);

  // Half large shade, half medium — the mix the README's worked example cites.
  const trees = suggestPlan(scene.meta.yard, analysis.ndvi, analysis.lst, {
    ...DEFAULT_SUGGEST,
    count: treeCount,
    classKeys: ['large_shade', 'medium_shade'],
    canopyThreshold: scene.meta.ndviCanopyThreshold,
  });

  const report = buildReport({
    scene,
    trees,
    classes,
    costModel,
    generatedFor: REPORT_DATE,
    analysis,
  });

  return { report, analysis, scene, trees, classes };
}
