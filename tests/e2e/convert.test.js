import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { after, before, describe, test } from "node:test";
import {
  assertNoErrors, cleanupDir, convertAndSave, fixture, launchBrowser, newAppPage,
  queue, readPptx, tempDir,
} from "./helpers.mjs";

let browser;
before(async () => { browser = await launchBrowser(); });
after(async () => { await browser?.close(); });

async function one(name, expected, setup = () => {}) {
  const { page, errors } = await newAppPage(browser);
  const dir = await tempDir();
  try {
    await queue(page, [name]);
    await setup(page);
    const out = `${dir}/output.pptx`;
    await convertAndSave(page, out);
    const info = await readPptx(out);
    expected(info);
    assertNoErrors(errors);
  } finally {
    await page.close();
    await cleanupDir(dir);
  }
}

const size = (widthIn, heightIn) => (info) => {
  assert.equal(info.widthIn, widthIn);
  assert.equal(info.heightIn, heightIn);
};
const slides = (count) => (info) => assert.equal(info.slideCount, count);

function collectDownloads(page, count) {
  return new Promise((resolve, reject) => {
    const downloads = [];
    const timer = setTimeout(() => reject(new Error(`Timed out after ${downloads.length}/${count} downloads`)), 180000);
    const onDownload = (download) => {
      downloads.push(download);
      if (downloads.length === count) {
        clearTimeout(timer);
        page.off("download", onDownload);
        resolve(downloads);
      }
    };
    page.on("download", onDownload);
  });
}

