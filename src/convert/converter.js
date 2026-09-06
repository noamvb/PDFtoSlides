import { CODES, PdfError } from "../core/errors.js";
import { chooseSlideSize, placeOnSlide } from "../core/slideGeometry.js";
import { pptxNameFor, sanitizeFilename } from "../core/naming.js";
import { estimatePptxBytes } from "../core/sizeEstimate.js";
import { QUALITY_DPI } from "../core/quality.js";
import { createDeck } from "./pptxBuilder.js";
import { openPdf, readPageSizes, renderPage } from "./pdfRenderer.js";
import { convertPdfInWorker, workerSupported } from "./workerClient.js";

let workerDisabled = false;

function throwIfAborted(signal) {
  if (signal?.aborted) throw new PdfError(CODES.CANCELLED, "Conversion cancelled.");
}

export async function convertPdf(job, opts) {
  if (!workerDisabled && workerSupported()) {
    try {
      return await convertPdfInWorker(job, opts);
    } catch (cause) {
      if (!cause?.workerStartup) throw cause;
      workerDisabled = true;
    }
  }
  return convertPdfOnMainThread(job, opts);
}

async function convertPdfOnMainThread(job, opts) {
  const { signal, onProgress } = opts;
  throwIfAborted(signal);
  onProgress({ phase: "opening", page: 0, pageCount: 0, estimatedBytes: 0 });

  let doc;
  try {
    const buf = await job.file.arrayBuffer();
    doc = await openPdf(buf, job.password);
    const sizes = await readPageSizes(doc);
    const pageNumbers = job.pages ?? sizes.map((_, index) => index + 1);
    if (pageNumbers.length === 0) {
      throw new PdfError(CODES.RENDER_FAILED, "No pages selected.");
    }
    const slideSize = chooseSlideSize(pageNumbers.map((pageNumber) => sizes[pageNumber - 1]));
    const deck = await createDeck(slideSize, job.file.name);
    const sampleBytes = [];

    for (let index = 0; index < pageNumbers.length; index += 1) {
      throwIfAborted(signal);
      const rendered = await renderPage(doc, pageNumbers[index], {
        dpi: QUALITY_DPI[opts.quality],
        mime: opts.mime,
        quality: opts.jpegQuality ?? 0.92,
      });
      await deck.addPage(
        rendered,
        placeOnSlide(
          { widthPt: rendered.widthPt, heightPt: rendered.heightPt },
          slideSize,
        ),
      );
      sampleBytes.push(rendered.blob.size);
      onProgress({
        phase: "rendering",
        page: index + 1,
        pageCount: pageNumbers.length,
        estimatedBytes: estimatePptxBytes(sampleBytes, pageNumbers.length),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    throwIfAborted(signal);
    onProgress({
      phase: "packaging",
      page: pageNumbers.length,
      pageCount: pageNumbers.length,
      estimatedBytes: estimatePptxBytes(sampleBytes, pageNumbers.length),
    });
    const blob = await deck.toBlob();
    onProgress({
      phase: "done",
      page: pageNumbers.length,
      pageCount: pageNumbers.length,
      estimatedBytes: blob.size,
    });
    return {
      blob,
      filename: sanitizeFilename(pptxNameFor(job.file.name)),
      slideCount: pageNumbers.length,
      slideSize,
    };
  } finally {
    if (doc) await doc.destroy();
  }
}
