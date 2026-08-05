/** One renderer, two backends. §5.2 */

export {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  approximateTextWidth,
  type FillStyle,
  type Surface,
  type TextStyle,
} from './Surface.js';
export { SvgSurface } from './SvgSurface.js';
export { drawReport } from './drawReport.js';
export { ink, layout, lstColor, lstRamp, ndviRamp, lstDomainC, sampleRamp } from './theme.js';
