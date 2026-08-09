/**
 * The decision ledger — the pipeline's gates, as a replayable artefact.
 *
 * Canopy already refuses to assert what it cannot support. Until now "why was ΔT
 * withheld?" was answered by a canned explanation string. This makes the answer
 * something you obtain by WALKING a typed trace instead.
 *
 * Two properties earn this module its place:
 *
 *   CONTENT-ADDRESSED. Every entry hashes its inputs with a canonical
 *   serialisation, so identical inputs produce a byte-identical ledger including
 *   the run hash. That is what makes a reported number independently
 *   reproducible by a third party from an artefact alone — the whole point for a
 *   tool meant to inform public spending.
 *
 *   REFUSALS PROPAGATE. When a stage refuses, stages that CONSUME its output are
 *   marked `unreachable` rather than being allowed to compute on garbage.
 *
 * A note on propagation semantics, because the honest answer is subtle: Canopy's
 * suppression is deliberately PARTIAL. When the coverage gate withholds ΔT, the
 * canopy measurement and the costed plan remain valid and are still reported —
 * they do not depend on the prediction. So `buildLedgerFromReport` marks the
 * report stage `degrade`, not `unreachable`: the document is still produced, it
 * just no longer carries a temperature. `LedgerBuilder.markUnreachable` provides
 * true hard propagation for chains where downstream genuinely cannot proceed.
 * Conflating the two would misrepresent the architecture.
 */

import type { Report, SceneAnalysis } from './buildReport.js';
import { R2_FULL, R2_WEAK } from '../model/prediction.js';
import { REQUIRED_COVERAGE } from '../raster/mask.js';

export type StageName =
  | 'ingest'
  | 'mask'
  | 'ndvi'
  | 'lst'
  | 'resample'
  | 'fit'
  | 'validate'
  | 'predict'
  | 'plan'
  | 'cost'
  | 'report';

export type Outcome = 'pass' | 'refuse' | 'suppress' | 'degrade' | 'unreachable';

export type EvidenceValue = number | string | boolean | null;

export interface LedgerEntry {
  readonly stage: StageName;
  /** Content hash of this stage's inputs. Same inputs → same hash. */
  readonly inputsHash: string;
  readonly params: Readonly<Record<string, number | string | boolean>>;
  readonly outcome: Outcome;
  /** The measured values that drove the outcome. `null` means genuinely unknown. */
  readonly evidence: Readonly<Record<string, EvidenceValue>>;
  /** The threshold that decided it, when one applies. */
  readonly threshold: string | null;
  /** Composed from evidence + threshold at record time — never a fixed sentence. */
  readonly note: string;
  /** Stages whose output this one consumed. */
  readonly upstream: readonly StageName[];
}

export interface Ledger {
  readonly entries: readonly LedgerEntry[];
  /** Hash over every entry. Two identical runs agree exactly. */
  readonly runHash: string;
}

/** Canonical pipeline order. Also the dependency spine. */
export const STAGE_ORDER: readonly StageName[] = [
  'ingest',
  'mask',
  'ndvi',
  'lst',
  'resample',
  'fit',
  'validate',
  'predict',
  'plan',
  'cost',
  'report',
];

/** Which stages each stage consumes. Used for refusal propagation. */
export const STAGE_UPSTREAM: Readonly<Record<StageName, readonly StageName[]>> = {
  ingest: [],
  mask: ['ingest'],
  ndvi: ['ingest'],
  lst: ['ingest', 'mask', 'ndvi'],
  resample: ['ndvi'],
  fit: ['lst', 'resample', 'mask'],
  validate: ['fit'],
  predict: ['validate', 'mask'],
  plan: ['ndvi', 'lst'],
  cost: ['plan'],
  report: ['predict', 'plan', 'cost'],
};

