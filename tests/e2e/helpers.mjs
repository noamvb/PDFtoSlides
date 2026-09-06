import { statSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { chromium } from "playwright";

export const REPO = path.resolve(import.meta.dirname, "../..");
export const FIXTURES = path.join(REPO, "tests", "fixtures");
export const DIST = path.join(REPO, "dist", "PDFtoSlides.html");

export function fixture(name) {
  return path.join(FIXTURES, name);
}

/**
 * Build dist/PDFtoSlides.html if it is missing or older than any source file.
 *
 * Node's test runner runs test FILES in parallel. An unconditional rebuild
 * here meant one suite rewrote the very file another suite was loading, which
 * produced an intermittent failure that looked like a product bug. Skipping
 * the rebuild when the artifact is already current removes the race for the
 * common case; `npm run test:e2e` additionally pins concurrency to 1.
 */
export function ensureBuild() {
  const target = path.join(REPO, "dist", "PDFtoSlides.html");
  const sources = [
    path.join(REPO, "build.mjs"),
    path.join(REPO, "src"),
  ];
  const newestSource = () => {
    let newest = 0;
    const walk = (p) => {
      const st = statSync(p);
      if (st.isDirectory()) for (const e of readdirSync(p)) walk(path.join(p, e));
      else newest = Math.max(newest, st.mtimeMs);
    };
    for (const s of sources) walk(s);
    return newest;
  };

  try {
    if (statSync(target).mtimeMs >= newestSource()) return;
  } catch {
    /* not built yet */
  }

  try {
    execFileSync("node", ["build.mjs"], { cwd: REPO, stdio: "inherit" });
  } catch (error) {
    throw new Error(`Build failed: ${error.message}`, { cause: error });
  }
}

export async function launchBrowser() {
  return chromium.launch({ headless: true });
}

export async function newAppPage(browser) {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = { page: [], console: [] };
  page.on("pageerror", (error) => errors.page.push(error));
  page.on("console", (message) => {
    if (message.type() === "error") errors.console.push(message.text());
  });
  await page.goto(`file://${DIST}`);
  return { page, errors };
}

export function assertNoErrors(errors) {
  assert.deepEqual(errors.page, [], `pageerror events: ${errors.page.map(String).join(" | ")}`);
  assert.deepEqual(errors.console, [], `console.error messages: ${errors.console.join(" | ")}`);
}

export async function queue(page, names) {
  const paths = names.map(fixture);
  await page.setInputFiles("#file-input", paths);
  await page.locator(".badge.busy").first().waitFor({ state: "detached", timeout: 180000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".badge.busy"), null, { timeout: 180000 });
}

export async function convertAndSave(page, outPath) {
  const downloadPromise = page.waitForEvent("download", { timeout: 180000 });
  await page.click("#convert");
  const download = await downloadPromise;
  await download.saveAs(outPath);
  await page.locator("#results-card").waitFor({ state: "visible", timeout: 180000 });
  return download;
}

export async function tempDir() {
  return mkdtemp(path.join(os.tmpdir(), "pdftoslides-e2e-"));
}

export async function cleanupDir(dir) {
  if (dir) await rm(dir, { recursive: true, force: true });
}

/**
 * Minimal ZIP reader: returns a Map of entry name -> Buffer.
 * Handles stored (method 0) and deflated (method 8) entries.
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
export function unzip(buf) {
  const eocd = 0x06054b50;
  let eocdOffset = -1;
  for (let i = buf.length - 22; i >= 0; i -= 1) {
    if (buf.readUInt32LE(i) === eocd) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("ZIP end-of-central-directory record not found");

  const count = buf.readUInt16LE(eocdOffset + 10);
  const centralOffset = buf.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let cursor = centralOffset;
  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid ZIP central-directory record");
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const nameLength = buf.readUInt16LE(cursor + 28);
    const extraLength = buf.readUInt16LE(cursor + 30);
    const commentLength = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");

    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid ZIP local-file header");
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method: ${method}`);
    entries.set(name, method === 8 ? inflateRawSync(compressed) : Buffer.from(compressed));
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function xmlText(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return match ? match[1].replace(/<[^>]+>/g, "").trim() : "";
}

function xmlPart(entries, name) {
  return entries.get(name)?.toString("utf8") ?? "";
}

/** @param {Buffer} buf */
export function inspectPptx(buf) {
  const entries = unzip(buf);
  const slideNames = [...entries.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
  const presentation = xmlPart(entries, "ppt/presentation.xml");
  const size = presentation.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  if (!size) throw new Error("Presentation slide size not found");
  const round4 = (value) => Math.round(value * 10000) / 10000;
  const core = xmlPart(entries, "docProps/core.xml");
  const mediaTypes = [...new Set([...entries.keys()]
    .filter((name) => name.startsWith("ppt/media/"))
    .map((name) => path.extname(name).slice(1).toLowerCase()))].sort();
  return {
    slideCount: slideNames.length,
    widthIn: round4(Number(size[1]) / 914400),
    heightIn: round4(Number(size[2]) / 914400),
    title: xmlText(core, "dc:title"),
    images: slideNames.map((name, index) => ({ slide: index + 1, count: (xmlPart(entries, name).match(/<p:pic\b/g) ?? []).length })),
    mediaTypes,
  };
}

export async function readPptx(filePath) {
  return inspectPptx(await readFile(filePath));
}
