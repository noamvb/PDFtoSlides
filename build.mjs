/**
 * Build the single self-contained application file.
 *
 *   node build.mjs            -> dist/PDFtoSlides.html
 *   node build.mjs --dev      -> also writes dist/dev.html with sourcemaps
 *
 * Everything the app needs is embedded: pdf.js and its worker, PptxGenJS,
 * the pdf.js standard fonts and CMaps, the stylesheet and the app code. The
 * result loads from file:// with no network access of any kind.
 */

import { build } from "esbuild";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const dev = process.argv.includes("--dev");
const r = (...p) => path.join(root, ...p);

/** Read a directory of binary assets as a `{filename: base64}` map. */
async function base64Dir(dir, extensions) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const name of (await fs.readdir(dir)).sort()) {
    if (extensions && !extensions.some((e) => name.endsWith(e))) continue;
    const stat = await fs.stat(path.join(dir, name));
    if (!stat.isFile()) continue;
    out[name] = (await fs.readFile(path.join(dir, name))).toString("base64");
  }
  return out;
}

/** Escape a string so it can sit inside a `</script>`-terminated block. */
const safeJson = (value) =>
  JSON.stringify(value)
    .replaceAll("</script", "<\\/script")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

async function main() {
  const pdfjsDir = r("node_modules", "pdfjs-dist");
  const t0 = Date.now();

  const [pdfjsSrc, workerSrc, pptxSrc, styles, html, standardFonts, cmaps] = await Promise.all([
    fs.readFile(path.join(pdfjsDir, "build", "pdf.min.mjs"), "utf8"),
    fs.readFile(path.join(pdfjsDir, "build", "pdf.worker.min.mjs"), "utf8"),
    fs.readFile(r("node_modules", "pptxgenjs", "dist", "pptxgen.bundle.js"), "utf8"),
    fs.readFile(r("src", "ui", "styles.css"), "utf8"),
    fs.readFile(r("src", "ui", "index.html"), "utf8"),
    base64Dir(path.join(pdfjsDir, "standard_fonts")),
    base64Dir(path.join(pdfjsDir, "cmaps"), [".bcmap"]),
  ]);

  // Bundle the app's own modules into one classic script (no import statements
  // survive, so the file works from file:// where module CORS rules bite).
  const bundled = await build({
    entryPoints: [r("src", "ui", "entry.js")],
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["chrome110", "firefox115", "safari16"],
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    write: false,
    legalComments: "none",
  });
  const appJs = bundled.outputFiles[0].text;

  const assets = `<script>
globalThis.__PDFJS_SRC__ = ${safeJson(pdfjsSrc)};
globalThis.__PDFJS_WORKER_SRC__ = ${safeJson(workerSrc)};
globalThis.__PPTXGEN_SRC__ = ${safeJson(pptxSrc)};
globalThis.__STANDARD_FONTS__ = ${safeJson(standardFonts)};
globalThis.__CMAPS__ = ${safeJson(cmaps)};
</script>`;

  // A replacer FUNCTION is required: `$&` and `$\'` inside minified library
  // source would otherwise be read as replacement patterns.
  const inject = (doc, marker, text) => {
    if (!doc.includes(marker)) throw new Error(`Build placeholder ${marker} is missing from index.html`);
    return doc.replace(marker, () => text);
  };

  let out = inject(html, "<!--INLINE:STYLES-->", `<style>\n${styles}\n</style>`);
  out = inject(out, "<!--INLINE:ASSETS-->", assets);
  out = inject(out, "<!--INLINE:APP-->", `<script>\n${appJs}\n</script>`);


  await fs.mkdir(r("dist"), { recursive: true });
  const target = r("dist", dev ? "dev.html" : "PDFtoSlides.html");
  await fs.writeFile(target, out);

  const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
  console.log(`Wrote ${path.relative(root, target)}  ${mb(Buffer.byteLength(out))}  in ${Date.now() - t0} ms`);
  console.log(`  pdf.js ${mb(pdfjsSrc.length)} + worker ${mb(workerSrc.length)}`);
  console.log(`  pptxgenjs ${mb(pptxSrc.length)}`);
  console.log(`  standard fonts ${Object.keys(standardFonts).length} files, cmaps ${Object.keys(cmaps).length} files`);
  console.log(`  app ${mb(appJs.length)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