/**
 * Canonical serialisation: object keys sorted recursively so `{a,b}` and `{b,a}`
 * serialise identically. Without this, a hash would depend on property insertion
 * order and replay would be a coin flip.
 *
 * Typed arrays hash by length plus a fixed stride sample rather than every
 * element — a 40,000-cell raster would otherwise dominate hashing cost for no
 * additional collision safety at this scale. The stride is fixed, so it stays
 * deterministic.
 */
function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undef';

  const t = typeof value;
  if (t === 'number') {
    const n = value as number;
    if (Number.isNaN(n)) return 'NaN';
    // Normalise -0 to 0; they are indistinguishable to a reader and must not
    // produce different hashes.
    if (n === 0) return '0';
    return String(n);
  }
  if (t === 'boolean') return value === true ? 'true' : 'false';
  if (t === 'string') return `"${value as string}"`;

  if (ArrayBuffer.isView(value)) {
    const arr = value as unknown as { length: number; [i: number]: number };
    const stride = Math.max(1, Math.floor(arr.length / 64));
    const parts: string[] = [`len:${arr.length}`];
    for (let i = 0; i < arr.length; i += stride) {
      const v = arr[i];
      parts.push(Number.isNaN(v) ? 'NaN' : String(v));
    }
    return `TA[${parts.join(',')}]`;
  }

  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  if (t === 'object') {
    const rec = value as Record<string, unknown>;
    const keys = Object.keys(rec).sort();
    return `{${keys.map((k) => `"${k}":${canonical(rec[k])}`).join(',')}}`;
  }

  return `"${String(value)}"`;
}

