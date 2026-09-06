import { CODES, PdfError } from "../core/errors.js";
import { pptxNameFor, sanitizeFilename } from "../core/naming.js";
import { QUALITY_DPI } from "../core/quality.js";

let worker;
let nextId = 1;
const pending = new Map();

export function workerSupported() {
  return typeof Worker === "function"
    && typeof OffscreenCanvas === "function"
    && typeof OffscreenCanvas.prototype.convertToBlob === "function";
}

class WorkerStartupError extends Error {
  constructor(cause) {
    super("Could not create conversion worker.", { cause });
    this.workerStartup = true;
  }
}

function getWorker() {
  if (worker) return worker;
  try {
    const source = globalThis.__CONVERTER_WORKER_SRC__;
    if (typeof source !== "string") throw new Error("Missing __CONVERTER_WORKER_SRC__ converter asset.");
    worker = new Worker(URL.createObjectURL(new Blob([source], { type: "text/javascript" })));
  } catch (cause) {
    worker = undefined;
    throw new WorkerStartupError(cause);
  }
  worker.onmessage = (event) => {
    const message = event.data;
    const current = pending.get(message?.id);
    if (!current) return;
    if (message.type === "progress") {
      current.onProgress(message);
      return;
    }
    pending.delete(message.id);
    if (message.type === "done") {
      current.resolve({ blob: message.blob, filename: current.filename, slideCount: message.slideCount, slideSize: message.slideSize });
    } else if (message.type === "error") {
      current.reject(new PdfError(message.code, message.message, message.detail ? new Error(message.detail) : undefined));
    }
  };
  worker.onerror = (event) => {
    for (const current of pending.values()) current.reject(new PdfError(CODES.CORRUPT, "This PDF couldn't be opened.", new Error(event.message)));
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

export async function convertPdfInWorker(job, opts) {
  if (opts.signal?.aborted) throw new PdfError(CODES.CANCELLED, "Conversion cancelled.");
  const instance = getWorker();
  const id = nextId++;
  const filename = sanitizeFilename(pptxNameFor(job.file.name));
  const bytes = await job.file.arrayBuffer();
  if (opts.signal?.aborted) throw new PdfError(CODES.CANCELLED, "Conversion cancelled.");
  return new Promise((resolve, reject) => {
    let cancelTimer;
    const onAbort = () => {
      instance.postMessage({ type: "cancel", id });
      cancelTimer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        instance.terminate();
        worker = undefined;
        reject(new PdfError(CODES.CANCELLED, "Conversion cancelled."));
      }, 5000);
    };
    pending.set(id, {
      filename,
      onProgress: opts.onProgress,
      resolve: (value) => { clearTimeout(cancelTimer); opts.signal?.removeEventListener("abort", onAbort); resolve(value); },
      reject: (error) => { clearTimeout(cancelTimer); opts.signal?.removeEventListener("abort", onAbort); reject(error); },
    });
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      instance.postMessage({
        type: "convert", id, bytes, password: job.password, pages: job.pages,
        dpi: QUALITY_DPI[opts.quality], mime: opts.mime,
        quality: opts.jpegQuality ?? 0.92, title: job.file.name,
      }, [bytes]);
    } catch (cause) {
      pending.delete(id);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(cause);
    }
  });
}

globalThis.addEventListener?.("beforeunload", () => {
  worker?.terminate();
  worker = undefined;
});
