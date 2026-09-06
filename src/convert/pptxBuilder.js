import { getPptxGenJS } from "./pdfjs.js";

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(",") + 1));
    reader.onerror = () => reject(reader.error || new Error("Could not read rendered page."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Build a .pptx from rendered pages.
 * @returns {Promise<{addPage(rendered: object, placement: object): Promise<void>, toBlob(): Promise<Blob>}>}
 */
export async function createDeck(slideSize, title) {
  const P = await getPptxGenJS();
  const pptx = new P();
  pptx.defineLayout({ name: "PDFPAGE", width: slideSize.widthIn, height: slideSize.heightIn });
  pptx.layout = "PDFPAGE";
  pptx.title = title;
  pptx.subject = "Converted from PDF";
  pptx.company = "";
  pptx.author = "PDF to Slides";

  return {
    async addPage(rendered, placement) {
      const b64 = await blobToBase64(rendered.blob);
      const slide = pptx.addSlide();
      slide.background = { color: "FFFFFF" };
      slide.addImage({
        data: `data:${rendered.mime};base64,${b64}`,
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h,
      });
    },
    toBlob() {
      return pptx.write({ outputType: "blob" });
    },
  };
}
