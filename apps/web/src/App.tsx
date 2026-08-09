/**
 * The application shell. Presentation only — no math lives in this layer.
 *
 * Every computed quantity comes from @canopy/core; this file moves a ViewState
 * through its five variants and hands each to the right component.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  analyseScene,
  buildReport,
  suggestPlan,
  DEFAULT_SUGGEST,
  CanopyFailure,
  type CanopyError,
  type PlantingClass,
  type SchoolMeta,
  type Tree,
} from '@canopy/core';
import { createFixtureImageryPort } from '@canopy/imagery-fixture';
import { createLocalCostModelPort, type CostModelJson } from '@canopy/cost-local';
import portlandCosts from '@canopy/cost-local/data/portland-or.json';
import maricopaCosts from '@canopy/cost-local/data/maricopa-az.json';

import { FIXTURES } from './data/fixtures.js';
import { color, fontSize, lstColor, ndviColor } from './design/tokens.js';
import { MapView, type Layer } from './map/MapView.js';
import { SchoolPicker } from './panels/SchoolPicker.js';
import { MetricsPanel } from './panels/MetricsPanel.js';
import { CostPanel } from './panels/CostPanel.js';
import { RegressionPanel } from './panels/RegressionPanel.js';
import { DecisionTrace } from './panels/DecisionTrace.js';
import { EmptyState, LoadingState } from './states/EmptyAndLoading.js';
import { ErrorState } from './states/ErrorState.js';
import { SyntheticBadge } from './states/SuppressedState.js';
import { readyKindFor, type ViewState } from './states/ViewState.js';

/**
 * Two regions, deliberately asymmetric.
 *
 * Portland resolves every cost line to the City's published Title 11 fee
 * schedule, so it prints an itemised total. Maricopa ships with zeroed prices and
 * empty source fields on purpose, so the same code path withholds the total and
 * labels each line UNSOURCED.
 *
 * Flipping the selector is the fastest way to see that the citation gate is
 * structural rather than decorative.
 */
const PORTLAND = 'Portland, OR';
const MARICOPA = 'Maricopa County, AZ';

/** Portland first: the default should demonstrate the working, cited path. */
export const REGIONS: readonly string[] = [PORTLAND, MARICOPA];
const DEFAULT_REGION = PORTLAND;

/** Shown under the selector so an uncited region reads as intent, not breakage. */
const REGION_NOTE: Readonly<Record<string, string>> = {
  [PORTLAND]:
    'Every line resolves to the City of Portland Title 11 Trees Fee Schedule, so a total is printed.',
  [MARICOPA]:
    'Deliberately uncited — not broken. No published figure has been resolved for this region, so every line reads UNSOURCED and the total is withheld rather than guessed.',
};

/** Fixed so the UI and the committed PDF/SVG agree exactly. */
const REPORT_DATE = '2026-08-05';
const DEFAULT_TREES = 12;

const imagery = createFixtureImageryPort(FIXTURES);
const costs = createLocalCostModelPort({
  [PORTLAND]: portlandCosts as unknown as CostModelJson,
  [MARICOPA]: maricopaCosts as unknown as CostModelJson,
});

