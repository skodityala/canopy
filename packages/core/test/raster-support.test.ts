/** Resampling, masking, stats, grid helpers and the typed error surface. */

import { describe, expect, it } from 'vitest';
import {
  at,
  makeBoolGrid,
  makeGrid,
  pixelCentre,
  sameShape,
  type GeoTransform,
  type Grid,
  type Polygon,
} from '../src/types.js';
import { coverageFractionToGrid, resampleToGrid } from '../src/raster/resample.js';
import {
  QA_BIT,
  REQUIRED_COVERAGE,
  cloudMaskFromQA,
  countMask,
  coverageIsSufficient,
  intersectMasks,
  pointInPolygon,
  rasterisePolygon,
  validCoverage,
} from '../src/raster/mask.js';
import { percentile, summarise, valuesIn } from '../src/raster/stats.js';
import { CanopyFailure, explain, type CanopyError } from '../src/errors.js';

/** 10 m grid, 10x10, origin (0, 100) — covers 0..100 E, 0..100 N. */
const T10: GeoTransform = {
  originX: 0,
  originY: 100,
  pixelWidth: 10,
  pixelHeight: 10,
  epsg: 32612,
};

/** 100 m grid, 1x1, same extent — one coarse cell over the whole fine grid. */
const T100: GeoTransform = {
  originX: 0,
  originY: 100,
  pixelWidth: 100,
  pixelHeight: 100,
  epsg: 32612,
};

describe('grid helpers', () => {
  it('makeGrid fills with NaN by default — unknown, not zero', () => {
    const g = makeGrid(2, 2, T10);
    expect([...g.data].every(Number.isNaN)).toBe(true);
  });

  it('makeGrid and makeBoolGrid honour an explicit fill', () => {
    expect([...makeGrid(2, 1, T10, 0).data]).toEqual([0, 0]);
    expect([...makeGrid(2, 1, T10, 5).data]).toEqual([5, 5]);
    expect([...makeBoolGrid(2, 1, T10, 1).data]).toEqual([1, 1]);
    expect([...makeBoolGrid(2, 1, T10).data]).toEqual([0, 0]);
  });

  it('at() returns null out of bounds and for NaN', () => {
    const g = makeGrid(2, 2, T10, 3);
    g.data[3] = Number.NaN;
    expect(at(g, 0, 0)).toBe(3);
    expect(at(g, 1, 1)).toBeNull();
    expect(at(g, -1, 0)).toBeNull();
    expect(at(g, 0, -1)).toBeNull();
    expect(at(g, 2, 0)).toBeNull();
    expect(at(g, 0, 2)).toBeNull();
  });

  it('sameShape compares dimensions and pixel geometry', () => {
    expect(sameShape(makeGrid(2, 2, T10), makeGrid(2, 2, T10))).toBe(true);
    expect(sameShape(makeGrid(2, 2, T10), makeGrid(3, 2, T10))).toBe(false);
    expect(sameShape(makeGrid(2, 2, T10), makeGrid(2, 3, T10))).toBe(false);
    expect(sameShape(makeGrid(2, 2, T10), makeGrid(2, 2, T100))).toBe(false);
    expect(sameShape(makeGrid(2, 2, T10), makeGrid(2, 2, { ...T10, originX: 5 }))).toBe(false);
    expect(sameShape(makeGrid(2, 2, T10), makeGrid(2, 2, { ...T10, originY: 5 }))).toBe(false);
    expect(sameShape(makeGrid(2, 2, T10), makeGrid(2, 2, { ...T10, epsg: 4326 }))).toBe(false);
    expect(sameShape(makeGrid(2, 2, T10), makeGrid(2, 2, { ...T10, pixelHeight: 20 }))).toBe(false);
  });

  it('pixelCentre places centres half a pixel in from the origin', () => {
    expect(pixelCentre(T10, 0, 0)).toEqual([5, 95]);
    expect(pixelCentre(T10, 1, 1)).toEqual([15, 85]);
  });
});