/** FNV-1a, run twice with different offsets for a 16-hex-char digest. */
function fnv1a(text: string, offset: number): string {
  let h = offset >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Deterministic content hash. No crypto import — core carries no dependencies. */
export function hashInputs(value: unknown): string {
  const text = canonical(value);
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x9dc5811c)}`;
}

/** Compose a note from the evidence, so it cannot drift from the numbers. */
function composeNote(
  outcome: Outcome,
  evidence: Readonly<Record<string, EvidenceValue>>,
  threshold: string | null,
): string {
  const parts = Object.entries(evidence).map(([k, v]) => {
    if (v === null) return `${k}=unknown`;
    if (typeof v === 'number') {
      return `${k}=${Number.isInteger(v) ? v : v.toFixed(3)}`;
    }
    return `${k}=${String(v)}`;
  });
  const verdict = outcome.toUpperCase();
  const gate = threshold === null ? '' : ` · threshold ${threshold}`;
  return `${verdict} · ${parts.join(' · ')}${gate}`;
}

export class LedgerBuilder {
  private readonly entries: LedgerEntry[] = [];
  private readonly blocked = new Set<StageName>();

  /**
   * Append an entry, hashing its inputs.
   *
   * If any stage this one consumes is blocked, the outcome is forced to
   * `unreachable` regardless of what the caller asked for — a downstream stage
   * cannot legitimately report `pass` on input that was never produced.
   */
  record(entry: {
    readonly stage: StageName;
    readonly inputs: unknown;
    readonly params?: Readonly<Record<string, number | string | boolean>>;
    readonly outcome: Outcome;
    readonly evidence: Readonly<Record<string, EvidenceValue>>;
    readonly threshold?: string | null;
    readonly upstream?: readonly StageName[];
  }): LedgerEntry {
    const upstream = entry.upstream ?? STAGE_UPSTREAM[entry.stage];
    const outcome = upstream.some((u) => this.blocked.has(u))
      ? 'unreachable'
      : entry.outcome;
    const threshold = entry.threshold ?? null;
    const evidence = entry.evidence;

    const built: LedgerEntry = {
      stage: entry.stage,
      inputsHash: hashInputs(entry.inputs),
      params: entry.params ?? {},
      outcome,
      evidence,
      threshold,
      note: composeNote(outcome, evidence, threshold),
      upstream,
    };

    if (outcome === 'refuse' || outcome === 'unreachable') {
      this.blocked.add(entry.stage);
    }
    this.entries.push(built);
    return built;
  }

  /** Block a stage explicitly, so consumers of it record as `unreachable`. */
  markUnreachable(from: StageName): void {
    this.blocked.add(from);
  }

  build(): Ledger {
    return {
      entries: [...this.entries],
      runHash: hashInputs(
        this.entries.map((e) => [e.stage, e.inputsHash, e.outcome, e.note]),
      ),
    };
  }
}

/** Derive a complete ledger from an already-computed report. */
export function buildLedgerFromReport(report: Report, analysis: SceneAnalysis): Ledger {
  const b = new LedgerBuilder();
  const img = report.imagery;
  const m = report.measured;
  const fit = report.prediction.fit;

  b.record({
    stage: 'ingest',
    inputs: [img.opticalSceneId, img.thermalSceneId, report.school.yardAreaM2],
    params: { synthetic: report.school.synthetic },
    outcome: 'pass',
    evidence: { opticalScene: img.opticalDate, thermalScene: img.thermalDate },
    threshold: null,
  });

  b.record({
    stage: 'mask',
    inputs: analysis.usable.data,
    outcome: 'pass',
    evidence: { coverage: m.coverage, thermalPixels: m.thermalPixels },
    threshold: null,
  });

  b.record({
    stage: 'ndvi',
    inputs: analysis.ndvi.data,
    params: { canopyThreshold: img.ndviCanopyThreshold },
    outcome: 'pass',
    evidence: { yardMeanNdvi: analysis.meanNdviYard, canopyPct: m.canopyPctBefore },
    threshold: `NDVI ≥ ${img.ndviCanopyThreshold}`,
  });

  b.record({
    stage: 'lst',
    inputs: analysis.lst.data,
    params: { spacecraft: img.spacecraft, overpass: img.localOverpassTime },
    outcome: 'pass',
    evidence: { yardMeanC: m.lstMeanC, sdC: m.lstSdC, pixels: m.thermalPixels },
    threshold: null,
  });

  b.record({
    stage: 'resample',
    inputs: analysis.ndviOnThermal.data,
    params: { method: 'area-weighted' },
    outcome: 'pass',
    evidence: { cells: analysis.ndviOnThermal.data.length },
    threshold: null,
  });

  b.record({
    stage: 'fit',
    inputs: [fit?.slope ?? null, fit?.n ?? null],
    params: { model: 'OLS LST~NDVI' },
    outcome: fit === null ? 'suppress' : 'pass',
    evidence: {
      slope: fit?.slope ?? null,
      intercept: fit?.intercept ?? null,
      n: fit?.n ?? null,
    },
    threshold: null,
  });

  // ── GATE 2 — fit quality.
  const r2 = fit?.r2 ?? Number.NaN;
  const fitOutcome: Outcome = !Number.isFinite(r2)
    ? 'suppress'
    : r2 >= R2_FULL
      ? 'pass'
      : r2 >= R2_WEAK
        ? 'degrade'
        : 'suppress';
  b.record({
    stage: 'validate',
    inputs: [r2, fit?.n ?? null],
    outcome: fitOutcome,
    evidence: { r2: Number.isFinite(r2) ? r2 : null, n: fit?.n ?? null },
    threshold: `R² ≥ ${R2_FULL.toFixed(2)} full · ≥ ${R2_WEAK.toFixed(2)} indicative`,
  });

  // ── GATE 1 — coverage. Checked here because it decides the prediction.
  const suppressed = report.prediction.kind === 'suppressed';
  const coverageShort = m.coverage < REQUIRED_COVERAGE;
  b.record({
    stage: 'predict',
    inputs: [m.coverage, r2, report.plan.deltaNdviYard],
    outcome: coverageShort ? 'refuse' : suppressed ? 'suppress' : fitOutcome,
    evidence: {
      coverage: m.coverage,
      thermalPixels: m.thermalPixels,
      deltaNdviYard: report.plan.deltaNdviYard,
      deltaC: report.prediction.kind === 'suppressed' ? null : report.prediction.deltaC,
    },
    threshold: `coverage ≥ ${REQUIRED_COVERAGE.toFixed(2)}`,
  });

  b.record({
    stage: 'plan',
    inputs: [report.plan.treeCount, report.plan.unionCrownM2],
    params: { trees: report.plan.treeCount },
    outcome: 'pass',
    evidence: {
      trees: report.plan.treeCount,
      unionCrownM2: report.plan.unionCrownM2,
      canopyPctAfter: report.plan.canopyPctAfter,
    },
    threshold: null,
  });

  // ── GATE 3 — citations.
  const cited = report.cost.lines.filter((l) => !l.unsourced).length;
  b.record({
    stage: 'cost',
    inputs: report.cost.lines.map((l) => [l.key, l.quantity, l.unsourced]),
    params: { region: report.cost.region },
    outcome: report.cost.hasUnsourcedLines ? 'refuse' : 'pass',
    evidence: {
      linesTotal: report.cost.lines.length,
      linesCited: cited,
      totalLow: report.cost.hasUnsourcedLines ? null : report.cost.totalLow,
    },
    threshold: 'all lines cited',
  });

  // The document is always produced. When a gate withheld a figure it degrades
  // rather than failing — partial suppression is the design, not a fallback.
  b.record({
    stage: 'report',
    inputs: [report.generatedFor, report.limitations.length],
    outcome: suppressed || report.cost.hasUnsourcedLines ? 'degrade' : 'pass',
    evidence: {
      limitations: report.limitations.length,
      deltaReported: !suppressed,
      costReported: !report.cost.hasUnsourcedLines,
    },
    threshold: null,
    // Declared explicitly as EMPTY, and this is the subtle part.
    //
    // The report consumes plan, cost and prediction, but it reads all three
    // DEFENSIVELY: a withheld ΔT or a withheld cost total removes a figure from
    // the document without preventing the document. Declaring cost as upstream
    // would make the builder force `unreachable` and claim no report was
    // produced, which is false — the canopy measurement and the plan are still
    // there. Partial suppression is the design, so the report degrades.
    upstream: [],
  });

  return b.build();
}

/** Walk upstream and derive why a stage ended as it did. */
export function explainOutcome(ledger: Ledger, stage: StageName): string {
  const byStage = new Map(ledger.entries.map((e) => [e.stage, e]));
  const target = byStage.get(stage);
  if (target === undefined) return `No ledger entry for stage "${stage}".`;

  const chain: LedgerEntry[] = [];
  const seen = new Set<StageName>();
  const walk = (name: StageName): void => {
    if (seen.has(name)) return;
    seen.add(name);
    const entry = byStage.get(name);
    if (entry === undefined) return;
    chain.push(entry);
    for (const up of entry.upstream) walk(up);
  };
  walk(stage);

  const culprit = chain.find(
    (e) => e.outcome === 'refuse' || e.outcome === 'suppress',
  );

  if (culprit === undefined) {
    return `${stage} → ${target.outcome}. No upstream stage refused. ${target.note}`;
  }
  return (
    `${stage} → ${target.outcome}, because ${culprit.stage} → ${culprit.outcome}. ` +
    `${culprit.note}`
  );
}

/** Flat projection for a trace panel. */
export function ledgerToRows(
  ledger: Ledger,
): ReadonlyArray<{
  stage: string;
  outcome: Outcome;
  measured: string;
  threshold: string;
}> {
  return ledger.entries.map((e) => ({
    stage: e.stage,
    outcome: e.outcome,
    measured: Object.entries(e.evidence)
      .map(([k, v]) =>
        v === null
          ? `${k}=unknown`
          : typeof v === 'number' && !Number.isInteger(v)
            ? `${k}=${v.toFixed(3)}`
            : `${k}=${String(v)}`,
      )
      .join(' · '),
    threshold: e.threshold ?? '—',
  }));
}
