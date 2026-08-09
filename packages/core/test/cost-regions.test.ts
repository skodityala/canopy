/**
 * The citation gate, demonstrated as a contrast between two real regions.
 *
 * Portland resolves every line to the City's published Title 11 fee schedule and
 * therefore prints a total. Maricopa ships zeroed and unsourced on purpose and
 * therefore withholds one. Same `costPlan` code path, same plan, two data states
 * — which is the whole argument for the gate being structural rather than a
 * presentation choice.
 *
 * If someone ever "fixes" maricopa-az.json by inventing prices, the contrast
 * test fails and says why. That is deliberate.
 */

import { describe, expect, it } from 'vitest';
import { costPlan, formatCostRange, isSourced, type Tree } from '@canopy/core';
import {
  createLocalCostModelPort,
  modelIsFullyCited,
  unverifiedRadiusClasses,
  type CostModelJson,
} from '@canopy/cost-local';
import portlandJson from '../../adapters/cost-local/data/portland-or.json' with { type: 'json' };
import maricopaJson from '../../adapters/cost-local/data/maricopa-az.json' with { type: 'json' };

const PORTLAND = 'Portland, OR';
const MARICOPA = 'Maricopa County, AZ';

const portland = portlandJson as unknown as CostModelJson;
const maricopa = maricopaJson as unknown as CostModelJson;

const port = createLocalCostModelPort({
  [PORTLAND]: portland,
  [MARICOPA]: maricopa,
});

/** A 12-tree plan: 6 large, 6 medium, matching the app's default mix. */
const TREES: readonly Tree[] = Array.from({ length: 12 }, (_, i) => ({
  id: `t${String(i + 1).padStart(2, '0')}`,
  x: 400000 + i * 12,
  y: 3700000,
  classKey: i % 2 === 0 ? 'large_shade' : 'medium_shade',
}));

