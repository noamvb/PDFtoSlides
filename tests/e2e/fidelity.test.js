/**
 * Rendering-fidelity regression tests.
 *
 * Every other test in this suite asserts STRUCTURE — slide counts, slide
 * dimensions, one picture per slide. All of them passed while the app shipped
 * a document in which every single glyph was a .notdef box, because a page of
 * tofu has exactly the same structure as a page of text.
 *
 * The cause was the worker's DOM shim omitting `document.fonts`, which is what
 * pdf.js registers embedded fonts through. These tests therefore look at
 * PIXELS, and specifically compare the two rendering paths the app can take:
 * the Web Worker (with OffscreenCanvas) and the main-thread fallback. Both
 * must draw the same picture.
 *
 * They run against `embedded-font.pdf` specifically. Every other text fixture
 * uses base-14 Helvetica, which pdf.js draws from built-in outlines without
 * ever touching `document.fonts` — a version of this test pointed at those
 * fixtures passed happily with the bug reintroduced. A font that fails to load in one and not the
 * other shows up immediately as a large pixel difference.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  fixture, ensureBuild, launchBrowser, newAppPage,
  assertNoErrors, queue, convertAndSave, tempDir, cleanupDir, unzip,
} from "./helpers.mjs";

/**
 * Pull the first slide image out of a .pptx.
 * A zip carries a directory entry for `ppt/media/` itself, which sorts first
 * and has a zero-length body, so match on the extension rather than the prefix.
 */
function firstImage(buf) {
  const entries = unzip(buf);
  const name = [...entries.keys()]
    .filter((n) => /^ppt\/media\/.+\.(jpe?g|png)$/i.test(n))
    .sort()[0];
  assert.ok(name, "the deck contains no slide image");
  const bytes = entries.get(name);
  assert.ok(bytes.length > 1000, `${name} is only ${bytes.length} bytes`);
  return { bytes, name };
}

/**
 * Decode two images in the browser and compare them pixel by pixel.
 * @returns {Promise<{meanAbsDiff:number, width:number, height:number, inkFraction:number}>}
 */
async function comparePixels(page, a, b) {
  return page.evaluate(async ([aArr, bArr]) => {
    const load = async (arr) => {
      const bmp = await createImageBitmap(new Blob([new Uint8Array(arr)]));
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = cv.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0);
      return { data: ctx.getImageData(0, 0, bmp.width, bmp.height).data, w: bmp.width, h: bmp.height };
    };
    const A = await load(aArr);
    const B = await load(bArr);
    if (A.w !== B.w || A.h !== B.h) return { meanAbsDiff: 255, width: A.w, height: A.h, inkFraction: 0 };

    let total = 0;
    let ink = 0;
    for (let i = 0; i < A.data.length; i += 4) {
      total += Math.abs(A.data[i] - B.data[i]);
      if (A.data[i] < 128) ink++;
    }
    const pixels = A.data.length / 4;
    return { meanAbsDiff: total / pixels, width: A.w, height: A.h, inkFraction: ink / pixels };
  }, [Array.from(a), Array.from(b)]);
}

describe("rendering fidelity", { timeout: 240000 }, () => {
  let browser;
  let dir;

  before(async () => {
    ensureBuild();
    browser = await launchBrowser();
    dir = await tempDir();
  });

  after(async () => {
    await browser?.close();
    await cleanupDir(dir);
  });

  /**
   * The worker and the main-thread fallback must render identically.
   *
   * This is the check that fails when the worker cannot load a font: the
   * fallback runs in a real document and draws glyphs, the worker draws boxes,
   * and the two pictures diverge wildly.
   */
  test("worker and main-thread fallback draw the same page", async () => {
    const outs = {};
    for (const mode of ["worker", "fallback"]) {
      const { page, errors } = await newAppPage(browser);
      if (mode === "fallback") {
        // Force the fallback by making Worker construction throw.
        await page.evaluate(() => {
          window.Worker = class { constructor() { throw new Error("workers disabled for test"); } };
        });
      }
      await queue(page, ["embedded-font.pdf"]);
      const out = path.join(dir, `${mode}.pptx`);
      await convertAndSave(page, out);
      assertNoErrors(errors);
      outs[mode] = firstImage(await readFile(out)).bytes;
      await page.close();
    }

    const { page } = await newAppPage(browser);
    const diff = await comparePixels(page, outs.worker, outs.fallback);
    await page.close();

    assert.ok(diff.width > 100 && diff.height > 100, `implausible image size ${diff.width}x${diff.height}`);
    // JPEG quantisation differs slightly between canvas.toBlob and
    // OffscreenCanvas.convertToBlob, so this is a tolerance, not equality.
    // Tofu against real text scores in the tens; identical pages score under 1.
    assert.ok(
      diff.meanAbsDiff < 6,
      `worker and fallback renders differ by ${diff.meanAbsDiff.toFixed(2)} mean levels — ` +
        `one of the two paths is drawing something the other is not (missing fonts?)`,
    );
  });

  /**
   * An absolute check that does not depend on the two paths agreeing: a page
   * of text must contain a plausible amount of dark ink. A blank render scores
   * near zero; a page where every glyph became a filled .notdef box scores far
   * higher than real text, because boxes are much heavier than letterforms.
   */
  test("a text page renders a plausible amount of ink", async () => {
    const { page, errors } = await newAppPage(browser);
    await queue(page, ["embedded-font.pdf"]);
    const out = path.join(dir, "ink.pptx");
    await convertAndSave(page, out);
    assertNoErrors(errors);
    const img = firstImage(await readFile(out)).bytes;

    const { page: probe } = await newAppPage(browser);
    const { inkFraction } = await comparePixels(probe, img, img);
    await probe.close();
    await page.close();

    assert.ok(inkFraction > 0.0002, `page looks blank — only ${(inkFraction * 100).toFixed(4)}% dark pixels`);
    assert.ok(inkFraction < 0.25, `page is implausibly dark at ${(inkFraction * 100).toFixed(2)}% — tofu boxes?`);
  });
});