export function App() {
  const [state, setState] = useState<ViewState>({ kind: 'empty', schools: [] });
  const [layer, setLayer] = useState<Layer>('lst');
  const [showGrid, setShowGrid] = useState(true);
  const [classes, setClasses] = useState<readonly PlantingClass[]>([]);
  const [region, setRegion] = useState<string>(DEFAULT_REGION);

  useEffect(() => {
    void (async () => {
      const [schools, plantingClasses] = await Promise.all([
        imagery.list(),
        costs.plantingClasses(DEFAULT_REGION),
      ]);
      setClasses(plantingClasses);
      setState({ kind: 'empty', schools });
    })();
  }, []);

  const crownRadii = useMemo(
    () => new Map(classes.map((c) => [c.key, c.crownRadiusM])),
    [classes],
  );

  /**
   * Recompute a report for a school with an explicit tree list.
   *
   * `regionOverride` is a parameter rather than a closure read so a region switch
   * recomputes against the region the user just chose. Reading `region` from the
   * closure would use the previous value on the first render after the change,
   * printing the wrong cost state at exactly the moment someone is watching.
   */
  const analyse = useCallback(
    async (
      slug: string,
      schools: readonly SchoolMeta[],
      treesOverride?: readonly Tree[],
      regionOverride?: string,
    ) => {
      const activeRegion = regionOverride ?? region;
      setState({ kind: 'loading', schools, slug });
      try {
        const scene = await imagery.load(slug);
        const analysis = analyseScene(scene);
        const costModel = await costs.forRegion(activeRegion);
        const plantingClasses = await costs.plantingClasses(activeRegion);

        const trees =
          treesOverride ??
          suggestPlan(scene.meta.yard, analysis.ndvi, analysis.lst, {
            ...DEFAULT_SUGGEST,
            count: DEFAULT_TREES,
            classKeys: ['large_shade', 'medium_shade'],
            canopyThreshold: scene.meta.ndviCanopyThreshold,
          });

        const report = buildReport({
          scene,
          trees,
          classes: plantingClasses,
          costModel,
          generatedFor: REPORT_DATE,
          analysis,
        });

        setState({
          kind: readyKindFor(report),
          schools,
          meta: scene.meta,
          report,
          analysis,
          trees,
        });
      } catch (err) {
        const detail: CanopyError =
          err instanceof CanopyFailure
            ? err.detail
            : { code: 'FIXTURE_MALFORMED', path: slug, detail: String(err) };
        setState({ kind: 'error', schools, error: detail, slug });
      }
    },
    [region],
  );

  const selectSchool = useCallback(
    (slug: string) => void analyse(slug, state.schools),
    [analyse, state.schools],
  );

  /** Switch cost region and recompute in place. Only the cost model changes. */
  const selectRegion = useCallback(
    (next: string) => {
      setRegion(next);
      void costs.plantingClasses(next).then(setClasses);
      if (state.kind === 'ready' || state.kind === 'suppressed') {
        void analyse(state.meta.slug, state.schools, state.trees, next);
      }
    },
    [analyse, state],
  );

  const placeTree = useCallback(
    (x: number, y: number) => {
      if (state.kind !== 'ready' && state.kind !== 'suppressed') return;
      const next: Tree[] = [
        ...state.trees,
        {
          id: `t${String(state.trees.length + 1).padStart(2, '0')}`,
          x: +x.toFixed(2),
          y: +y.toFixed(2),
          classKey: state.trees.length % 2 === 0 ? 'large_shade' : 'medium_shade',
        },
      ];
      void analyse(state.meta.slug, state.schools, next);
    },
    [analyse, state],
  );

  const removeLastTree = useCallback(() => {
    if (state.kind !== 'ready' && state.kind !== 'suppressed') return;
    void analyse(state.meta.slug, state.schools, state.trees.slice(0, -1));
  }, [analyse, state]);

  const clearTrees = useCallback(() => {
    if (state.kind !== 'ready' && state.kind !== 'suppressed') return;
    void analyse(state.meta.slug, state.schools, []);
  }, [analyse, state]);

  const resetPlan = useCallback(() => {
    if (state.kind !== 'ready' && state.kind !== 'suppressed') return;
    void analyse(state.meta.slug, state.schools);
  }, [analyse, state]);

  /**
   * Force the error state so all five states are reachable in a live demo
   * without editing a fixture. Loads a slug that does not exist, which the
   * fixture adapter rejects with a typed FIXTURE_MALFORMED.
   */
  const forceError = useCallback(
    () => void analyse('no-such-school', state.schools),
    [analyse, state.schools],
  );

  const hasPlan = state.kind === 'ready' || state.kind === 'suppressed';

  const selected = hasPlan
    ? state.meta.slug
    : state.kind === 'loading' || state.kind === 'error'
      ? state.slug
      : null;

  const schoolName =
    state.schools.find((s) => s.slug === selected)?.name ?? selected ?? 'this schoolyard';

  return (
    <>
      <a className="skip-link" href="#measurements">
        Skip to measurements
      </a>

      <div className="app">
        {/* ── Left rail: picker and view controls. Quiet by design. */}
        <aside className="rail rail--left no-print" aria-label="Controls">
          <header>
            <div style={{ fontSize: fontSize.subhead, fontWeight: 600, color: color.accent }}>
              🌳 Canopy
            </div>
            <div style={{ fontSize: fontSize.method, color: color.textFaint, marginTop: 2 }}>
              Schoolyard shade plans from satellite imagery
            </div>
          </header>

          <SchoolPicker schools={state.schools} selected={selected} onSelect={selectSchool} />

          <fieldset className="segmented" style={{ display: 'block' }}>
            <legend className="segmented__legend">MAP LAYER</legend>
            <div style={{ display: 'flex', gap: 'var(--sp-xs)' }}>
              {(['lst', 'ndvi'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  className="seg"
                  onClick={() => setLayer(l)}
                  aria-pressed={layer === l}
                >
                  {l === 'lst' ? 'Temperature' : 'Vegetation'}
                </button>
              ))}
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--sp-sm)',
                marginTop: 'var(--sp-md)',
                fontSize: fontSize.caption,
                color: color.textMuted,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={showGrid}
                onChange={(e) => setShowGrid(e.target.checked)}
              />
              Show 100 m thermal grid
            </label>
          </fieldset>

          <div style={{ display: 'grid', gap: 'var(--sp-sm)' }}>
            <div className="section-label">PLAN</div>
            <button type="button" className="btn" onClick={resetPlan} disabled={!hasPlan}>
              Reset to suggested plan
            </button>
            <button type="button" className="btn" onClick={removeLastTree} disabled={!hasPlan}>
              Remove last tree
            </button>
            <button type="button" className="btn" onClick={clearTrees} disabled={!hasPlan}>
              Clear all trees
            </button>
          </div>

          <div style={{ marginTop: 'auto', display: 'grid', gap: 'var(--sp-sm)' }}>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => window.print()}
              disabled={!hasPlan}
            >
              Print / save as PDF
            </button>
            {/* Makes the error state demoable without breaking a fixture. */}
            <button type="button" className="btn" onClick={forceError}>
              Simulate data failure
            </button>
            <div style={{ fontSize: fontSize.method, color: color.textFaint, lineHeight: 1.5 }}>
              Runs fully offline. No request leaves this machine.
            </div>
          </div>
        </aside>

        {/* ── Centre: the map is the hero. */}
        <main className="stage">
          {state.kind === 'empty' && <EmptyState schools={state.schools} />}

          {state.kind === 'loading' && (
            <div style={{ margin: 'auto', width: 'min(560px, 100%)' }}>
              <LoadingState name={schoolName} />
            </div>
          )}

          {state.kind === 'error' && (
            <ErrorState error={state.error} schoolName={schoolName} />
          )}

          {hasPlan && (
            <>
              <div className="map-wrap">
                <MapView
                  ndvi={state.analysis.ndvi}
                  lst={state.analysis.lst}
                  yard={state.meta.yard}
                  trees={state.trees}
                  crownRadii={crownRadii}
                  layer={layer}
                  onPlace={placeTree}
                  showThermalGrid={showGrid}
                />
              </div>
              <Legend layer={layer} />
              <p
                className="no-print"
                style={{ margin: 0, fontSize: fontSize.method, color: color.textFaint }}
              >
                Click the map to plant a tree — or focus it and use the arrow keys, then
                Enter. Crowns are drawn at ~15-year mature radius.
              </p>
            </>
          )}
        </main>

        {/* ── Right rail: the numbers, each with its method. */}
        <aside className="rail rail--right" id="measurements" aria-label="Measurements">
          {hasPlan && (
            <>
              <div>
                <h1 style={{ margin: 0, fontSize: fontSize.subhead, fontWeight: 600 }}>
                  {state.report.school.name}
                </h1>
                <div
                  className="num"
                  style={{ fontSize: fontSize.method, color: color.textFaint, marginTop: 2 }}
                >
                  {state.report.school.city}, {state.report.school.state} · yard{' '}
                  {state.report.school.yardAreaM2.toLocaleString('en-US')} m²
                </div>
              </div>

              {state.report.school.synthetic && (
                <SyntheticBadge provenance="Pixel values are generated, not observed. Yard geometry is real OpenStreetMap data." />
              )}

              <MetricsPanel report={state.report} />

              <DecisionTrace report={state.report} />

              <RegressionPanel
                analysis={state.analysis}
                prediction={state.report.prediction}
              />

              {/* The region control sits immediately above the cost table so the
                  consequence of flipping it is in the same glance as the control. */}
              <fieldset className="segmented no-print" style={{ display: 'block' }}>
                <legend className="segmented__legend">COST REGION</legend>
                <div style={{ display: 'flex', gap: 'var(--sp-xs)' }}>
                  {REGIONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      className="seg"
                      onClick={() => selectRegion(r)}
                      aria-pressed={r === region}
                    >
                      {r.replace(' County, AZ', ', AZ')}
                    </button>
                  ))}
                </div>
                <p
                  style={{
                    margin: 'var(--sp-sm) 0 0',
                    fontSize: fontSize.method,
                    lineHeight: 1.5,
                    color: state.report.cost.hasUnsourcedLines
                      ? color.warn
                      : color.textFaint,
                  }}
                >
                  {REGION_NOTE[region] ?? ''}
                </p>
              </fieldset>

              <CostPanel cost={state.report.cost} />

              <details>
                <summary>LIMITATIONS ({state.report.limitations.length})</summary>
                <ul
                  style={{
                    margin: 'var(--sp-sm) 0 0',
                    paddingLeft: 'var(--sp-lg)',
                    fontSize: fontSize.method,
                    color: color.textMuted,
                    lineHeight: 1.7,
                  }}
                >
                  {state.report.limitations.map((l) => (
                    <li key={l.slice(0, 40)}>{l}</li>
                  ))}
                </ul>
              </details>
            </>
          )}

          {!hasPlan && (
            <div style={{ fontSize: fontSize.caption, color: color.textFaint }}>
              Measurements appear here once a schoolyard is selected.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

/** Ramp legend. Values are labelled, never colour alone. §7.2 */
function Legend({ layer }: { layer: Layer }) {
  const stops =
    layer === 'lst'
      ? [20, 25, 30, 35, 40, 45, 50, 55]
      : [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  return (
    <div className="legend">
      <span
        style={{
          fontSize: fontSize.method,
          color: color.textFaint,
          whiteSpace: 'nowrap',
        }}
      >
        {layer === 'lst' ? 'Surface temp °C' : 'NDVI'}
      </span>
      <div className="legend__stops">
        {stops.map((v) => (
          <div key={v} className="legend__stop">
            <div
              className="legend__swatch"
              style={{ background: layer === 'lst' ? lstColor(v) : ndviColor(v) }}
            />
            <div className="legend__value">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
