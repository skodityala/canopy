# LIMITATIONS

The complete register. Every limitation, its magnitude where quantifiable, how
Canopy handles it, and what would remove it.

**This document exists because a team that names its own error bars is more
credible than one that presents a bare number.** Nothing here is hidden in a
footnote; the report itself prints a limitations section, and the UI shows it
behind a disclosure on every school.

---

## Severity summary

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  L1   thermal resolution        100 m sensor, 95 m yard      ██████████  │
  │  L2   synthetic fixture pixels  demo data is generated       ██████████  │
  │  L3   spatial autocorrelation   CI is narrower than truth    ████████░░  │
  │  L4   single-date imagery       one weather day, not climate ███████░░░  │
  │  L5   correlational fit         association, not causation   ███████░░░  │
  │  L6   surface ≠ air temp        LST is not what a kid feels  ██████░░░░  │
  │  L7   overpass ≠ peak heat      10:42 local, not 15:00       ██████░░░░  │
  │  L8   NDVI catches turf         irrigated grass ≈ canopy     █████░░░░░  │
  │  L9   unverified crown radii    nominal, not a species list  █████░░░░░  │
  │  L10  derived yard polygon      centroid inset, not footprints ████░░░░░ │
  │  L11  maturity projection       15-year crowns, not day one  ████░░░░░░  │
  │  L12  one region uncited        Maricopa prints no total     ███░░░░░░░  │
  │  L13  caliper ≠ dbh             cost high-end approximation  ██░░░░░░░░  │
  │  L14  single climate tested     all four fixtures Phoenix    ██░░░░░░░░  │
  └──────────────────────────────────────────────────────────────────────────┘
     severity = how much it could mislead a decision-maker who ignored it
```

---

## L1 — Thermal resolution: a 100 m sensor on a 95 m yard

**The central limitation of the entire project.**

```
  Landsat Band 10 native resolution        100 m
  Recess yard span (9,000 m²)              ~95 m
  Thermal cells intersecting the yard      1 – 4
```

There is no 10 m thermal satellite in open data. This is a hard constraint of the
available instrumentation, not a design choice.

### What it means concretely

```
  A SINGLE THERMAL CELL vs THE PLANTING AREA

  ┌───────────────────────────────────────┐  one 100 m cell = 10,000 m²
  │                                       │
  │   ●   ●   ●   ●     ← 12 crowns,      │  the entire 12-tree plan
  │                       1,503 m² union  │  occupies 15% of ONE cell
  │   ●   ●   ●   ●                       │
  │                                       │  the sensor cannot resolve
  │   ●   ●   ●   ●                       │  a single tree, let alone
  │                                       │  its individual effect
  └───────────────────────────────────────┘
```

### How Canopy handles it

```
  ✓  reports a YARD-SCALE MEAN, always with its pixel count
     "43.9 °C, mean of 3 thermal pixels at 100 m native"
  ✓  selects cells by AREA OVERLAP (≥15%), not centre containment — so a
     95 m yard reports 3 contributing cells rather than the 1 whose centre
     it happens to contain
  ✓  shows the thermal grid on the map, so the resolution is visible
  ✓  ships a dedicated diagram (docs/assets/03-thermal-resolution.svg)
     whose only job is to make this limitation legible
  ✗  NEVER reports a per-tree temperature
  ✗  NEVER reports a temperature for a sub-yard zone
```

### What would remove it

Airborne or drone thermal imagery at 1–5 m, or a commercial thermal constellation.
Neither is free or public. ECOSTRESS (70 m) is marginally better but has
irregular revisit.

---

## L2 — The shipped fixture pixels are SYNTHETIC

```
  ┌──────────────────────────────────────────────────────────────────────────┐
  │  REAL        school names · OSM parcel polygons (way IDs recorded) ·      │
  │              UTM projection · planar areas · Portland cost figures ·     │
  │              all physics and calibration constants                       │
  │                                                                          │
  │  DERIVED     the recess-yard sub-polygon (centroid inset)  → L10          │
  │                                                                          │
  │  SYNTHETIC   every pixel value in every band                             │
  └──────────────────────────────────────────────────────────────────────────┘
```

Real satellite rasters could not be fetched on the build machine. The alternatives
were: ship nothing, ship something undisclosed, or ship something synthetic and
say so loudly. Only the third is defensible.

### How Canopy handles it

```
  ✓  synthetic: true in fixture metadata drives a PERSISTENT badge in the UI
     and a line in every PDF and SVG — removing it requires editing the data,
     not the template
  ✓  a test asserts the badge and the provenance string are present
  ✓  the generator emits REFLECTANCE and THERMAL DN, never NDVI or temperature,
     so the core derives everything and a fixture cannot mask a chain bug
  ✓  ground truth is planted, and the pipeline is tested for recovering it
