/**
 * The metrics panel. Every figure goes through <Measured>, which requires a
 * `method` prop — so a bare number here is a type error, not an oversight. §7
 */

import type { Report } from '@canopy/core';
import { Measured } from '../components/Measured.js';
import { SuppressedNotice } from '../states/SuppressedState.js';
import { color, font, fontSize, lineHeight, ndviColor, space } from '../design/tokens.js';

export function MetricsPanel({ report }: { report: Report }) {
  const m = report.measured;
  const plan = report.plan;
  const img = report.imagery;

  const canopyMethod =
    `Sentinel-2 B8/B4 at 10 m · NDVI ≥ ${img.ndviCanopyThreshold} classified as canopy ` +
    `(threshold hand-validated for this site) · ${img.opticalDate}`;

  const lstMethod =
    `${img.spacecraft.replace('_', ' ')} B10, ${img.thermalDate}, ${img.localOverpassTime} local ` +
    `overpass · mean of ${m.thermalPixels} thermal pixel${m.thermalPixels === 1 ? '' : 's'} ` +
    `at 100 m native · peak afternoon temperature is higher than at overpass`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: space.xl }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: space.lg }}>
        <Measured
          label="CANOPY COVER NOW"
          value={plan.canopyPctBefore}
          unit="%"
          method={canopyMethod}
          swatch={ndviColor(0.7)}
          unknownReason="No cloud-free optical pixels inside this yard."
        />
        <Measured
          label="AFTER THIS PLAN"
          value={plan.canopyPctAfter}
          unit="%"
          method={`Crown union ${Math.round(plan.unionCrownM2).toLocaleString('en-US')} m² after ${(plan.overlapFraction * 100).toFixed(1)}% measured geometric overlap, discounted for ground already shaded · projected at ~${plan.maturityYears}-year maturity`}
          swatch={color.accent}
        />
      </div>

      <Measured
        label="RECESS YARD SURFACE TEMPERATURE"
        value={m.lstMeanC}
        unit="°C"
        method={lstMethod}
        size="metric"
        unknownReason="Cloud cover masked too much of this yard to report a temperature."
      />

      {report.prediction.kind === 'suppressed' ? (
        <SuppressedNotice prediction={report.prediction} />
      ) : (
        <Measured
          label="PREDICTED CHANGE AFTER PLANTING"
          value={report.prediction.deltaC}
          unit="°C"
          signed
          size="hero"
          ci95={report.prediction.ci95}
          caveat={report.prediction.kind === 'weak' ? report.prediction.caveat : undefined}
          method={report.deltaMethod ?? ''}
        />
      )}

      {report.predictedLstMeanC !== null && (
        <p
          style={{
            margin: 0,
            font: `${font.weightNormal} ${fontSize.caption}px/${lineHeight.normal} ${font.text}`,
            color: color.textFaint,
          }}
        >
          Yard mean would move {m.lstMeanC.toFixed(1)} °C → {report.predictedLstMeanC.toFixed(1)} °C.
          This is an association from a fit on this scene, not a causal claim.
        </p>
      )}
    </div>
  );
}
