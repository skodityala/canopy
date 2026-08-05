/**
 * LOCAL cost adapter. Reads the cited regional JSON.
 *
 * This port "already qualifies" as real data wherever an event demands it: it is
 * data, not a service. What it must never do is invent a figure — the schema
 * carries empty values and empty sources until a real citation is resolved, and
 * the cost module downstream refuses to print a total that includes them.
 */

import type { CostModel, CostModelPort, PlantingClass } from '@canopy/core';

export interface PlantingClassJson {
  readonly key: string;
  readonly label: string;
  readonly crownRadiusM: number;
  readonly maturityYears: number;
  readonly radiusSource: string;
  readonly radiusStatus: 'cited' | 'unverified';
}

export interface CostModelJson extends CostModel {
  readonly plantingClasses: readonly PlantingClassJson[];
}

/** Build a CostModelPort over one or more region files. */
export function createLocalCostModelPort(
  models: Readonly<Record<string, CostModelJson>>,
): CostModelPort {
  return {
    async forRegion(region: string): Promise<CostModel> {
      const m = models[region];
      if (m === undefined) {
        throw new Error(
          `No cost model for region "${region}". Available: ${Object.keys(models).join(', ')}`,
        );
      }
      return m;
    },

    async plantingClasses(region: string): Promise<readonly PlantingClass[]> {
      const m = models[region];
      if (m === undefined) {
        throw new Error(`No cost model for region "${region}"`);
      }
      return m.plantingClasses.map((c) => ({
        key: c.key,
        label: c.label,
        crownRadiusM: c.crownRadiusM,
        maturityYears: c.maturityYears,
      }));
    },
  };
}

/** True when every cost line in a model carries a resolvable source. */
export function modelIsFullyCited(m: CostModelJson): boolean {
  return m.items.every(
    (i) =>
      i.source_name.trim() !== '' &&
      /^https?:\/\/\S+$/.test(i.source_url.trim()) &&
      /^\d{4}-\d{2}-\d{2}$/.test(i.source_retrieved.trim()),
  );
}

/** Planting-class radii that are not yet backed by a species list. */
export function unverifiedRadiusClasses(m: CostModelJson): readonly string[] {
  return m.plantingClasses.filter((c) => c.radiusStatus !== 'cited').map((c) => c.label);
}
