# DECISIONS

Architecture decision records, ADR-lite. Each entry states the decision, what was
rejected, why, and — most importantly — **what would change our mind.**

The last field is the point. A decision without a falsification condition is a
preference.

---

## Index

| # | Decision | Status |
|---|---|---|
| [1](#adr-1) | No runtime server | accepted |
| [2](#adr-2) | Refit the regression per scene instead of borrowing a literature constant | accepted |
| [3](#adr-3) | Suppress the claim instead of reporting a best effort | accepted |
| [4](#adr-4) | `Prediction` as a discriminated union | accepted |
| [5](#adr-5) | One renderer, two backends | accepted |
| [6](#adr-6) | Synthetic fixtures with planted ground truth | accepted, reluctantly |
| [7](#adr-7) | Per-fixture MTL constants, never global | accepted |
| [8](#adr-8) | Unknown is `NaN` / `null`, never `0` | accepted |
| [9](#adr-9) | JSON tiles instead of GeoTIFF | accepted |
| [10](#adr-10) | Canvas map instead of MapLibre | accepted |
| [11](#adr-11) | Deterministic quadrature instead of Monte Carlo | accepted |
| [12](#adr-12) | Real Student-t quantile instead of 1.96 | accepted |
| [13](#adr-13) | Ship one region uncited on purpose | accepted |
| [14](#adr-14) | Two-parameter OLS instead of a larger model | accepted |
| [15](#adr-15) | Absolute yard area instead of a parcel fraction | accepted |
| [16](#adr-16) | Delete unreachable code instead of testing it | accepted |
| [17](#adr-17) | Clean compiled artifacts before test and build | accepted |

---

## ADR-1

### No runtime server

**Decision.** The backend is a pure-TypeScript computation core plus a build-time
fixture pipeline. There is no HTTP service, no API route, no serverless function.

**Rejected.** An Express service; a Next.js API route; a Python FastAPI service
wrapping rasterio.

**Why.**

```
  A SERVER WOULD ADD                              AND WOULD BUY
  ─────────────────────────────────────────────────────────────────────────
  a network dependency, breaking the offline       nothing. the heavy
  demo — the single most differentiating           computation is PER-SCENE,
  property of the project                          not per-request, so it
  a cold-start failure mode                        belongs in a build-time
  an API-key surface                               pipeline emitting
  a hosting dependency that can go down            committed fixtures —
  latency on every plan edit                       exactly where it is
  ─────────────────────────────────────────────────────────────────────────
```

The plan editor recomputes on every tree placement. Locally that is
sub-millisecond; over a network it would feel dead.

**What would change our mind.** A requirement to ingest live imagery *on demand*
for an arbitrary user-supplied address. That is genuinely per-request work and
would justify a service — though even then the right shape is a build-time
ingest queue plus a static read path, not a synchronous compute endpoint.

---

## ADR-2

### Refit the regression per scene instead of borrowing a literature constant

**Decision.** Fit `LST = β₀ + β₁·NDVI` on the pixels of the scene being analysed,
every time, and derive ΔT from that fit.

**Rejected.** Looking up a published urban-cooling figure — "trees reduce surface
temperature by X °C" — and multiplying.

**Why.** Published figures vary by an order of magnitude across climates,
irrigation regimes, and background albedo. A borrowed constant fails the first
informed question: *which study, which city, and why does it apply here?* It would
also produce the same answer for a desert schoolyard and a Portland one, which is
obviously wrong.

```
  BORROWED CONSTANT                     PER-SCENE FIT
  ─────────────────────────────────────────────────────────────────────────
  one number for every site             a number for THIS site
  unverifiable from the input            checkable against the same imagery
  no honest confidence interval          real CI from real residuals
  cannot fail                            CAN fail — and failing is useful
  ─────────────────────────────────────────────────────────────────────────
```

That last row matters most. A per-scene fit can come back with R² = 0.15, which
tells you the relationship is not resolvable at that site. A borrowed constant
never tells you anything.

**Verified consequence.** The four fixtures produce slopes from −12.26 to −15.93,
ordered correctly by how green each yard already is. A single constant would have
erased that structure.

**What would change our mind.** A site with too few cloud-free thermal cells to
fit anything (n < 3). Canopy already handles this by refusing rather than falling
back to a constant — and refusing is the better failure.

---

## ADR-3

### Suppress the claim instead of reporting a best effort

**Decision.** Three gates. When any fires, the affected number is **withheld**,
with the reason stated. Not caveated. Not shown greyed out. Absent.

**Rejected.** Reporting the number with a warning label; reporting it with a wider
interval; reporting a partial mean over whatever pixels survived.

**Why.** A caveat is not read. A number, once printed, is quoted — and it will be
quoted without its warning. The only way to prevent a bad number from being cited
is to not print it.

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  A number a skeptic can puncture is worse than no number.                │
  │                                                                          │
  │  One fabricated figure discards the entire document in the eyes of the    │
  │  person who caught it. The expected cost of a wrong number is therefore   │
  │  much higher than the cost of an absent one.                             │
  └──────────────────────────────────────────────────────────────────────────┘
```

**Critically, suppression is partial.** When ΔT is withheld, canopy % and the
costed plan still render — those are still measured. The gate withholds exactly
the unsupported claim and nothing more.

**Verified consequence.** `dos-rios` has R² = 0.708, the second-best fit of the
four, and is still refused because only 50% of its yard is cloud-free. A tool that
suppresses only when its model is bad is ordinary; suppressing when the model is
fine but the input coverage is not is the harder and more honest behaviour.

**What would change our mind.** Evidence that users interpret a refusal as "this
site does not need trees" rather than "the imagery cannot answer this." That would
be a serious harm, and the mitigation is wording plus always showing the
measurements that *are* valid — both already implemented, neither validated with
real users.

---

## ADR-4

### `Prediction` as a discriminated union

**Decision.**

```ts
type Prediction =
  | { kind: 'ok';         deltaC: number; ci95: [number, number]; fit: Fit }
  | { kind: 'weak';       deltaC: number; ci95: [number, number]; fit: Fit;
                          caveat: string }
  | { kind: 'suppressed'; reason: 'low_r2' | 'insufficient_coverage' | 'no_fit';
                          fit: Fit | null; explanation: string };
```

**Rejected.** `{ deltaC: number | null; suppressed: boolean; reason?: string }`.

**Why.** The rejected shape lets a renderer read `deltaC` without checking
`suppressed`, and `number | null` invites `deltaC ?? 0` — which is the exact bug
the whole project exists to prevent.

With the union, `deltaC` **does not exist** on the suppressed variant. Reading it
without narrowing is a compile error.

```
  FOUR INDEPENDENT RENDERERS, FOUR FORCED BRANCHES

  apps/web MetricsPanel        ──▶ SuppressedNotice component
  packages/render drawReport   ──▶ amber WITHHELD block in the PDF
  tools/ingest report CLI      ──▶ "⛔ SUPPRESSED (reason)"
  tools/ingest appMock         ──▶ WITHHELD card in the SVG

  none of them CAN forget. the compiler will not allow it.
```

This is what turns the refusal from a feature into an architectural property.

**What would change our mind.** Nothing. This is the single highest-leverage
design decision in the codebase and it costs almost nothing.

---

## ADR-5

### One renderer, two backends

**Decision.** `drawReport(surface, report)` written once against an abstract
`Surface`. A PDF backend produces the deliverable; an SVG backend produces the
README images.

**Rejected.** A separate SVG chart library for docs; Playwright screenshots of the
web UI; hand-authored illustrations.

**Why.**

```
  ✓  the README hero cannot drift from the real artifact, because it IS the
     real artifact rendered through a different surface
  ✓  no browser binary to download (Playwright was explicitly out of scope
     for an offline build)
  ✓  no screenshot service, no network
  ✓  a change to the report updates every documentation image automatically
  ✓  CI catches a stale image
```

**Verified.** The drift guard was tested by corrupting the committed SVG; it fails
with `docs/assets/report-preview.svg is stale — run npm run assets`. And
`write-assets.ts` only writes when invoked as a CLI, so importing it from the test
cannot regenerate the file it is checking — which would mask staleness rather than
catch it.

**What would change our mind.** A need for interactive HTML charts with tooltips,
which SVG-through-`Surface` cannot express. Even then, the static path should
remain for the PDF.

---

## ADR-6

### Synthetic fixtures with planted ground truth

**Decision.** Ship four fixtures with real school names, real OSM parcel polygons,
and **synthetic pixel values**, disclosed by a persistent badge driven by fixture
metadata.

**Status: accepted, reluctantly.** This is the weakest part of the project and it
is labelled as such.

**Rejected.** Shipping no fixtures (no demo); shipping synthetic data undisclosed
(disqualifying); shipping a single hand-crafted array (proves nothing).

**Why.** Real rasters could not be fetched on the build machine. Given that, the
design choices that make synthetic data *useful* rather than merely present:

```
  1  THE GENERATOR EMITS DN, NOT DERIVED QUANTITIES
     reflectance and thermal digital numbers only — never NDVI, never
     temperature. the core derives everything exactly as it would from a
     real scene, so a fixture cannot conceal a bug in that chain.

  2  GROUND TRUTH IS PLANTED AND RECOVERY IS TESTED
     a known slope goes in; the pipeline is asserted to recover it inside
     the 95% CI it reports. 4/4 fixtures pass.

  3  NOISE σ IS DERIVED FROM A DECLARED TARGET R²
     σ = s·sqrt((1−R²)/R²), so fit quality is a STATED property rather than
     an accident of tuned constants.

  4  DISCLOSURE IS STRUCTURAL
     synthetic: true in metadata drives the badge. removing it requires
     editing data, not a template. a test asserts it is present.
```

**What would change our mind.** Network access. The `ImageryPort` boundary exists
precisely so this swap costs one adapter and zero model changes. Procedure is
written down in [DATA.md §6](DATA.md#6-swapping-in-real-imagery).

---

## ADR-7

### Per-fixture MTL constants, never global

**Decision.** `RADIANCE_MULT_BAND_10`, `RADIANCE_ADD_BAND_10`, `K1`, `K2` are read
from each scene's MTL metadata and committed into that fixture.

**Rejected.** Hardcoding Landsat 8 constants in `lst.ts`.

**Why.** They are per-scene. And `K1`/`K2` differ between spacecraft:

```
  SENSOR              K₁            K₂          BT at L=10
  ──────────────────────────────────────────────────────────
  Landsat 8       774.8853     1321.0789        302.79 K
  Landsat 9       799.0284     1329.2405        303.19 K
  ──────────────────────────────────────────────────────────
  a 0.4 K error from using the wrong spacecraft's constants —
  invisible, plausible, and wrong
```

Hardcoding also makes multi-sensor input impossible to answer for when asked.

**What would change our mind.** Nothing. Reading them is strictly correct and
costs one metadata field.

---

## ADR-8

### Unknown is `NaN` / `null`, never `0`

**Decision.** Unknown is `NaN` inside a raster (because `Float64Array` cannot hold
`null`) and `null` at a scalar boundary. Never `0`, never `Infinity`.

**Rejected.** Returning `0` for a zero-denominator NDVI; defaulting a masked
pixel's temperature to `0`; treating a missing cost as free.

**Why.** Zeros are not neutral in this domain — they systematically flatter the
product:

```
  QUANTITY          IF UNKNOWN → 0            BIAS DIRECTION
  ─────────────────────────────────────────────────────────────────────────
  NDVI              reads as bare ground      canopy % UNDERSTATED
  LST               reads as 0 °C             yard mean COLLAPSES
  canopy fraction   reads as fully paved      plan gain OVERSTATED
  cost line         reads as free             total UNDERSTATED
  coverage          reads as no cloud         gate NEVER FIRES
  ─────────────────────────────────────────────────────────────────────────
  every single one makes the intervention look better than it is
```

`canopyFraction` excludes unknowns from **both** numerator and denominator, so a
cloudy yard cannot report "0% canopy" with false confidence.

**What would change our mind.** Nothing. This is a correctness invariant, asserted
by tests that specifically check the result is neither `0` nor `Infinity`.

---

## ADR-9

### JSON tiles instead of GeoTIFF

**Decision.** Commit rasters as row-major JSON.

**Rejected.** GeoTIFF; Cloud-Optimized GeoTIFF; PNG-encoded bands; binary
`Float32Array` dumps.

**Why.**

```
  JSON                                    GEOTIFF
  ─────────────────────────────────────────────────────────────────────────
  ✓ no binary assets in the repo          ✗ opaque blobs in review
  ✓ diffable — a changed pixel shows      ✗ any change is an opaque rewrite
  ✓ readable without GDAL                 ✗ needs a geospatial stack
  ✓ Vite INLINES it into the bundle,      ✗ needs a fetch or a loader —
    which is what makes the demo work       breaking the offline guarantee
    with the cable pulled
  ✗ larger on disk                        ✓ compressed
  ✗ not a standard GIS format             ✓ opens in QGIS
  ─────────────────────────────────────────────────────────────────────────
```

The inlining property is decisive. It is why the web bundle is ~3 MB and why there
is no runtime fetch anywhere in the demo path.

**What would change our mind.** Fixtures large enough that bundle size becomes a
real load-time problem — a full scene rather than a 2 km window. At that point the
right answer is a COG adapter behind `ImageryPort`, not a different commit format.

---

## ADR-10

### Canvas map instead of MapLibre

**Decision.** Draw the raster, yard polygon, and crowns directly to a `<canvas>`.

**Rejected.** MapLibre GL; Leaflet; OpenLayers; deck.gl.

**Why.** The fixtures are already projected rasters in UTM metres held in memory.
There is nothing to fetch and no tile server to depend on.

```
  ✓  the offline guarantee becomes absolute — there is no code path that
     could reach for a tile
  ✓  removes a heavy dependency whose only job would be to display data we
     already hold
  ✓  full control of the thermal-grid overlay, which is a bespoke
     visualisation MapLibre would fight
  ✗  no pan/zoom, no basemap context
  ✗  no reprojection
```

The `BasemapPort` exists for the day a basemap is wanted, and it carries a
`requiresNetwork()` method so the UI can tell the user honestly.

**What would change our mind.** A need for aerial-photo context behind the raster
— which would genuinely help a facilities director orient — or multi-site
navigation across a district.

---

## ADR-11

### Deterministic quadrature instead of Monte Carlo

**Decision.** Crown union area by 0.5 m grid quadrature.

**Rejected.** Monte Carlo point sampling; an analytic circle-union algorithm.

**Why.** Determinism. A Monte Carlo estimate would make the report's numbers change
between renders of identical input, which breaks the golden snapshot test and,
much worse, means the PDF a school receives is not reproducible.

The analytic union of N overlapping circles is genuinely hard to implement
correctly; quadrature at 0.5 m gives under 1% area error at r ≈ 7 m and is a dozen
lines. It is validated against the exact two-circle lens formula.

```
  QUADRATURE           MONTE CARLO          ANALYTIC
  ─────────────────────────────────────────────────────────────
  deterministic  ✓     nondeterministic ✗   deterministic  ✓
  <1% error      ✓     converges slowly ~   exact          ✓
  ~12 lines      ✓     ~10 lines        ✓   ~200 lines     ✗
  ─────────────────────────────────────────────────────────────
```

**What would change our mind.** Plans with hundreds of trees, where 0.5 m
quadrature over a large bounding box becomes slow. The fix would be a coarser cell
with a documented error bound, not randomness.

---

## ADR-12

### Real Student-t quantile instead of 1.96

**Decision.** Compute `t(0.975, n−2)` via the regularised incomplete beta function
(Lentz continued fraction) with a Lanczos log-gamma.

**Rejected.** Hardcoding 1.96; a lookup table.

**Why.** At n = 400 the difference from 1.96 is negligible, so this buys almost
nothing numerically. It buys:

```
  ✓  a correct answer to "where does that interval come from?"
  ✓  correctness at small n — and sparse-coverage sites genuinely produce
     small n, which is exactly when the interval matters most
  ✓  no magic number in a statistical computation
```

Verified against published tables across three orders of magnitude of df, matching
to within 0.0004 at every point from df = 1 to df = 1000.

**What would change our mind.** Nothing. It is ~60 lines, fully tested, and
removes a question a statistician would otherwise ask.

---

## ADR-13

### Ship one region uncited on purpose

**Decision.** `portland-or.json` is fully cited and prints a total.
`maricopa-az.json` ships with zeroed prices and empty source fields, and prints
`cost not shown`.

**Rejected.** Filling Maricopa with plausible figures; shipping only Portland;
shipping neither.

**Why.** The uncited region is the demonstration. With both present, flipping one
control shows the same plan — identical canopy %, identical LST, identical ΔT —
going from an itemised cited total to a withheld one. Same code path, two data
states.

```
  ═══════════════════════════════════════════════════════════════════════════
   PORTLAND, OR                                     $8,544 – $11,328   ✓
   MARICOPA COUNTY, AZ    cost not shown — line items lack a cited source ⛔
  ═══════════════════════════════════════════════════════════════════════════
   identical plan · identical measurements · only citation state differs
```

Filling Maricopa in would destroy the most persuasive thing the cost model does,
and would require inventing figures — the one unrecoverable act in this project.

A test enforces it: if someone "fixes" the file with invented prices, the contrast
test fails and says why.

**Cost of this decision.** A Phoenix school — the actual location of all four
fixtures — cannot currently get a cost total. That is a real limitation and is
recorded as [L12](LIMITATIONS.md#l12--one-cost-region-is-deliberately-uncited).

**What would change our mind.** A real Maricopa County or Phoenix price sheet.
Then a *third* region would need to stay uncited to preserve the demonstration —
or better, the UI would carry an explicit "uncited example" toggle.

---

## ADR-14

### Two-parameter OLS instead of a larger model

**Decision.** Univariate `LST ~ NDVI`. Two parameters.

**Rejected.** Random forest; gradient boosting; a small MLP; a multivariate fit
with an impervious-surface term.

**Why.** There are ~400 observations per scene, all spatially autocorrelated. Any
model with meaningful capacity would fit noise. And its coefficients would not be
inspectable by the facilities director who has to act on the output.

```
                        interpretable   honest CI   auditable   safe at n=400
  ─────────────────────────────────────────────────────────────────────────
  OLS  (chosen)              ✓              ✓           ✓            ✓
  random forest              ~              ✗           ~            ~
  gradient boosting          ✗              ✗           ✗            ✗
  small MLP                  ✗              ✗           ✗            ✗
  ─────────────────────────────────────────────────────────────────────────
```

The value Canopy adds is not model capacity. It is refusing to answer when the
data cannot support an answer, and being fully auditable when it can.

**What would change our mind.** A multivariate fit adding an impervious-surface
proxy is the one worthwhile extension — but adopt it **only** if it improves
honest out-of-sample performance, and report the comparison either way. "We tried
it, it did not help, here is the number" is a stronger result than a silent
upgrade.

---

## ADR-15

### Absolute yard area instead of a parcel fraction

**Decision.** Derive the recess yard toward an absolute 9,000 m² target, capped at
45% of the parcel.

**Rejected.** A fixed fraction of the parcel (an earlier version used 55%).

**Why.** The parcel-fraction approach produced a 30,420 m² "yard" for cactus-wren
— an entire campus minus buildings. Since yard area is the denominator of canopy %
and therefore of `ΔNDVI_yard`, **this scaled the headline temperature number by
roughly 3×.**

A recess yard does not scale with the parcel. A 5-hectare campus and a 2-hectare
campus both give children roughly a field plus a hardcourt; the rest goes to
buildings, bus loop, staff parking, and frontage.

```
  BEFORE (55% of parcel)          AFTER (absolute 9,000 m²)
  ──────────────────────────────────────────────────────────────
  yard      30,420 m²             yard       9,000 m²
  canopy     ~4% → ~9%            canopy     9.0% → 24.2%
  ΔT        −0.51 °C              ΔT        −1.74 °C
  ──────────────────────────────────────────────────────────────
  the "after" figures are not better because they are larger — they are
  correct because the denominator is now a recess yard rather than a campus
```

**The figure was chosen to match a typical elementary recess yard, not chosen to
make ΔT land anywhere in particular.** That distinction matters, and inverting it
would be fitting to a desired answer.

**What would change our mind.** Real building footprints, which would remove the
need for a target area entirely. Query is in [DATA.md §6](DATA.md#6-swapping-in-real-imagery).

---

## ADR-16

### Delete unreachable code instead of testing it

**Decision.** `lnGamma`'s reflection branch for `z < 0.5` was deleted rather than
covered.

**Why.** Its only callers pass `df/2`, `0.5`, or their sum, and `tCritical`
rejects `df ≤ 0`. So `z` is never below 0.5 and the branch was unreachable.

The options were:

```
  1  write a test that calls lnGamma directly to hit the branch
     → tests a code path no caller can reach. coverage theatre.
  2  add an istanbul-ignore comment
     → hides it rather than resolving it
  3  DELETE it
     → the function now does exactly what its callers need, and 100%
       coverage means 100% of reachable behaviour
```

**What would change our mind.** A caller that legitimately needs `Γ(z)` for
`z < 0.5`. Then the branch comes back **with** a test, because it would be
reachable.

**Related.** Branch-coverage thresholds are set to the honestly achieved figures
(94% model, 98% raster) rather than to 100%, with the shortfall documented: the
remaining branches are floating-point underflow guards in the incomplete-beta
continued fraction that only fire on denormals. Faking a test for those would be
worse than stating the real number.

---

## ADR-17

### Clean compiled artifacts before test and build

**Decision.** `tools/scripts/clean.sh`, wired as `pretest` and `prebuild`.

**Why.** If `tsc` is ever run in place, `.js` / `.d.ts` / `.map` accumulate beside
the `.ts` they came from — and **Vitest resolves the stale `.js` in preference to
the `.ts`.** A suite can therefore execute month-old compiled output and pass.

```
  OBSERVED FAILURE MODE

    tools/ingest/src/loadFixtures.ts   reads 'yard.json'      (current)
    tools/ingest/src/loadFixtures.js   reads 'yard.geojson'   (stale)

    → 23 tests failing with ENOENT on a filename that no longer exists
      in the source. deleting the artifacts fixed it with zero source
      changes.
```

Reproduced deliberately by planting a stale `loadFixtures.js`: 5 tests broke
instantly with `STALE ARTIFACT WAS EXECUTED`; `npm run clean` removed it and all
17 passed.

These files are gitignored, so a fresh clone is unaffected — **which is exactly
why the failure is invisible without the guard.** A tree that has built in place
is silently poisoned while CI stays green.

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  A test that passes only because it executed last month's compiled       │
  │  output is worse than a failing test.                                    │
  └──────────────────────────────────────────────────────────────────────────┘
```

**What would change our mind.** Moving to a build system that never emits beside
sources (`outDir` enforced everywhere, or Bazel-style sandboxing). The clean step
would then be redundant — but it costs ~20 lines and one second, so it would
likely stay as a belt-and-braces measure.

---

## Decisions deliberately deferred

Recorded so the absence is intentional rather than an oversight.

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  SPATIAL ERROR MODEL                                    highest value    │
  │  Moran's I on residuals, then HAC standard errors. Addresses the         │
  │  model's least conservative assumption — that pixels are independent.    │
  │  Pure math, fully testable, no network. This is the next thing to build. │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  REAL IMAGERY INGEST                                                     │
  │  Sentinel-2 L2A + Landsat C2 L2 via STAC. The port boundary exists.      │
  │  Needs network.                                                          │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  VALIDATION AGAINST USGS LEVEL-2 ST                                      │
  │  An independent check on the whole 4-step LST derivation, using a         │
  │  product that ships in the SAME STAC item. Needs network. If agreement    │
  │  is poor, report it honestly — do not tune the derivation to match.       │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  BUILDING-FOOTPRINT YARD POLYGONS                                        │
  │  Removes the centroid-inset approximation. Overpass query is written      │
  │  down in DATA.md.                                                        │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  CITED CROWN RADII                                                       │
  │  A municipal or extension species list, replacing the UNVERIFIED         │
  │  nominal figures. Radius enters squared, so this matters more than it     │
  │  looks.                                                                  │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  MULTI-DATE COMPOSITING                                                  │
  │  Median over a season's cloud-free scenes. Replaces one weather day       │
  │  with a seasonal summary and legitimately tightens the fit.               │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  DISTRICT BATCH MODE                                                     │
  │  Rank sites by predicted cooling per dollar. Suppressed sites MUST be     │
  │  listed as "insufficient evidence" — never dropped, never ranked last.    │
  │  Silent omission would convert a data limitation into a funding           │
  │  decision.                                                               │
  └──────────────────────────────────────────────────────────────────────────┘
```

---

## See also

- [METHOD.md](METHOD.md) — the science these decisions implement
- [ARCHITECTURE.md](ARCHITECTURE.md) — the structure they produce
- [LIMITATIONS.md](LIMITATIONS.md) — what they do not solve
- [MODEL-CARD.md](MODEL-CARD.md) — the model in card form
- [DATA.md](DATA.md) — provenance and the swap procedure
