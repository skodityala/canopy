/**
 * Plan → itemised cost, with a citation on every line. §4.7.
 *
 * Hard rule: a cost line without a resolvable source is not printable. This
 * module enforces that structurally — `costPlan` marks any line whose source is
 * missing, and the PDF renders those as UNSOURCED rather than as a dollar
 * figure. An invented number is the fastest way to lose the impact criterion, so
 * the code refuses to let one through quietly.
 */

import type { Tree } from './canopy.js';

export interface CostSource {
  readonly source_name: string;
  readonly source_url: string;
  /** ISO date the figure was retrieved. */
  readonly source_retrieved: string;
}

export interface CostItem extends CostSource {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  /** Low end of the cited range. */
  readonly low: number;
  /** High end of the cited range. */
  readonly high: number;
}

export interface CostModel {
  readonly region: string;
  readonly currency: string;
  readonly last_verified: string;
  readonly items: readonly CostItem[];
  /**
   * Planting-class key → cost item key, so a tree class resolves to a price.
   */
  readonly classCostKeys: Readonly<Record<string, string>>;
  /** Per-tree recurring items applied to every planted tree. */
  readonly perTreeItemKeys: readonly string[];
}

export interface CostLine {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  readonly quantity: number;
  readonly unitLow: number;
  readonly unitHigh: number;
  readonly totalLow: number;
  readonly totalHigh: number;
  readonly source: CostSource;
  /**
   * True when this line's figure is not backed by a resolvable source. Such a
   * line must never be rendered as a dollar amount. See `hasUnsourcedLines`.
   */
  readonly unsourced: boolean;
}

export interface CostBreakdown {
  readonly currency: string;
  readonly region: string;
  readonly lines: readonly CostLine[];
  readonly totalLow: number;
  readonly totalHigh: number;
  /** Any line missing a citation — blocks printing a headline cost. */
  readonly hasUnsourcedLines: boolean;
  readonly lastVerified: string;
}

/** A source is usable only with a name, an http(s) URL and a retrieval date. */
export function isSourced(s: CostSource): boolean {
  return (
    s.source_name.trim().length > 0 &&
    /^https?:\/\/\S+$/.test(s.source_url.trim()) &&
    /^\d{4}-\d{2}-\d{2}$/.test(s.source_retrieved.trim())
  );
}

function findItem(model: CostModel, key: string): CostItem | undefined {
  return model.items.find((i) => i.key === key);
}

/**
 * Build an itemised cost for a set of placed trees.
 *
 * Quantities come from the actual plan, prices from the cited model. Totals are
 * ranges, never point estimates — a range with a citation beats a precise
 * number without one.
 */
export function costPlan(trees: readonly Tree[], model: CostModel): CostBreakdown {
  const counts = new Map<string, number>();
  for (const t of trees) {
    counts.set(t.classKey, (counts.get(t.classKey) ?? 0) + 1);
  }

  const lines: CostLine[] = [];

  // Purchase + installation, one line per planting class present in the plan.
  for (const [classKey, qty] of [...counts.entries()].sort()) {
    const itemKey = model.classCostKeys[classKey];
    const item = itemKey === undefined ? undefined : findItem(model, itemKey);
    lines.push(makeLine(item, itemKey ?? `missing:${classKey}`, qty));
  }

  // Recurring per-tree items — establishment watering, mulch, and so on.
  const totalTrees = trees.length;
  if (totalTrees > 0) {
    for (const key of model.perTreeItemKeys) {
      lines.push(makeLine(findItem(model, key), key, totalTrees));
    }
  }

  let totalLow = 0;
  let totalHigh = 0;
  let hasUnsourced = false;
  for (const l of lines) {
    if (l.unsourced) hasUnsourced = true;
    else {
      totalLow += l.totalLow;
      totalHigh += l.totalHigh;
    }
  }

  return {
    currency: model.currency,
    region: model.region,
    lines,
    totalLow,
    totalHigh,
    hasUnsourcedLines: hasUnsourced,
    lastVerified: model.last_verified,
  };
}

function makeLine(item: CostItem | undefined, key: string, quantity: number): CostLine {
  if (item === undefined) {
    return {
      key,
      label: `Unknown cost item "${key}"`,
      unit: 'each',
      quantity,
      unitLow: Number.NaN,
      unitHigh: Number.NaN,
      totalLow: Number.NaN,
      totalHigh: Number.NaN,
      source: { source_name: '', source_url: '', source_retrieved: '' },
      unsourced: true,
    };
  }
  const source: CostSource = {
    source_name: item.source_name,
    source_url: item.source_url,
    source_retrieved: item.source_retrieved,
  };
  const sourced = isSourced(source);
  return {
    key: item.key,
    label: item.label,
    unit: item.unit,
    quantity,
    unitLow: item.low,
    unitHigh: item.high,
    totalLow: item.low * quantity,
    totalHigh: item.high * quantity,
    source,
    unsourced: !sourced,
  };
}

/** Format a cost range for display, or the honest refusal when unsourced. */
export function formatCostRange(b: CostBreakdown): string {
  if (b.hasUnsourcedLines) {
    return 'cost not shown — one or more line items lack a cited source';
  }
  const fmt = (n: number) =>
    n.toLocaleString('en-US', { style: 'currency', currency: b.currency, maximumFractionDigits: 0 });
  if (b.totalLow === b.totalHigh) return fmt(b.totalLow);
  return `${fmt(b.totalLow)} – ${fmt(b.totalHigh)}`;
}
