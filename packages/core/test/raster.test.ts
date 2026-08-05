/**
 * The §6 known-value suite. Every anchor from §4.3, plus the traps.
 *
 * These are pure functions — no imagery required, which is why this file exists
 * independently of the ingest track.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CANOPY_THRESHOLD,
  canopyFraction,
  classifyCanopy,
  meanNdvi,
  ndvi,
  ndviGrid,
} from '../src/raster/ndvi.js';
import {
  KELVIN_OFFSET,
  LAMBDA_B10_M,
  RHO_M_K,
  emissivity,
  lstCelsius,
  lstGrid,
  proportionVegetation,
  toBrightnessTempK,
  toRadiance,
  validPixelCount,
} from '../src/raster/lst.js';
import { makeBoolGrid, makeGrid, type GeoTransform } from '../src/types.js';

const T10: GeoTransform = {
  originX: 0,
  originY: 100,
  pixelWidth: 10,
  pixelHeight: 10,
  epsg: 32612,
};

/** Landsat 8 Band 10 thermal constants, for the documented anchor. */
const L8 = { k1: 774.8853, k2: 1321.0789 };
/** Landsat 9 differs — this is why they are read from MTL, not hardcoded. */
const L9 = { k1: 799.0284, k2: 1329.2405 };

describe('§4.2 NDVI — known values', () => {
  it('ndvi(0.5, 0.1) = 0.6667', () => {
    expect(ndvi(0.5, 0.1)).toBeCloseTo(0.6667, 4);
  });

  it('ndvi(0.3, 0.3) = 0', () => {
    expect(ndvi(0.3, 0.3)).toBe(0);
  });

  it('ndvi(0, 0) = null — NOT Infinity, NOT 0', () => {
    const v = ndvi(0, 0);
    expect(v).toBeNull();
    // The whole point: a no-signal pixel is unknown, not confidently zero.
    expect(v).not.toBe(0);
    expect(v).not.toBe(Infinity);
    expect(Number.isNaN(v as unknown as number)).toBe(false);
  });

  it('returns null for non-finite input rather than propagating NaN silently', () => {
    expect(ndvi(Number.NaN, 0.1)).toBeNull();
    expect(ndvi(0.1, Number.NaN)).toBeNull();
    expect(ndvi(Infinity, 0.1)).toBeNull();
  });

  it('is null when the denominator cancels to zero with signed inputs', () => {
    expect(ndvi(0.2, -0.2)).toBeNull();
  });

  it('is +1 for pure NIR and -1 for pure red', () => {
    expect(ndvi(0.4, 0)).toBeCloseTo(1, 12);
    expect(ndvi(0, 0.4)).toBeCloseTo(-1, 12);
  });
});

