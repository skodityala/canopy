/**
 * The analysis pipeline and report assembly.
 *
 * Everything a judge sees on screen or in the PDF comes out of `buildReport`.
 * It is pure: same scene + same plan → byte-identical report, which is what
 * makes the golden test meaningful.
 */

import type { BoolGrid, Grid } from '../types.js';
import type { SchoolScene } from '../ports/ImageryPort.js';
import type { PlantingClass, Tree } from '../model/canopy.js';
import type { CostBreakdown, CostModel } from '../model/cost.js';
import type { Fit } from '../model/regression.js';
import type { Prediction } from '../model/prediction.js';
import type { Summary } from '../raster/stats.js';

import { canopyFraction, classifyCanopy, meanNdvi, ndviGrid } from '../raster/ndvi.js';
import { lstGrid, validPixelCount } from '../raster/lst.js';
import { resampleToGrid } from '../raster/resample.js';
import {
  cloudMaskFromQA,
  countMask,
  intersectMasks,
  rasterisePolygon,
} from '../raster/mask.js';
import { summarise, valuesIn } from '../raster/stats.js';
import { yardCellMask } from '../raster/yardCells.js';
import { olsFit } from '../model/regression.js';
import { methodLabel, predictDeltaLST } from '../model/prediction.js';
import {
  canopyPctAfter,
  effectiveAddedCanopyM2,
  overlapFraction,
  summedCrownAreaM2,
  unionCanopyAreaM2,
} from '../model/canopy.js';
import { costPlan } from '../model/cost.js';

export interface SceneAnalysis {
  /** 10 m NDVI. */
  readonly ndvi: Grid;
  /** NDVI area-averaged onto the 100 m thermal grid. */
  readonly ndviOnThermal: Grid;
  /** Emissivity-corrected LST in °C, 100 m. */
  readonly lst: Grid;
  /** Cloud-free pixels on the thermal grid. */
  readonly usable: BoolGrid;
  readonly yardMaskFine: BoolGrid;
  readonly yardMaskThermal: BoolGrid;
  /** Fraction of yard thermal pixels that are cloud-free, 0..1. */
  readonly coverage: number;
  /** Canopy fraction inside the yard, from 10 m NDVI, 0..1. */
  readonly canopyFractionBefore: number;
  /** Mean NDVI inside the yard. */
  readonly meanNdviYard: number;
  /** Mean NDVI of yard pixels classified as canopy. */
  readonly meanNdviCanopy: number;
  /** Mean NDVI of yard pixels not classified as canopy. */
  readonly meanNdviOpen: number;
  /** Yard-scale LST summary — always reported with n. */
  readonly lstYard: Summary;
  /** Count of valid thermal pixels in the yard. */
  readonly thermalPixels: number;
  /** Neighbourhood LST~NDVI fit, or null when unfittable. */
  readonly fit: Fit | null;
}

/** Mean of a grid over a mask, ignoring NaN. NaN when nothing valid. */
function maskedMean(g: Grid, mask: BoolGrid): number {
  const v = valuesIn(g, mask);
  if (v.length === 0) return Number.NaN;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

/** Mask of yard pixels that are (or are not) canopy, on the fine grid. */
function splitCanopy(
  ndvi: Grid,
  yard: BoolGrid,
  threshold: number,
): { canopy: BoolGrid; open: BoolGrid } {
  const cls = classifyCanopy(ndvi, threshold);
  const canopy = intersectMasks(yard, cls);
  const open: BoolGrid = {
    width: yard.width,
    height: yard.height,
    transform: yard.transform,
    data: new Uint8Array(yard.data.length),
  };
  for (let i = 0; i < yard.data.length; i++) {
    open.data[i] = yard.data[i] === 1 && cls.data[i] === 0 && !Number.isNaN(ndvi.data[i]!) ? 1 : 0;
  }
  return { canopy, open };
}

/**
 * Run the full raster chain for one scene.
 *
 * The regression uses every cloud-free thermal pixel in the committed extent —
 * roughly the school's neighbourhood — not just the yard, because a yard alone
 * is 1–3 pixels and cannot support a fit.
 */
export function analyseScene(scene: SchoolScene): SceneAnalysis {
  const { meta } = scene;
  const nd = ndviGrid(scene.nir, scene.red);
  const ndOnThermal = resampleToGrid(nd, scene.thermalDn);
  const lst = lstGrid(scene.thermalDn, meta.mtl, ndOnThermal);

  const usable = cloudMaskFromQA(scene.qa);
  const yardFine = rasterisePolygon(meta.yard, nd);
  // Thermal cells are 100 m and a recess yard is ~95 m across, so cells are
  // selected by AREA OVERLAP, not centre containment. See raster/yardCells.ts.
  const yardThermal = yardCellMask(meta.yard, scene.thermalDn);

  const yardThermalPixels = countMask(yardThermal);
  const yardUsable = intersectMasks(yardThermal, usable);
  const coverage = yardThermalPixels === 0 ? 0 : countMask(yardUsable) / yardThermalPixels;

  const validFine: BoolGrid = {
    width: nd.width,
    height: nd.height,
    transform: nd.transform,
    data: new Uint8Array(nd.data.length),
  };
  for (let i = 0; i < nd.data.length; i++) {
    validFine.data[i] = yardFine.data[i] === 1 && !Number.isNaN(nd.data[i]!) ? 1 : 0;
  }

  const cls = classifyCanopy(nd, meta.ndviCanopyThreshold);
  const { canopy, open } = splitCanopy(nd, yardFine, meta.ndviCanopyThreshold);

  // Neighbourhood fit over all cloud-free thermal pixels with a defined NDVI.
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < lst.data.length; i++) {
    if (usable.data[i] !== 1) continue;
    const x = ndOnThermal.data[i]!;
    const y = lst.data[i]!;
    if (Number.isNaN(x) || Number.isNaN(y)) continue;
    xs.push(x);
    ys.push(y);
  }
  const fit = xs.length >= 3 ? olsFit(xs, ys) : null;

  return {
    ndvi: nd,
    ndviOnThermal: ndOnThermal,
    lst,
    usable,
    yardMaskFine: yardFine,
    yardMaskThermal: yardThermal,
    coverage,
    canopyFractionBefore: canopyFraction(cls, validFine),
    meanNdviYard: meanNdvi(nd, validFine),
    meanNdviCanopy: maskedMean(nd, canopy),
    meanNdviOpen: maskedMean(nd, open),
    lstYard: summarise(lst, yardUsable),
    thermalPixels: validPixelCount(lst, yardUsable),
    fit,
  };
}

