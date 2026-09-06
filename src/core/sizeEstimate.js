/** Google Slides refuses uploads above this many bytes. */
export const GOOGLE_SLIDES_LIMIT_BYTES = 100 * 1024 * 1024;

/**
 * Estimate the finished .pptx size in bytes from measured sample renders.
 *
 * @param {number[]} sampleBytes byte length of each already-rendered page image
 * @param {number} totalPages
 * @returns {number} estimated bytes, including a flat 40_000 byte overhead
 */
export function estimatePptxBytes(sampleBytes, totalPages) {
  if (sampleBytes.length === 0) return 40000;
  const mean = sampleBytes.reduce((sum, bytes) => sum + bytes, 0) / sampleBytes.length;
  return mean * totalPages + 40000;
}

/** @returns {string} formatted byte count */
export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes === 1 ? 1 : bytes} byte${bytes === 1 ? "" : "s"}`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