```

### What it does and does not prove

```
  ✓ PROVES                              ✗ DOES NOT PROVE
  ─────────────────────────────────────────────────────────────────────────
  the NDVI formula is right             anything about real Phoenix yards
  the 4-step LST chain is right         any real cooling magnitude
  resampling is area-weighted           that R² would be 0.73 on real data
  the fit recovers a planted slope      that these schools need trees
  the gates fire correctly              any real budget figure
  the pipeline is deterministic
  ─────────────────────────────────────────────────────────────────────────
```

### What would remove it

An `ImageryPort` adapter reading real Sentinel-2 L2A and Landsat C2 L2 via STAC.
The boundary already exists; procedure in [DATA.md §6](DATA.md#6-swapping-in-real-imagery).
No model code changes.

---

## L3 — Spatial autocorrelation: the reported CI is too narrow

**The model's least conservative property.**

Ordinary least squares assumes independent errors. Thermal pixels 100 m apart are
not independent — a hot parking lot spans several cells, a shaded street spans
several more.

```
  CONSEQUENCE

    effective sample size  <  n = 400
    true standard error    >  reported SE(β₁) = 0.485
    true 95% interval      wider than [−16.88, −14.98]

  → the reported interval is a LOWER BOUND on the true uncertainty
```

### How Canopy handles it

```
  ✓  disclosed here and in MODEL-CARD.md assumption A7
  ✓  framed as a lower bound rather than presented as exact
  ✗  NOT corrected. No spatial error model is implemented.
```

This is the most significant unaddressed statistical issue in the project, and it
is stated rather than quietly ignored.

### What would remove it

A Moran's I diagnostic on the residuals to quantify the autocorrelation, then
Conley or HAC standard errors, or a spatial-lag model. All are pure math, fully
testable, no network required — this is the highest-value next piece of work.

---

## L4 — Single-date imagery: one weather day, not a climate

One cloud-free scene is one morning. Cloud cover, antecedent rainfall, soil
moisture, and season all move surface temperature substantially.

```
  WHAT ONE SCENE CANNOT TELL YOU

  ✗  whether this was an unusually hot or mild day
  ✗  how the yard behaves across a season
  ✗  interannual variation
  ✗  whether the vegetation was stressed or well-watered that week
```

### How Canopy handles it

```
  ✓  every temperature is labelled with its acquisition date
  ✓  the report states it explicitly as a limitation
  ✗  no multi-date compositing
```

### What would remove it

Median compositing across a season's cloud-free scenes, which also reduces
per-scene noise and would tighten the fit legitimately.

---

## L5 — The fit is correlational, not causal

`β₁` describes how LST and NDVI *co-vary* across a neighbourhood. Those two
quantities are related through shade, but also through irrigation (wet soil is
cooler), building density, material albedo, and land-use patterns that correlate
with both.

```
  WHAT β₁ = −15.93 °C/NDVI ACTUALLY MEANS

  ✓  in this neighbourhood, cells with higher NDVI are cooler, by about
     15.9 °C per unit of NDVI, with R² = 0.73

  ✗  NOT: adding vegetation to a cell will cool it by 15.9 °C per NDVI unit
  ✗  NOT: shade is the mechanism
  ✗  NOT: this transfers to another city
```

### How Canopy handles it

```
  ✓  every method label reads "associated change", never "will cause"
  ✓  enforced by test:
       expect(label).toMatch(/associated/i);
       expect(label).not.toMatch(/will cause|causes/i);
  ✓  the fit is refitted per scene, so it is at least THIS neighbourhood's
     relationship rather than a borrowed constant
```

### What would remove it

Before/after measurement of actual plantings — a longitudinal study, not a
remote-sensing product.

---

## L6 — Surface temperature is not air temperature

LST is the radiometric temperature of the ground. It is not what a thermometer at
1.5 m reads, and it is not what a child experiences.

```
  ON A HOT SUMMER DAY

    asphalt surface       55 – 65 °C
    air at 1.5 m          38 – 42 °C
    difference            15 – 25 °C, varying with wind and insolation
```

Surface temperature is nonetheless the right quantity for this problem: it is what
radiates onto a child standing on it, it is what shade directly modifies, and it
is what the free instrumentation measures. But it must not be relabelled.

### How Canopy handles it

```
  ✓  always called "surface temperature", never "temperature"
  ✓  the quantity is named in every label and in the PDF
  ✗  no air-temperature or heat-index model
```

### What would remove it

An energy-balance model with wind, humidity, and radiation inputs — a different
project.

---

## L7 — Landsat crosses at ~10:30, not at peak heat

```
  Landsat overpass       ~10:00 – 10:30 local (10:42 for these fixtures)
  Peak surface temp      ~13:00 – 15:00 local
  Recess                 often 10:00 – 13:00 — closer to overpass than to peak,
                         but lunch recess is later
