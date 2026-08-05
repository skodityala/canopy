/**
 * Print the full report for every fixture — what the PDF and the UI will say.
 *
 * Usage: npx vite-node tools/ingest/src/report.ts
 */

import { formatCostRange } from '@canopy/core';
import { FIXTURE_SLUGS } from './loadFixtures.js';
import { buildForSlug } from './pipeline.js';

for (const slug of FIXTURE_SLUGS) {
  const { report: r, trees } = await buildForSlug(slug);
  const p = r.plan;

  const lines: string[] = [
    `══ ${r.school.name} — ${r.school.city}, ${r.school.state}`,
    `   yard ${r.school.yardAreaM2.toLocaleString('en-US')} m²  ·  synthetic=${r.school.synthetic}`,
    `   canopy   ${fmt(p.canopyPctBefore)}% → ${fmt(p.canopyPctAfter)}%   (Δ ${fmt(p.canopyPctDelta)} pts)`,
    `   trees    ${p.treeCount}  ·  crowns Σ ${Math.round(p.summedCrownM2)} m² → union ${Math.round(p.unionCrownM2)} m² (${(p.overlapFraction * 100).toFixed(1)}% overlap)`,
    `   effective new shade ${Math.round(p.effectiveAddedM2)} m²  ·  ΔNDVI_yard ${p.deltaNdviYard.toFixed(4)}`,
    `   LST measured ${fmt(r.measured.lstMeanC)} °C  (n=${r.measured.thermalPixels} px, coverage ${(r.measured.coverage * 100).toFixed(1)}%)`,
  ];

  if (r.prediction.kind === 'suppressed') {
    lines.push(`   ΔT       ⛔ SUPPRESSED (${r.prediction.reason})`);
    lines.push(`            ${r.prediction.explanation}`);
  } else {
    const pr = r.prediction;
    lines.push(
      `   ΔT       ${pr.deltaC.toFixed(2)} °C   95% CI [${pr.ci95[0].toFixed(2)}, ${pr.ci95[1].toFixed(2)}]  kind=${pr.kind}`,
    );
    lines.push(`            → predicted mean ${fmt(r.predictedLstMeanC)} °C`);
    lines.push(`            method: ${r.deltaMethod}`);
  }

  lines.push(
    `   cost     ${formatCostRange(r.cost)}  ·  lines=${r.cost.lines.length}  unsourced=${r.cost.hasUnsourcedLines}`,
  );
  lines.push(`   limitations: ${r.limitations.length} stated`);
  lines.push(`   trees placed: ${trees.map((t) => t.classKey).join(', ')}`);
  lines.push('');

  process.stdout.write(`${lines.join('\n')}\n`);
}

function fmt(v: number | null): string {
  return v === null || !Number.isFinite(v) ? '—' : v.toFixed(1);
}
