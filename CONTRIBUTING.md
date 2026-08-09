# Contributing

Canopy's credibility rests on a small number of invariants. Everything else is
negotiable; these are not.

---

## The invariants

```
  1  npm test stays green. Never commit red.

  2  100% line coverage on packages/core/src/raster/** and
     packages/core/src/model/** must not regress. Every new function in those
     directories ships with tests.

  3  Zero new RUNTIME dependencies. Dev dependencies only if unavoidable.

  4  Determinism. No Math.random(), no Date.now() in any computation path.
     Report output must be byte-identical across runs — a golden test depends
     on it.

  5  Unknown is NaN inside a raster and null at a scalar boundary.
     Never 0. Never Infinity. A cloud-masked pixel has no temperature, and
     coercing it to zero silently drags every mean down.

  6  No uncited numbers. packages/core/src/model/cost.ts structurally refuses
     to print a cost line without source_name + source_url + source_retrieved.
     Do not weaken it. Do not invent citations.
     maricopa-az.json ships with zeroed prices ON PURPOSE.

  7  No network in packages/core. A test asserts this. Keep it passing.

  8  Refusals stay type-enforced. Prediction is a discriminated union with a
     suppressed variant so the compiler forces every renderer to handle it.
     Do not add an escape hatch.
```

Violating any of these makes the project worse, not better.

---

## Before you commit

```bash
npm run typecheck && npm test && npm run build
```

All three must pass. `pretest` and `prebuild` clean stale compiled artifacts
automatically — see [ADR-17](docs/DECISIONS.md#adr-17) for why that matters.

---

## Commit style

Conventional commits, scoped to the package:

```
  feat(core):     derive LST from Landsat B10 radiance
  feat(web):      cost region selector, defaulting to Portland
  fix(render):    suppress cost total when any line lacks a source
  test(core):     assert NDVI returns null on zero-signal pixels
  docs(method):   document the NDVI-threshold emissivity derivation
  chore(ci):      run build and tests on push
```

Never `wip`, `fix`, `update`, `stuff`, or merge noise. One logical change per
commit. Body text where the *why* is not obvious from the subject — two lines is
usually enough.

---

## Where things go

```
  a new raster operation        packages/core/src/raster/<concept>.ts
  a new model computation       packages/core/src/model/<concept>.ts
  a new data source             packages/adapters/<port>-<impl>/
  a new report section          packages/render/src/drawReport.ts
  a new UI panel                apps/web/src/panels/
  a build-time script           tools/ingest/src/
```

Naming rules:

```
  ✓  one concept per file — ndvi.ts does NDVI, not masking
  ✓  index.ts is a curated public surface, not export * from everything
  ✓  domain vocabulary — canopyFraction, not getPct
  ✓  test files mirror source paths
  ✗  no utils/ · no helpers/ · no misc/ · no common/
     if you cannot name a module after a domain concept, the boundary is wrong
```

---

## Adding a cost region

1. Create `packages/adapters/cost-local/data/<region>.json`.
2. Every item needs `low`, `high`, `source_name`, `source_url` (must resolve),
   and `source_retrieved` (ISO date).
3. Record limitations **in the file** — see `portland-or.json` for the pattern.
4. Register it in `apps/web/src/App.tsx` `REGIONS`.
5. Add a contrast test.

Source priority:

```
  TIER 1   school district facilities bid tabulation — strongest, it is
           literally what a school pays
  TIER 2   city or county urban forestry price sheet
  TIER 3   state extension service cost guide
  TIER 4   i-Tree project documentation assumptions
```

**Record a range, never a point estimate.** A cited range beats an uncited precise
number every time.

**If you cannot find a real figure, leave the fields empty.** The gate will
withhold the total, which is the correct outcome. Do not fill it in with something
plausible.

---

## Adding a fixture

See [docs/DATA.md](docs/DATA.md). In short:

```
  real imagery      set synthetic: false, parse real MTL constants from the
                    scene, record scene IDs in provenance
  synthetic         set synthetic: true and a fixed seed. The badge appears
                    automatically — it is driven by metadata, not a template.
```

Never present synthetic data as real. That is the one unrecoverable act here.

---

## Reporting

If you hit something that needs web access, **stop and say so.** Do not guess, and
above all do not invent a citation, a price, or a data source. The entire
credibility of this project rests on the fact that it does not do that.
