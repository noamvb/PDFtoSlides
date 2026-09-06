/** @typedef {"standard"|"high"|"veryHigh"} QualityKey */

/** DPI per quality key: standard 150, high 200, veryHigh 300. */
export const QUALITY_DPI = Object.freeze({ standard: 150, high: 200, veryHigh: 300 });

/** Render scale to pass to pdf.js getViewport, given a DPI. PDF is 72 DPI. */
export function scaleForDpi(dpi) {
  return dpi / 72;
}