```

Every temperature Canopy reports is a morning measurement. Actual afternoon yard
temperatures are higher, and the temperature *difference* that shade produces may
also be larger at peak insolation.

### How Canopy handles it

```
  ✓  the local overpass time is printed with every temperature
  ✓  the report states explicitly: "peak afternoon yard temperature is
     higher than at overpass"
  ✗  no diurnal model
```

### What would remove it

A diurnal surface-energy model, or geostationary thermal data such as GOES —
which is far coarser spatially, trading one limitation for another.

---

## L8 — NDVI catches irrigated turf, not only tree canopy

In arid climates, well-watered grass routinely exceeds NDVI 0.60. A global
threshold would count a soccer field as tree canopy.

```
  DIRECTION OF THE ERROR

  turf counted as canopy
    → existing canopy % OVERSTATED
    → the gap a plan would fill UNDERSTATED
    → the tool UNDERSELLS the intervention

  this is the safer direction, but it is still wrong
```

### How Canopy handles it

```
  ✓  per-site, hand-validated threshold — never a global constant
  ✓  the threshold and its rationale are PRINTED in every report
       cactus-wren 0.66 · dos-rios 0.63 · john-jacobs 0.62 · sunridge 0.60
  ✓  a reader who disagrees can see the value and discount accordingly
  ✗  no texture or height check to separate turf from crowns
```

### What would remove it

A canopy height model from lidar, or NDVI texture analysis — tree crowns have
higher local variance than mown turf.

---

## L9 — Crown radii are UNVERIFIED

```
  CLASS              RADIUS   MATURITY   STATUS
  ─────────────────────────────────────────────────────────────
  large_shade         7.5 m    15 yr     UNVERIFIED (nominal 7–9 m)
  medium_shade        5.5 m    15 yr     UNVERIFIED (nominal 5–6 m)
  small_ornamental    3.5 m    15 yr     UNVERIFIED (nominal 3–4 m)
  ─────────────────────────────────────────────────────────────
```

These are nominal planting-class figures, not a cited municipal species list. They
carry `radiusStatus: 'unverified'` in the cost model data.

Radius enters the calculation **squared** (`πr²`), so a 20% radius error is a 44%
area error, which propagates directly into ΔNDVI and therefore into ΔT.

### How Canopy handles it

```
  ✓  explicitly marked UNVERIFIED in the data file
  ✓  radiusSource records what the figure actually is
  ✓  costs are cited; radii are NOT — and the file says so, because
     conflating two claims when only one is resolved is exactly the
     overreach this project avoids
  ✗  radii are populated rather than zeroed, because zeroing them would make
     the geometry silently produce no shade — a wrong number rather than an
     absent one
```

### What would remove it

A municipal or extension species list with mature crown dimensions for the
specific species a district plants.

---

## L10 — The recess-yard polygon is derived, not measured

The OSM `amenity=school` way is the whole **parcel** — buildings, parking,
frontage. Reporting canopy over that would answer the wrong question.

With no building footprints available offline, the yard is a **centroid inset** of
the real parcel, targeting 9,000 m² of open play space.

```
  cactus-wren   parcel 55,309 m²  →  yard 9,000 m²   (16% inset)

  the parcel boundary is REAL OSM geometry
  the yard subset is an APPROXIMATION
```

### Why the target is absolute, not a parcel fraction

An earlier version took 55% of the parcel, producing a 30,420 m² "yard" — a whole
campus minus buildings. Since yard area is the denominator of canopy % and
therefore of ΔNDVI, this scaled the headline temperature by roughly 3×.

A recess yard does not scale with the parcel: large and small campuses both give
children roughly a field plus a hardcourt. Hence an absolute 9,000 m² target,
capped at 45% of parcel for small sites — chosen to match a typical elementary
yard, **not** chosen to make ΔT land anywhere.

### How Canopy handles it

```
  ✓  the derivation method string is in the fixture provenance and the PDF
  ✓  both parcel and yard areas are recorded
  ✗  the inset does not follow actual buildings, so it may include roof or
     exclude playground
```

### What would remove it

An Overpass query for `building=*` and `leisure=pitch` within the parcel,
subtracting footprints and unioning pitches. Query is in [DATA.md §6](DATA.md#6-swapping-in-real-imagery).

---

## L11 — Canopy figures are 15-year projections

A 2-inch caliper tree does not have a 7.5 m crown on planting day. Every canopy
and temperature figure is a projection at approximately 15-year maturity.

```
  PROJECTED CROWN GROWTH — r(t) = r_max · (1 − e^(−2.5t/T)) / (1 − e^(−2.5))

    7.5 m ┤                                    ╭────────────  mature
          │                            ╭───────╯
    5.0 m ┤                  ╭─────────╯
          │           ╭──────╯
    2.5 m ┤    ╭──────╯
          │╭───╯
      0 m ┼────┬────┬────┬────┬────┬────┬────┬───
          0    5    10   15   20   25   30   years
                         ▲ ΔT is quoted here
