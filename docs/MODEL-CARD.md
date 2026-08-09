# MODEL CARD — Canopy ΔLST predictor

A model card in the sense of Mitchell et al., adapted for a per-scene
ordinary-least-squares estimator rather than a trained neural network.

**Read this before quoting any number Canopy produces.**

---

## At a glance

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  MODEL          univariate OLS, LST ~ NDVI, refitted per scene           │
  │  PREDICTS       change in yard-mean land surface temperature after a      │
  │                 proposed tree-planting plan                               │
  │  OUTPUT         a °C interval, or an explicit refusal                     │
  │  TRAINED ON     the pixels of the scene being analysed. Nothing else.     │
  │  N              ~400 cloud-free thermal cells per scene                   │
  │  PARAMETERS     2  (slope, intercept)                                     │
  │  TRAINING TIME  single-pass closed form, sub-millisecond                  │
  │  VERSION        1.0                                                       │
  │  DATE           2026-08-09                                                │
  │  LICENSE        MIT                                                       │
  └──────────────────────────────────────────────────────────────────────────┘
```

### Why a two-parameter model is the right choice here

A deep model would be indefensible for this task, not impressive. There are
roughly 400 observations per scene, all spatially autocorrelated. Any model with
meaningful capacity would fit the noise, and — critically — its coefficients
would not be inspectable by the facilities director who has to act on the output.

The value Canopy adds is not model capacity. It is *refusing to answer when the
data cannot support an answer*, and being fully auditable when it does. A
two-parameter linear fit with a real confidence interval and three hard gates
serves that far better than an opaque one that always produces a number.

```
  MODEL CHOICE TRADEOFF

                        interpretable   honest CI   auditable   n=400 safe
  ─────────────────────────────────────────────────────────────────────────
  OLS  (chosen)              ✓              ✓           ✓           ✓
  random forest              ~              ✗           ~           ~
  gradient boosting          ✗              ✗           ✗           ✗
  small MLP                  ✗              ✗           ✗           ✗
  literature constant        ✓              ✗           ✗           ✓
  ─────────────────────────────────────────────────────────────────────────
  the literature constant row is the conventional approach. it is
  interpretable and safe at any n, but has no honest interval and
  cannot be audited against the site it is applied to.
```

---

## 1. Intended use

### Primary use

Producing a costed, cited, one-page shade plan for **one named schoolyard**, at a
scale a facilities office can act on. The output is a document, not a dashboard.

### Intended users

```
  USER                          USE                              NEEDS
  ─────────────────────────────────────────────────────────────────────────
  student / advocate            makes the case to a principal     legibility
  school facilities office      scopes and budgets the work       citations
  district sustainability lead  ranks sites across a portfolio    comparability
  municipal urban forestry      cross-checks a request            method detail
  ─────────────────────────────────────────────────────────────────────────
```

### Out-of-scope uses

```
  ✗  Regulatory compliance or permitting. Not a certified thermal survey.
  ✗  Air-temperature or heat-index prediction. LST is a surface quantity.
  ✗  Per-tree siting decisions on thermal grounds. Resolution forbids it.
  ✗  Health-outcome estimation. No exposure or physiological model exists here.
  ✗  Carbon accounting. Canopy measures shade, not sequestration.
  ✗  Property valuation.
  ✗  Any use where the SYNTHETIC fixture disclosure has been stripped.
```

---

## 2. What the model predicts

```
      ΔLST  =  β₁ · ΔNDVI_yard
```

`β₁` is fitted per scene. `ΔNDVI_yard` is derived from the proposed plan's crown
geometry and this scene's own measured NDVI contrast between shaded and open
ground.

The prediction interval scales the slope interval through the same
multiplication:

```
      CI₉₅(ΔLST)  =  [ β₁_lo · ΔNDVI_yard ,  β₁_hi · ΔNDVI_yard ]
```

### Units and framing

```
  QUANTITY         UNIT     FRAMING
  ─────────────────────────────────────────────────────────────────────────
  ΔLST             °C       change in YARD-MEAN LAND SURFACE temperature
                            at ~10:30 local overpass
                            at ~15-year crown maturity
                            ASSOCIATED WITH the modelled canopy gain
  ─────────────────────────────────────────────────────────────────────────
  never: air temperature · never: per-tree · never: peak afternoon
  never: "will cause"
```

---

## 3. Training data

**The model is trained on the scene it is asked about, and nothing else.** There
is no pretrained checkpoint, no transfer, no external corpus.

```
  FEATURE   NDVI    resampled from Sentinel-2 10 m onto the 100 m thermal grid
                    by area-weighted averaging
  TARGET    LST     derived from Landsat Band 10 via the four-step chain
  UNIT      one cloud-free thermal cell in the ~2 km neighbourhood extent
  N         ~400    per scene
  SPLIT     none    the fit is descriptive of this scene, not predictive
                    across scenes — see §7 for why this matters
