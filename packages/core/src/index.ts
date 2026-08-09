/** Canopy computation core — public surface. Pure TypeScript, zero I/O, zero DOM. */

export * from './types.js';
export * from './errors.js';

export * from './raster/ndvi.js';
export * from './raster/lst.js';
export * from './raster/resample.js';
export * from './raster/mask.js';
export * from './raster/stats.js';
export * from './raster/yardCells.js';

export * from './geo/utm.js';

export * from './model/regression.js';
export * from './model/spatialcv.js';
export * from './model/canopy.js';
export * from './model/prediction.js';
export * from './model/cost.js';
export * from './model/suggestPlan.js';

export * from './report/buildReport.js';

export type { ImageryPort, SchoolMeta, SchoolScene } from './ports/ImageryPort.js';
export type { BasemapPort } from './ports/BasemapPort.js';
export type { CostModelPort } from './ports/CostModelPort.js';
