import { CODES } from "../core/errors.js";
import { chooseSlideSize, placeOnSlide } from "../core/slideGeometry.js";
import { estimatePptxBytes } from "../core/sizeEstimate.js";

const cancelled = new Set();

function post(message) {
  self.postMessage(message);
}

function cancelledError(id) {
  return { type: "error", id, code: CODES.CANCELLED, message: "Conversion cancelled.", detail: "" };
}

function checkCancelled(id) {
  if (!cancelled.has(id)) return false;
  post(cancelledError(id));
  return true;
}

function mapOpenError(cause) {
  if (cause?.name === "PasswordException" && cause.code === 1) {
    return [CODES.PASSWORD_REQUIRED, "This PDF is password-protected."];
  }
  if (cause?.name === "PasswordException" && cause.code === 2) {
    return [CODES.PASSWORD_WRONG, "That password didn't work."];
  }
  if (cause?.name === "InvalidPDFException" || cause?.message?.includes("Invalid PDF structure")) {
    return [CODES.CORRUPT, "This file is damaged and can't be read."];
  }
  return [CODES.CORRUPT, "This PDF couldn't be opened."];
}

function mapError(cause) {
  if (cause?.__renderError) return [CODES.RENDER_FAILED, cause.message];
  if (cause?.__noPages) return [CODES.RENDER_FAILED, "No pages selected."];
  return mapOpenError(cause);
}

function blobToBase64(blob) {
  return blob.arrayBuffer().then((buffer) => {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    return btoa(binary);
  });
}

async function createDeck(slideSize, title) {
  const pptx = new self.PptxGenJS();
  pptx.defineLayout({ name: "PDFPAGE", width: slideSize.widthIn, height: slideSize.heightIn });
  pptx.layout = "PDFPAGE";
  pptx.title = title;
  pptx.subject = "Converted from PDF";
  pptx.company = "";
  pptx.author = "PDF to Slides";
  return {
    async addPage(rendered, placement) {
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };
      slide.addImage({
        data: `data:${rendered.mime};base64,${await blobToBase64(rendered.blob)}`,
        x: placement.x, y: placement.y, w: placement.w, h: placement.h,
      });
    },
    toBlob() { return pptx.write({ outputType: "blob" }); },
  };
}

async function convert(message) {
  const { id, bytes, password, pages, dpi, mime, quality, title } = message;
  if (checkCancelled(id)) return;
  post({ type: "progress", id, phase: "opening", page: 0, pageCount: 0, estimatedBytes: 0 });

  let doc;
  try {
    doc = await self.pdfjsLib.getDocument({ data: bytes, password, useSystemFonts: true }).promise;
    if (checkCancelled(id)) return;
    const sizes = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      try {
        const viewport = page.getViewport({ scale: 1 });
        sizes.push({ widthPt: viewport.width, heightPt: viewport.height });
      } finally {
        page.cleanup();
      }
    }
    const pageNumbers = pages ?? sizes.map((_, index) => index + 1);
    if (pageNumbers.length === 0) {
      const error = new Error("No pages selected.");
      error.__noPages = true;
      throw error;
    }
    const slideSize = chooseSlideSize(pageNumbers.map((pageNumber) => sizes[pageNumber - 1]));
    const deck = await createDeck(slideSize, title);
    const sampleBytes = [];
    for (let index = 0; index < pageNumbers.length; index += 1) {
      const pageNumber = pageNumbers[index];
      if (checkCancelled(id)) return;
      const page = await doc.getPage(pageNumber);
      let blob;
      try {
        const baseViewport = page.getViewport({ scale: 1 });
        let viewport = page.getViewport({ scale: dpi / 72 });
        let width = Math.ceil(viewport.width);
        let height = Math.ceil(viewport.height);
        if (width * height > 40_000_000) {
          const scale = Math.sqrt(40_000_000 / (width * height));
          viewport = page.getViewport({ scale: (dpi / 72) * scale });
          width = Math.ceil(viewport.width);
          height = Math.ceil(viewport.height);
        }
        const canvas = new OffscreenCanvas(width, height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas 2D context is unavailable.");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
        await page.render({ canvasContext: context, viewport, canvas }).promise;
        blob = await canvas.convertToBlob({ type: mime, quality });
        await deck.addPage(
          { pageNumber, blob, mime, widthPt: baseViewport.width, heightPt: baseViewport.height },
          placeOnSlide({ widthPt: baseViewport.width, heightPt: baseViewport.height }, slideSize),
        );
      } catch (cause) {
        const error = new Error(`Page ${pageNumber} could not be rendered.`);
        error.__renderError = true;
        error.cause = cause;
        error.stack = `${error.stack}\nCaused by: ${cause?.stack || cause}`;
        throw error;
      } finally {
        page.cleanup();
      }
      sampleBytes.push(blob.size);
      post({
        type: "progress", id, phase: "rendering", page: index + 1,
        pageCount: pageNumbers.length,
        estimatedBytes: estimatePptxBytes(sampleBytes, pageNumbers.length),
      });
    }
    if (checkCancelled(id)) return;
    post({
      type: "progress", id, phase: "packaging", page: pageNumbers.length,
      pageCount: pageNumbers.length,
      estimatedBytes: estimatePptxBytes(sampleBytes, pageNumbers.length),
    });
    const blob = await deck.toBlob();
    if (checkCancelled(id)) return;
    post({ type: "done", id, blob, slideCount: pageNumbers.length, slideSize });
  } catch (cause) {
    if (cancelled.has(id)) {
      post(cancelledError(id));
      return;
    }
    const [code, message] = mapError(cause);
    post({ type: "error", id, code, message, detail: cause?.stack || String(cause) });
  } finally {
    if (doc) await doc.destroy();
    cancelled.delete(id);
  }
}

self.onmessage = (event) => {
  const message = event.data;
  if (message?.type === "cancel") {
    cancelled.add(message.id);
    return;
  }
  if (message?.type === "convert") void convert(message);
};