describe('Portland — cited, prints a total', () => {
  it('every cost item carries a resolvable source', () => {
    expect(modelIsFullyCited(portland)).toBe(true);
    for (const item of portland.items) {
      expect(isSourced(item), `${item.key} is not fully sourced`).toBe(true);
      expect(item.source_url).toMatch(/^https:\/\/www\.portland\.gov\//);
      expect(item.source_name).toMatch(/City of Portland/);
      expect(item.source_retrieved).toBe('2026-08-07');
    }
  });

  it('resolves a plan to an itemised total with no unsourced lines', () => {
    const breakdown = costPlan(TREES, portland);
    expect(breakdown.hasUnsourcedLines).toBe(false);
    expect(breakdown.lines.length).toBeGreaterThan(0);
    for (const line of breakdown.lines) {
      expect(line.unsourced).toBe(false);
      expect(Number.isFinite(line.totalLow)).toBe(true);
      expect(Number.isFinite(line.totalHigh)).toBe(true);
    }
    expect(breakdown.totalLow).toBeGreaterThan(0);
    expect(breakdown.totalHigh).toBeGreaterThanOrEqual(breakdown.totalLow);
  });

  it('prints a currency range rather than a refusal', () => {
    const formatted = formatCostRange(costPlan(TREES, portland));
    expect(formatted).toMatch(/^\$[\d,]+\s*–\s*\$[\d,]+$/);
    expect(formatted).not.toMatch(/not shown|withheld/i);
  });

  it('totals exactly the published figures — 12 trees at $712 low', () => {
    // The schedule states $712.00 per on-site tree as a flat figure, so the low
    // end is arithmetic on a published number, not an interpolation.
    const breakdown = costPlan(TREES, portland);
    expect(breakdown.totalLow).toBe(712 * 12);
    // High end: $472/dbh-inch x 2in = $944 for both 2-inch classes.
    expect(breakdown.totalHigh).toBe(944 * 12);
  });

  it('bundles establishment rather than double-counting it', () => {
    // The cited fee is "Planting AND Establishment", so a separate per-tree
    // establishment line would charge for the same work twice.
    expect(portland.perTreeItemKeys).toEqual([]);
    const keys = costPlan(TREES, portland).lines.map((l) => l.key);
    expect(keys).not.toContain('establishment_watering_3yr');
  });

  it('keeps crown radii marked unverified — costs and radii are separate claims', () => {
    expect(unverifiedRadiusClasses(portland).length).toBe(3);
  });
});

describe('Maricopa — deliberately uncited, withholds the total', () => {
  it('reports unsourced lines rather than passing them into the total', () => {
    const breakdown = costPlan(TREES, maricopa);
    expect(breakdown.hasUnsourcedLines).toBe(true);
    for (const line of breakdown.lines) {
      expect(line.unsourced).toBe(true);
    }
    // Note what withholds the total: the `unsourced` FLAG, not a NaN value.
    // Maricopa's items carry an explicit low/high of 0 — a placeholder awaiting
    // a real figure — so arithmetic on them yields 0, not NaN. NaN is reserved
    // for a genuinely unknown item key. Either way the flag keeps the number
    // off the page, which is the property that matters.
    expect(breakdown.totalLow).toBe(0);
    expect(formatCostRange(breakdown)).toMatch(/cost not shown/i);
  });

  it('yields NaN — never 0 — for an item key that does not exist at all', () => {
    const orphan = costPlan([{ id: 'x', x: 0, y: 0, classKey: 'no-such-class' }], maricopa);
    const line = orphan.lines[0];
    expect(line).toBeDefined();
    expect(Number.isNaN(line?.totalLow ?? 0)).toBe(true);
  });

  it('refuses to format a headline cost', () => {
    const formatted = formatCostRange(costPlan(TREES, maricopa));
    expect(formatted).toMatch(/cost not shown/i);
    expect(formatted).not.toMatch(/\$/);
  });

  it('is uncited by design — no item has a resolvable source', () => {
    expect(modelIsFullyCited(maricopa)).toBe(false);
    for (const item of maricopa.items) {
      expect(isSourced(item)).toBe(false);
      expect(item.low).toBe(0);
      expect(item.high).toBe(0);
    }
  });
});

describe('the contrast — same code path, two data states', () => {
  it('one region prints a total and the other withholds it', async () => {
    const a = costPlan(TREES, await port.forRegion(PORTLAND));
    const b = costPlan(TREES, await port.forRegion(MARICOPA));

    expect(a.hasUnsourcedLines).toBe(false);
    expect(b.hasUnsourcedLines).toBe(true);
    expect(formatCostRange(a)).toMatch(/\$/);
    expect(formatCostRange(b)).not.toMatch(/\$/);
  });

  it('both regions are selectable through the port', async () => {
    await expect(port.forRegion(PORTLAND)).resolves.toBeDefined();
    await expect(port.forRegion(MARICOPA)).resolves.toBeDefined();
    await expect(port.forRegion('Nowhere, XX')).rejects.toThrow(/No cost model/);
  });

  it('both regions expose the same three planting classes', async () => {
    const p = await port.plantingClasses(PORTLAND);
    const m = await port.plantingClasses(MARICOPA);
    expect(p.map((c) => c.key).sort()).toEqual(m.map((c) => c.key).sort());
    // Radii are identical because they are the same unverified nominal figures;
    // only the cost citations differ between the regions.
    expect(p.map((c) => c.crownRadiusM)).toEqual(m.map((c) => c.crownRadiusM));
  });

  it('prices the same 12 trees in both regions — the difference is citation, not quantity', async () => {
    const a = costPlan(TREES, await port.forRegion(PORTLAND));
    const b = costPlan(TREES, await port.forRegion(MARICOPA));

    // Both regions charge for the same 6 large + 6 medium purchase lines.
    const purchaseQty = (lines: typeof a.lines) =>
      lines.filter((l) => l.key.startsWith('tree_')).map((l) => l.quantity);
    expect(purchaseQty(a.lines)).toEqual([6, 6]);
    expect(purchaseQty(b.lines)).toEqual([6, 6]);

    // Maricopa carries two EXTRA per-tree lines (establishment watering, mulch)
    // that Portland deliberately omits: Portland's cited fee is "Planting AND
    // Establishment", so billing establishment separately would double-count it.
    // The line counts differ for a documented reason, not by accident.
    expect(a.lines.length).toBe(2);
    expect(b.lines.length).toBe(4);
    expect(portland.perTreeItemKeys).toEqual([]);
    expect(maricopa.perTreeItemKeys.length).toBe(2);
  });
});