describe('§4.5 step 1 — area-weighted resampling', () => {
  it('averages a uniform fine grid to the same value', () => {
    const fine = makeGrid(10, 10, T10, 0.42);
    const coarse = makeGrid(1, 1, T100, 0);
    const out = resampleToGrid(fine, coarse);
    expect(out.data[0]).toBeCloseTo(0.42, 12);
  });

  it('area-averages rather than nearest-neighbouring', () => {
    // Left half 1.0, right half 0.0 → area mean 0.5. A nearest-neighbour
    // resample would return whichever single pixel it happened to sample.
    const fine = makeGrid(10, 10, T10, 0);
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 5; c++) fine.data[r * 10 + c] = 1;
    }
    const out = resampleToGrid(fine, makeGrid(1, 1, T100, 0));
    expect(out.data[0]).toBeCloseTo(0.5, 12);
  });

  it('weights partial overlaps by true intersection area', () => {
    // One 100 m cell offset so it covers only the fine grid's right 50 m.
    const fine = makeGrid(10, 10, T10, 0);
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 5; c++) fine.data[r * 10 + c] = 1; // left half = 1
    }
    const shifted = makeGrid(1, 1, { ...T100, originX: 50 }, 0);
    const out = resampleToGrid(fine, shifted);
    // Only the right half (all zeros) is inside the shifted cell.
    expect(out.data[0]).toBeCloseTo(0, 12);
  });

  it('ignores NaN fine pixels in the weighted mean', () => {
    const fine = makeGrid(10, 10, T10, Number.NaN);
    fine.data[0] = 1;
    fine.data[1] = 3;
    const out = resampleToGrid(fine, makeGrid(1, 1, T100, 0));
    expect(out.data[0]).toBeCloseTo(2, 12);
  });

  it('yields NaN for a coarse cell with no valid fine pixels', () => {
    const fine = makeGrid(10, 10, T10, Number.NaN);
    const out = resampleToGrid(fine, makeGrid(1, 1, T100, 0));
    expect(Number.isNaN(out.data[0]!)).toBe(true);
  });

  it('yields NaN for a coarse cell entirely outside the fine grid', () => {
    const fine = makeGrid(10, 10, T10, 0.5);
    const away = makeGrid(1, 1, { ...T100, originX: 10000, originY: 10000 }, 0);
    const out = resampleToGrid(fine, away);
    expect(Number.isNaN(out.data[0]!)).toBe(true);
  });

  it('refuses to resample across a CRS mismatch', () => {
    const fine = makeGrid(2, 2, T10, 1);
    const coarse = makeGrid(1, 1, { ...T100, epsg: 32613 }, 0);
    expect(() => resampleToGrid(fine, coarse)).toThrow(/CRS mismatch/);
  });

  it('preserves the coarse geometry in the output', () => {
    const out = resampleToGrid(makeGrid(10, 10, T10, 1), makeGrid(1, 1, T100, 0));
    expect(out.width).toBe(1);
    expect(out.transform.pixelWidth).toBe(100);
  });

  it('coverageFractionToGrid reports the covered fraction of each coarse cell', () => {
    const fine = makeBoolGrid(10, 10, T10, 0);
    for (let r = 0; r < 10; r++) {
      for (let c = 0; c < 5; c++) fine.data[r * 10 + c] = 1;
    }
    const out = coverageFractionToGrid(fine, makeGrid(1, 1, T100, 0));
    expect(out.data[0]).toBeCloseTo(0.5, 12);
  });

  it('resamples a multi-cell coarse grid independently per cell', () => {
    // 2x2 of 50 m cells over the 100x100 m fine extent.
    const fine = makeGrid(10, 10, T10, 0);
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) fine.data[r * 10 + c] = 1; // top-left quadrant
    }
    const coarse = makeGrid(2, 2, { ...T10, pixelWidth: 50, pixelHeight: 50 }, 0);
    const out = resampleToGrid(fine, coarse);
    expect(out.data[0]).toBeCloseTo(1, 12); // top-left
    expect(out.data[1]).toBeCloseTo(0, 12); // top-right
    expect(out.data[2]).toBeCloseTo(0, 12); // bottom-left
    expect(out.data[3]).toBeCloseTo(0, 12); // bottom-right
  });
});

describe('§4.4 QA cloud masking', () => {
  const qaGrid = (values: number[]): Grid => {
    const g = makeGrid(values.length, 1, T100, 0);
    g.data.set(values);
    return g;
  };

  it('marks a clear pixel usable', () => {
    const m = cloudMaskFromQA(qaGrid([0]));
    expect(m.data[0]).toBe(1);
  });

  it('masks every documented unusable bit', () => {
    for (const bit of [
      QA_BIT.FILL,
      QA_BIT.DILATED_CLOUD,
      QA_BIT.CIRRUS,
      QA_BIT.CLOUD,
      QA_BIT.CLOUD_SHADOW,
      QA_BIT.SNOW,
    ]) {
      const m = cloudMaskFromQA(qaGrid([1 << bit]));
      expect(m.data[0], `bit ${bit} should mask the pixel`).toBe(0);
    }
  });

  it('leaves unrelated high bits usable', () => {
    // Bits 6+ carry confidence levels, not usability.
    const m = cloudMaskFromQA(qaGrid([1 << 8]));
    expect(m.data[0]).toBe(1);
  });

  it('masks a NaN QA value rather than assuming it is clear', () => {
    const m = cloudMaskFromQA(qaGrid([Number.NaN]));
    expect(m.data[0]).toBe(0);
  });

  it('masks a realistic cloud-plus-shadow QA value', () => {
    const m = cloudMaskFromQA(qaGrid([(1 << QA_BIT.CLOUD) | (1 << QA_BIT.CLOUD_SHADOW)]));
    expect(m.data[0]).toBe(0);
  });
});

