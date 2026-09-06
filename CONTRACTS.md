# Module contracts — PDF to Slides

Authoritative. Every module below MUST match these signatures exactly.
All modules are ES modules (`.js`, `import`/`export`). No CommonJS. No TypeScript.
No `console.log` in `src/` except through the `log` module.

## Units

- PDF page dimensions come from pdf.js `page.getViewport({scale:1})` and are in
  **PDF points** (1/72 inch).
- PPTX slide dimensions are in **inches** = points / 72.
- PowerPoint hard limit: a slide side must be within `[1, 56]` inches.

## src/core/pageRanges.js

```js
/**
 * Parse a page-range expression into a sorted, de-duplicated array of
 * 1-based page numbers.
 *
 * Accepts: "1-10, 14, 20-25", "3", " 2 , 1 ", "5-5".
 * Empty/whitespace-only input means "all pages" and returns null.
 *
 * @param {string} expr
 * @param {number} pageCount  total pages in the document, >= 1
 * @returns {number[]|null}   null = all pages; otherwise ascending unique
 * @throws {RangeError} with a human-readable `.message` on invalid input
 */
export function parsePageRanges(expr, pageCount)
```

Rules:
- Separators: comma. Whitespace anywhere is ignored.
- A range is `A-B` with `A <= B`. `B-A` where B > A throws
  `RangeError("Range \"10-3\" is backwards")`.
- A page number `< 1` throws `RangeError("Page numbers start at 1")`.
- A page number `> pageCount` throws
  `RangeError("This PDF has only N pages")` where N is pageCount.
- Any token that is not `\d+` or `\d+-\d+` throws
  `RangeError('"<token>" is not a page number or range')`.
- Overlapping ranges merge; the result is always ascending and unique.

## src/core/slideGeometry.js

```js
/** @typedef {{widthPt:number, heightPt:number}} PageSize */

/**
 * Decide the presentation-wide slide size from every page's size.
 *
 * Strategy: pick the MODE (most frequently occurring) page size, comparing
 * sizes rounded to 0.5pt. Ties are broken by whichever mode-candidate occurs
 * earliest in the document. Then clamp into PowerPoint's legal range,
 * preserving aspect ratio.
 *
 * @param {PageSize[]} pages  one entry per page being converted, length >= 1
 * @returns {{widthIn:number, heightIn:number}}  rounded to 4 decimal places
 */
export function chooseSlideSize(pages)

/**
 * Place one page image on the slide: fit inside without cropping, centred,
 * never stretched. When the page's aspect ratio equals the slide's, the
 * result fills the slide exactly (x=0, y=0).
 *
 * @param {PageSize} page
 * @param {{widthIn:number, heightIn:number}} slide
 * @returns {{x:number, y:number, w:number, h:number}} inches, 4 decimals
 */
export function placeOnSlide(page, slide)
```

Clamping rule for `chooseSlideSize`: if the longer side in inches exceeds 56,
scale both sides by `56 / longerSide`. If the shorter side is below 1, scale
both sides by `1 / shorterSide`. If both rules would apply, the 56 rule wins
(such a page cannot be represented and the caller accepts the distortion-free
downscale).

## src/core/naming.js

```js
/**
 * Turn a PDF filename into the .pptx output basename.
 * "Q3 report.pdf" -> "Q3 report.pptx";  "notes" -> "notes.pptx"
 * Strips a trailing ".pdf" case-insensitively only.
 * @param {string} pdfFilename
 * @returns {string}
 */
export function pptxNameFor(pdfFilename)

/**
 * Remove characters illegal in Windows and macOS filenames, so the same name
 * is safe on both. Replaces each of  < > : " / \ | ? *  and control chars
 * (U+0000-U+001F) with "_". Trims trailing dots and spaces (illegal on
 * Windows). Preserves all other Unicode. Never returns an empty string —
 * falls back to "presentation".
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name)

/**
 * Given a desired name and a predicate that reports whether a name is taken,
 * return the first free name, appending " (2)", " (3)", ... before the
 * extension.  "deck.pptx" -> "deck (2).pptx"
 * @param {string} name
 * @param {(candidate:string)=>Promise<boolean>} isTaken
 * @returns {Promise<string>}
 */
export async function uniqueName(name, isTaken)
```

## src/core/sizeEstimate.js

```js
/** Google Slides refuses uploads above this many bytes. */
export const GOOGLE_SLIDES_LIMIT_BYTES = 100 * 1024 * 1024;

/**
 * Estimate the finished .pptx size in bytes from measured sample renders.
 *
 * @param {number[]} sampleBytes  byte length of each already-rendered page image
 * @param {number} totalPages
 * @returns {number}  estimated bytes, including a flat 40_000 byte PPTX overhead
 */
export function estimatePptxBytes(sampleBytes, totalPages)

/** @returns {string} e.g. "2.4 MB", "812 KB", "1.1 GB" — 1 decimal above KB */
export function formatBytes(bytes)
```