```

### Actual training sets, per shipped fixture

```
  SCHOOL          n     NDVI RANGE       LST RANGE °C     EXCLUDED (cloud)
  ─────────────────────────────────────────────────────────────────────────
  cactus-wren    400    0.0953–0.2013    42.96–45.18            0
  dos-rios       395    0.1082–0.2137    42.12–44.19            5
  john-jacobs    400    —                —                      0
  sunridge       400    —                —                      0
  ─────────────────────────────────────────────────────────────────────────
  from: npx vite-node tools/ingest/src/diagnose.ts
```

### ⚠ The shipped pixel values are SYNTHETIC

This is the most important disclosure on this page.

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  REAL                                                                    │
  │    school names, cities                                                  │
  │    parcel polygons — OpenStreetMap, ODbL, retrieved 2026-08-05           │
  │      cactus-wren way 121203200 · dos-rios way 152752071                  │
  │      john-jacobs way 121870035 · sunridge way 66166058                   │
  │    UTM projection (EPSG:32612), planar areas                             │
  │    Portland cost figures — City of Portland Title 11 fee schedule        │
  │                                                                          │
  │  DERIVED, LABELLED AS APPROXIMATION                                      │
  │    the recess-yard sub-polygon — a centroid inset of the real parcel,     │
  │    because building footprints are not available offline                  │
  │                                                                          │
  │  SYNTHETIC                                                               │
  │    every pixel value. Generated by @canopy/fixtures-synth with a fixed    │
  │    seed, calibrated to realistic per-region ground truth.                 │
  └──────────────────────────────────────────────────────────────────────────┘
```

Every generated report carries a **SYNTHETIC IMAGERY** badge, driven by
`SchoolMeta.synthetic` in the fixture metadata rather than by a template
decision. It cannot be omitted by forgetting.

**What the synthetic fixtures do and do not prove:**

```
  DOES PROVE                              DOES NOT PROVE
  ─────────────────────────────────────────────────────────────────────────
  the NDVI chain is correct               anything about real Phoenix yards
  the LST chain is correct                any real cooling magnitude
  resampling is area-weighted             that R² would be 0.73 on real data
  the fit recovers a known slope          that these schools need trees
  the gates fire when they should
  the whole pipeline is deterministic
  ─────────────────────────────────────────────────────────────────────────
```

The generator emits **reflectance and thermal digital numbers** — never NDVI,
never temperature. So the core derives every displayed quantity exactly as it
would from a real scene, and a fixture cannot mask a bug in that chain. Ground
truth is planted as a target slope, and the pipeline is checked for recovering it
(§6).

Swapping in real imagery is an `ImageryPort` adapter change. No model code moves.
See [DATA.md](DATA.md).

---

## 4. Functional form, in full

```
  ┌─ FEATURE CONSTRUCTION ───────────────────────────────────────────────────┐
  │  NDVI      = (NIR − RED) / (NIR + RED)          per 10 m pixel           │
  │  NDVI₁₀₀   = area-weighted mean of NDVI         per 100 m thermal cell   │
  └──────────────────────────────────────────────────────────────────────────┘
                                    │
  ┌─ TARGET CONSTRUCTION ────────────────────────────────────────────────────┐
  │  L_λ  = M_L · Q_cal + A_L                       MTL per-scene constants  │
  │  BT   = K₂ / ln(K₁/L_λ + 1)                     KELVIN                   │
  │  P_v  = ((NDVI − 0.2)/0.3)²                     clamped [0,1]            │
  │  ε    = 0.004·P_v + 0.986                                                │
  │  LST  = BT / (1 + (λ·BT/ρ)·ln ε) − 273.15       °C at the very end       │
  └──────────────────────────────────────────────────────────────────────────┘
                                    │
  ┌─ FIT ────────────────────────────────────────────────────────────────────┐
  │  β₁ = Σ(x−x̄)(y−ȳ) / Σ(x−x̄)²                                             │
  │  β₀ = ȳ − β₁x̄                                                           │
  │  R² = 1 − RSS/TSS                               NaN if TSS = 0           │
  │  SE = sqrt( (RSS/(n−2)) / Σ(x−x̄)² )                                     │
  │  CI = β₁ ± t(0.975, n−2)·SE                     real Student-t quantile  │
  └──────────────────────────────────────────────────────────────────────────┘
                                    │
  ┌─ PREDICTION ─────────────────────────────────────────────────────────────┐
  │  ΔNDVI_yard = (effective_new_shade / yard_area)                          │
  │               × (mean NDVI canopy − mean NDVI open)                      │
  │  ΔLST       = β₁ · ΔNDVI_yard                                            │
  └──────────────────────────────────────────────────────────────────────────┘
```