describe('polygon rasterisation and coverage', () => {
  /** A 40 m square yard from (20,20) to (60,60). */
  const yard: Polygon = {
    outer: [
      [20, 20],
      [60, 20],
      [60, 60],
      [20, 60],
    ],
  };

  it('pointInPolygon includes interior and excludes exterior', () => {
    expect(pointInPolygon(yard, 40, 40)).toBe(true);
    expect(pointInPolygon(yard, 10, 40)).toBe(false);
    expect(pointInPolygon(yard, 70, 40)).toBe(false);
    expect(pointInPolygon(yard, 40, 10)).toBe(false);
    expect(pointInPolygon(yard, 40, 70)).toBe(false);
  });

  it('excludes points inside a hole', () => {
    const withHole: Polygon = {
      outer: yard.outer,
      holes: [
        [
          [35, 35],
          [45, 35],
          [45, 45],
          [35, 45],
        ],
      ],
    };
    expect(pointInPolygon(withHole, 40, 40)).toBe(false);
    expect(pointInPolygon(withHole, 25, 25)).toBe(true);
  });

  it('rasterises to the expected pixel count on a 10 m grid', () => {
    const mask = rasterisePolygon(yard, makeGrid(10, 10, T10, 0));
    // 40 m square on a 10 m grid → 16 pixel centres inside.
    expect(countMask(mask)).toBe(16);
  });

  it('produces an empty mask for a polygon off the grid', () => {
    const far: Polygon = {
      outer: [
        [5000, 5000],
        [5010, 5000],
        [5010, 5010],
        [5000, 5010],
      ],
    };
    expect(countMask(rasterisePolygon(far, makeGrid(10, 10, T10, 0)))).toBe(0);
  });

  it('intersectMasks ANDs element-wise', () => {
    const a = makeBoolGrid(4, 1, T10, 0);
    const b = makeBoolGrid(4, 1, T10, 0);
    a.data.set([1, 1, 0, 0]);
    b.data.set([1, 0, 1, 0]);
    expect([...intersectMasks(a, b).data]).toEqual([1, 0, 0, 0]);
  });

  it('intersectMasks refuses a shape mismatch', () => {
    expect(() => intersectMasks(makeBoolGrid(2, 1, T10), makeBoolGrid(3, 1, T10))).toThrow(
      /shape mismatch/,
    );
  });

  it('validCoverage is 1.0 for a fully clear yard', () => {
    const like = makeGrid(10, 10, T10, 0);
    const clear = makeBoolGrid(10, 10, T10, 1);
    expect(validCoverage(clear, yard, like)).toBeCloseTo(1, 12);
  });

  it('validCoverage reports the masked fraction honestly', () => {
    const like = makeGrid(10, 10, T10, 0);
    const partial = makeBoolGrid(10, 10, T10, 1);
    // The yard spans y = 20..60, i.e. grid rows 4..7. Masking rows 4 and 5
    // removes 8 of its 16 pixels.
    for (let c = 0; c < 10; c++) {
      partial.data[4 * 10 + c] = 0;
      partial.data[5 * 10 + c] = 0;
    }
    const cov = validCoverage(partial, yard, like);
    expect(cov).toBeCloseTo(0.5, 12);
  });

  it('validCoverage is 0 when the yard does not intersect the grid', () => {
    const far: Polygon = {
      outer: [
        [9000, 9000],
        [9010, 9000],
        [9010, 9010],
        [9000, 9010],
      ],
    };
    expect(validCoverage(makeBoolGrid(10, 10, T10, 1), far, makeGrid(10, 10, T10, 0))).toBe(0);
  });

  it('coverageIsSufficient gates at the documented 80%', () => {
    expect(REQUIRED_COVERAGE).toBe(0.8);
    expect(coverageIsSufficient(0.81)).toBe(true);
    expect(coverageIsSufficient(0.8)).toBe(true);
    expect(coverageIsSufficient(0.79)).toBe(false);
    expect(coverageIsSufficient(Number.NaN)).toBe(false);
    expect(coverageIsSufficient(0.5, 0.4)).toBe(true);
  });

  it('countMask counts set bits', () => {
    const m = makeBoolGrid(4, 1, T10, 0);
    m.data.set([1, 0, 1, 1]);
    expect(countMask(m)).toBe(3);
    expect(countMask(makeBoolGrid(4, 1, T10, 0))).toBe(0);
  });
});

