# METHOD

Every formula, constant, and threshold Canopy uses, with the reasoning for each
choice and the failure mode each guard exists to prevent.

This document is the citable science. If a number appears on screen or in a
generated report, its derivation is here.

---

## Contents

1. [Why this pipeline exists](#1-why-this-pipeline-exists)
2. [Sensor selection](#2-sensor-selection)
3. [NDVI](#3-ndvi)
4. [Land surface temperature](#4-land-surface-temperature)
5. [Cloud masking and the coverage gate](#5-cloud-masking-and-the-coverage-gate)
6. [Resampling across resolutions](#6-resampling-across-resolutions)
7. [The regression](#7-the-regression)
8. [Prediction and the fit-quality gate](#8-prediction-and-the-fit-quality-gate)
9. [Crown geometry](#9-crown-geometry)
10. [Cost and the citation gate](#10-cost-and-the-citation-gate)
11. [Unknown-value discipline](#11-unknown-value-discipline)
12. [Determinism](#12-determinism)
13. [Every constant, in one table](#13-every-constant-in-one-table)
14. [What this method does not claim](#14-what-this-method-does-not-claim)

---

## 1. Why this pipeline exists

A schoolyard in Phoenix reaches surface temperatures above 43 °C on a July
morning. Children stand on it at recess. Shade is the intervention, and the
decision-maker is a facilities office that needs a number, a cost, and a
citation — not a research finding.

The instrumentation to answer this is free and public. Sentinel-2 measures
vegetation at 10 m. Landsat measures thermal emission at 100 m. Both are
open data. What does not exist is the last mile: turning those rasters into
*this yard, this many trees, this much money, this much cooler.*

Canopy is that last mile. The method below is deliberately conservative at every
step, because the output is meant to survive contact with someone who has a
budget and a reason to doubt it.

### The design constraint that shapes everything

> **A number a skeptic can puncture is worse than no number.**

A facilities director who catches one fabricated figure discards the entire
document. So every quantity Canopy prints is either measured, derived from
measurement by a stated formula, or withheld. There is no fourth category, and
in particular there is no "reasonable estimate."

This is why the pipeline contains three gates that can each stop output entirely.
They are not error handling. They are the product.

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  THE THREE GATES                                                     │
  ├──────────────────────────────────────────────────────────────────────┤
  │                                                                      │
  │  GATE 1  coverage        cloud-free yard pixels ≥ 80%                │
  │          fails →         no temperature reported at all              │
  │          §5                                                          │
  │                                                                      │
  │  GATE 2  fit quality     R² ≥ 0.50 estimate · ≥ 0.30 indicative      │
  │          fails →         ΔT suppressed, canopy and cost still shown  │
  │          §8                                                          │
  │                                                                      │
  │  GATE 3  citation        every cost line has name + URL + date       │
  │          fails →         that line reads UNSOURCED, total withheld   │
  │          §10                                                         │
  │                                                                      │
  └──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Sensor selection

Two sensors, chosen for different reasons, with a resolution mismatch that is
disclosed rather than hidden.

```
  SENSOR              BANDS USED          NATIVE RES   ROLE IN CANOPY
  ──────────────────────────────────────────────────────────────────────────
  Sentinel-2 MSI      B4  red   665 nm        10 m     NDVI, canopy classing
                      B8  NIR   842 nm        10 m
  ──────────────────────────────────────────────────────────────────────────
  Landsat 8/9 TIRS    B10 thermal 10.9 µm    100 m     surface temperature
                      QA_PIXEL                30 m     cloud / cirrus mask
  ──────────────────────────────────────────────────────────────────────────
```

### Why Sentinel-2 for vegetation

A recess yard is roughly 95 m across. At 10 m that is about 90 pixels — enough
to resolve individual mature crowns and to distinguish a shaded strip from an
open field.

Landsat's 30 m optical bands would give about 10 pixels for the same yard. A
single tree would be a fraction of one pixel, and canopy percentage would be
dominated by mixed-pixel effects. The choice is not close.

```
  YARD SAMPLING BY SENSOR — 9,000 m² recess yard, ~95 m across

  Sentinel-2  10 m   ████████████████████████████████████████  ~90 px
  Landsat     30 m   ████                                      ~10 px
  Landsat    100 m   ▌                                          1–4 px

                     resolving a 7.5 m crown radius needs the top row
```

### Why Landsat for temperature

Because it is the only free thermal source. There is no 10 m thermal satellite
in open data. This is a hard constraint, not a preference, and it produces the
central limitation of the entire project: **temperature is measured at 100 m on
a yard that is 95 m wide.**

Canopy's response to that is §5 and §6 — report a yard-scale mean, always with
its pixel count, and never a per-tree figure. See [LIMITATIONS.md](LIMITATIONS.md)
for the full treatment.

---

## 3. NDVI

The Normalized Difference Vegetation Index. Healthy vegetation reflects strongly
in the near infrared and absorbs in the red; bare surfaces do neither. The
normalised ratio is therefore a robust vegetation signal that cancels much of
the variation in overall scene brightness.

```
                NIR − RED
      NDVI  =  ───────────
                NIR + RED
```

Implemented in [`packages/core/src/raster/ndvi.ts`](../packages/core/src/raster/ndvi.ts).

### Interpretation for a schoolyard

```
  NDVI RANGE     SURFACE                              TYPICAL SCHOOLYARD FEATURE
  ─────────────────────────────────────────────────────────────────────────────
  < 0.0          water, deep shadow                   shaded pavement, pond
  0.00 – 0.10    asphalt, concrete, roofing           parking, hardcourt, roof
  0.10 – 0.20    bare soil, dead turf, track          decomposed granite, track
  0.20 – 0.40    sparse grass, stressed lawn          unirrigated field
  0.40 – 0.60    healthy turf, shrubs                 irrigated field, hedges
  > 0.60         dense tree canopy                    mature shade tree  ◀── canopy
  ─────────────────────────────────────────────────────────────────────────────
```

### The canopy threshold is per-site, not global

A single hardcoded 0.60 would be wrong, and in a specific direction: in arid
climates, well-irrigated turf routinely exceeds 0.60. A global threshold would
count the soccer field as tree canopy and inflate existing cover, which in turn
*understates* how much a planting plan would add.

So each fixture carries its own hand-validated threshold and the reason for it.
The four shipped fixtures:

```
  SCHOOL          THRESHOLD   RATIONALE
  ────────────────────────────────────────────────────────────────────────────
  cactus-wren        0.66     raised above default — irrigated desert turf can
                              exceed 0.60 and would be miscounted as canopy
  dos-rios           0.63     same arid correction, validated for this yard
  john-jacobs        0.62     same arid correction, validated for this yard
  sunridge           0.60     standard default — mature shade trees separate
                              cleanly from turf in visible imagery
  ────────────────────────────────────────────────────────────────────────────
```

The chosen value is printed in every generated report. A reader who disagrees
with the threshold can see it and discount accordingly — which is the point.

### The zero-denominator case

When `NIR + RED == 0`, the expression is undefined. Three things could be
returned, and only one of them is honest:

```
  RETURN       CONSEQUENCE
  ──────────────────────────────────────────────────────────────────────────
  0            pixel counts as bare ground. Drags canopy % down silently.
               A no-data pixel becomes evidence of pavement.        ✗ WRONG
  Infinity     propagates through every downstream mean as NaN or
               Infinity, corrupting aggregates without saying why.  ✗ WRONG
  null         pixel is unknown. Excluded from both numerator and
               denominator of every aggregate.                      ✓ CORRECT
  ──────────────────────────────────────────────────────────────────────────
```

`ndvi()` returns `null`. This is asserted by a test that specifically checks it
is neither `0` nor `Infinity`, because those are the two mistakes a reasonable
implementation would make.

```ts
expect(ndvi(0, 0)).toBeNull();
expect(ndvi(0, 0)).not.toBe(0);
expect(ndvi(0, 0)).not.toBe(Infinity);
```

Inside a raster the same unknown is carried as `NaN`, because a `Float64Array`
cannot hold `null`. The boundary rule is in §11.

### Verified anchor values

```
  INPUT                    OUTPUT      NOTE
  ─────────────────────────────────────────────────────────────────
  NIR 0.5   RED 0.1        0.6667      dense canopy
  NIR 0.3   RED 0.3        0.0         no vegetation signal
  NIR 0.4   RED 0.0        +1.0        upper bound
  NIR 0.0   RED 0.4        −1.0        lower bound
  NIR 0.0   RED 0.0        null        unknown — NOT 0, NOT Infinity
  NIR 0.2   RED −0.2       null        denominator cancels
  NIR NaN   RED 0.1        null        non-finite input
  ─────────────────────────────────────────────────────────────────
```

---

## 4. Land surface temperature

Four steps from a raw Landsat Band 10 digital number to a surface temperature in
degrees Celsius. Each step is a separate pure function with its own tests,
because each has a distinct failure mode.

Implemented in [`packages/core/src/raster/lst.ts`](../packages/core/src/raster/lst.ts).

```
  ┌─────────┐   ┌──────────┐   ┌───────────┐   ┌────────────┐   ┌─────────┐
  │ DN      │──▶│ radiance │──▶│ brightness│──▶│ emissivity │──▶│ LST °C  │
  │ uint16  │   │ W/m²·sr  │   │ temp  K   │   │ from NDVI  │   │         │
  └─────────┘   └──────────┘   └───────────┘   └────────────┘   └─────────┘
     step 1        step 2          step 3          step 4
   MTL scaling   Planck inv.     Sobrino        emissivity
                                                correction
```

### Step 1 — digital number to spectral radiance

```
      L_λ  =  M_L · Q_cal  +  A_L
```

| Symbol | Meaning | Source |
|---|---|---|
| `Q_cal` | raw Band 10 pixel value (uint16) | the raster |
| `M_L` | `RADIANCE_MULT_BAND_10` | the scene's MTL metadata |
| `A_L` | `RADIANCE_ADD_BAND_10` | the scene's MTL metadata |

**These are per-scene and are never hardcoded.** They are parsed from the
`_MTL.txt` / `_MTL.json` that ships with every Landsat scene and committed into
the fixture alongside the raster. Hardcoding them would silently produce wrong
temperatures on any scene but the one they came from.

### Step 2 — radiance to at-sensor brightness temperature

The inverse Planck function, in **Kelvin**:

```
                    K₂
      BT  =  ─────────────────
              ln( K₁ / L_λ + 1 )
```

Thermal calibration constants, also read from MTL. They differ between
spacecraft, which is exactly why they are not constants in the source:

```
  SENSOR              K₁  (W·m⁻²·sr⁻¹·µm⁻¹)      K₂  (K)
  ──────────────────────────────────────────────────────────
  Landsat 8  Band 10        774.8853            1321.0789
  Landsat 9  Band 10        799.0284            1329.2405
  ──────────────────────────────────────────────────────────
  same radiance L = 10 → BT differs by ~0.4 K between them
```

Non-positive or non-finite radiance returns `NaN`, not a number. A saturated or
masked thermal pixel has no temperature, and inventing one would corrupt the
yard mean.

### Step 3 — emissivity from NDVI

Surfaces do not emit as perfect blackbodies. The correction uses the Sobrino
NDVI-threshold method, which estimates the vegetated fraction of a pixel and
interpolates emissivity between bare and vegetated endpoints.

Proportion of vegetation:

```
                ⎛  NDVI − NDVI_min  ⎞ ²
      P_v  =    ⎜ ───────────────── ⎟          clamped to [0, 1]
                ⎝ NDVI_max − NDVI_min ⎠
```

with `NDVI_min = 0.2`, `NDVI_max = 0.5`.

Emissivity:

```
      ε  =  0.004 · P_v  +  0.986
```

This yields `ε ∈ [0.986, 0.990]` — the standard narrow band for mixed urban
surfaces. The narrowness matters: emissivity is a second-order correction here,
worth a few tenths of a degree, and any implementation producing values outside
this range has a bug.

```
  P_v      ε        SURFACE
  ────────────────────────────────────────────
  0.00     0.9860   fully bare
  0.25     0.9870   sparse vegetation
  0.50     0.9880   mixed
  0.75     0.9890   mostly vegetated
  1.00     0.9900   fully vegetated
  ────────────────────────────────────────────
  monotonically non-decreasing in P_v — asserted by property test
```

### Step 4 — emissivity-corrected surface temperature

```
                          BT
      LST  =  ─────────────────────────────
               1  +  ( λ · BT / ρ ) · ln(ε)
```

| Symbol | Value | Meaning |
|---|---|---|
| `λ` | 10.895 µm → `10.895e-6` m | Band 10 centre wavelength |
| `ρ` | `1.438e-2` m·K | `h·c/σ` |

where `h` = Planck 6.626×10⁻³⁴ J·s, `c` = 2.998×10⁸ m/s, `σ` = Boltzmann
1.38×10⁻²³ J/K.

Since `ε < 1`, `ln(ε) < 0`, so the denominator is less than 1 and **LST is always
warmer than BT**. A result below brightness temperature indicates a sign error.
This is asserted by a test.

### ⚠ The Kelvin trap

**`BT` in step 4 must be in Kelvin.** Feeding Celsius produces a plausible-looking
wrong answer, which is the most dangerous kind.

Worked example with `L_λ = 10`, Landsat 8 constants, NDVI = 0.35:

```
  ┌──────────────────────────────────────────────────────────────────────┐
  │  CORRECT — Kelvin into step 4                                        │
  │                                                                      │
  │    BT  = 302.79 K                                                    │
  │    ε   = 0.987                                                       │
  │    LST = 302.79 / (1 + (10.895e-6 · 302.79 / 1.438e-2) · ln 0.987)    │
  │        = 303.71 K  =  30.56 °C                            ✓          │
  ├──────────────────────────────────────────────────────────────────────┤
  │  WRONG — Celsius into step 4                                         │
  │                                                                      │
  │    BT  = 29.64 °C   ← already converted, the mistake                  │
  │    LST = 29.64 / (1 + (10.895e-6 · 29.64 / 1.438e-2) · ln 0.987)      │
  │        = 29.65 °C                                         ✗          │
  ├──────────────────────────────────────────────────────────────────────┤
  │  The error is 0.91 °C. Both values are plausible summer               │
  │  temperatures. Nothing about the wrong one looks wrong.               │
  │  This is why it is a pinned unit test and not a code comment.         │
  └──────────────────────────────────────────────────────────────────────┘
```

The test asserts the correct value to 2 decimal places, computes the buggy value
alongside it, and asserts they differ by more than 0.5 °C — so the test fails if
anyone reintroduces the conversion in the wrong place.

Conversion to Celsius happens exactly once, at the very end, at the presentation
boundary.

### Verified anchor values

```
  FUNCTION                                    INPUT              EXPECTED
  ──────────────────────────────────────────────────────────────────────────
  toRadiance(dn, mult, add)                   10000, 3.342e-4,   3.442
                                              0.1
  toBrightnessTempK(L, K₁, K₂)   Landsat 8    10                 302.79 K
  proportionVegetation(ndvi)                  0.35               0.25
  emissivity(pv)                              0.25               0.987
  lstCelsius(btK, ε)                          302.79 K, 0.987    30.56 °C
  ──────────────────────────────────────────────────────────────────────────
```

---

## 5. Cloud masking and the coverage gate

A cloud between the sensor and the schoolyard means the sensor measured the
cloud, not the yard. Cloud tops are cold. An unmasked cloudy pixel therefore
drags the yard mean *down*, which for a heat-mitigation tool is the worst
possible direction — it would make a hot yard look survivable.

Implemented in [`packages/core/src/raster/mask.ts`](../packages/core/src/raster/mask.ts).

### QA_PIXEL bit assignments

Landsat Collection 2 ships a per-pixel quality band. Canopy treats six bits as
disqualifying:

```
  BIT   FLAG              MASKED?   WHY
  ─────────────────────────────────────────────────────────────────────────
   0    fill                 ✗      no data at all
   1    dilated cloud        ✗      cloud edge; thermal contamination likely
   2    cirrus               ✗      thin high cloud, cools the signal subtly
   3    cloud                ✗      opaque cloud
   4    cloud shadow         ✗      ground in shadow, not representative
   5    snow                 ✗      wrong surface entirely
   6+   confidence levels    ✓      quality metadata, not usability
  ─────────────────────────────────────────────────────────────────────────
```

A `NaN` QA value is masked. An unreadable quality flag is not evidence of a clear
sky.

### Cirrus deserves specific mention

Opaque cloud is obvious in imagery and a careless pipeline would still catch it
by eye. Cirrus is not: it is thin, often invisible in an RGB composite, and it
depresses thermal readings by a degree or two. That is the same order of
magnitude as the entire effect Canopy is trying to measure. Masking cirrus is
therefore not optional.

### The coverage gate

```
  REQUIRED_COVERAGE = 0.80
```

If fewer than 80% of the yard's thermal cells are cloud-free, **no temperature is
reported for that site.** Not a caveated temperature. Not a mean over whatever
survived. Nothing.

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │  GATE 1 — COVERAGE                                                     │
  │                                                                        │
  │   coverage = (cloud-free yard cells) / (total yard cells)               │
  │                                                                        │
  │   ≥ 0.80  ─────▶  proceed to the regression                            │
  │   < 0.80  ─────▶  Prediction { kind: 'suppressed',                      │
  │                                reason: 'insufficient_coverage' }        │
  │                                                                        │
  │   Canopy %, the planting plan, and the cost are STILL REPORTED.         │
  │   Those come from the optical bands and do not depend on the            │
  │   thermal scene. Only the temperature claim is withheld.                │
  └────────────────────────────────────────────────────────────────────────┘
```

The shipped `dos-rios` fixture exercises this path with 50% coverage. It is not
a synthetic edge case bolted on for a test — it is one of the four schools in the
demo, and the refusal is what a user sees when they select it.

### Why 80% and not another number

The threshold trades sample size against contamination risk. Below roughly 80%,
a yard that already contains only 1–4 thermal cells is being averaged from one or
two survivors, and the mean carries no meaningful spatial coverage of the site.
Above 80%, the remaining masked fraction is small enough that the surviving cells
still represent the yard.

The value is a judgement call, it is a single named constant, and it is stated on
screen whenever it fires. A reader who prefers 90% can see exactly what changed.

---

## 6. Resampling across resolutions

NDVI arrives at 10 m. Thermal arrives at 100 m. The regression pairs them, so one
must be moved onto the other's grid.

Implemented in [`packages/core/src/raster/resample.ts`](../packages/core/src/raster/resample.ts).

### Area-weighted, not nearest-neighbour

Each 100 m thermal cell covers 100 optical pixels. Nearest-neighbour resampling
picks *one* of those 100 to represent the cell, discarding 99% of the information
that determines the cell's actual vegetation content, and injecting sampling
noise directly into the regression that the entire temperature claim rests on.

```
  ONE 100 m THERMAL CELL, CONTAINING 100 OPTICAL PIXELS
  ═════════════════════════════════════════════════════════════════════

    optical NDVI at 10 m               nearest-neighbour     area-weighted
    ┌──┬──┬──┬──┬──┬──┬──┬──┬──┬──┐
    │.9│.9│.8│.1│.1│.1│.1│.1│.1│.1│    picks ONE cell:       mean of all 100:
    ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤
    │.9│.8│.8│.1│.1│.1│.1│.1│.1│.1│      0.90  or  0.10          0.31
    ├──┼──┼──┼──┼──┼──┼──┼──┼──┼──┤        ↑           ↑            ↑
    │.8│.8│.1│.1│.1│.1│.1│.1│.1│.1│     depends on   wildly     the real
    ├──┴──┴──┴──┴──┴──┴──┴──┴──┴──┤     grid phase   different  vegetation
    │        ... 70 more ...       │                             content
    └──────────────────────────────┘
                                        ✗ noise into the fit    ✓ signal
```

`resampleToGrid` computes the true geometric intersection area of every
contributing fine pixel with the coarse cell and weights by it. Partial overlaps
at the raster edge are weighted by their real overlap, so a coarse cell that
straddles the boundary is averaged over only the part that exists.

A coarse cell with no valid fine pixels becomes `NaN` — unknown, not zero.

### Yard cell selection uses area overlap too

A related problem, with the same resolution:

A 9,000 m² yard is about 95 m across. On a 100 m grid it may contain only **one**
cell centre while genuinely overlapping **three or four** cells. Selecting cells
by centre-containment would report "mean of 1 thermal pixel," which understates
the sampling and invites the obvious objection.

[`yardCells.ts`](../packages/core/src/raster/yardCells.ts) selects a cell when at
least **15%** of its area falls inside the yard, estimated by regular 8×8
sub-sampling — deterministic, and accurate to about 1/64 of a cell.

```
  YARD CELL SELECTION — 95 m yard on a 100 m grid

  centre containment              area overlap ≥ 15%
  ┌───────┬───────┬───────┐       ┌───────┬───────┬───────┐
  │       │       │       │       │       │▓▓▓▓▓▓▓│       │
  │       │   ●   │       │       │       │▓▓▓▓▓▓▓│       │
  ├───────┼───────┼───────┤       ├───────┼───────┼───────┤
  │       │░░░░░░░│       │       │▓▓▓▓▓▓▓│▓▓▓▓▓▓▓│▓▓▓▓▓▓▓│
  │   ●   │░░░●░░░│   ●   │       │▓▓▓▓▓▓▓│▓▓▓▓▓▓▓│▓▓▓▓▓▓▓│
  ├───────┼───────┼───────┤       ├───────┼───────┼───────┤
  │       │       │       │       │       │▓▓▓▓▓▓▓│       │
  │       │   ●   │       │       │       │▓▓▓▓▓▓▓│       │
  └───────┴───────┴───────┘       └───────┴───────┴───────┘
   1 cell selected                 3–4 cells selected
   "mean of 1 pixel"               honest spatial coverage
```

The 15% figure is a named constant, `MIN_CELL_OVERLAP`. Raising it toward 0.5
yields a tighter but smaller sample.

The fine optical grid still uses centre containment — at 10 m the centre test is
accurate enough and dramatically cheaper.

---

## 7. The regression

**This is the most important methodological decision in the project.**

### What we refused to do

The tempting move is to look up a published urban-cooling constant — "trees
reduce surface temperature by X °C" — and multiply.

Do not do this. Published figures vary by an order of magnitude across climates,
irrigation regimes, and background albedo. Any single borrowed constant is
indefensible the moment someone asks which study, which city, and why it applies
to Phoenix. Worse, it means the tool would produce the same answer for a desert
schoolyard and a Portland one.

### What we do instead

Fit the relationship on the school's own scene, live, every time.

```
      LST  =  β₀  +  β₁ · NDVI
```

over every cloud-free thermal cell in the committed neighbourhood extent
(roughly 2 km × 2 km around the site).

Then:

```
      ΔLST  ≈  β₁ · ΔNDVI_yard
```

The method is one sentence, it is checkable against the same public imagery, and
it is *this site's* relationship rather than a generic one.

Implemented in [`packages/core/src/model/regression.ts`](../packages/core/src/model/regression.ts).

### The real fit on the hero fixture

Computed live from `cactus-wren`. Every value below is from
`npx vite-node tools/ingest/src/diagnose.ts`.

```
  LST vs NDVI  ·  cactus-wren  ·  n = 400 cloud-free thermal cells
  density: . none   1 low   2   3   4 high      █ = fitted OLS line

  LST °C
   45.1 │.1.1....................
   44.9 │.221....................
   44.8 │1█432.111...............
   44.6 │222█32321.1.............
   44.5 │.1224█43.21..1..........
   44.3 │221144█3441122..........
   44.1 │....234█3344122.........
   44.0 │....21232█3332.2........
   43.8 │.....13.32█23241311..1..
   43.7 │..1......214█1322122....
   43.5 │...........11223█223212.
   43.4 │............12.222█3321.
   43.2 │.............111.1221█1.
   43.0 │...............1..1213.█
        └────┬─────┬─────┬─────┬─
           0.10  0.13  0.16  0.20        NDVI
  ─────────────────────────────────────────────────────────────────────
    β₁        = −15.93 °C per NDVI unit
    β₀        =  46.29 °C
    R²        =   0.730
    n         = 400 cells
    SE(β₁)    =   0.485
    95% CI    = [−16.88, −14.98]
  ─────────────────────────────────────────────────────────────────────
```

The negative slope is the physical expectation: more vegetation, cooler surface.
The CI excludes zero comfortably, so the relationship is resolvable at this site.

### Confidence interval from a real Student-t quantile

```
      CI₉₅(β₁)  =  β₁  ±  t(0.975, n−2) · SE(β₁)
```

`SE(β₁) = sqrt( MSE / Σ(x − x̄)² )`, and `MSE = RSS / (n − 2)`.

The critical value comes from an actual Student-t inverse CDF — implemented via
the regularised incomplete beta function with a Lentz continued fraction, and a
Lanczos log-gamma — not a hardcoded 1.96. At n = 400 the two nearly coincide, so
this buys almost nothing numerically. It buys a correct answer to "where does
that interval come from?", and it is right at small n, which matters because
sparse-coverage sites genuinely produce small n.

Verified against published t-tables across three orders of magnitude of df:

```
  df        COMPUTED    PUBLISHED   Δ
  ────────────────────────────────────────────
     1       12.7062     12.706     0.0002
     2        4.3027      4.303      0.0003
     3        3.1824      3.182      0.0004
     5        2.5706      2.571      0.0004
    10        2.2281      2.228      0.0001
    20        2.0860      2.086      0.0000
    30        2.0423      2.042      0.0003
    60        2.0003      2.000      0.0003
   120        1.9799      1.980      0.0001
  1000        1.9623      1.962      0.0003
  ────────────────────────────────────────────
  → 1.96 as df → ∞, as it must
```

### Degenerate inputs return NaN, never a confident slope

```
  INPUT CONDITION                      RETURNS
  ─────────────────────────────────────────────────────────────────────
  n < 3            no residual df      slope NaN, r2 NaN, CI [NaN, NaN]
  zero variance    in x                slope NaN — vertical relationship
  constant y       R² is 0/0           r2 NaN — model explains nothing
  perfectly        collinear           r2 exactly 1
  non-finite       pairs               dropped; surviving n reported
  ─────────────────────────────────────────────────────────────────────
```

Note the `constant y` row. A naive implementation returns `R² = 1` there, because
`1 − RSS/TSS` with `RSS = TSS = 0` looks perfect. It is undefined, and reporting
1 would let a completely uninformative fit sail through the quality gate.

### Ground-truth recovery

Because the shipped fixtures are synthetic with a *planted* slope, the pipeline
can be checked end-to-end: does the regression recover the value that was put in?

```
  SCHOOL          PLANTED β₁    RECOVERED β₁    95% CI              INSIDE?
  ──────────────────────────────────────────────────────────────────────────
  cactus-wren        −15.40        −15.93       [−16.88, −14.98]      ✓
  dos-rios           −14.60        −14.99       [−15.94, −14.03]      ✓
  john-jacobs        −13.10        −13.16       [−14.18, −12.14]      ✓
  sunridge           −11.80        −12.26       [−13.33, −11.18]      ✓
  ──────────────────────────────────────────────────────────────────────────
  every planted value falls inside the interval the method reports
  asserted by packages/core/test/guards.test.ts
```

This is a genuine end-to-end validation of the NDVI chain, the LST chain, the
resampling, and the fit — because the generator emits reflectance and thermal
digital numbers, never NDVI or temperature. See [DATA.md](DATA.md).

---

## 8. Prediction and the fit-quality gate

### The functional form

```
      ΔLST  =  β₁ · ΔNDVI_yard
```

and the interval scales through the same multiplication:

```
      CI₉₅(ΔLST)  =  [ β₁_lo · ΔNDVI_yard ,  β₁_hi · ΔNDVI_yard ]
```

sorted so `lo ≤ hi` even when `ΔNDVI` is negative — which happens if someone
models canopy *removal*, and should produce a warming prediction.

Implemented in [`packages/core/src/model/prediction.ts`](../packages/core/src/model/prediction.ts).

### Where ΔNDVI_yard comes from

Not a constant. Measured from this scene's own contrast between shaded and open
ground inside the yard:

```
      ΔNDVI_yard  =  (effective new shaded area / yard area)
                     × (mean NDVI of canopy pixels − mean NDVI of open pixels)
```

On `cactus-wren`: canopy pixels average NDVI 0.802, open pixels average 0.083. So
newly shaded ground is modelled as moving 0.719 NDVI units — a figure measured on
site, not assumed.

```
  MEASURED NDVI CONTRAST, PER FIXTURE

  SCHOOL          CANOPY    OPEN     CONTRAST   YARD MEAN
  ────────────────────────────────────────────────────────
  cactus-wren      0.802    0.083      0.719      0.148
  dos-rios         0.796    0.085      0.711      0.167
  john-jacobs      0.794    0.140      0.654      0.298
  sunridge         0.795    0.170      0.625      0.516
  ────────────────────────────────────────────────────────
  contrast narrows as a yard gets greener — as it must
```

### The gate

```
  R² RANGE           VERDICT        WHAT IS DISPLAYED
  ─────────────────────────────────────────────────────────────────────────
  ≥ 0.50             ESTIMATE       full ΔT with 95% CI
  0.30 – 0.50        INDICATIVE     ΔT shown, flagged "weak local fit"
  < 0.30             SUPPRESSED     ⛔ no number. Canopy % and cost still shown.
  ─────────────────────────────────────────────────────────────────────────
  coverage < 0.80    SUPPRESSED     checked FIRST — see §5
```

Coverage is evaluated before fit quality, deliberately. With a cloud-occluded
yard the neighbourhood fit may look excellent while the yard's own measurement is
untrustworthy. The more fundamental problem wins.

### The gate is type-enforced, not convention

```ts
export type Prediction =
  | { kind: 'ok';         deltaC: number; ci95: readonly [number, number]; fit: Fit }
  | { kind: 'weak';       deltaC: number; ci95: readonly [number, number];
                          fit: Fit; caveat: string }
  | { kind: 'suppressed'; reason: 'low_r2' | 'insufficient_coverage' | 'no_fit';
                          fit: Fit | null; explanation: string };
```

`deltaC` **does not exist** on the suppressed variant. Every renderer — the web
UI, the PDF, the SVG, the README image generator — must narrow on `kind` before
it can read a temperature. Forgetting to handle the refusal is a compile error,
not a runtime blank.

This is why the refusal is an architectural property rather than a demo trick.
There is no code path that prints an unsupported number, because such a path
would not typecheck.

### Live gate results

```
  SCHOOL          COVERAGE    R²      VERDICT       ΔT
  ─────────────────────────────────────────────────────────────────────
  cactus-wren      100.0%    0.730    ESTIMATE      −1.74 °C  [−1.84, −1.64]
  john-jacobs      100.0%    0.618    ESTIMATE      −1.11 °C  [−1.19, −1.02]
  sunridge         100.0%    0.557    ESTIMATE      −0.58 °C  [−0.63, −0.53]
  dos-rios          50.0%    0.708    SUPPRESSED    ⛔ withheld
  ─────────────────────────────────────────────────────────────────────
  dos-rios has a PERFECTLY GOOD fit (R² = 0.708) and is still refused.
  The fit describes the neighbourhood; the yard itself is half under cloud.
```

That last row is the most valuable one in the project. A tool that suppresses
only when its model is bad is ordinary. A tool that suppresses when its model is
*fine* but its input coverage is not is doing something harder.

### Language discipline

Every method label reads **"associated change"**, never "will cause" or "will
reduce." The fit is correlational. Vegetation and temperature co-vary across a
neighbourhood for reasons that include irrigation, building density, and
material albedo, not only shade.

This is enforced by test:

```ts
expect(label).toMatch(/associated/i);
expect(label).not.toMatch(/will cause|causes/i);
```

---

## 9. Crown geometry

Turning "12 trees" into an area of new shade.

Implemented in [`packages/core/src/model/canopy.ts`](../packages/core/src/model/canopy.ts).

### Crown area and union

```
      crown_area_i     =  π · r_i²

      new_canopy_area  =  area of the UNION of all crown circles

      canopy_pct_after =  (existing + effective_new) / yard_area × 100
```

The union is the hard part. Overlapping circles have no simple closed form for
three or more, so Canopy uses **deterministic grid quadrature at 0.5 m**.

### Why quadrature and not Monte Carlo

Determinism. A Monte Carlo estimate would make the report's numbers change
between renders of identical input, which breaks the golden snapshot test and,
far worse, means the PDF a facilities office receives is not reproducible.

0.5 m cells give under 1% area error at r ≈ 7 m, verified against the exact
two-circle lens formula:

```
      A_lens  =  r₁²(α₁ − ½sin 2α₁)  +  r₂²(α₂ − ½sin 2α₂)

      α₁ = arccos( (d² + r₁² − r₂²) / 2·d·r₁ )
      α₂ = arccos( (d² + r₂² − r₁²) / 2·d·r₂ )
```

The test compares quadrature against this analytic value and asserts relative
error < 1%.

### Overlap is measured, never assumed

A fixed "overlap factor" would be a fabricated number. Two trees 6 m apart with
5 m radii overlap substantially, and the map shows it — so the arithmetic must
agree with the picture.

```
  MEASURED OVERLAP ON THE SHIPPED 12-TREE PLANS

  SCHOOL          Σ CROWNS    UNION     OVERLAP   EFFECTIVE NEW SHADE
  ───────────────────────────────────────────────────────────────────
  cactus-wren      1630 m²    1503 m²     7.8%          1368 m²
  dos-rios         1630 m²    1504 m²     7.8%          1330 m²
  john-jacobs      1630 m²    1524 m²     6.5%          1156 m²
  sunridge         1630 m²    1532 m²     6.0%           683 m²
  ───────────────────────────────────────────────────────────────────
  union ≤ Σ crowns always — asserted as a property test
```

Note `sunridge`: identical crown area, identical overlap, but only 683 m² of
*effective* new shade against cactus-wren's 1368 m². Because it is already 55%
shaded, half the new crowns land on ground that is already in shade.

### Effective added canopy

Planting over an existing crown adds no new shade. The naive `existing + new`
would double-count, so new area is scaled by the unshaded fraction:

```
      effective_new  =  union_new  ×  (1 − existing_canopy_fraction)
```

This is a first-order correction and is labelled as such. A full treatment would
subtract the geometric intersection of new crowns with the existing canopy mask.

### Crown radii are UNVERIFIED and say so

```
  CLASS              RADIUS   MATURITY   STATUS
  ─────────────────────────────────────────────────────────────────────
  large_shade         7.5 m    15 yr     UNVERIFIED — nominal 7–9 m
  medium_shade        5.5 m    15 yr     UNVERIFIED — nominal 5–6 m
  small_ornamental    3.5 m    15 yr     UNVERIFIED — nominal 3–4 m
  ─────────────────────────────────────────────────────────────────────
```

These are nominal planting-class figures, **not** a cited municipal species list.
They carry `radiusStatus: 'unverified'` in the cost model and are surfaced as such.

Costs are now cited (§10); radii are not. Those are separate claims and only one
has been resolved. Conflating them would be exactly the sort of quiet overreach
this project exists to avoid.

### Maturity is disclosed

A 2-inch caliper tree does not have a 7.5 m crown on planting day. Every canopy
projection is labelled **"at ~15-year maturity."** The growth curve, when shown,
is:

```
      r(t)  =  r_mature  ×  ( 1 − e^(−2.5t/T) ) / ( 1 − e^(−2.5) )
```

monotonic, zero at t = 0, reaching `r_mature` at `t = T`.

---

## 10. Cost and the citation gate

### The rule

**Every cost line must carry a resolvable source.** An invented dollar figure is
the fastest way to lose a reader who has a budget, and it is precisely what they
will probe.

The gate is structural. `CostBreakdown.hasUnsourcedLines` is computed from the
data, and when it is true the headline total is not formatted at all:

```ts
if (b.hasUnsourcedLines) {
  return 'cost not shown — one or more line items lack a cited source';
}
```

A source counts as resolvable only with all three of:

```
  source_name       non-empty
  source_url        matches ^https?://\S+$
  source_retrieved  matches ^\d{4}-\d{2}-\d{2}$
```

### Two regions, deliberately asymmetric

This is the clearest demonstration in the product. Same code path, same plan,
two data states.

```
  ═══════════════════════════════════════════════════════════════════════════
   PORTLAND, OR                                              CITED  ✓
  ═══════════════════════════════════════════════════════════════════════════
   Large shade tree, 2" caliper, planted and established
     ×6      $4,272 – $5,664
     cite    City of Portland, Portland Parks & Recreation Urban Forestry —
             Title 11, Trees Fee Schedule, effective July 1, 2025
   Medium shade tree, 2" caliper, planted and established
     ×6      $4,272 – $5,664
     cite    (same schedule)
  ───────────────────────────────────────────────────────────────────────────
   TOTAL     $8,544 – $11,328
  ═══════════════════════════════════════════════════════════════════════════

  ═══════════════════════════════════════════════════════════════════════════
   MARICOPA COUNTY, AZ                                  UNCITED  ⛔
  ═══════════════════════════════════════════════════════════════════════════
   Large shade tree, 2" caliper, installed        ×6    UNSOURCED
   Medium shade tree, 2" caliper, installed       ×6    UNSOURCED
   Establishment watering, 3 years               ×12    UNSOURCED
   Mulch ring and watering basin                 ×12    UNSOURCED
  ───────────────────────────────────────────────────────────────────────────
   TOTAL     cost not shown — one or more line items lack a cited source
  ═══════════════════════════════════════════════════════════════════════════

   Identical plan. Identical measurements: canopy 9.0% → 24.2%,
   LST 43.9 °C, ΔT −1.74 °C. Only the citation state differs.
```

Maricopa's prices are zeroed **on purpose** and must stay that way. Its emptiness
demonstrates the gate. Filling it in with plausible figures would destroy the
most persuasive thing the cost model does.

### How the Portland figures were derived

The City of Portland publishes a *Planting and Establishment Fee in Lieu* — what
the City charges when a required tree is **not** planted on site. It is therefore
the City's own published valuation of planting and establishing one tree, which
is exactly the quantity needed.

Two figures are published, and both are used as the ends of a range with no
interpolation and no invented middle:

```
  PUBLISHED FIGURE                        USED AS
  ─────────────────────────────────────────────────────────────────────────
  $712.00 per on-site tree (flat)         LOW end, every class, verbatim
  $472.00 per dbh inch                    HIGH end, × caliper:
                                            2.0 in → $944.00
                                            1.5 in → $708.00
  ─────────────────────────────────────────────────────────────────────────
```

The 1.5-inch ornamental computes to $708.00, which is **below** the flat $712.00
per-tree figure the schedule already states. Rather than push a price below a
published number, its range collapses to $712–$712.

```
  ARITHMETIC CHECK — the 12-tree plan, 6 large + 6 medium, all 2" caliper

    low   = $712 × 12  =  $8,544      ← flat published per-tree figure
    high  = $944 × 12  = $11,328      ← $472/dbh-in × 2 in
```

Both ends are arithmetic on published numbers. Neither is an estimate.

### Three limitations recorded in the data file itself

```
  1  CALIPER IS NOT DBH
     Nursery caliper is measured 6 in above ground; dbh at 4.5 ft. For young
     2-inch stock they are close, but the high end is an approximation of the
     schedule's per-dbh-inch basis, not a figure the schedule states for
     caliper.

  2  ESTABLISHMENT IS BUNDLED
     The cited fee is "Planting AND Establishment." Watering and mulch are
     already inside it, so perTreeItemKeys is EMPTY for Portland. Adding
     separate establishment lines would bill the same work twice.
     → This is why Portland shows 2 lines and Maricopa shows 4.

  3  RADII REMAIN UNVERIFIED
     Costs are cited. Crown radii are not. Separate claims, one resolved.
```

### Ranges, not point estimates

Every line carries `low` and `high`. A cited range beats an uncited precise
number every time, and it is what an actual construction estimate looks like.

---

## 11. Unknown-value discipline

One rule, applied without exception:

```
  ┌────────────────────────────────────────────────────────────────────────┐
  │  Unknown is NaN inside a raster and null at a scalar boundary.         │
  │  Never 0. Never Infinity.                                              │
  └────────────────────────────────────────────────────────────────────────┘
```

`Float64Array` cannot hold `null`, so rasters use `NaN`. Scalars and function
returns use `null`, which is unambiguous and cannot be silently arithmetic'd.

### Why zero is the dangerous choice

```
  QUANTITY            IF UNKNOWN → 0                    CONSEQUENCE
  ─────────────────────────────────────────────────────────────────────────
  NDVI                pixel reads as bare ground        canopy % understated
  LST                 pixel reads as 0 °C               yard mean collapses
  canopy fraction     yard reads as fully paved         plan overstates gain
  cost line           line reads as free                total understated
  coverage            reads as no cloud                 gate never fires
  ─────────────────────────────────────────────────────────────────────────
  every single one biases the output in the direction that makes the
  intervention look better. that is the worst possible failure mode.
```

Zeros are not neutral. In this domain they systematically flatter the product.

### Propagation rules

```
  OPERATION                    UNKNOWN HANDLING
  ─────────────────────────────────────────────────────────────────────────
  ndviGrid                     NaN in → NaN out, per pixel
  classifyCanopy               NaN never classifies as canopy
  canopyFraction               NaN excluded from BOTH numerator and
                               denominator — so it cannot count as bare
  summarise / mean             NaN skipped; n reported alongside
  zero valid pixels            returns NaN with n = 0, never 0.0
  lstGrid                      NaN if either DN or NDVI is unknown
  resampleToGrid               coarse cell with no valid fine px → NaN
  olsFit                       non-finite pairs dropped, surviving n reported
  costPlan                     unknown item key → NaN totals + unsourced flag
  ─────────────────────────────────────────────────────────────────────────
```

Note the `canopyFraction` row. Excluding unknowns from the denominator is what
prevents a cloudy yard from reporting "0% canopy" with false confidence.

### Typed errors, never silent fallbacks

```ts
export type CanopyError =
  | { code: 'INSUFFICIENT_COVERAGE'; coverage: number; required: number }
  | { code: 'NO_THERMAL_OVERLAP' }
  | { code: 'FIT_UNRELIABLE'; r2: number }
  | { code: 'FIXTURE_MALFORMED'; path: string; detail: string };
```

Each renders as a readable sentence plus a concrete remedy. None falls back to a
default value. A crash is better than a wrong number, because a crash is
noticed.

---

## 12. Determinism

Identical input must produce byte-identical output. This is not fastidiousness —
a report that a school receives must be reproducible, and a golden snapshot test
is only meaningful if the pipeline is deterministic.

```
  SOURCE OF NONDETERMINISM        HOW IT IS ELIMINATED
  ─────────────────────────────────────────────────────────────────────────
  Math.random()                    absent from all computation paths
  Date.now() / new Date()          report date is an INPUT parameter
  Monte Carlo area estimation      replaced by 0.5 m grid quadrature
  Object key iteration order       sorted explicitly where it reaches output
  Floating-point accumulation      fixed traversal order, no parallel reduce
  Set / Map iteration              sorted before rendering
  fixture generation               seeded PRNG (mulberry32), seed in metadata
  ─────────────────────────────────────────────────────────────────────────
```

Asserted directly:

```ts
it('report rendering is deterministic — same input, same SVG', async () => {
  const a = await renderReportSvg(HERO_SLUG);
  const b = await renderReportSvg(HERO_SLUG);
  expect(a).toBe(b);
});
```

And the committed README hero image is regenerated and byte-compared on every
test run, so documentation cannot drift from the artifact:

```ts
expect(committed, 'docs/assets/report-preview.svg is stale — run `npm run assets`')
  .toBe(fresh);
```

That guard was verified to actually fail: corrupting the committed SVG produces
exactly that message.

---

## 13. Every constant, in one table

```
  CONSTANT                VALUE          UNIT       WHERE            WHY
  ══════════════════════════════════════════════════════════════════════════
  OPTICS
  NDVI canopy default     0.60           —          ndvi.ts          dense canopy
  NDVI_MIN_PV             0.20           —          lst.ts           Sobrino
  NDVI_MAX_PV             0.50           —          lst.ts           Sobrino
  ──────────────────────────────────────────────────────────────────────────
  THERMAL
  λ  Band 10 centre       10.895e-6      m          lst.ts           Planck corr.
  ρ  h·c/σ                1.438e-2       m·K        lst.ts           Planck corr.
  Kelvin offset           273.15         K          lst.ts           unit conv.
  emissivity slope        0.004          —          lst.ts           Sobrino
  emissivity intercept    0.986          —          lst.ts           Sobrino
  K₁ Landsat 8            774.8853       W·m⁻²·sr⁻¹·µm⁻¹  MTL        per-scene
  K₂ Landsat 8            1321.0789      K          MTL              per-scene
  K₁ Landsat 9            799.0284       W·m⁻²·sr⁻¹·µm⁻¹  MTL        per-scene
  K₂ Landsat 9            1329.2405      K          MTL              per-scene
  ──────────────────────────────────────────────────────────────────────────
  GATES
  REQUIRED_COVERAGE       0.80           fraction   mask.ts          GATE 1
  R2_FULL                 0.50           —          prediction.ts    GATE 2
  R2_WEAK                 0.30           —          prediction.ts    GATE 2
  MIN_CELL_OVERLAP        0.15           fraction   yardCells.ts     cell select
  ──────────────────────────────────────────────────────────────────────────
  GEOMETRY
  QUADRATURE_CELL_M       0.5            m          canopy.ts        union area
  SUBSAMPLES              8              per edge   yardCells.ts     overlap est.
  maturity horizon        15             years      cost data        projection
  ──────────────────────────────────────────────────────────────────────────
  STATISTICS
  alpha                   0.05           —          regression.ts    95% CI
  min n for fit           3              cells      regression.ts    residual df
  ──────────────────────────────────────────────────────────────────────────
  PROJECTION
  WGS84 semi-major a      6378137.0      m          geo/utm.ts       ellipsoid
  WGS84 e²                0.00669438     —          geo/utm.ts       ellipsoid
  UTM k₀                  0.9996         —          geo/utm.ts       scale factor
  false easting           500000         m          geo/utm.ts       UTM
  ══════════════════════════════════════════════════════════════════════════
```

Every one of these is a named export or a documented per-scene value. None is a
magic number inline in a computation.

---

## 14. What this method does not claim

Stated plainly, because the credibility of everything above depends on it.

```
  ✗  It does not claim causation. The fit is correlational. Vegetation and
     temperature co-vary for reasons including irrigation, building density,
     and material albedo, not only shade.

  ✗  It does not claim per-tree temperature effects. One thermal cell is
     larger than the entire planting area. The sensor cannot resolve it.

  ✗  It does not claim air temperature. LST is a surface measurement. Surface
     and air temperature differ substantially, especially over asphalt.

  ✗  It does not claim peak conditions. Landsat crosses at ~10:30 local.
     Afternoon yard temperature is higher than anything reported here.

  ✗  It does not claim a climate. One cloud-free scene is one weather day.

  ✗  It does not claim verified crown radii. Those are nominal planting-class
     figures and are marked UNVERIFIED.

  ✗  It does not claim its synthetic fixtures are observations. The shipped
     pixel values are generated; every report carries a SYNTHETIC badge.
```

What it does claim: given this imagery, this threshold, and this fit, the
relationship at this site is *this*, with *this* interval — and where the data
cannot support the claim, it says so instead.

---

## See also

- [LIMITATIONS.md](LIMITATIONS.md) — every limitation, with its handling
- [DATA.md](DATA.md) — fixture provenance and the real-imagery swap
- [ARCHITECTURE.md](ARCHITECTURE.md) — module boundaries and the dependency rule
- [MODEL-CARD.md](MODEL-CARD.md) — the model in ML-card form
- [DECISIONS.md](DECISIONS.md) — the tradeoffs, with what would change our mind
