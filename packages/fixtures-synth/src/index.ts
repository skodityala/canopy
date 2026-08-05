/** Seeded synthetic fixtures with known ground truth. Build-time only. */

export { mulberry32, type Rng } from './prng.js';
export { fractalField, constantField, type Field } from './field.js';
export {
  generateScene,
  celsiusToThermalDn,
  L9_B10,
  type SceneSpec,
  type SceneOut,
  type RasterOut,
  type ThermalCalibration,
} from './scene.js';
export { SCHOOLS, type SchoolDef } from './schools.js';
export {
  deriveRecessYard,
  insetRing,
  insetFactorForAreaFraction,
  ringCentroid,
  type DerivedYard,
  type Ring,
} from './recessYard.js';
export {
  buildFixture,
  EXTENT_M,
  FINE_PIXEL_M,
  THERMAL_PIXEL_M,
  type FixturePayload,
} from './buildFixture.js';
