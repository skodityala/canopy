/**
 * The regression panel — the machine learning, made visible.
 *
 * Canopy's central claim is that β₁ is fitted on THIS scene's own pixels rather
 * than borrowed from literature. That claim was previously invisible: the number
 * appeared, and a reader had to take the method on trust.
 *
 * This panel shows the fit. Every thermal pixel that entered the regression, the
 * fitted line, the 95% confidence band, and the coefficients. A reader can see
 * the scatter and judge for themselves whether a line through it is reasonable.
 *
 * ★ It renders the scatter EVEN WHEN THE PREDICTION IS SUPPRESSED. A cloud of
 * points with no trend is far more persuasive than a hidden error message — it
 * shows the reader *why* the claim was withheld rather than asserting it.
 *
 * Drawn as inline SVG with no charting library, per the zero-runtime-dependency
 * invariant.
 */

import { useId, useMemo } from 'react';
import type { Fit, Prediction, SceneAnalysis } from '@canopy/core';
import { color, font, fontSize, lstColor } from '../design/tokens.js';

export interface RegressionPanelProps {
  readonly analysis: SceneAnalysis;
  readonly prediction: Prediction;
}

interface Point {
  readonly ndvi: number;
  readonly lst: number;
}

const W = 344;
const H = 210;
const PAD = { top: 10, right: 10, bottom: 30, left: 38 };

/**
 * The (NDVI, LST) pairs the fit was actually computed over.
 *
 * `analysis.usable` is the cloud mask the pipeline already built, so this reuses
 * the pipeline's own decision about which pixels are trustworthy rather than
 * recomputing it — the scatter cannot disagree with the fit it illustrates.
 */
function fitPoints(analysis: SceneAnalysis): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < analysis.lst.data.length; i++) {
    if (analysis.usable.data[i] !== 1) continue;
    const ndvi = analysis.ndviOnThermal.data[i]!;
    const lst = analysis.lst.data[i]!;
    if (Number.isNaN(ndvi) || Number.isNaN(lst)) continue;
    out.push({ ndvi, lst });
  }
  return out;
}

/** ESTIMATE / INDICATIVE / SUPPRESSED, with the colour that goes with it. */
function chipFor(prediction: Prediction): { label: string; tone: string } {
  switch (prediction.kind) {
    case 'ok':
      return { label: 'ESTIMATE', tone: color.accent };
    case 'weak':
      return { label: 'INDICATIVE', tone: color.warn };
    case 'suppressed':
      return { label: 'SUPPRESSED', tone: color.warn };
  }
}