describe("PDF to Slides browser conversion", { timeout: 180000 }, () => {
  test("single page", async () => one("single-page.pdf", (info) => {
    slides(1)(info); size(8.2677, 11.6929)(info);
  }));
  test("multi page", async () => one("multi-page.pdf", (info) => {
    slides(12)(info); assert.ok(info.images.every((image) => image.count === 1));
  }));
  test("portrait", async () => one("portrait.pdf", (info) => {
    slides(3)(info); size(8.5, 11)(info);
  }));
  test("landscape", async () => one("landscape.pdf", (info) => {
    slides(3)(info); size(11, 8.5)(info);
  }));
  test("mixed page sizes", async () => one("mixed-sizes.pdf", (info) => {
    slides(5)(info); size(8.2677, 11.6929)(info);
    assert.ok(info.images.every((image) => image.count === 1));
  }));
  test("text and vector graphics", async () => {
    const { page, errors } = await newAppPage(browser); const dir = await tempDir();
    try { await queue(page, ["vector-and-text.pdf"]); const out = `${dir}/output.pptx`;
      await convertAndSave(page, out); assert.equal((await readPptx(out)).slideCount, 2);
      assert.ok((await stat(out)).size > 10 * 1024); assertNoErrors(errors);
    } finally { await page.close(); await cleanupDir(dir); }
  });
  test("raster image", async () => one("raster-image.pdf", slides(2)));
  test("unusual dimensions", async () => {
    const cases = [["tall-narrow.pdf", 2.7778, 41.6667], ["wide-short.pdf", 41.6667, 2.7778], ["tiny-page.pdf", 1, 1], ["huge-page.pdf", 56, 56]];
    for (const [name, width, height] of cases) await one(name, (info) => { slides(1)(info); size(width, height)(info); });
  });
  test("corrupt PDF", async () => {
    const { page, errors } = await newAppPage(browser);
    try { await queue(page, ["corrupt.pdf"]); const row = page.locator("#filelist li");
      await assert.rejects(() => page.locator(".badge.busy").waitFor({ state: "attached", timeout: 100 }));
      await assert.equal(await row.locator(".badge.err").textContent(), "Failed");
      assert.equal(await page.locator("#convert").isDisabled(), true);
      const text = await row.textContent(); assert.ok(!/stack|undefined|Error:/i.test(text));
      assertNoErrors(errors);
    } finally { await page.close(); }
  });
  test("password-protected", async () => {
    const { page, errors } = await newAppPage(browser); const dir = await tempDir();
    try { await queue(page, ["encrypted.pdf"]); const row = page.locator("#filelist li");
      assert.equal(await row.locator(".badge.warn").textContent(), "Locked");
      await row.locator('input[id^="pw-"]').fill("wrongpass"); await row.getByRole("button", { name: "Unlock" }).click();
      await page.waitForFunction(() => document.querySelector(".badge.warn")?.textContent === "Locked");
      assert.match(await row.textContent(), /password/i);
      await row.locator('input[id^="pw-"]').fill("hunter2"); await row.getByRole("button", { name: "Unlock" }).click();
      await page.waitForFunction(() => !document.querySelector(".badge.busy") && document.querySelector("#filelist li")?.textContent.includes("2 pages"));
      const out = `${dir}/encrypted.pptx`; await convertAndSave(page, out); assert.equal((await readPptx(out)).slideCount, 2); assertNoErrors(errors);
    } finally { await page.close(); await cleanupDir(dir); }
  });
  test("Unicode and spaces in the filename", async () => {
    const { page, errors } = await newAppPage(browser); const dir = await tempDir();
    try { await queue(page, ["Отчёт 2024 — итоги (v2).pdf"]); const dl = await convertAndSave(page, `${dir}/unicode.pptx`);
      assert.equal((await readPptx(`${dir}/unicode.pptx`)).slideCount, 2); assert.match(dl.suggestedFilename(), /Отчёт/); assert.match(dl.suggestedFilename(), /\.pptx$/); assertNoErrors(errors);
    } finally { await page.close(); await cleanupDir(dir); }
  });
  test("batch", async () => {
    const { page, errors } = await newAppPage(browser); const dir = await tempDir();
    try { await queue(page, ["single-page.pdf", "portrait.pdf", "landscape.pdf"]); const downloads = collectDownloads(page, 3); await page.click("#convert");
      const got = await downloads; const infos = []; for (let i = 0; i < got.length; i += 1) { const out = `${dir}/${i}.pptx`; await got[i].saveAs(out); infos.push(await readPptx(out)); }
      assert.deepEqual(infos.map((info) => info.slideCount).sort((a, b) => a - b), [1, 3, 3]); assert.equal(await page.locator("#result-title").textContent(), "Conversion complete"); assertNoErrors(errors);
    } finally { await page.close(); await cleanupDir(dir); }
  });
  test("page ranges", async () => one("multi-page.pdf", (info) => slides(7)(info), async (page) => {
    await page.locator('input[id^="rg-"]').fill("1-3, 7, 10-12"); await page.waitForFunction(() => document.querySelector("#convert")?.textContent.includes("7 slides"));
  }));
  test("invalid page range blocks conversion", async () => {
    const { page, errors } = await newAppPage(browser); try { await queue(page, ["multi-page.pdf"]); const input = page.locator('input[id^="rg-"]'); await input.fill("10-3"); await page.waitForFunction(() => document.querySelector(".field-error")?.textContent);
      assert.equal(await page.locator("#convert").isDisabled(), true); assert.match(await page.locator(".field-error").textContent(), /backwards/i); await input.fill("1-3"); await page.waitForFunction(() => !document.querySelector("#convert")?.disabled); assertNoErrors(errors);
    } finally { await page.close(); }
  });
  test("quality changes output size", async () => {
    const { page, errors } = await newAppPage(browser); const dir = await tempDir(); try { await queue(page, ["raster-image.pdf"]); await page.locator('input[name="quality"][value="standard"]').check({ force: true }); await convertAndSave(page, `${dir}/standard.pptx`); await page.click("#clear-all"); await queue(page, ["raster-image.pdf"]); await page.locator('input[name="quality"][value="veryHigh"]').check({ force: true }); await convertAndSave(page, `${dir}/very-high.pptx`); assert.ok((await stat(`${dir}/very-high.pptx`)).size > (await stat(`${dir}/standard.pptx`)).size); assertNoErrors(errors); } finally { await page.close(); await cleanupDir(dir); }
  });
  test("cancel", async () => {
    const { page, errors } = await newAppPage(browser); try { await queue(page, ["multi-page.pdf"]); let download = false; page.on("download", () => { download = true; }); await page.click("#convert"); await page.locator("#progress-card").waitFor({ state: "visible" }); await page.waitForFunction(() => /Page \d+ of 12/.test(document.querySelector("#prog-what")?.textContent ?? "")); await page.click("#cancel"); await page.waitForFunction(() => document.querySelector("#result-title")?.textContent === "Conversion cancelled", null, { timeout: 30000 }); assert.equal(await page.locator("#progress-card").isHidden(), true); await new Promise((resolve) => setTimeout(resolve, 500)); assert.equal(download, false); assertNoErrors(errors); } finally { await page.close(); }
  });
  test("the UI does not freeze", async () => {
    const { page, errors } = await newAppPage(browser); try { await queue(page, ["multi-page.pdf"]); await page.click("#convert"); const timings = []; for (let i = 0; i < 8; i += 1) { const start = performance.now(); await page.evaluate(() => performance.now()); timings.push(performance.now() - start); await new Promise((resolve) => setTimeout(resolve, 250)); } assert.ok(timings.every((time) => time < 1000), `slow evaluate calls: ${timings}`); await page.locator("#results-card").waitFor({ state: "visible", timeout: 180000 }); assertNoErrors(errors); } finally { await page.close(); }
  });
});