describe('masked statistics', () => {
  const g = makeGrid(5, 1, T10, 0);
  g.data.set([10, 20, 30, 40, Number.NaN]);
  const all = makeBoolGrid(5, 1, T10, 1);

  it('summarises mean, sd, range and n over valid pixels', () => {
    const s = summarise(g, all);
    expect(s.n).toBe(4);
    expect(s.mean).toBeCloseTo(25, 12);
    expect(s.min).toBe(10);
    expect(s.max).toBe(40);
    // Sample SD of 10,20,30,40 is 12.9099.
    expect(s.sd).toBeCloseTo(12.9099, 4);
  });

  it('honours the mask', () => {
    const m = makeBoolGrid(5, 1, T10, 0);
    m.data.set([1, 1, 0, 0, 0]);
    const s = summarise(g, m);
    expect(s.n).toBe(2);
    expect(s.mean).toBeCloseTo(15, 12);
  });

  it('returns n = 0 and NaNs when nothing is valid — never a confident zero', () => {
    const s = summarise(g, makeBoolGrid(5, 1, T10, 0));
    expect(s.n).toBe(0);
    expect(Number.isNaN(s.mean)).toBe(true);
    expect(Number.isNaN(s.sd)).toBe(true);
    expect(Number.isNaN(s.min)).toBe(true);
    expect(Number.isNaN(s.max)).toBe(true);
  });

  it('reports sd 0 for a single pixel rather than NaN', () => {
    const one = makeBoolGrid(5, 1, T10, 0);
    one.data[0] = 1;
    const s = summarise(g, one);
    expect(s.n).toBe(1);
    expect(s.sd).toBe(0);
    expect(s.mean).toBe(10);
  });

  it('valuesIn collects only valid masked values', () => {
    expect(valuesIn(g, all)).toEqual([10, 20, 30, 40]);
    expect(valuesIn(g, makeBoolGrid(5, 1, T10, 0))).toEqual([]);
  });

  it('percentile interpolates linearly', () => {
    const v = [1, 2, 3, 4];
    expect(percentile(v, 0)).toBe(1);
    expect(percentile(v, 100)).toBe(4);
    expect(percentile(v, 50)).toBeCloseTo(2.5, 12);
  });

  it('percentile sorts its input and ignores NaN', () => {
    expect(percentile([4, 1, 3, 2], 50)).toBeCloseTo(2.5, 12);
    expect(percentile([1, Number.NaN, 3], 50)).toBe(2);
  });

  it('percentile handles empty and single-element input', () => {
    expect(Number.isNaN(percentile([], 50))).toBe(true);
    expect(percentile([7], 25)).toBe(7);
  });

  it('percentile clamps out-of-range p', () => {
    expect(percentile([1, 2, 3], -10)).toBe(1);
    expect(percentile([1, 2, 3], 150)).toBe(3);
  });

  it('percentile returns the exact element when the index lands on one', () => {
    expect(percentile([10, 20, 30], 50)).toBe(20);
  });
});

describe('§5.5 typed errors explain themselves', () => {
  const cases: CanopyError[] = [
    { code: 'INSUFFICIENT_COVERAGE', coverage: 0.42, required: 0.8 },
    { code: 'NO_THERMAL_OVERLAP' },
    { code: 'FIT_UNRELIABLE', r2: 0.12 },
    { code: 'FIXTURE_MALFORMED', path: 'fixtures/x/meta.json', detail: 'missing yard' },
  ];

  for (const c of cases) {
    it(`${c.code} produces a readable, non-empty explanation`, () => {
      const msg = explain(c);
      expect(msg.length).toBeGreaterThan(20);
    });
  }

  it('INSUFFICIENT_COVERAGE names both the actual and required coverage', () => {
    const msg = explain({ code: 'INSUFFICIENT_COVERAGE', coverage: 0.42, required: 0.8 });
    expect(msg).toContain('42.0%');
    expect(msg).toContain('80%');
  });

  it('FIT_UNRELIABLE states the R² and that the number is withheld', () => {
    const msg = explain({ code: 'FIT_UNRELIABLE', r2: 0.12 });
    expect(msg).toContain('0.12');
    expect(msg).toMatch(/withheld|not resolvable/i);
  });

  it('FIXTURE_MALFORMED names the path and the detail', () => {
    const msg = explain({
      code: 'FIXTURE_MALFORMED',
      path: 'fixtures/x/meta.json',
      detail: 'missing yard',
    });
    expect(msg).toContain('fixtures/x/meta.json');
    expect(msg).toContain('missing yard');
  });

  it('CanopyFailure carries the structured detail alongside the message', () => {
    const err = new CanopyFailure({ code: 'NO_THERMAL_OVERLAP' });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('CanopyFailure');
    expect(err.detail.code).toBe('NO_THERMAL_OVERLAP');
    expect(err.message).toMatch(/does not overlap/i);
  });
});
