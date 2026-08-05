import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/**/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['packages/core/src/**/*.ts', 'packages/render/src/**/*.ts'],
      exclude: [
        'packages/core/src/index.ts',
        'packages/core/src/ports/**',
        'packages/render/src/index.ts',
      ],
      thresholds: {
        // §6: core is the only hard-gated package.
        lines: 90,
        functions: 90,
        // raster/ and model/ are held at 100% lines — the numbers that reach a
        // judge. Branch coverage is set to the honestly achieved figure: the
        // shortfall is entirely floating-point underflow guards in the
        // incomplete-beta continued fraction (Math.abs(d) < FPMIN), which only
        // fire on denormals. Writing a test that fakes those would be worse
        // than stating the real number here.
        'packages/core/src/raster/**/*.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 98,
        },
        'packages/core/src/model/**/*.ts': {
          lines: 100,
          functions: 100,
          statements: 100,
          branches: 94,
        },
      },
    },
  },
});
