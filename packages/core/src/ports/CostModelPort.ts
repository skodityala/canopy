/**
 * CostModelPort — regional cost data with citations.
 *
 * This port already qualifies as "real data" anywhere it is required: it is
 * data, not a service. See §5.4.
 */

import type { CostModel } from '../model/cost.js';
import type { PlantingClass } from '../model/canopy.js';

export interface CostModelPort {
  /** Cost model for a region, e.g. "Maricopa County, AZ". */
  forRegion(region: string): Promise<CostModel>;
  /** Planting classes with their mature crown radii and citations. */
  plantingClasses(region: string): Promise<readonly PlantingClass[]>;
}
