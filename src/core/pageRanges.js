/**
 * Parse a page-range expression into a sorted, de-duplicated array of
 * 1-based page numbers.
 *
 * @param {string} expr
 * @param {number} pageCount total pages in the document, >= 1
 * @returns {number[]|null} null = all pages; otherwise ascending unique
 * @throws {RangeError} with a human-readable message on invalid input
 */
export function parsePageRanges(expr, pageCount) {
  const compact = expr.replace(/\s/g, "");
  if (compact === "") return null;

  const pages = new Set();
  for (const token of compact.split(",")) {
    const rangeMatch = token.match(/^(\d+)-(\d+)$/);
    const numberMatch = token.match(/^\d+$/);
    if (!rangeMatch && !numberMatch) {
      throw new RangeError(`"${token}" is not a page number or range`);
    }

    const start = Number(rangeMatch ? rangeMatch[1] : token);
    const end = Number(rangeMatch ? rangeMatch[2] : token);
    if (rangeMatch && end < start) {
      throw new RangeError(`Range "${token}" is backwards`);
    }
    if (start < 1 || end < 1) {
      throw new RangeError("Page numbers start at 1");
    }
    if (start > pageCount || end > pageCount) {
      throw new RangeError(`This PDF has only ${pageCount} pages`);
    }
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}