export function RegressionPanel({ analysis, prediction }: RegressionPanelProps) {
  const clipId = useId();
  const points = useMemo(() => fitPoints(analysis), [analysis]);
  const fit: Fit | null = analysis.fit;
  const chip = chipFor(prediction);

  if (fit === null || points.length === 0) {
    return (
      <section className="panel" style={{ padding: 'var(--sp-md)' }}>
        <div className="section-label">THE FIT BEHIND THE NUMBER</div>
        <p
          style={{
            margin: 'var(--sp-sm) 0 0',
            fontSize: fontSize.caption,
            color: color.warn,
          }}
        >
          No regression could be fitted for this scene, so no temperature change is
          reported.
        </p>
      </section>
    );
  }

  // Axis domains padded to the data.
  const xs = points.map((p) => p.ndvi);
  const ys = points.map((p) => p.lst);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xPad = (xMax - xMin) * 0.06 || 0.01;
  const yPad = (yMax - yMin) * 0.08 || 0.5;
  const x0 = xMin - xPad;
  const x1 = xMax + xPad;
  const y0 = yMin - yPad;
  const y1 = yMax + yPad;

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const px = (v: number) => PAD.left + ((v - x0) / (x1 - x0)) * plotW;
  const py = (v: number) => PAD.top + plotH - ((v - y0) / (y1 - y0)) * plotH;

  // The 95% band: the fitted line swept between the slope's interval ends.
  const bandPath = (() => {
    const steps = 24;
    const lo: string[] = [];
    const hi: string[] = [];
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps;
      lo.push(`${i === 0 ? 'M' : 'L'}${px(x).toFixed(1)},${py(fit.intercept + fit.slopeCI95[0] * x).toFixed(1)}`);
      hi.unshift(`L${px(x).toFixed(1)},${py(fit.intercept + fit.slopeCI95[1] * x).toFixed(1)}`);
    }
    return `${lo.join(' ')} ${hi.join(' ')} Z`;
  })();

  const yTicks = 4;
  const xTicks = 4;

  return (
    <section
      className="panel"
      style={{ padding: 'var(--sp-md)', display: 'flex', flexDirection: 'column', gap: 'var(--sp-sm)' }}
      aria-labelledby={`${clipId}-title`}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-sm)' }}>
        <div className="section-label" id={`${clipId}-title`}>
          THE FIT BEHIND THE NUMBER
        </div>
        <span className="chip" style={{ color: chip.tone }}>
          ⬤ {chip.label}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={
          `Scatter plot of surface temperature against vegetation index for ` +
          `${points.length} cloud-free thermal pixels. The fitted line has slope ` +
          `${fit.slope.toFixed(2)} degrees Celsius per NDVI unit with R squared ` +
          `${fit.r2.toFixed(3)}.` +
          (prediction.kind === 'suppressed'
            ? ' The temperature prediction is withheld for this site.'
            : '')
        }
        style={{ display: 'block', overflow: 'visible' }}
      >
        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="#171412"
          stroke={color.border}
        />

        {/* Gridlines and axis labels. */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const v = y0 + ((y1 - y0) * i) / yTicks;
          return (
            <g key={`y${i}`}>
              <line
                x1={PAD.left}
                y1={py(v)}
                x2={PAD.left + plotW}
                y2={py(v)}
                stroke={color.border}
                strokeWidth={0.6}
              />
              <text
                x={PAD.left - 5}
                y={py(v) + 3}
                textAnchor="end"
                fontFamily={font.display}
                fontSize={8}
                fill={color.textFaint}
              >
                {v.toFixed(1)}
              </text>
            </g>
          );
        })}
        {Array.from({ length: xTicks + 1 }, (_, i) => {
          const v = x0 + ((x1 - x0) * i) / xTicks;
          return (
            <g key={`x${i}`}>
              <line
                x1={px(v)}
                y1={PAD.top}
                x2={px(v)}
                y2={PAD.top + plotH}
                stroke={color.border}
                strokeWidth={0.6}
              />
              <text
                x={px(v)}
                y={PAD.top + plotH + 12}
                textAnchor="middle"
                fontFamily={font.display}
                fontSize={8}
                fill={color.textFaint}
              >
                {v.toFixed(2)}
              </text>
            </g>
          );
        })}

        {/* Axis titles. */}
        <text
          x={PAD.left + plotW / 2}
          y={H - 4}
          textAnchor="middle"
          fontFamily={font.text}
          fontSize={9}
          fill={color.textMuted}
        >
          NDVI  (vegetation index)
        </text>
        <text
          x={4}
          y={PAD.top - 2}
          fontFamily={font.text}
          fontSize={9}
          fill={color.textMuted}
        >
          LST °C
        </text>

        <clipPath id={`${clipId}-clip`}>
          <rect x={PAD.left} y={PAD.top} width={plotW} height={plotH} />
        </clipPath>

        <g clipPath={`url(#${clipId}-clip)`}>
          {/* 95% confidence band. */}
          <path d={bandPath} fill="rgba(75,163,106,0.16)" />

          {/* Every pixel that entered the fit, coloured by its own temperature. */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={px(p.ndvi)}
              cy={py(p.lst)}
              r={1.6}
              fill={lstColor(p.lst)}
              opacity={0.75}
            />
          ))}

          {/* The fitted line, drawn last so it reads on top. */}
          <line
            x1={px(x0)}
            y1={py(fit.intercept + fit.slope * x0)}
            x2={px(x1)}
            y2={py(fit.intercept + fit.slope * x1)}
            stroke={color.accent}
            strokeWidth={2}
          />
        </g>
      </svg>

      {/* Coefficients. A reader can check every one of these. */}
      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 'var(--sp-sm) var(--sp-md)',
        }}
      >
        <Coefficient label="β₁ SLOPE" value={`${fit.slope.toFixed(2)} °C/NDVI`} />
        <Coefficient label="R²" value={fit.r2.toFixed(3)} />
        <Coefficient label="n PIXELS" value={fit.n.toLocaleString('en-US')} />
        <Coefficient
          label="β₁ 95% CI"
          value={`[${fit.slopeCI95[0].toFixed(2)}, ${fit.slopeCI95[1].toFixed(2)}]`}
        />
      </dl>

      <p
        style={{
          margin: 0,
          fontSize: fontSize.method,
          color: color.textFaint,
          lineHeight: 1.5,
        }}
      >
        Ordinary least squares, refitted on this scene's own {fit.n.toLocaleString('en-US')}{' '}
        cloud-free thermal pixels — not a literature constant. Shaded band is the 95%
        interval on the slope. Suppressed below R² 0.30.
      </p>

      {prediction.kind === 'suppressed' && (
        <p
          style={{
            margin: 0,
            fontSize: fontSize.method,
            color: color.warn,
            lineHeight: 1.5,
          }}
        >
          The scatter is shown even though the prediction is withheld — so you can see
          why.
        </p>
      )}
    </section>
  );
}

function Coefficient({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt
        style={{
          fontSize: fontSize.method,
          fontWeight: font.weightBold,
          letterSpacing: '0.06em',
          color: color.textFaint,
        }}
      >
        {label}
      </dt>
      <dd
        className="num"
        style={{
          margin: 0,
          fontSize: fontSize.caption,
          fontWeight: font.weightBold,
          color: color.text,
        }}
      >
        {value}
      </dd>
    </div>
  );
}