`estimatePptxBytes` takes the MEAN of `sampleBytes`, multiplies by
`totalPages`, adds 40000. JPEG/PNG images are already compressed so the ZIP
container adds no meaningful saving; do not apply a compression factor.
Empty `sampleBytes` returns 40000.

## src/core/quality.js

```js
/** @typedef {"standard"|"high"|"veryHigh"} QualityKey */

/** DPI per quality key: standard 150, high 200, veryHigh 300. */
export const QUALITY_DPI = Object.freeze({standard:150, high:200, veryHigh:300});

/** Render scale to pass to pdf.js getViewport, given a DPI. PDF is 72 DPI. */
export function scaleForDpi(dpi)   // => dpi / 72
```

## src/convert/pdfRenderer.js

```js
/**
 * @typedef {Object} RenderedPage
 * @property {number} pageNumber    1-based
 * @property {Blob} blob            image data
 * @property {string} mime          "image/jpeg" | "image/png"
 * @property {number} widthPt       page width in PDF points at scale 1
 * @property {number} heightPt      page height in PDF points at scale 1
 */

/**
 * Open a PDF. Throws a PdfError (see src/core/errors.js) on failure.
 * @param {ArrayBuffer} data
 * @param {string} [password]
 * @returns {Promise<PDFDocumentProxy>}   the raw pdf.js document proxy
 */
export async function openPdf(data, password)

/**
 * Read every page's size WITHOUT rasterising.
 * @param {PDFDocumentProxy} doc
 * @returns {Promise<PageSize[]>}  index 0 = page 1
 */
export async function readPageSizes(doc)

/**
 * Render ONE page to an image Blob. Must release the canvas before returning
 * so peak memory stays at one page.
 * @param {PDFDocumentProxy} doc
 * @param {number} pageNumber  1-based
 * @param {{dpi:number, mime:string, quality:number}} opts
 * @returns {Promise<RenderedPage>}
 */
export async function renderPage(doc, pageNumber, opts)
```

## src/convert/pptxBuilder.js

```js
/**
 * Build a .pptx from rendered pages.
 * @param {{widthIn:number, heightIn:number}} slideSize
 * @param {string} title   set as the presentation title metadata
 * @returns {{addPage(rendered:RenderedPage, placement:{x,y,w,h}):Promise<void>,
 *            toBlob():Promise<Blob>}}
 */
export function createDeck(slideSize, title)
```

Every slide has a white background. No placeholders, no text boxes, no notes.

## src/core/errors.js

```js
export class PdfError extends Error {
  /** @param {string} code  one of the CODES below
   *  @param {string} message  human-readable, shown in the UI
   *  @param {Error} [cause]   original error, shown only in the technical detail */
  constructor(code, message, cause)
}

export const CODES = Object.freeze({
  PASSWORD_REQUIRED: "PASSWORD_REQUIRED",
  PASSWORD_WRONG:    "PASSWORD_WRONG",
  CORRUPT:           "CORRUPT",
  NOT_A_PDF:         "NOT_A_PDF",
  RENDER_FAILED:     "RENDER_FAILED",
  WRITE_FAILED:      "WRITE_FAILED",
  DISK_FULL:         "DISK_FULL",
  PERMISSION:        "PERMISSION",
  CANCELLED:         "CANCELLED",
});
```

## src/convert/converter.js

```js
/**
 * @typedef {Object} ConvertJob
 * @property {File} file
 * @property {string} [password]
 * @property {number[]|null} pages   from parsePageRanges; null = all
 *
 * @typedef {Object} ConvertOptions
 * @property {import("../core/quality.js").QualityKey} quality
 * @property {"image/jpeg"|"image/png"} mime
 * @property {number} jpegQuality      0..1, default 0.92
 * @property {AbortSignal} signal
 * @property {(p:Progress)=>void} onProgress
 *
 * @typedef {Object} Progress
 * @property {"opening"|"rendering"|"packaging"|"done"} phase
 * @property {number} page            1-based current page, 0 while opening
 * @property {number} pageCount       pages being converted for this file
 * @property {number} estimatedBytes  running estimate, 0 until 1st page renders
 *
 * Convert ONE pdf. Renders and appends pages one at a time; never holds more
 * than one page image plus the accumulating deck in memory.
 * Throws PdfError(CODES.CANCELLED) promptly when `signal` aborts — checked
 * before opening, before each page render, and before packaging.
 *
 * @param {ConvertJob} job
 * @param {ConvertOptions} opts
 * @returns {Promise<{blob:Blob, filename:string, slideCount:number,
 *                    slideSize:{widthIn:number,heightIn:number}}>}
 */
export async function convertPdf(job, opts)
```

`filename` is `sanitizeFilename(pptxNameFor(job.file.name))`. Collision
handling belongs to the caller (the UI), not here.
