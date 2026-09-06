/**
 * Minimal DOM shim for the conversion worker. Prepended verbatim to the worker
 * source by build.mjs; it runs before pdf.js and PptxGenJS are evaluated.
 *
 * Two libraries need coaxing to run outside a document:
 *
 *  - The pdf.js worker bundle installs its own `self.onmessage` when it thinks
 *    it is in a worker, which would swallow our own protocol. Defining
 *    `self.window` makes it stand down, leaving `globalThis.pdfjsWorker
 *    .WorkerMessageHandler` for pdf.js to use inline.
 *  - PptxGenJS expects a `window` too.
 *
 * The critical member is `document.fonts`. pdf.js registers every EMBEDDED
 * font by calling `document.fonts.add(new FontFace(...))`, taking the document
 * from `globalThis.document`. A worker has its own real FontFaceSet at
 * `self.fonts`, so the shim forwards to it. Omitting this does not throw — it
 * silently renders every glyph of every embedded font as a .notdef box, which
 * is exactly how the first real document came out of this app.
 */

self.window = self;

function fakeElement() {
  const el = {
    style: {},
    children: [],
    setAttribute() {},
    append(...items) {
      for (const item of items) {
        item.parentNode = el;
        el.children.push(item);
      }
    },
    remove() {},
  };
  return el;
}

self.document = {
  URL: "",
  baseURI: "",
  body: { append() {} },
  // The real FontFaceSet of this worker. This is what makes embedded fonts render.
  fonts: self.fonts,
  createElement: (name) => (name === "canvas" ? new OffscreenCanvas(1, 1) : fakeElement()),
  createElementNS: () => fakeElement(),
};
