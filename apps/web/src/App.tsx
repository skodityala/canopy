/**
 * The application shell. Presentation only — no math lives in this layer.
 *
 * Every computed quantity comes from @canopy/core; this file's job is to move a
 * ViewState through the five variants and hand each one to the right component.
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
import costData from '@canopy/cost-local/data/maricopa-az.json';

import { FIXTURES } from './data/fixtures.js';
import {
  color,
  font,
  fontSize,
  lineHeight,
  lstColor,
  ndviColor,
  radius,
  shadow,
  space,
  z,
} from './design/tokens.js';
import { MapView, type Layer } from './map/MapView.js';
import { SchoolPicker } from './panels/SchoolPicker.js';
import { MetricsPanel } from './panels/MetricsPanel.js';
import { CostPanel } from './panels/CostPanel.js';
import { EmptyState, LoadingState } from './states/EmptyAndLoading.js';
import { ErrorState } from './states/ErrorState.js';
import { SyntheticBadge } from './states/SuppressedState.js';
import { readyKindFor, type ViewState } from './states/ViewState.js';

const REGION = 'Maricopa County, AZ';
/** Fixed so the UI and the committed PDF/SVG agree exactly. */
const REPORT_DATE = '2026-08-05';
const DEFAULT_TREES = 12;

const imagery = createFixtureImageryPort(FIXTURES);
const costs = createLocalCostModelPort({
  [REGION]: costData as unknown as CostModelJson,
});

