import { CODES, PdfError } from "../core/errors.js";
import { scaleForDpi } from "../core/quality.js";
import { getPdfjs, getStandardFontDataFactory, getCMapReaderFactory } from "./pdfjs.js";

/**
 * Open a PDF. `data` is consumed by pdf.js; callers must pass a fresh copy for
 * every attempt.
 * @param {ArrayBuffer} data
 * @param {string} [password]
 */
export async function openPdf(data, password) {
  try {
    const pdfjs = await getPdfjs();
    const StandardFontDataFactory = getStandardFontDataFactory();
    const options = {
      data,
      password,
      useSystemFonts: !StandardFontDataFactory,
    };
    if (StandardFontDataFactory) options.StandardFontDataFactory = StandardFontDataFactory;
    const CMapReaderFactory = getCMapReaderFactory();
    if (CMapReaderFactory) {
      options.CMapReaderFactory = CMapReaderFactory;
      options.cMapPacked = true;
    }
    return await pdfjs.getDocument(options).promise;
  } catch (cause) {
    if (cause instanceof PdfError) throw cause;
    const pdfjs = await getPdfjs().catch(() => undefined);
    const passwordResponses = pdfjs?.PasswordResponses;
    if (cause?.name === "PasswordException" && cause.code === passwordResponses?.NEED_PASSWORD) {
      throw new PdfError(CODES.PASSWORD_REQUIRED, "This PDF is password-protected.", cause);
    }
    if (cause?.name === "PasswordException" && cause.code === passwordResponses?.INCORRECT_PASSWORD) {
      throw new PdfError(CODES.PASSWORD_WRONG, "That password didn't work.", cause);
    }
    if (cause?.name === "InvalidPDFException" || cause?.message?.includes("Invalid PDF structure")) {
      throw new PdfError(CODES.CORRUPT, "This file is damaged and can't be read.", cause);
    }
    throw new PdfError(CODES.CORRUPT, "This PDF couldn't be opened.", cause);
  }
}

export async function readPageSizes(doc) {
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
  return sizes;
}

export async function renderPage(doc, pageNumber, { dpi, mime, quality }) {
  let page;
  let canvas;
  try {
    page = await doc.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });
    let scale = scaleForDpi(dpi);
    let viewport = page.getViewport({ scale });
    let width = Math.ceil(viewport.width);
    let height = Math.ceil(viewport.height);
    if (width * height > 40_000_000) {
      scale *= Math.sqrt(40_000_000 / (width * height));
      viewport = page.getViewport({ scale });
      width = Math.ceil(viewport.width);
      height = Math.ceil(viewport.height);
    }

    canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas 2D context is unavailable.");
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, width, height);
    await page.render({ canvasContext: context, viewport, canvas }).promise;
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => {
        if (result) resolve(result);
        else reject(new PdfError(CODES.RENDER_FAILED, "A page could not be rendered."));
      }, mime, quality);
    });
    return { pageNumber, blob, mime, widthPt: baseViewport.width, heightPt: baseViewport.height };
  } catch (cause) {
    if (cause instanceof PdfError) throw cause;
    throw new PdfError(CODES.RENDER_FAILED, `Page ${pageNumber} could not be rendered.`, cause);
  } finally {
    if (page) page.cleanup();
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