```

Benefits accrue gradually; the first several years deliver a fraction of the
projected cooling.

### How Canopy handles it

```
  ✓  every projection is labelled "at ~15-year crown maturity"
  ✓  the maturity horizon is in the method label attached to ΔT
  ✗  no year-by-year benefit schedule in the report
```

### What would remove it

A 5/15/30-year staged projection, which the growth curve already supports.

---

## L12 — One cost region is deliberately uncited

```
  Portland, OR          ✓ CITED    → prints $8,544 – $11,328
  Maricopa County, AZ   ⛔ UNCITED  → prints "cost not shown"
```

Maricopa's prices are zeroed and its source fields are empty **on purpose**. No
published figure has been resolved for that region, and inventing one would be
the single worst thing this project could do.

The consequence is real: a Phoenix school — the actual location of all four
fixtures — cannot currently get a cost total from Canopy.

### How Canopy handles it

```
  ✓  the UI states it is deliberately uncited rather than broken
  ✓  the citation gate withholds the total structurally
  ✓  a test fails if anyone "fixes" it by inventing prices
  ✓  Portland demonstrates that the cited path works
```

### What would remove it

A Maricopa County or Phoenix urban-forestry price sheet, a school district
facilities bid tabulation, or an Arizona extension service cost guide. Source
priority is in [DATA.md §7](DATA.md#7-cost-data-provenance).

---

## L13 — Caliper is not dbh

The Portland schedule publishes `$472.00 per dbh inch`. Nursery stock is specified
by **caliper**, measured 6 inches above ground. **Dbh** is measured at 4.5 feet.
They are different measurements.

```
  low end   $712.00 flat per on-site tree     ← published verbatim, exact
  high end  $472.00 × caliper inches          ← approximation of a per-dbh basis
```

For young 2-inch stock the two measurements are close, but the high end of each
cost range is therefore an approximation of the schedule's basis rather than a
figure the schedule states for caliper.

### How Canopy handles it

```
  ✓  recorded verbatim in portland-or.json as _limitation_caliper_vs_dbh
  ✓  the LOW end uses only the exact flat published figure
  ✓  the range is presented as a range, never a point estimate
```

### What would remove it

A caliper-basis price sheet, or a species-specific caliper-to-dbh conversion.

---

## L14 — All four fixtures are Phoenix

Every shipped site is in the same city, the same climate, and the same UTM zone.

```
  UNTESTED

  ✗  temperate climates where the LST~NDVI slope is shallower
  ✗  humid climates where evapotranspiration dominates
  ✗  high-latitude sites with low sun angles
  ✗  a second UTM zone
  ✗  the southern hemisphere (the projection supports it; nothing exercises it)
```

The narrow slope range across the four fixtures (−12.26 to −15.93) reflects one
climate, not the range Canopy would see globally. Published urban studies place
LST–canopy relationships across an order of magnitude depending on climate,
irrigation, and albedo — which is precisely why Canopy refits per scene instead of
borrowing a constant.

### How Canopy handles it

```
  ✓  refitting per scene means a new climate produces a new β₁ automatically
  ✓  the R² gate suppresses if the relationship does not resolve there
  ✗  no cross-climate validation has been run
```

### What would remove it

Fixtures from a temperate and a humid city, ideally in different UTM zones.

---

## What Canopy explicitly does not claim

```
  ✗  causation — the fit is correlational
  ✗  per-tree temperature effects — the sensor cannot resolve them
  ✗  air temperature or heat index — LST is a surface quantity
  ✗  peak afternoon conditions — the overpass is mid-morning
  ✗  a climate — single-date imagery is one weather day
  ✗  verified crown radii — nominal figures, marked UNVERIFIED
  ✗  that its shipped fixture pixels are observations — they are generated
  ✗  a cost for any region without a resolved published source
  ✗  health outcomes, carbon sequestration, or property value
```

## What it does claim

> Given this imagery, this per-site threshold, and this per-scene fit, the
> LST–NDVI relationship at this site is **this**, with **this** interval — and a
> planting plan of this geometry is associated with **this** change in yard-mean
> surface temperature at ~15-year maturity, costing **this** range according to
> **this** published schedule.
>
> Where the data cannot support any part of that, the corresponding number is
> **withheld**, with the reason stated.

---

## See also

- [METHOD.md](METHOD.md) — every formula and constant
- [MODEL-CARD.md](MODEL-CARD.md) — assumptions and evaluation
- [DATA.md](DATA.md) — provenance, and how to remove L2 and L10
- [DECISIONS.md](DECISIONS.md) — what would change our mind on each tradeoff