Every step is a pure function with unit tests. Full derivation and the anchor
values in [METHOD.md](METHOD.md).

---

## 5. The three refusal conditions

**This is the defining behaviour of the model.** It is enforced by a
discriminated union, so no renderer can bypass it.

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  1  INSUFFICIENT COVERAGE            threshold: coverage < 0.80          │
  │                                                                          │
  │     Fewer than 80% of the yard's thermal cells are cloud-free.            │
  │     → ΔT withheld entirely. Canopy % and cost still reported.             │
  │     → checked FIRST, before fit quality                                   │
  │     Rationale: the fit may be excellent while this yard's own             │
  │     measurement is untrustworthy. The deeper problem wins.                │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  2  LOW R²                           threshold: R² < 0.30                │
  │                                                                          │
  │     The local canopy–temperature relationship is not resolvable.          │
  │     → ΔT withheld. Canopy % and cost still reported.                      │
  │     → 0.30 ≤ R² < 0.50 shows ΔT flagged INDICATIVE rather than            │
  │       withholding it                                                      │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  3  NO FIT                           n < 3, or zero variance in x,       │
  │                                      or non-finite slope                 │
  │                                                                          │
  │     No regression could be fitted at all.                                 │
  │     → ΔT withheld. Never a zero, never a default.                         │
  └──────────────────────────────────────────────────────────────────────────┘
```

Plus a fourth refusal in the cost model, same philosophy:

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  4  UNCITED COST LINE       any line missing source_name, source_url,    │
  │                             or source_retrieved                          │
  │     → that line reads UNSOURCED, is excluded from the total, and the      │
  │       headline total is withheld entirely                                 │
  └──────────────────────────────────────────────────────────────────────────┘
```

### Type-level enforcement

```ts
export type Prediction =
  | { kind: 'ok';         deltaC: number; ci95: readonly [number, number]; fit: Fit }
  | { kind: 'weak';       deltaC: number; ci95: readonly [number, number];
                          fit: Fit; caveat: string }
  | { kind: 'suppressed'; reason: 'low_r2' | 'insufficient_coverage' | 'no_fit';
                          fit: Fit | null; explanation: string };
```

`deltaC` does not exist on the suppressed variant. Reading a temperature without
narrowing on `kind` **does not compile.**

### What the user sees when it fires

Not a blank space and not an error dialog. The refusal takes the number's visual
slot at the same weight, with the reason beside it:

```
  ┌─ PREDICTED TEMPERATURE CHANGE ───────────────────────────────────────────┐
  │                                                                          │
  │   WITHHELD                                                               │
  │                                                                          │
  │   CLOUD COVER OVER THIS YARD                                             │
  │   Only 50.0% of this yard has cloud-free pixels (80% required).           │
  │   No temperature change is reported for this site.                        │
  │                                                                          │
  │   ✓ STILL REPORTED                                                        │
  │     Canopy 11.6% → 26.4%, measured LST 42.6 °C, full costed plan.          │
  └──────────────────────────────────────────────────────────────────────────┘
```

Hiding the field would read as a bug. This reads as a decision.

---

## 6. Evaluation

### Ground-truth recovery

Because the fixtures are synthetic with a planted slope, the whole pipeline can be
checked: does the regression recover the value that was put in?

```
  SCHOOL          PLANTED β₁   RECOVERED β₁   95% CI              INSIDE?  R²
  ─────────────────────────────────────────────────────────────────────────────
  cactus-wren       −15.40       −15.93      [−16.88, −14.98]       ✓     0.730
  dos-rios          −14.60       −14.99      [−15.94, −14.03]       ✓     0.708
  john-jacobs       −13.10       −13.16      [−14.18, −12.14]       ✓     0.618
  sunridge          −11.80       −12.26      [−13.33, −11.18]       ✓     0.557
  ─────────────────────────────────────────────────────────────────────────────
  4/4 planted values fall inside the reported interval
  asserted by packages/core/test/guards.test.ts
```

This validates the NDVI chain, the LST chain, the resampling, and the fit
simultaneously — because the generator never computes any of them.

### Declared vs realised R²

Fixture noise σ is derived from a declared target R², so fit quality is a stated
property rather than an accident of hand-tuned constants:

```
  SCHOOL          TARGET R²   REALISED R²   |Δ|
  ────────────────────────────────────────────────
  cactus-wren        0.72        0.730      0.010
  dos-rios           0.68        0.708      0.028
  john-jacobs        0.63        0.618      0.012
  sunridge           0.55        0.557      0.007
  ────────────────────────────────────────────────
  all within the 0.12 tolerance asserted by test
```

### Known-value tests on every stage

```
  STAGE                    INPUT                    EXPECTED    STATUS
  ─────────────────────────────────────────────────────────────────────
  ndvi                     NIR 0.5, RED 0.1         0.6667        ✓
  ndvi                     NIR 0.3, RED 0.3         0.0           ✓
  ndvi                     NIR 0.0, RED 0.0         null          ✓
  toRadiance               10000, 3.342e-4, 0.1     3.442         ✓
  toBrightnessTempK        L=10, Landsat 8          302.79 K      ✓
  proportionVegetation     NDVI 0.35                0.25          ✓
  emissivity               P_v 0.25                 0.987         ✓
  lstCelsius               302.79 K, ε 0.987        30.56 °C      ✓
  tCritical                df 1..1000               t-tables      ✓
  circle union             quadrature vs lens       < 1% error    ✓
  ─────────────────────────────────────────────────────────────────────
```

### Test and coverage summary

```
  MODULE                        LINES    BRANCH    MODULES   
  ─────────────────────────────────────────────────────────────────
  core/src/raster    ████████████ 100%    98.14%      6
  core/src/model     ████████████ 100%    94.01%      5
  core/src           ████████████ 100%   100.00%      2
  core/src/geo       ████████████ 100%    66.66%      1
  core/src/report    ███████████░ 99.49%  71.79%      1
  render/src         ███████████░ 92.49%  65.43%      4
  ─────────────────────────────────────────────────────────────────
  ALL FILES          ███████████░ 97.65%  88.65%
  ─────────────────────────────────────────────────────────────────
  207 tests · 8 files · 0 runtime dependencies · 0 network calls in core
```

### What is NOT evaluated

Stated because its absence matters:

```
  ✗  No out-of-sample validation. The fit is descriptive of one scene, so
     there is no held-out set in the usual sense. k-fold CV on spatially
     autocorrelated pixels would report optimistic scores, not honest ones.
     → see §7.
  ✗  No validation against ground thermometry. No in-situ measurements exist
     for these sites.
  ✗  No validation against USGS Level-2 ST product. Would require network
     access to fetch a real scene; the ImageryPort boundary is where that
     would attach.
  ✗  No temporal validation. Single-date imagery per site.
  ✗  No cross-climate validation. All four fixtures are Phoenix.
```

---

## 7. Assumptions

Each with its failure mode.

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  A1  NDVI is a usable proxy for canopy presence                          │
  │      FAILS WHEN  irrigated turf exceeds the threshold                    │
  │      MITIGATION  per-site hand-validated threshold, printed in report    │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  A2  the LST~NDVI relationship is locally linear over the observed range │
  │      FAILS WHEN  extrapolating far beyond the scene's NDVI range         │
  │      MITIGATION  ΔNDVI derived from measured on-site contrast, so the    │
  │                  prediction stays near the fitted range                  │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  A3  the neighbourhood fit applies to the yard within it                 │
  │      FAILS WHEN  the yard's materials differ sharply from surroundings   │
  │      MITIGATION  none. Stated as a limitation.                           │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  A4  new crowns shade previously unshaded ground                         │
  │      FAILS WHEN  trees are placed over existing canopy                   │
  │      MITIGATION  effective area scaled by unshaded fraction; placement   │
  │                  algorithm targets hot unshaded pixels                   │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  A5  crowns reach nominal radius at ~15 years                            │
  │      FAILS WHEN  species, water, or soil differ from the nominal class   │
  │      MITIGATION  radii marked UNVERIFIED; horizon always labelled        │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  A6  a cloud-free cell is representative of the yard                     │
  │      FAILS WHEN  coverage is marginal                                    │
  │      MITIGATION  GATE 1 at 80%                                           │
  ├──────────────────────────────────────────────────────────────────────────┤
  │  A7  pixels are independent observations                                 │
  │      FAILS       always. Adjacent pixels are spatially autocorrelated.   │
  │      CONSEQUENCE the 95% CI is NARROWER than a spatially-aware interval  │
  │                  would be. This is the model's least conservative        │
  │                  property and it is disclosed rather than corrected.     │
  └──────────────────────────────────────────────────────────────────────────┘
