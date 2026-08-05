/**
 * The suppression detail card — a close-up of the refusal, for the README.
 *
 * Built on the same Surface abstraction, so it inherits the palette and cannot
 * drift from the report's own styling.
 */

import { SvgSurface, ink } from '@canopy/render';
import { buildForSlug } from '../pipeline.js';
import { FAILURE_SLUG } from '../write-assets.js';

export async function renderSuppressedPreview(): Promise<string> {
  const { report } = await buildForSlug(FAILURE_SLUG);
  const s = new SvgSurface(ink.bg);

  const W = 595;
  const x = 32;
  let y = 46;

  s.text(x, y, 'WHEN THE DATA CANNOT SUPPORT THE CLAIM', {
    size: 9,
    color: ink.textFaint,
    family: 'sans',
    bold: true,
  });
  y += 26;

  s.text(x, y, report.school.name, { size: 16, color: ink.text, family: 'sans', bold: true });
  y += 22;

  // The measured value still shows — only the prediction is withheld.
  s.text(x, y, 'MEASURED SURFACE TEMPERATURE', {
    size: 8,
    color: ink.textMuted,
    family: 'sans',
  });
  y += 24;
  const lst = report.measured.lstMeanC;
  s.text(x, y, Number.isFinite(lst) ? lst.toFixed(1) : '—', {
    size: 30,
    color: ink.text,
    family: 'mono',
    bold: true,
  });
  s.text(x + 62, y, '°C', { size: 13, color: ink.textMuted, family: 'mono' });
  y += 16;
  s.text(
    x,
    y,
    `mean of ${report.measured.thermalPixels} cloud-free thermal pixel(s) · ` +
      `${(report.measured.coverage * 100).toFixed(0)}% of the yard usable`,
    { size: 7.5, color: ink.textFaint, family: 'sans' },
  );
  y += 30;

  if (report.prediction.kind === 'suppressed') {
    const boxH = 84;
    s.rect(x, y, W - x * 2, boxH, {
      fill: '#241a0c',
      stroke: ink.warn,
      strokeWidth: 1,
    });
    s.text(x + 14, y + 22, 'PREDICTED TEMPERATURE CHANGE', {
      size: 8,
      color: ink.warn,
      family: 'sans',
      bold: true,
    });
    s.text(x + 14, y + 46, 'WITHHELD', {
      size: 22,
      color: ink.warn,
      family: 'mono',
      bold: true,
    });

    const words = report.prediction.explanation.split(/\s+/);
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      const next = cur === '' ? w : `${cur} ${w}`;
      if (next.length > 72) {
        lines.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur !== '') lines.push(cur);

    let ly = y + boxH + 18;
    for (const line of lines) {
      s.text(x, ly, line, { size: 8.5, color: ink.textMuted, family: 'sans' });
      ly += 12;
    }

    ly += 8;
    s.text(x, ly, 'A number a judge can break is worse than no number.', {
      size: 8,
      color: ink.textFaint,
      family: 'sans',
    });
  }

  return s.toSvg();
}
