import { CODES, PdfError } from "../core/errors.js";

let pdfjsPromise;
let pptxPromise;

function assetError(cause) {
  return new PdfError(CODES.RENDER_FAILED, "Converter assets failed to load.", cause);
}

/**
 * Resolve the pdf.js module, configuring its worker.
 * Repeated calls share the same promise.
 * @returns {Promise<object>}
 */
export function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      try {
        const source = globalThis.__PDFJS_SRC__;
        const workerSource = globalThis.__PDFJS_WORKER_SRC__;
        if (typeof source !== "string") {
          throw new Error("Missing __PDFJS_SRC__ converter asset.");
        }
        if (typeof workerSource !== "string") {
          throw new Error("Missing __PDFJS_WORKER_SRC__ converter asset.");
        }

        const workerBlobUrl = URL.createObjectURL(
          new Blob([workerSource], { type: "text/javascript" }),
        );
        const pdfjsBlobUrl = URL.createObjectURL(
          new Blob([source], { type: "text/javascript" }),
        );
        const mod = await import(/* @vite-ignore */ pdfjsBlobUrl);
        mod.GlobalWorkerOptions.workerSrc = workerBlobUrl;

        const fonts = globalThis.__STANDARD_FONTS__;
        if (fonts && typeof fonts === "object" && Object.keys(fonts).length > 0) {
          try {
            mod.__standardFonts = fonts;
          } catch {
            // Native module namespace objects are non-extensible; preserve the
            // requested property on a delegating object in that environment.
            return Object.assign(Object.create(mod), { __standardFonts: fonts });
          }
        }
        return mod;
      } catch (cause) {
        if (cause instanceof PdfError) throw cause;
        throw assetError(cause);
      }
    })();
  }
  return pdfjsPromise;
}

/**
 * Return the standard-font factory configuration for pdf.js, if assets exist.
 * @returns {object|undefined}
 */
export function getStandardFontDataFactory() {
  const fonts = globalThis.__STANDARD_FONTS__;
  if (!fonts || typeof fonts !== "object" || Object.keys(fonts).length === 0) {
    return undefined;
  }
  return class StandardFontDataFactory {
    async fetch({ filename }) {
      const encoded = fonts[filename];
      if (typeof encoded !== "string") {
        throw new Error(`Missing standard font: ${filename}`);
      }
      return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    }
  };
}

/**
 * Resolve the PptxGenJS constructor from its UMD bundle.
 * @returns {Promise<Function>}
 */
export function getPptxGenJS() {
  if (globalThis.PptxGenJS) return Promise.resolve(globalThis.PptxGenJS);
  if (!pptxPromise) {
    pptxPromise = new Promise((resolve, reject) => {
      try {
        const source = globalThis.__PPTXGEN_SRC__;
        if (typeof source !== "string") {
          throw new Error("Missing __PPTXGEN_SRC__ converter asset.");
        }
        const script = document.createElement("script");
        const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        script.onload = () => {
          URL.revokeObjectURL(url);
          if (typeof globalThis.PptxGenJS !== "function") {
            reject(assetError(new Error("PptxGenJS did not load.")));
            return;
          }
          resolve(globalThis.PptxGenJS);
        };
        script.onerror = () => {
          URL.revokeObjectURL(url);
          reject(assetError(new Error("PptxGenJS script failed to load.")));
        };
        script.src = url;
        document.head.appendChild(script);
      } catch (cause) {
        reject(cause instanceof PdfError ? cause : assetError(cause));
      }
    });
  }
  return pptxPromise;
}