```

**A7 deserves emphasis.** Ordinary least squares assumes independent errors.
Thermal pixels 100 m apart are not independent — a hot parking lot spans several
cells. The effective sample size is therefore smaller than n = 400, and the true
interval is wider than the one reported.

Canopy does not currently correct for this. The honest framing is: **the reported
interval is a lower bound on the true uncertainty.** A spatial error model
(Moran's I diagnostic, or a Conley/HAC standard error) is the correct next step
and is recorded as future work in [DECISIONS.md](DECISIONS.md).

---

## 8. Ethical considerations and fairness

### Heat is not distributed evenly

Urban heat correlates with historical disinvestment. Low-canopy schoolyards are
disproportionately in lower-income neighbourhoods, so a tool that scores sites by
predicted cooling will tend to rank those sites highest — which is the intended
direction, but it should be stated rather than discovered.

### The refusal has a distributional consequence

```
  ⚠  Sites with persistent cloud cover, or with thermal relationships the model
     cannot resolve, receive NO temperature estimate.

     If cloud cover correlates with geography — coastal, high-latitude, monsoon
     regions — then those sites are systematically under-served by this tool
     relative to arid ones.

     A site that is refused must never be interpreted as a site that does not
     need trees. Canopy reports "insufficient evidence," which is a statement
     about the imagery, not about the schoolyard.
```

Any batch or ranking feature must list refused sites explicitly as *insufficient
evidence* — never drop them silently and never rank them last. Silent omission
would convert a data limitation into a funding decision.

### Costs are regional and one region is uncited

The Portland figures do not transfer to Phoenix. Maricopa ships uncited on
purpose, and the UI states it is deliberately uncited rather than broken. Someone
using Portland prices for an Arizona project would produce a wrong budget; the
region selector exists partly to make that substitution visible.

### Synthetic data must stay labelled

Stripping the SYNTHETIC badge to make a demo look stronger would convert an
honest engineering artifact into a fabricated claim about real schools. The badge
is driven by fixture metadata specifically so that removing it requires editing
the data, not the template.

---

## 9. Caveats and recommendations

### If you are quoting a Canopy number

```
  DO                                      DO NOT
  ─────────────────────────────────────────────────────────────────────────
  quote the interval, not the point       quote "−1.7 °C" bare
  say "surface temperature"               say "temperature" or "air temp"
  say "associated with"                   say "will reduce" or "causes"
  state the maturity horizon              imply planting-day effect
  state the overpass time                 imply peak afternoon
  state SYNTHETIC where it applies        present fixtures as observations
  report refusals as refusals             report them as zero or as N/A
  ─────────────────────────────────────────────────────────────────────────
```

### Recommended next work, in priority order

```
  1  spatial error model — Moran's I on residuals, then HAC standard errors.
     Addresses A7, the model's least conservative assumption.
  2  real imagery ingest — Sentinel-2 L2A + Landsat C2 L2 via STAC. The
     ImageryPort boundary already exists for this.
  3  validation against USGS Level-2 ST — an independent check on the whole
     four-step LST derivation. Requires network.
  4  building-footprint yard polygons — replaces the centroid-inset
     approximation with real geometry.
  5  cited crown radii — a municipal or extension species list, replacing the
     UNVERIFIED nominal figures.
  6  multi-date compositing — replaces single-scene weather with a seasonal
     summary.
  7  multivariate fit adding an impervious-surface proxy — adopt ONLY if it
     improves honest out-of-sample performance, and report the comparison
     either way.
```

---

## 10. Provenance and reproducibility

```
  CODE          github.com/skodityala/canopy            MIT
  MODEL         packages/core/src/model/regression.ts
                packages/core/src/model/prediction.ts
  FIXTURES      fixtures/schools/<slug>/                seeded, deterministic
  COSTS         packages/adapters/cost-local/data/
  DEPENDENCIES  0 runtime · 4 dev (typescript, vitest, coverage, @types/node)
  DETERMINISM   no Math.random, no Date.now in any computation path
  REPRODUCE     npm install && npm test && npm run report
```

Every figure in this card came from one of:

```
  npx vite-node tools/ingest/src/report.ts       per-school reports
  npx vite-node tools/ingest/src/diagnose.ts     fit diagnostics
  npm test                                       tests + coverage
```

No number in this document was written by hand.

---

## See also

- [METHOD.md](METHOD.md) — full derivations and every constant
- [LIMITATIONS.md](LIMITATIONS.md) — the complete limitation register
- [DATA.md](DATA.md) — fixture provenance and the real-imagery swap
- [ARCHITECTURE.md](ARCHITECTURE.md) — how the refusal is structurally enforced
- [DECISIONS.md](DECISIONS.md) — tradeoffs, with what would change our mind