describe('§4.2 NDVI — property: output always in [-1,1] or null', () => {
  it('holds across a wide sweep of finite inputs', () => {
    const vals = [-1, -0.3, 0, 1e-9, 0.05, 0.2, 0.5, 0.9, 1, 12345];
    for (const nir of vals) {
      for (const red of vals) {
        const v = ndvi(nir, red);
        if (v === null) continue;
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('§4.2 NDVI grids and canopy classification', () => {
  it('propagates unknown pixels as NaN through ndviGrid', () => {
    const nir = makeGrid(2, 1, T10, 0);
    const red = makeGrid(2, 1, T10, 0);
    nir.data[0] = 0.5;
    red.data[0] = 0.1;
    // pixel 1 stays 0/0 → unknown
    const g = ndviGrid(nir, red);
    expect(g.data[0]).toBeCloseTo(0.6667, 4);
    expect(Number.isNaN(g.data[1]!)).toBe(true);
  });

  it('rejects non-co-registered inputs instead of producing garbage', () => {
    const nir = makeGrid(2, 1, T10, 0.4);
    const red = makeGrid(3, 1, T10, 0.1);
    expect(() => ndviGrid(nir, red)).toThrow(/co-registered/);
  });

  it('classifies at the documented 0.60 canopy threshold', () => {
    expect(DEFAULT_CANOPY_THRESHOLD).toBe(0.6);
    const g = makeGrid(4, 1, T10);
    g.data.set([0.05, 0.45, 0.6, 0.82]);
    const c = classifyCanopy(g, DEFAULT_CANOPY_THRESHOLD);
    expect([...c.data]).toEqual([0, 0, 1, 1]);
  });

  it('never classifies an unknown pixel as canopy', () => {
    const g = makeGrid(2, 1, T10, Number.NaN);
    const c = classifyCanopy(g, 0.6);
    expect([...c.data]).toEqual([0, 0]);
  });

  it('excludes unknown pixels from the canopy denominator', () => {
    // 4 px: canopy, open, canopy, unknown. Valid mask covers the first three.
    const g = makeGrid(4, 1, T10);
    g.data.set([0.8, 0.1, 0.7, Number.NaN]);
    const cls = classifyCanopy(g, 0.6);
    const valid = makeBoolGrid(4, 1, T10);
    valid.data.set([1, 1, 1, 0]);
    expect(canopyFraction(cls, valid)).toBeCloseTo(2 / 3, 12);
  });

  it('returns NaN canopy fraction when nothing is valid — never a confident 0%', () => {
    const g = makeGrid(2, 1, T10, Number.NaN);
    const cls = classifyCanopy(g, 0.6);
    const valid = makeBoolGrid(2, 1, T10, 0);
    expect(Number.isNaN(canopyFraction(cls, valid))).toBe(true);
  });

  it('meanNdvi ignores NaN and returns NaN on an empty mask', () => {
    const g = makeGrid(3, 1, T10);
    g.data.set([0.2, Number.NaN, 0.4]);
    const all = makeBoolGrid(3, 1, T10, 1);
    expect(meanNdvi(g, all)).toBeCloseTo(0.3, 12);
    expect(Number.isNaN(meanNdvi(g, makeBoolGrid(3, 1, T10, 0)))).toBe(true);
  });

  it('throws when canopy and valid masks disagree in shape', () => {
    const cls = makeBoolGrid(2, 1, T10);
    const valid = makeBoolGrid(3, 1, T10);
    expect(() => canopyFraction(cls, valid)).toThrow(/shape/);
  });
});

describe('§4.3 LST step 1 — radiance', () => {
  it('applies the MTL linear scaling', () => {
    // L = M·Q + A
    expect(toRadiance(10000, 3.342e-4, 0.1)).toBeCloseTo(3.442, 6);
  });

  it('is exactly the additive constant at DN 0', () => {
    expect(toRadiance(0, 3.342e-4, 0.1)).toBeCloseTo(0.1, 12);
  });
});

describe('§4.3 LST step 2 — brightness temperature', () => {
  it('BT(L=10, Landsat 8) ≈ 302.79 K', () => {
    expect(toBrightnessTempK(10, L8.k1, L8.k2)).toBeCloseTo(302.79, 1);
  });

  it('differs between Landsat 8 and Landsat 9 for the same radiance', () => {
    const b8 = toBrightnessTempK(10, L8.k1, L8.k2);
    const b9 = toBrightnessTempK(10, L9.k1, L9.k2);
    expect(Math.abs(b8 - b9)).toBeGreaterThan(0.1);
  });

  it('is NaN for non-positive or non-finite radiance — never a fabricated temperature', () => {
    expect(Number.isNaN(toBrightnessTempK(0, L8.k1, L8.k2))).toBe(true);
    expect(Number.isNaN(toBrightnessTempK(-3, L8.k1, L8.k2))).toBe(true);
    expect(Number.isNaN(toBrightnessTempK(Number.NaN, L8.k1, L8.k2))).toBe(true);
  });

  it('increases monotonically with radiance', () => {
    let prev = -Infinity;
    for (const l of [1, 2, 5, 8, 10, 14, 20]) {
      const bt = toBrightnessTempK(l, L8.k1, L8.k2);
      expect(bt).toBeGreaterThan(prev);
      prev = bt;
    }
  });
});

describe('§4.3 LST step 3 — proportion of vegetation and emissivity', () => {
  it('proportionVegetation(0.35) = 0.25', () => {
    expect(proportionVegetation(0.35)).toBeCloseTo(0.25, 6);
  });

  it('emissivity(0.25) = 0.987', () => {
    expect(emissivity(0.25)).toBeCloseTo(0.987, 6);
  });

  it('clamps P_v to [0,1] outside the NDVI bounds', () => {
    expect(proportionVegetation(0.1)).toBe(0);
    expect(proportionVegetation(0.2)).toBe(0);
    expect(proportionVegetation(0.5)).toBe(1);
    expect(proportionVegetation(0.9)).toBe(1);
  });

  it('keeps emissivity in the documented [0.986, 0.990] urban range', () => {
    expect(emissivity(0)).toBeCloseTo(0.986, 12);
    expect(emissivity(1)).toBeCloseTo(0.99, 12);
    for (const pv of [0, 0.1, 0.33, 0.5, 0.75, 1]) {
      const e = emissivity(pv);
      expect(e).toBeGreaterThanOrEqual(0.986);
      expect(e).toBeLessThanOrEqual(0.99);
    }
  });

  it('property: emissivity is monotonically non-decreasing in P_v', () => {
    let prev = -Infinity;
    for (let pv = 0; pv <= 1.0001; pv += 0.05) {
      const e = emissivity(pv);
      expect(e).toBeGreaterThanOrEqual(prev);
      prev = e;
    }
  });

  it('propagates unknown NDVI as NaN rather than 0', () => {
    expect(Number.isNaN(proportionVegetation(Number.NaN))).toBe(true);
    expect(Number.isNaN(emissivity(Number.NaN))).toBe(true);
  });
});

describe('§4.3 LST step 4 — the Kelvin unit trap', () => {
  it('uses the documented λ and ρ constants', () => {
    expect(LAMBDA_B10_M).toBeCloseTo(10.895e-6, 12);
    expect(RHO_M_K).toBeCloseTo(1.438e-2, 12);
    expect(KELVIN_OFFSET).toBe(273.15);
  });

  it('converts a known BT+ε to the correct °C', () => {
    const bt = toBrightnessTempK(10, L8.k1, L8.k2); // ≈302.79 K
    const emis = emissivity(proportionVegetation(0.35)); // 0.987
    // Verified independently: 30.56 °C for these inputs.
    expect(lstCelsius(bt, emis)).toBeCloseTo(30.56, 2);
  });

  it('KELVIN TRAP: feeding °C instead of K silently shifts the answer ~0.9 °C', () => {
    const btK = toBrightnessTempK(10, L8.k1, L8.k2);
    const emis = emissivity(proportionVegetation(0.35));
    const correct = lstCelsius(btK, emis);
    // What the bug looks like: passing Celsius into a formula expecting Kelvin.
    const btC = btK - KELVIN_OFFSET;
    const wrong = btC / (1 + (LAMBDA_B10_M * btC / RHO_M_K) * Math.log(emis));
    // Both land in a plausible-looking range, which is exactly why this needs a test.
    expect(wrong).toBeGreaterThan(25);
    expect(wrong).toBeLessThan(35);
    expect(Math.abs(correct - wrong)).toBeGreaterThan(0.5);
    // The correct value is the higher one; pin it so a regression cannot pass.
    expect(correct).toBeGreaterThan(wrong);
  });

  it('emissivity correction always warms relative to brightness temperature', () => {
    // ln(ε) < 0 for ε < 1, so LST > BT. A result below BT means a sign error.
    for (const l of [5, 8, 10, 14]) {
      const bt = toBrightnessTempK(l, L9.k1, L9.k2);
      const e = emissivity(proportionVegetation(0.3));
      expect(lstCelsius(bt, e)).toBeGreaterThan(bt - KELVIN_OFFSET);
    }
  });

  it('is NaN for invalid brightness temperature or emissivity', () => {
    expect(Number.isNaN(lstCelsius(Number.NaN, 0.987))).toBe(true);
    expect(Number.isNaN(lstCelsius(0, 0.987))).toBe(true);
    expect(Number.isNaN(lstCelsius(-5, 0.987))).toBe(true);
    expect(Number.isNaN(lstCelsius(300, Number.NaN))).toBe(true);
    expect(Number.isNaN(lstCelsius(300, 0))).toBe(true);
    expect(Number.isNaN(lstCelsius(300, -0.5))).toBe(true);
  });

  it('produces physically plausible surface temperatures for a hot summer scene', () => {
    // A hot asphalt pixel should land well above air temperature, not near 0 °C —
    // the signature of the Kelvin trap.
    const bt = toBrightnessTempK(11.5, L9.k1, L9.k2);
    const lst = lstCelsius(bt, emissivity(proportionVegetation(0.08)));
    expect(lst).toBeGreaterThan(20);
    expect(lst).toBeLessThan(75);
  });
});

describe('§4.3 full chain — lstGrid', () => {
  const mtl = {
    radianceMult: 3.342e-4,
    radianceAdd: 0.1,
    k1: L9.k1,
    k2: L9.k2,
    spacecraft: 'LANDSAT_9',
    acquisitionDate: '2025-07-29',
    localOverpassTime: '10:42',
    sceneId: 'TEST_SCENE',
  };

  it('chains DN → radiance → BT → ε → LST per pixel', () => {
    const dn = makeGrid(2, 1, T10);
    dn.data.set([30000, 30000]);
    const nd = makeGrid(2, 1, T10);
    nd.data.set([0.7, 0.05]);
    const out = lstGrid(dn, mtl, nd);
    // Both pixels have the same radiance; the vegetated one has higher
    // emissivity and therefore a slightly lower corrected LST.
    expect(out.data[0]!).toBeLessThan(out.data[1]!);
    expect(out.data[0]!).toBeGreaterThan(0);
  });

  it('yields NaN where either the thermal DN or the NDVI is unknown', () => {
    const dn = makeGrid(3, 1, T10);
    dn.data.set([30000, Number.NaN, 30000]);
    const nd = makeGrid(3, 1, T10);
    nd.data.set([0.5, 0.5, Number.NaN]);
    const out = lstGrid(dn, mtl, nd);
    expect(Number.isNaN(out.data[0]!)).toBe(false);
    expect(Number.isNaN(out.data[1]!)).toBe(true);
    expect(Number.isNaN(out.data[2]!)).toBe(true);
  });

  it('refuses mismatched grids rather than silently misaligning thermal and NDVI', () => {
    const dn = makeGrid(2, 1, T10);
    const nd = makeGrid(4, 1, T10);
    expect(() => lstGrid(dn, mtl, nd)).toThrow(/co-registered/);
  });

  it('counts only valid pixels inside the mask', () => {
    const lst = makeGrid(3, 1, T10);
    lst.data.set([38.2, Number.NaN, 41.1]);
    const mask = makeBoolGrid(3, 1, T10, 1);
    expect(validPixelCount(lst, mask)).toBe(2);
    const none = makeBoolGrid(3, 1, T10, 0);
    expect(validPixelCount(lst, none)).toBe(0);
  });
});