export interface PlanGeometry {
  readonly treeCount: number;
  readonly summedCrownM2: number;
  readonly unionCrownM2: number;
  readonly overlapFraction: number;
  readonly effectiveAddedM2: number;
  readonly canopyPctBefore: number;
  readonly canopyPctAfter: number;
  readonly canopyPctDelta: number;
  /** Yard-mean NDVI shift implied by the plan — the input to ΔT. */
  readonly deltaNdviYard: number;
  /** Maturity horizon used for the crown radii, in years. */
  readonly maturityYears: number;
}

/**
 * Convert a placed plan into canopy geometry and the implied ΔNDVI.
 *
 * ΔNDVI is derived from *this scene's own* measured contrast between canopy and
 * open pixels in the yard — not a borrowed constant. Newly shaded ground moves
 * from the measured open-surface NDVI to the measured canopy NDVI.
 */
export function planGeometry(
  analysis: SceneAnalysis,
  trees: readonly Tree[],
  classes: readonly PlantingClass[],
  yardAreaM2: number,
  yardPolygonClip = true,
  scene?: SchoolScene,
): PlanGeometry {
  const radii = new Map(classes.map((c) => [c.key, c.crownRadiusM]));
  const clip = yardPolygonClip && scene ? scene.meta.yard : undefined;

  const summed = summedCrownAreaM2(trees, radii);
  const union = unionCanopyAreaM2(trees, radii, clip);
  const overlap = overlapFraction(trees, radii, clip);
  const before = analysis.canopyFractionBefore;
  const effective = effectiveAddedCanopyM2(union, before);

  const existingM2 = Number.isNaN(before) ? 0 : before * yardAreaM2;
  const pctBefore = Number.isNaN(before) ? Number.NaN : before * 100;
  const pctAfter = canopyPctAfter(existingM2, effective, yardAreaM2);

  // Measured NDVI contrast between shaded and open yard surface.
  const contrast =
    Number.isNaN(analysis.meanNdviCanopy) || Number.isNaN(analysis.meanNdviOpen)
      ? Number.NaN
      : analysis.meanNdviCanopy - analysis.meanNdviOpen;
  const addedFraction = yardAreaM2 > 0 ? effective / yardAreaM2 : Number.NaN;
  const deltaNdviYard = addedFraction * contrast;

  const maturityYears = classes.length > 0 ? Math.max(...classes.map((c) => c.maturityYears)) : 0;

  return {
    treeCount: trees.length,
    summedCrownM2: summed,
    unionCrownM2: union,
    overlapFraction: overlap,
    effectiveAddedM2: effective,
    canopyPctBefore: pctBefore,
    canopyPctAfter: pctAfter,
    canopyPctDelta: pctAfter - pctBefore,
    deltaNdviYard,
    maturityYears,
  };
}

