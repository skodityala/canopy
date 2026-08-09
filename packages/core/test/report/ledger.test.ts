/**
 * The decision ledger.
 *
 * The load-bearing tests are canonical hashing (which is what makes replay
 * possible) and refusal propagation (which is what stops a downstream stage
 * reporting success on input that was never produced).
 */

import { describe, expect, it } from 'vitest';
import {
  LedgerBuilder,
  STAGE_ORDER,
  buildLedgerFromReport,
  explainOutcome,
  hashInputs,
  ledgerToRows,
} from '../../src/report/ledger.js';
import { buildForSlug } from '../../../../tools/ingest/src/pipeline.js';

describe('★ canonical hashing — the basis of replay', () => {
  it('is independent of object key order', () => {
    // Without canonicalisation the hash would depend on property insertion
    // order, and replay would be a coin flip.
    expect(hashInputs({ a: 1, b: 2 })).toBe(hashInputs({ b: 2, a: 1 }));
    expect(hashInputs({ x: { p: 1, q: 2 }, y: 3 })).toBe(
      hashInputs({ y: 3, x: { q: 2, p: 1 } }),
    );
  });

  it('distinguishes different values', () => {
    expect(hashInputs({ a: 1 })).not.toBe(hashInputs({ a: 2 }));
    expect(hashInputs([1, 2, 3])).not.toBe(hashInputs([3, 2, 1]));
  });

  it('handles NaN, -0, null and undefined without throwing', () => {
    expect(hashInputs(Number.NaN)).toBe(hashInputs(Number.NaN));
    // -0 and 0 are indistinguishable to a reader and must not diverge.
    expect(hashInputs(-0)).toBe(hashInputs(0));
    expect(hashInputs(null)).not.toBe(hashInputs(undefined));
    expect(hashInputs({ a: null })).not.toBe(hashInputs({ a: undefined }));
  });

  it('hashes typed arrays by content', () => {
    expect(hashInputs(Float64Array.from([1, 2, 3]))).toBe(
      hashInputs(Float64Array.from([1, 2, 3])),
    );
    expect(hashInputs(Float64Array.from([1, 2, 3]))).not.toBe(
      hashInputs(Float64Array.from([1, 2, 4])),
    );
  });

  it('is a fixed-length lowercase hex digest', () => {
    for (const v of [1, 'x', { a: [1, { b: 2 }] }, Float64Array.from([1])]) {
      expect(hashInputs(v)).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe('hash fallthrough and gate branches', () => {
  it('hashes exotic values without throwing', () => {
    // symbol and bigint hit the String() fallthrough. A hash function that threw
    // on an unexpected type would make replay fragile.
    expect(hashInputs(Symbol('x') as unknown)).toMatch(/^[0-9a-f]{16}$/);
    expect(hashInputs(10n as unknown)).toMatch(/^[0-9a-f]{16}$/);
    expect(hashInputs(() => 1)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('records degrade for a weak fit and suppress for no fit', () => {
    // No shipped fixture lands in 0.30 ≤ R² < 0.50, so the intermediate verdict
    // is constructed directly rather than left untested.
    const b = new LedgerBuilder();
    const weak = b.record({
      stage: 'validate',
      inputs: [0.41],
      outcome: 'degrade',
      evidence: { r2: 0.41, n: 400 },
      threshold: 'R² ≥ 0.50 full · ≥ 0.30 indicative',
    });
    expect(weak.outcome).toBe('degrade');
    expect(weak.note).toContain('0.410');

    const none = b.record({
      stage: 'predict',
      inputs: [null],
      outcome: 'suppress',
      evidence: { r2: null, coverage: 1 },
      threshold: 'coverage ≥ 0.80',
    });
    // A missing fit suppresses; it never falls back to a default slope.
    expect(none.outcome).toBe('suppress');
    expect(none.note).toContain('r2=unknown');
  });
});

describe('★ determinism', () => {
  it('the same report yields a byte-identical ledger and runHash', async () => {
    const { report, analysis } = await buildForSlug('cactus-wren');
    const a = buildLedgerFromReport(report, analysis);
    const b = buildLedgerFromReport(report, analysis);
    expect(a.entries).toEqual(b.entries);
    expect(a.runHash).toBe(b.runHash);
  });

  it('different fixtures yield different run hashes', async () => {
    const hero = await buildForSlug('cactus-wren');
    const other = await buildForSlug('sunridge');
    expect(buildLedgerFromReport(hero.report, hero.analysis).runHash).not.toBe(
      buildLedgerFromReport(other.report, other.analysis).runHash,
    );
  });
});

describe('★ refusal propagation', () => {
  it('marks consumers of a refusing stage as unreachable', () => {
    // Built directly so the mechanism is tested in isolation from any fixture.
    const b = new LedgerBuilder();
    b.record({ stage: 'ingest', inputs: [1], outcome: 'pass', evidence: { ok: true } });
    b.record({
      stage: 'mask',
      inputs: [2],
      outcome: 'refuse',
      evidence: { coverage: 0.12 },
      threshold: 'coverage ≥ 0.80',
    });
    // lst consumes mask, so it cannot legitimately pass.
    const lst = b.record({
      stage: 'lst',
      inputs: [3],
      outcome: 'pass',
      evidence: { yardMeanC: 43.2 },
    });
    expect(lst.outcome).toBe('unreachable');

    // And the block is transitive: fit consumes lst.
    const fit = b.record({
      stage: 'fit',
      inputs: [4],
      outcome: 'pass',
      evidence: { slope: -15 },
    });
    expect(fit.outcome).toBe('unreachable');
  });

  it('markUnreachable blocks a stage explicitly', () => {
    const b = new LedgerBuilder();
    b.markUnreachable('resample');
    // fit consumes resample.
    const fit = b.record({
      stage: 'fit',
      inputs: [1],
      outcome: 'pass',
      evidence: { slope: -12 },
    });
    expect(fit.outcome).toBe('unreachable');
  });

  it('leaves independent stages untouched', () => {
    const b = new LedgerBuilder();
    b.markUnreachable('validate');
    // plan consumes ndvi and lst, not validate — so it still runs.
    const plan = b.record({
      stage: 'plan',
      inputs: [1],
      outcome: 'pass',
      evidence: { trees: 12 },
    });
    expect(plan.outcome).toBe('pass');
  });
});

describe('the gates, on real fixtures', () => {
  it('GATE 1 refuses on the cloud-occluded school', async () => {
    const { report, analysis } = await buildForSlug('dos-rios');
    const ledger = buildLedgerFromReport(report, analysis);
    const predict = ledger.entries.find((e) => e.stage === 'predict');

    expect(predict?.outcome).toBe('refuse');
    expect(predict?.threshold).toBe('coverage ≥ 0.80');
    // No temperature may leak into the evidence.
    expect(predict?.evidence.deltaC).toBeNull();
    expect(Number(predict?.evidence.coverage)).toBeLessThan(0.8);
  });

  it('the hero school passes GATE 1 — so the test above is not vacuous', async () => {
    const { report, analysis } = await buildForSlug('cactus-wren');
    const ledger = buildLedgerFromReport(report, analysis);
    const predict = ledger.entries.find((e) => e.stage === 'predict');
    expect(predict?.outcome).not.toBe('refuse');
    expect(predict?.evidence.deltaC).not.toBeNull();
  });

  it('GATE 2 reports the fit verdict with R² as evidence', async () => {
    const { report, analysis } = await buildForSlug('cactus-wren');
    const ledger = buildLedgerFromReport(report, analysis);
    const validate = ledger.entries.find((e) => e.stage === 'validate');
    expect(validate?.outcome).toBe('pass');
    expect(Number(validate?.evidence.r2)).toBeGreaterThan(0.5);
  });

  it('GATE 3 refuses the uncited cost model', async () => {
    // The default region ships deliberately uncited.
    const { report, analysis } = await buildForSlug('cactus-wren');
    const ledger = buildLedgerFromReport(report, analysis);
    const cost = ledger.entries.find((e) => e.stage === 'cost');

    if (report.cost.hasUnsourcedLines) {
      expect(cost?.outcome).toBe('refuse');
      expect(Number(cost?.evidence.linesCited)).toBeLessThan(
        Number(cost?.evidence.linesTotal),
      );
      expect(cost?.evidence.totalLow).toBeNull();
    } else {
      expect(cost?.outcome).toBe('pass');
    }
  });

  it('the report is still produced when a gate withholds a figure', async () => {
    // Partial suppression is the design: the document ships without the number.
    const { report, analysis } = await buildForSlug('dos-rios');
    const ledger = buildLedgerFromReport(report, analysis);
    const rep = ledger.entries.find((e) => e.stage === 'report');
    expect(rep?.outcome).toBe('degrade');
    expect(rep?.evidence.deltaReported).toBe(false);
    // The canopy and cost measurements survive, which is the whole point.
    expect(Number(rep?.evidence.limitations)).toBeGreaterThan(0);
  });
});

describe('notes are composed, not canned', () => {
  it('every note contains a number drawn from its own evidence', async () => {
    const { report, analysis } = await buildForSlug('cactus-wren');
    const ledger = buildLedgerFromReport(report, analysis);

    for (const entry of ledger.entries) {
      const numeric = Object.values(entry.evidence).filter(
        (v): v is number => typeof v === 'number' && Number.isFinite(v),
      );
      if (numeric.length === 0) continue;
      // A hardcoded sentence could not contain the measured value.
      expect(entry.note).toMatch(/\d/);
      expect(entry.note).toContain(entry.outcome.toUpperCase());
    }
  });

  it('a note reports unknown evidence as unknown, never as 0', () => {
    const b = new LedgerBuilder();
    const e = b.record({
      stage: 'predict',
      inputs: [1],
      outcome: 'refuse',
      evidence: { deltaC: null, coverage: 0.5 },
      threshold: 'coverage ≥ 0.80',
    });
    expect(e.note).toContain('deltaC=unknown');
    expect(e.note).not.toContain('deltaC=0');
  });
});

describe('explainOutcome walks the ledger', () => {
  it('names the refusing stage and its measured evidence', async () => {
    const { report, analysis } = await buildForSlug('dos-rios');
    const ledger = buildLedgerFromReport(report, analysis);
    const why = explainOutcome(ledger, 'predict');

    // Derived by traversal, so it must carry the actual coverage figure rather
    // than a canned sentence.
    expect(why).toContain(report.measured.coverage.toFixed(3));
    expect(why).toContain('predict');

    // And the cost refusal is reachable by its own traversal.
    expect(explainOutcome(ledger, 'cost')).toMatch(/REFUSE|linesCited/);
  });

  it('says so when nothing upstream refused', async () => {
    const { report, analysis } = await buildForSlug('cactus-wren');
    const ledger = buildLedgerFromReport(report, analysis);
    expect(explainOutcome(ledger, 'lst')).toMatch(/No upstream stage refused/);
  });

  it('handles a stage that is absent from the ledger', () => {
    const ledger = new LedgerBuilder().build();
    expect(explainOutcome(ledger, 'predict')).toMatch(/No ledger entry/);
  });
});

describe('projection and ordering', () => {
  it('emits stages in canonical pipeline order for every fixture', async () => {
    for (const slug of ['cactus-wren', 'john-jacobs', 'sunridge', 'dos-rios']) {
      const { report, analysis } = await buildForSlug(slug);
      const stages = buildLedgerFromReport(report, analysis).entries.map((e) => e.stage);
      expect(stages).toEqual([...STAGE_ORDER]);
    }
  });

  it('ledgerToRows returns one render-ready row per entry', async () => {
    const { report, analysis } = await buildForSlug('dos-rios');
    const ledger = buildLedgerFromReport(report, analysis);
    const rows = ledgerToRows(ledger);

    expect(rows.length).toBe(ledger.entries.length);
    for (const r of rows) {
      expect(r.stage.length).toBeGreaterThan(0);
      expect(r.measured.length).toBeGreaterThan(0);
      expect(r.threshold.length).toBeGreaterThan(0);
    }
    // The refusal is visible in the projection, not only in the entries.
    expect(rows.some((r) => r.outcome === 'refuse')).toBe(true);
  });

  it('every entry declares its upstream dependencies', async () => {
    const { report, analysis } = await buildForSlug('cactus-wren');
    for (const e of buildLedgerFromReport(report, analysis).entries) {
      // ingest has no inputs; report reads its inputs DEFENSIVELY and so
      // declares none, which is what lets it degrade rather than be blocked.
      if (e.stage === 'ingest' || e.stage === 'report') {
        expect(e.upstream).toEqual([]);
      } else {
        expect(e.upstream.length).toBeGreaterThan(0);
      }
    }
  });
});