export function App() {
  const [state, setState] = useState<ViewState>({ kind: 'empty', schools: [] });
  const [layer, setLayer] = useState<Layer>('lst');
  const [showGrid, setShowGrid] = useState(true);
  const [classes, setClasses] = useState<readonly PlantingClass[]>([]);

  // Boot: list the bundled schools.
  useEffect(() => {
    void (async () => {
      const [schools, plantingClasses] = await Promise.all([
        imagery.list(),
        costs.plantingClasses(REGION),
      ]);
      setClasses(plantingClasses);
      setState({ kind: 'empty', schools });
    })();
  }, []);

  const crownRadii = useMemo(
    () => new Map(classes.map((c) => [c.key, c.crownRadiusM])),
    [classes],
  );

  /** Recompute a report for a school with an explicit tree list. */
  const analyse = useCallback(
    async (slug: string, schools: readonly SchoolMeta[], treesOverride?: readonly Tree[]) => {
      setState({ kind: 'loading', schools, slug });
      try {
        const scene = await imagery.load(slug);
        const analysis = analyseScene(scene);
        const costModel = await costs.forRegion(REGION);
        const plantingClasses = await costs.plantingClasses(REGION);

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
    [],
  );

  const selectSchool = useCallback(
    (slug: string) => void analyse(slug, state.schools),
    [analyse, state.schools],
  );

  /** Add a tree where the user clicked, then recompute. */
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

  const clearTrees = useCallback(() => {
    if (state.kind !== 'ready' && state.kind !== 'suppressed') return;
    void analyse(state.meta.slug, state.schools, []);
  }, [analyse, state]);

  /**
   * Force the error state, so all five states are reachable in a live demo
   * without editing a fixture. Loads a slug that does not exist, which the
   * fixture adapter rejects with a typed FIXTURE_MALFORMED.
   */
  const forceError = useCallback(
    () => void analyse('no-such-school', state.schools),
    [analyse, state.schools],
  );

  const selected =
    state.kind === 'ready' || state.kind === 'suppressed'
      ? state.meta.slug
      : state.kind === 'loading' || state.kind === 'error'
        ? state.slug
        : null;

  const schoolName =
    state.schools.find((s) => s.slug === selected)?.name ?? selected ?? 'this schoolyard';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(230px, 260px) 1fr minmax(330px, 380px)',
        height: '100%',
        background: color.bg,
      }}
    >
      {/* ── Left: picker + layer controls. Quiet by design. */}
      <aside
        style={{
          borderRight: `1px solid ${color.border}`,
          padding: space.lg,
          display: 'flex',
          flexDirection: 'column',
          gap: space.xl,
          overflowY: 'auto',
          zIndex: z.panel,
        }}
      >
        <header>
          <div
            style={{
              font: `${font.weightBold} ${fontSize.subhead}px/${lineHeight.tight} ${font.text}`,
              color: color.accent,
              letterSpacing: '-0.01em',
            }}
          >
            🌳 Canopy
          </div>
          <div
            style={{
              font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
              color: color.textFaint,
              marginTop: 2,
            }}
          >
            Schoolyard shade plans from satellite imagery
          </div>
        </header>

        <SchoolPicker schools={state.schools} selected={selected} onSelect={selectSchool} />

        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
          <legend
            style={{
              font: `${font.weightBold} ${fontSize.method}px/${lineHeight.tight} ${font.text}`,
              color: color.textFaint,
              letterSpacing: '0.08em',
              marginBottom: space.sm,
            }}
          >
            MAP LAYER
          </legend>
          <div style={{ display: 'flex', gap: space.xs }}>
            {(['lst', 'ndvi'] as const).map((l) => (
              <button
                key={l}
                type="button"
                onClick={() => setLayer(l)}
                aria-pressed={layer === l}
                style={{
                  flex: 1,
                  cursor: 'pointer',
                  background: layer === l ? color.accentMuted : 'transparent',
                  color: layer === l ? color.text : color.textMuted,
                  border: `1px solid ${layer === l ? color.accent : color.border}`,
                  borderRadius: radius.sm,
                  padding: `${space.xs}px ${space.sm}px`,
                  font: `${font.weightNormal} ${fontSize.caption}px/1.4 ${font.text}`,
                }}
              >
                {l === 'lst' ? 'Temperature' : 'Vegetation'}
              </button>
            ))}
          </div>

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: space.sm,
              marginTop: space.md,
              font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.normal} ${font.text}`,
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

        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: space.sm }}>
          <button
            type="button"
            onClick={clearTrees}
            style={ghostButton}
            disabled={state.kind !== 'ready' && state.kind !== 'suppressed'}
          >
            Clear trees
          </button>
          {/* Makes the error state demoable without breaking a fixture. */}
          <button type="button" onClick={forceError} style={ghostButton}>
            Simulate data failure
          </button>
          <div
            style={{
              font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.text}`,
              color: color.textFaint,
            }}
          >
            Runs fully offline. No request leaves this machine.
          </div>
        </div>
      </aside>

      {/* ── Centre: the map is the hero. */}
      <main style={{ position: 'relative', padding: space.lg, minWidth: 0 }}>
        {state.kind === 'empty' && (
          <div style={{ height: '100%', display: 'flex' }}>
            <EmptyState schools={state.schools} />
          </div>
        )}

        {state.kind === 'loading' && (
          <div style={{ height: '100%', display: 'grid', placeItems: 'center' }}>
            <div style={{ width: 'min(560px, 100%)' }}>
              <LoadingState name={schoolName} />
            </div>
          </div>
        )}

        {state.kind === 'error' && (
          <div style={{ height: '100%', display: 'flex' }}>
            <ErrorState error={state.error} schoolName={schoolName} />
          </div>
        )}

        {(state.kind === 'ready' || state.kind === 'suppressed') && (
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: space.md }}>
            <div style={{ flex: 1, minHeight: 0 }}>
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
          </div>
        )}
      </main>

      {/* ── Right: the numbers, each with its method. */}
      <aside
        style={{
          borderLeft: `1px solid ${color.border}`,
          padding: space.lg,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: space.lg,
          boxShadow: shadow.panel,
          zIndex: z.panel,
        }}
      >
        {(state.kind === 'ready' || state.kind === 'suppressed') && (
          <>
            <div>
              <div
                style={{
                  font: `${font.weightBold} ${fontSize.subhead}px/${lineHeight.tight} ${font.text}`,
                  color: color.text,
                }}
              >
                {state.report.school.name}
              </div>
              <div
                style={{
                  font: `${font.weightNormal} ${fontSize.method}px/${lineHeight.normal} ${font.display}`,
                  color: color.textFaint,
                  marginTop: 2,
                }}
              >
                {state.report.school.city}, {state.report.school.state} · yard{' '}
                {state.report.school.yardAreaM2.toLocaleString('en-US')} m²
              </div>
            </div>

            {state.report.school.synthetic && (
              <SyntheticBadge provenance="Pixel values are generated, not observed. Yard geometry is real OpenStreetMap data." />
            )}

            <MetricsPanel report={state.report} />
            <CostPanel cost={state.report.cost} />

            <details>
              <summary
                style={{
                  cursor: 'pointer',
                  font: `${font.weightBold} ${fontSize.method}px/${lineHeight.tight} ${font.text}`,
                  color: color.textFaint,
                  letterSpacing: '0.08em',
                }}
              >
                LIMITATIONS ({state.report.limitations.length})
              </summary>
              <ul
                style={{
                  margin: `${space.sm}px 0 0`,
                  paddingLeft: space.lg,
                  font: `${font.weightNormal} ${fontSize.method}px/1.7 ${font.text}`,
                  color: color.textMuted,
                }}
              >
                {state.report.limitations.map((l) => (
                  <li key={l.slice(0, 40)}>{l}</li>
                ))}
              </ul>
            </details>
          </>
        )}

        {state.kind !== 'ready' && state.kind !== 'suppressed' && (
          <div
            style={{
              font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.normal} ${font.text}`,
              color: color.textFaint,
            }}
          >
            Measurements appear here once a schoolyard is selected.
          </div>
        )}
      </aside>
    </div>
  );
}

const ghostButton = {
  cursor: 'pointer',
  background: 'transparent',
  color: color.textMuted,
  border: `1px solid ${color.border}`,
  borderRadius: radius.sm,
  padding: `${space.sm}px ${space.md}px`,
  font: `${font.weightNormal} ${fontSize.caption}px/1.4 ${font.text}`,
  textAlign: 'left' as const,
};

/** Ramp legend. Values are labelled, never colour alone. §7.2 */
function Legend({ layer }: { layer: Layer }) {
  const stops =
    layer === 'lst'
      ? [20, 25, 30, 35, 40, 45, 50, 55]
      : [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7];
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: space.md }}>
      <span
        style={{
          font: `${font.weightNormal} ${fontSize.method}px/1 ${font.text}`,
          color: color.textFaint,
          whiteSpace: 'nowrap',
        }}
      >
        {layer === 'lst' ? 'Surface temp °C' : 'NDVI'}
      </span>
      <div style={{ display: 'flex', flex: 1 }}>
        {stops.map((v) => (
          <div key={v} style={{ flex: 1, textAlign: 'center' }}>
            <div
              style={{
                height: 8,
                background: layer === 'lst' ? lstColor(v) : ndviColor(v),
              }}
            />
            <div
              style={{
                font: `${font.weightNormal} ${fontSize.method}px/1.6 ${font.display}`,
                color: color.textFaint,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {v}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

