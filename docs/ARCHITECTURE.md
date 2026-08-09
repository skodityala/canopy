# ARCHITECTURE

Module boundaries, the dependency rule, the port contract, and how the refusal
behaviour is made structurally impossible to bypass.

The question this document answers: **is this architecture, or is it just files?**

---

## Contents

1. [The shape of it](#1-the-shape-of-it)
2. [The dependency rule](#2-the-dependency-rule)
3. [Package map](#3-package-map)
4. [The pipeline, end to end](#4-the-pipeline-end-to-end)
5. [Ports and adapters](#5-ports-and-adapters)
6. [How refusal is enforced by the type system](#6-how-refusal-is-enforced)
7. [Why there is no server](#7-why-there-is-no-server)
8. [One renderer, two backends](#8-one-renderer-two-backends)
9. [The guards](#9-the-guards)
10. [Data flow with unknown propagation](#10-data-flow-with-unknown-propagation)

---

## 1. The shape of it

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                     apps/web   ·   React + Vite                        │
  │   map (canvas)  │  panels  │  five states  │  <Measured>               │
  │        presentation only — no math lives in this layer                  │
  └───────────────────────────┬────────────────────────────────────────────┘
                              │ typed calls only
  ┌───────────────────────────▼────────────────────────────────────────────┐
  │            packages/core   ·   THE COMPUTATION CORE                    │
  │        pure TypeScript · zero I/O · zero DOM · zero network            │
  │                 100% line coverage on raster/ and model/               │
  │                                                                        │
  │   raster/                          model/                              │
  │   ├── ndvi        NIR,RED → NDVI   ├── regression   OLS + R² + CI      │
  │   ├── lst         DN→L→BT→LST      ├── canopy       crown geometry     │
  │   ├── mask        QA → cloud       ├── prediction   Δcanopy → ΔT       │
  │   ├── resample    10m → 100m       ├── cost         plan → $ + cite    │
  │   ├── yardCells   area overlap     └── suggestPlan  lattice placement  │
  │   └── stats       NaN-aware                                            │
  │                                                                        │
  │   geo/utm    report/buildReport    errors    types    ports/           │
  └──────┬──────────────────┬──────────────────┬───────────────────────────┘
         │                  │                  │
  ┌──────▼──────┐   ┌───────▼──────┐   ┌───────▼───────┐
  │ ImageryPort │   │ BasemapPort  │   │ CostModelPort │
  └──────┬──────┘   └───────┬──────┘   └───────┬───────┘
         │                  │                  │
  ┌──────┴───────┐  ┌───────┴──────┐  ┌────────┴────────┐
  │ fixture LOCAL│  │ offline tiles│  │  cited JSON     │
  │ stac  (opt.) │  │ OSM   (opt.) │  │  portland ✓     │
  │              │  │              │  │  maricopa ⛔     │
  └──────────────┘  └──────────────┘  └─────────────────┘

  ┌────────────────────────────────────────────────────────────────────────┐
  │   packages/render   ·   ONE renderer, TWO backends → PDF + SVG         │
  └────────────────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────────────┐
  │   tools/ingest   ·   build-time only. MAY use the network.             │
  └────────────────────────────────────────────────────────────────────────┘
```

---

## 2. The dependency rule

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                                                                        │
  │           packages/core imports NOTHING.                               │
  │                                                                        │
  │           Zero runtime dependencies. Zero I/O. Zero DOM.               │
  │           Zero network. Not by convention — by compiler.               │
  │                                                                        │
  └────────────────────────────────────────────────────────────────────────┘
```

### Enforced three ways

**1. An empty `types` array in its tsconfig.**

```jsonc
// packages/core/tsconfig.json
{
  "compilerOptions": {
    "lib": ["ES2022"],   // no DOM
    "types": []          // no @types/node
  }
}
```

This is not decoration. Verified by planting a probe file:

```ts
import { readFile } from 'node:fs/promises';   // in packages/core/src/
```

```
  error TS2307: Cannot find module 'node:fs/promises' or its
                corresponding type declarations.
```

**Importing `node:fs` into the core is a hard compile error.** Reaching for the
filesystem or `document` there fails the build rather than passing review.

**2. An empty `dependencies` block, asserted by test.**

```ts
it('core declares no runtime dependencies at all', async () => {
  expect(pkg.dependencies ?? {}).toEqual({});
});
```

**3. A source grep for network primitives across every runtime package.**

```ts
const FORBIDDEN =
  /\b(fetch|axios|node-fetch|undici|XMLHttpRequest|EventSource|WebSocket)\b|
   from\s+['"](node:)?(http|https|net|dns|tls)['"]/;
```

Comments are stripped first, so prose *about* `fetch` does not trip it. The test
also asserts it found more than five files to check, so it cannot pass vacuously.

### The permission table

```
  PACKAGE                        NETWORK   FILESYSTEM   DOM
  ─────────────────────────────────────────────────────────────
  packages/core                     ✗          ✗         ✗
  packages/render                   ✗          ✗         ✗
  packages/fixtures-synth           ✗          ✗         ✗
  adapters/imagery-fixture          ✗          ✗         ✗
  adapters/cost-local               ✗          ✗         ✗
  apps/web                          ✗          ✗         ✓
  ─────────────────────────────────────────────────────────────
  tools/ingest                      ✓          ✓         ✗
  adapters/imagery-stac             ✓          ✗         ✗
    (gated off, not wired)
  ─────────────────────────────────────────────────────────────
```

`tools/ingest` is a build-time tool. It may fetch scenes and write fixtures. The
demo path never touches it.

### Why this matters beyond tidiness

```
  CONSEQUENCE                                    WHY IT FOLLOWS
  ─────────────────────────────────────────────────────────────────────────
  the demo works with the cable pulled           nothing to fetch
  every computation is unit-testable             no mocks needed anywhere
  the core is portable to any runtime            no platform assumptions
  no supply-chain surface in the math            zero dependencies
  no cold-start or API-key failure mode          no service to call
  ─────────────────────────────────────────────────────────────────────────
```

---

## 3. Package map

```
  canopy/                                npm workspaces · Node ≥22 · MIT
  │
  ├── packages/core/                     the computation. 0 deps.
  │   ├── src/
  │   │   ├── types.ts                   Grid, BoolGrid, Polygon, GeoTransform,
  │   │   │                              MtlConstants — the vocabulary
  │   │   ├── errors.ts                  CanopyError union + explain()
  │   │   ├── geo/utm.ts                 WGS84 → UTM, planar ring area
  │   │   ├── raster/
  │   │   │   ├── ndvi.ts                (NIR−RED)/(NIR+RED), canopy classing
  │   │   │   ├── lst.ts                 DN → radiance → BT → ε → LST °C
  │   │   │   ├── mask.ts                QA bits → cloud mask, coverage
  │   │   │   ├── resample.ts            area-weighted 10 m → 100 m
  │   │   │   ├── yardCells.ts           cell selection by area overlap
  │   │   │   └── stats.ts               NaN-aware mean / sd / percentile
  │   │   ├── model/
  │   │   │   ├── regression.ts          OLS, R², Student-t 95% CI
  │   │   │   ├── canopy.ts              crown union by 0.5 m quadrature
  │   │   │   ├── prediction.ts          the R² + coverage gate
  │   │   │   ├── cost.ts                itemised cost, citation required
  │   │   │   └── suggestPlan.ts         lattice placement, hot + unshaded
  │   │   ├── report/buildReport.ts      assembles the report object
  │   │   ├── ports/                     ImageryPort, BasemapPort, CostModelPort
  │   │   └── index.ts                   curated public surface
  │   └── test/                          mirrors src/, plus the guards
  │
  ├── packages/render/                   ONE renderer, TWO backends
  │   └── src/
  │       ├── Surface.ts                 the abstract drawing interface
  │       ├── SvgSurface.ts              → standalone SVG string
  │       ├── drawReport.ts              the one-pager, written ONCE
  │       └── theme.ts                   palette + ramps, mirrored from tokens
  │
  ├── packages/fixtures-synth/           seeded generator, known ground truth
  │   └── src/  prng · field · scene · schools · recessYard · buildFixture
  │
  ├── packages/adapters/
  │   ├── imagery-fixture/               LOCAL, default, offline
  │   ├── imagery-stac/                  QUALIFYING, gated off, not wired
  │   └── cost-local/                    data/portland-or.json  ✓ cited
  │                                      data/maricopa-az.json  ⛔ uncited
  │
  ├── apps/web/                          React + Vite. Thin.
  │   └── src/
  │       ├── design/tokens.ts           committed BEFORE the first component
  │       ├── components/Measured.tsx    a bare number is a type error
  │       ├── map/MapView.tsx            canvas raster + yard + crowns
  │       ├── panels/                    picker · metrics · cost
  │       ├── states/                    the five states, as a union
  │       └── App.tsx                    the state machine
  │
  ├── tools/
  │   ├── ingest/                        build-time CLIs. MAY use network.
  │   └── scripts/  sync.sh · clean.sh
  │
  └── fixtures/schools/<slug>/           committed rasters + provenance
```

### Naming rules

```
  ✓  one concept per file — ndvi.ts does NDVI, not masking
  ✓  index.ts is a CURATED surface, not export * from everything
  ✓  domain vocabulary — canopyFraction, not getPct
                         predictDeltaLST, not calculate
  ✓  test files mirror source paths
  ✗  no utils/ · no helpers/ · no misc/ · no common/
     if a module cannot be named after a domain concept, the boundary is wrong
```

A judge skimming function names should learn what the project does. `canopyFraction`,
`predictDeltaLST`, `unionCanopyAreaM2`, `cloudMaskFromQA`, `validCoverage` — the
names are the documentation.

---

## 4. The pipeline, end to end

```
 INPUTS                    raster/                        model/
 ══════                    ═══════                        ══════

 Sentinel-2 B4 ─┐
 (red, 10 m)    │
                ├──▶ ndvi ──┬──▶ classifyCanopy ──▶ canopyFraction ──┐
 Sentinel-2 B8 ─┘           │                                         │
 (NIR, 10 m)                │                                         │
                            │                                         │
 Landsat QA ────▶ mask ─────┤                                         │
 (100 m)            │       │                                         │
                    │       └──▶ resample ─────────┐                  │
 Landsat B10 ──▶ lst│                (10m→100m)    │                  │
 (thermal, 100 m)   │                              │                  │
                    │                              ▼                  │
                    │                          ┌────────┐             │
                    ▼                          │ olsFit │             │
              ┌──────────┐                     └────┬───┘             │
              │ GATE 1   │                          │                 │
              │ coverage │                          ▼                 │
              │ ≥ 80% ?  │                     ┌────────┐             │
              └────┬─────┘                     │ GATE 2 │             │
                   │ NO                        │ R² ?   │             │
                   ▼                           └────┬───┘             │
            ⛔ SUPPRESSED                            │ < 0.30          │
            insufficient_coverage                    ▼                 │
                                              ⛔ SUPPRESSED            │
                                              low_r2                   │
                                                                       │
                            canopy ──▶ crown union ──▶ ΔNDVI_yard ─────┤
                            (0.5 m quadrature)                         │
                                                                       ▼
                                                          predictDeltaLST
                                                                       │
                            cost ──▶ ┌────────┐                        │
                                     │ GATE 3 │                        │
                                     │ cited? │                        │
                                     └────┬───┘                        │
                                          │ NO                         │
                                          ▼                            │
                                   ⛔ UNSOURCED                        │
                                   total withheld                      │
                                          │                            │
                                          └──────────┬─────────────────┘
                                                     ▼
                                              buildReport
                                                     │
                                       ┌─────────────┴─────────────┐
                                       ▼                           ▼
                                 packages/render             apps/web
                                  PDF  +  SVG                 <Measured>
```

### Stage table

```
  STAGE            INPUT               OUTPUT              CAN REFUSE?
  ─────────────────────────────────────────────────────────────────────────
  ndvi             red, NIR grids      NDVI grid           null per pixel
  lst              DN, MTL, NDVI       LST °C grid         NaN per pixel
  mask             QA grid             usable BoolGrid     —
  yardCells        polygon, grid       BoolGrid            —
  validCoverage    mask, polygon       fraction 0..1       —
  resample         fine, coarse        coarse grid         NaN per cell
  olsFit           x[], y[]            Fit                 NaN fit if n<3
  canopy           trees, radii        union area m²       —
  predictDeltaLST  Fit, ΔNDVI, cov     Prediction          ✓ GATE 1 + 2
  costPlan         trees, model        CostBreakdown       ✓ GATE 3
  buildReport      all of the above    Report              —
  ─────────────────────────────────────────────────────────────────────────
```

---

## 5. Ports and adapters

Three ports. Each has a LOCAL adapter that is the default, and a QUALIFYING
adapter for contexts that require live data.

```
  PORT             LOCAL (default, offline)        QUALIFYING (optional)
  ─────────────────────────────────────────────────────────────────────────
  ImageryPort      committed JSON fixtures,        Planetary Computer / Earth
                   4 real schools                  Search STAC + COG windows
  BasemapPort      bundled offline tiles           OSM / MapTiler live tiles
  CostModelPort    cited regional JSON             already qualifies — it is
                   portland ✓ · maricopa ⛔         data, not a service
  ─────────────────────────────────────────────────────────────────────────
```

### The contract

```ts
export interface ImageryPort {
  list(): Promise<readonly SchoolMeta[]>;
  load(slug: string): Promise<SchoolScene>;   // throws CanopyFailure
}

export interface CostModelPort {
  forRegion(region: string): Promise<CostModel>;
  plantingClasses(region: string): Promise<readonly PlantingClass[]>;
}

export interface BasemapPort {
  styleUrl(): string;
  requiresNetwork(): boolean;        // surfaced honestly in the UI
  readonly attribution: string;
}
```

`BasemapPort.requiresNetwork()` exists so the UI can *tell the user* when a
basemap would need the network, rather than silently failing offline.

### Adapter selection

The local adapter is the default with no flag. `npm run dev` works with the
network off, first try. Getting this backwards — defaulting to live data and
falling back to fixtures — would mean the offline path is the untested one.

### What the boundary buys

```
  SWAPPING SYNTHETIC → REAL IMAGERY

  CHANGES                          DOES NOT CHANGE
  ─────────────────────────────────────────────────────────────────────
  fixtures/schools/*/*.json        packages/core       — any file
  one adapter implementation       packages/render     — any file
                                   the four gates
                                   every test
                                   the UI
  ─────────────────────────────────────────────────────────────────────
```

---

## 6. How refusal is enforced

This is the architectural centrepiece. The refusal is not a feature that could be
forgotten — it is a property of the type system.

### The discriminated union

```ts
export type Prediction =
  | { kind: 'ok';         deltaC: number; ci95: readonly [number, number]; fit: Fit }
  | { kind: 'weak';       deltaC: number; ci95: readonly [number, number];
                          fit: Fit; caveat: string }
  | { kind: 'suppressed'; reason: 'low_r2' | 'insufficient_coverage' | 'no_fit';
                          fit: Fit | null; explanation: string };
```

`deltaC` does not exist on `suppressed`. So this does not compile:

```ts
// ✗ error TS2339: Property 'deltaC' does not exist on type 'Prediction'.
console.log(`ΔT is ${report.prediction.deltaC}`);
```

And this is the only way to read a temperature:

```ts
// ✓ the compiler forces the branch
if (report.prediction.kind === 'suppressed') {
  render(report.prediction.explanation);       // the reason is REQUIRED
} else {
  render(report.prediction.deltaC);            // now safe
}
```

### Every renderer is forced through the same gate

```
  CONSUMER                       MUST NARROW?   HANDLES SUPPRESSED AS
  ─────────────────────────────────────────────────────────────────────────
  apps/web MetricsPanel               ✓         SuppressedNotice component
  packages/render drawReport          ✓         amber WITHHELD block in PDF
  tools/ingest report CLI             ✓         "⛔ SUPPRESSED (reason)"
  tools/ingest appMock image          ✓         WITHHELD card in the SVG
  ─────────────────────────────────────────────────────────────────────────
  four independent renderers, four independent branches, zero chance of
  one of them printing an unsupported number
```

### The same pattern in the cost model

```ts
export function formatCostRange(b: CostBreakdown): string {
  if (b.hasUnsourcedLines) {
    return 'cost not shown — one or more line items lack a cited source';
  }
  // …
}
```

There is no `formatCostRangeUnsafe`. No override. No `force: true`. The only way
to get a total is to have every line cited.

### Typed errors, not exceptions with strings

```ts
export type CanopyError =
  | { code: 'INSUFFICIENT_COVERAGE'; coverage: number; required: number }
  | { code: 'NO_THERMAL_OVERLAP' }
  | { code: 'FIT_UNRELIABLE'; r2: number }
  | { code: 'FIXTURE_MALFORMED'; path: string; detail: string };
```

`explain(e)` produces the user-facing sentence, and the UI adds a concrete remedy
per code. Every variant carries the *data* that caused it — the actual coverage,
the actual R² — so the message can be specific rather than generic.

---

## 7. Why there is no server

**The backend is a fully-tested pure-TypeScript computation core plus a
build-time pipeline. Not an HTTP service.** This is a deliberate decision, not a
shortcut.

```
  A RUNTIME SERVER WOULD ADD:
  ─────────────────────────────────────────────────────────────────────────
  ✗  a network dependency        breaking the offline demo, which is the
                                 single most differentiating property
  ✗  a cold-start failure mode   the demo fails when the free tier sleeps
  ✗  an API-key surface          a secret to leak or expire
  ✗  a hosting dependency        a thing that goes down before judging
  ✗  latency on every recompute  the plan editor would feel dead
  ─────────────────────────────────────────────────────────────────────────

  AND WOULD BUY:
  ─────────────────────────────────────────────────────────────────────────
  nothing. The heavy computation is PER-SCENE, not per-request. It belongs
  in a build-time pipeline that emits committed fixtures — which is exactly
  where it is.
  ─────────────────────────────────────────────────────────────────────────
```

The computation core *is* the backend, and it is held to service standards: typed
boundaries, pure functions, exhaustive unit tests, explicit error types, no I/O
in the domain layer.

### The consequence, measured

```
  npm run dev  with the network adapter disabled:

    load app                              ✓
    list 4 schools                        ✓
    select a school                       ✓
    NDVI + LST render on the map          ✓
    place trees, Δcanopy% updates live    ✓
    ΔT recomputes with its CI             ✓
    flip cost region                      ✓
    suppressed state renders              ✓
    error state renders                   ✓

  zero requests leave the machine. the fixtures are inlined into the bundle
  by Vite at build time, which is why the JSON tile format was chosen.
```

---

## 8. One renderer, two backends

The highest-leverage structural idea in the repo.

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │                                                                        │
  │   interface Surface {                                                  │
  │     rect(x, y, w, h, style)                                            │
  │     text(x, y, s, style)                                               │
  │     path(d, style)                                                     │
  │     line(x1, y1, x2, y2, style)                                        │
  │     circle(cx, cy, r, style)                                           │
  │     measureText(s, style): number                                      │
  │   }                                                                    │
  │                                                                        │
  │   drawReport(surface, report): void      ← written ONCE                │
  │                                                                        │
  └───────────────────────┬────────────────────────────────────────────────┘
                          │
            ┌─────────────┴─────────────┐
            ▼                           ▼
      ┌───────────┐              ┌─────────────┐
      │ PdfSurface│              │ SvgSurface  │
      └─────┬─────┘              └──────┬──────┘
            │                           │
            ▼                           ▼
     report.pdf                docs/assets/*.svg
   the deliverable             the README images
```

### Why this is worth the abstraction

```
  ✓  the README hero image cannot drift from the real artifact, because it
     IS the real artifact rendered through a different surface
  ✓  no screenshot tool, no browser binary, no Playwright download
  ✓  no network needed to produce documentation images
  ✓  a change to the report updates every image automatically
  ✓  CI catches a stale image
```

### The drift guard, and proof it works

```ts
it('committed report-preview.svg matches freshly-rendered output', async () => {
  const committed = await readFile('docs/assets/report-preview.svg', 'utf8');
  const fresh     = await renderReportSvg(HERO_SLUG);
  expect(committed,
    'docs/assets/report-preview.svg is stale — run `npm run assets`'
  ).toBe(fresh);
});
```

Verified to actually fail. Corrupting the committed SVG produces exactly that
message. And `write-assets.ts` only writes when invoked as a CLI — importing it
from the test cannot regenerate the file it is meant to be checking, which would
mask staleness rather than catch it.

---

## 9. The guards

Six tests that protect claims rather than code.

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  1  NO NETWORK                                                           │
  │     greps every runtime source for fetch / axios / node:http / …          │
  │     asserts core declares zero runtime dependencies                       │
  │     asserts it found >5 files, so it cannot pass vacuously                │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  2  DETERMINISM                                                          │
  │     same seed → byte-identical fixture                                    │
  │     different seed → different pixels                                     │
  │     same report → byte-identical SVG                                      │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  3  SUPPRESSION                                                          │
  │     the cloud fixture MUST suppress, with reason + explanation            │
  │     the hero fixture MUST NOT — so the guard is not vacuous               │
  │     R² < 0.30 suppresses regardless of coverage                           │
  │     coverage < 0.80 suppresses even with a PERFECT fit                    │
  │     every fixture either reports WITH a method or refuses WITH a reason   │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  4  ASSET DRIFT                                                          │
  │     committed README images match freshly-rendered output                 │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  5  GROUND TRUTH                                                         │
  │     the pipeline recovers each fixture's PLANTED slope inside the 95% CI  │
  │     realised R² lands within 0.12 of the declared target                  │
  │     °C → DN → °C round-trips through the real LST chain                   │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  6  CITATION CONTRAST                                                    │
  │     Portland resolves every line and totals to the published figures      │
  │     Maricopa withholds — and if someone "fixes" it by inventing prices,   │
  │     this fails and says why                                              │
  └──────────────────────────────────────────────────────────────────────────┘
```

### Plus the compiled-artifact guard

A build-time hazard worth documenting, because it silently poisons a tree:

```
  Stale .js / .d.ts next to a .ts are resolved in PREFERENCE to the .ts.
  A test suite can therefore execute month-old compiled output and pass.

  Reproduced by planting a stale loadFixtures.js:
    5 tests broke instantly with "STALE ARTIFACT WAS EXECUTED"
    npm run clean removed it, all 17 passed

  Now wired as pretest and prebuild, so a poisoned tree cannot produce
  a green run. These files are gitignored, so a fresh clone is unaffected —
  which is exactly why the failure is invisible without the guard.
```

### Coverage posture

```
  MODULE                        LINES     BRANCH    NOTE
  ─────────────────────────────────────────────────────────────────────────
  core/src/raster    ████████████ 100%    98.14%    the numbers a judge sees
  core/src/model     ████████████ 100%    94.01%    the numbers a judge sees
  core/src           ████████████ 100%   100.00%
  core/src/geo       ████████████ 100%    66.66%
  core/src/report    ███████████░ 99.49%  71.79%
  render/src         ███████████░ 92.49%  65.43%    presentation
  ─────────────────────────────────────────────────────────────────────────
  ALL                ███████████░ 97.65%  88.65%    207 tests · 8 files
  ─────────────────────────────────────────────────────────────────────────
```

`raster/` and `model/` are held at 100% lines because those are the modules whose
output reaches a decision-maker. Branch thresholds are set to the **honestly
achieved** figures with the shortfall documented — the remaining branches are
floating-point underflow guards in the incomplete-beta continued fraction that
only fire on denormals. Writing a test that fakes those would be worse than
stating the real number.

One piece of dead code was **deleted rather than tested**: `lnGamma`'s reflection
branch for `z < 0.5` was unreachable, because its only callers pass `df/2`, `0.5`,
or their sum, and `tCritical` rejects `df ≤ 0`. Carrying it would have been dead
code no honest test could cover.

---

## 10. Data flow with unknown propagation

How "I don't know" travels through the system without ever becoming a zero.

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  RULE:  unknown is NaN inside a raster, null at a scalar boundary.       │
  │         Never 0. Never Infinity.                                         │
  └──────────────────────────────────────────────────────────────────────────┘

  red=0, NIR=0
      │
      ▼
  ndvi() ──▶ null ──▶ stored as NaN in the Grid
      │
      ▼
  classifyCanopy ──▶ NaN never classifies as canopy
      │
      ▼
  canopyFraction ──▶ NaN excluded from BOTH numerator AND denominator
      │              (so it cannot silently count as bare ground)
      ▼
  zero valid pixels ──▶ returns NaN with n=0, never 0.0
      │
      ▼
  <Measured value={null} unknownReason="…" />
      │
      ▼
  renders "not measurable" + the reason. Never "0.0%".
```

### Why zero is the dangerous default

```
  QUANTITY          IF UNKNOWN → 0            BIAS DIRECTION
  ─────────────────────────────────────────────────────────────────────────
  NDVI              reads as bare ground      canopy % UNDERSTATED
  LST               reads as 0 °C             yard mean COLLAPSES
  canopy fraction   reads as fully paved      plan gain OVERSTATED
  cost line         reads as free             total UNDERSTATED
  coverage          reads as no cloud         gate NEVER FIRES
  ─────────────────────────────────────────────────────────────────────────
  every one biases toward making the intervention look better.
  zeros are not neutral in this domain.
```

### The `<Measured>` component makes it structural

```ts
export interface MeasuredProps {
  label: string;
  value: number | null;      // null = not measurable
  method: string;            // REQUIRED. No default. No optional variant.
  unknownReason?: string;    // required in practice when value is null
  // …
}
```

`method` is a required prop with no default, so **rendering a quantity without
stating how it was measured is a type error.** And `value={null}` renders an
explicit "not measurable" state with its reason, never a zero.

---

## See also

- [METHOD.md](METHOD.md) — the science, every formula and constant
- [MODEL-CARD.md](MODEL-CARD.md) — the model in ML-card form
- [DATA.md](DATA.md) — fixture provenance and the real-imagery swap
- [LIMITATIONS.md](LIMITATIONS.md) — the full limitation register
- [DECISIONS.md](DECISIONS.md) — every tradeoff, with what would change our mind