export interface Report {
  readonly generatedFor: string;
  readonly school: {
    readonly name: string;
    readonly city: string;
    readonly state: string;
    readonly yardAreaM2: number;
    readonly synthetic: boolean;
    readonly provenance: string;
  };
  readonly imagery: {
    readonly opticalSceneId: string;
    readonly opticalDate: string;
    readonly thermalSceneId: string;
    readonly thermalDate: string;
    readonly localOverpassTime: string;
    readonly spacecraft: string;
    readonly ndviCanopyThreshold: number;
    readonly thresholdRationale: string;
  };
  readonly measured: {
    readonly canopyPctBefore: number;
    readonly lstMeanC: number;
    readonly lstSdC: number;
    readonly thermalPixels: number;
    readonly coverage: number;
  };
  readonly plan: PlanGeometry;
  readonly prediction: Prediction;
  /** Method sentence for the ΔT, or null when suppressed. */
  readonly deltaMethod: string | null;
  readonly predictedLstMeanC: number | null;
  readonly cost: CostBreakdown;
  /** Stated limitations — always present, never omitted. */
  readonly limitations: readonly string[];
}

export interface BuildReportInput {
  readonly scene: SchoolScene;
  readonly trees: readonly Tree[];
  readonly classes: readonly PlantingClass[];
  readonly costModel: CostModel;
  /** ISO date for the report header — passed in, never read from a clock. */
  readonly generatedFor: string;
  readonly analysis?: SceneAnalysis;
}

/** Assemble the complete report data object. Pure. */
export function buildReport(input: BuildReportInput): Report {
  const { scene, trees, classes, costModel, generatedFor } = input;
  const analysis = input.analysis ?? analyseScene(scene);
  const meta = scene.meta;

  const geom = planGeometry(
    analysis,
    trees,
    classes,
    meta.yardAreaM2,
    true,
    scene,
  );

  const prediction = predictDeltaLST(analysis.fit, geom.deltaNdviYard, analysis.coverage);
  const cost = costPlan(trees, costModel);

  const deltaMethod =
    prediction.kind === 'suppressed'
      ? null
      : methodLabel(prediction.fit, geom.maturityYears);

  const predictedLstMeanC =
    prediction.kind === 'suppressed' || Number.isNaN(analysis.lstYard.mean)
      ? null
      : analysis.lstYard.mean + prediction.deltaC;

  return {
    generatedFor,
    school: {
      name: meta.name,
      city: meta.city,
      state: meta.state,
      yardAreaM2: meta.yardAreaM2,
      synthetic: meta.synthetic,
      provenance: meta.provenance,
    },
    imagery: {
      opticalSceneId: meta.opticalSceneId,
      opticalDate: meta.opticalDate,
      thermalSceneId: meta.mtl.sceneId,
      thermalDate: meta.mtl.acquisitionDate,
      localOverpassTime: meta.mtl.localOverpassTime,
      spacecraft: meta.mtl.spacecraft,
      ndviCanopyThreshold: meta.ndviCanopyThreshold,
      thresholdRationale: meta.thresholdRationale,
    },
    measured: {
      canopyPctBefore: geom.canopyPctBefore,
      lstMeanC: analysis.lstYard.mean,
      lstSdC: analysis.lstYard.sd,
      thermalPixels: analysis.thermalPixels,
      coverage: analysis.coverage,
    },
    plan: geom,
    prediction,
    deltaMethod,
    predictedLstMeanC,
    cost,
    limitations: limitationsFor(analysis, meta.mtl.localOverpassTime),
  };
}

/** The §4.4 limitations, parameterised by what this scene actually is. */
export function limitationsFor(analysis: SceneAnalysis, overpass: string): readonly string[] {
  const out: string[] = [
    `Thermal pixels are 100 m native (resampled to 30 m in the delivered product); ` +
      `this yard is covered by ${analysis.thermalPixels} valid thermal pixel(s), so surface ` +
      `temperature is a yard-scale average and never a per-tree figure.`,
    `Single-date imagery: one cloud-free scene is one weather day, not a climate. ` +
      `Landsat overpass was ${overpass} local — peak afternoon yard temperature is higher.`,
    `Canopy is classified by an NDVI threshold, which can catch irrigated turf as well as ` +
      `tree crowns. The threshold is hand-validated per site and stated above.`,
    `Predicted ΔT is an extrapolation from a correlational fit on this scene, not a ` +
      `physical simulation. It is reported as an interval and phrased as an association.`,
    `Crown radii are projections at the stated maturity horizon; a newly planted tree ` +
      `does not shade at its mature radius on planting day.`,
  ];
  if (analysis.coverage < 1) {
    out.push(
      `${((1 - analysis.coverage) * 100).toFixed(1)}% of this yard's thermal pixels were ` +
        `masked as cloud, cirrus, shadow or fill.`,
    );
  }
  return out;
}
