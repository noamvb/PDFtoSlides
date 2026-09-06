/**
 * PDF to Slides — application controller.
 *
 * Owns all DOM interaction and the batch state machine. Conversion itself
 * lives in src/convert/; pure rules live in src/core/. Nothing here talks to
 * a network: there is no fetch, no XHR, no WebSocket anywhere in this file.
 */

import { parsePageRanges } from "../core/pageRanges.js";
import { pptxNameFor, sanitizeFilename } from "../core/naming.js";
import { estimatePptxBytes, formatBytes, GOOGLE_SLIDES_LIMIT_BYTES } from "../core/sizeEstimate.js";
import { QUALITY_DPI } from "../core/quality.js";
import { PdfError, CODES } from "../core/errors.js";
import { openPdf, readPageSizes, renderPage } from "../convert/pdfRenderer.js";
import { convertPdf } from "../convert/converter.js";
import { loadSettings, saveSettings, loadDirHandle, saveDirHandle } from "./store.js";
import { makeOutput, pickDirectory, supportsDirectoryOutput } from "./output.js";
import { log, downloadLog } from "./log.js";

const $ = (sel) => /** @type {HTMLElement} */ (document.querySelector(sel));

/**
 * @typedef {Object} Entry
 * @property {string} id
 * @property {File} file
 * @property {number} pageCount        0 until probed
 * @property {string} rangeExpr        raw user text
 * @property {number[]|null} pages     parsed, null = all
 * @property {string} rangeError       "" when valid
 * @property {string|null} password
 * @property {"probing"|"locked"|"ready"|"error"|"converting"|"done"} status
 * @property {string} message          user-facing status text
 * @property {Error|null} lastError
 * @property {number[]} sampleBytes    measured bytes of sampled pages, empty = unknown
 * @property {string} sampleKey        settings the sample was measured under
 * @property {string|null} outputName
 */

const state = {
  /** @type {Entry[]} */ entries: [],
  settings: loadSettings(),
  /** @type {FileSystemDirectoryHandle|null} */ dirHandle: null,
  /** @type {AbortController|null} */ abort: null,
  converting: false,
  /** @type {{ok:number, failed:number, names:string[]}|null} */ lastRun: null,
};

let nextId = 1;
const uid = () => `f${nextId++}`;

/* ------------------------------------------------------------------ files */

/** @param {FileList|File[]} list */
async function addFiles(list) {
  const incoming = Array.from(list).filter(isPdf);
  const rejected = Array.from(list).length - incoming.length;
  if (rejected > 0) {
    flashNotice(`${rejected} file${rejected === 1 ? " was" : "s were"} skipped — only PDF files can be converted.`);
    log.warn(`Rejected ${rejected} non-PDF file(s)`);
  }
  for (const file of incoming) {
    if (state.entries.some((e) => e.file.name === file.name && e.file.size === file.size)) continue;
    /** @type {Entry} */
    const entry = {
      id: uid(), file, pageCount: 0, rangeExpr: "", pages: null, rangeError: "",
      password: null, status: "probing", message: "Reading…", lastError: null,
      sampleBytes: [], sampleKey: "", outputName: null,
    };
    state.entries.push(entry);
    log.info(`Added ${file.name} (${file.size} bytes)`);
    render();
    probe(entry);
  }
  render();
}

/** @param {File} f */
function isPdf(f) {
  return f.type === "application/pdf" || /\.pdf$/i.test(f.name);
}

/** Open the file just far enough to learn its page count and lock state. */
async function probe(entry) {
  try {
    const buf = await entry.file.arrayBuffer();
    const doc = await openPdf(buf, entry.password ?? undefined);
    try {
      entry.pageCount = doc.numPages;
      entry.status = "ready";
      entry.message = "";
      entry.lastError = null;
      revalidateRange(entry);
    } finally {
      await doc.destroy();
    }
  } catch (err) {
    const e = /** @type {PdfError} */ (err);
    if (e && (e.code === CODES.PASSWORD_REQUIRED || e.code === CODES.PASSWORD_WRONG)) {
      entry.status = "locked";
      entry.message = e.code === CODES.PASSWORD_WRONG ? "That password didn't work." : "Password required";
    } else {
      entry.status = "error";
      entry.message = e?.message ?? "This PDF couldn't be read.";
    }
    entry.lastError = /** @type {Error} */ (err);
    log.error(`Probe failed for ${entry.file.name}`, /** @type {Error} */ (err));
  }
  render();
  scheduleEstimate();
}

function revalidateRange(entry) {
  if (!entry.rangeExpr.trim() || !entry.pageCount) {
    entry.pages = null;
    entry.rangeError = "";
    return;
  }
  try {
    entry.pages = parsePageRanges(entry.rangeExpr, entry.pageCount);
    entry.rangeError = "";
  } catch (err) {
    entry.pages = null;
    entry.rangeError = /** @type {Error} */ (err).message;
  }
}

const pagesOf = (e) => (e.pages ? e.pages.length : e.pageCount);

/* --------------------------------------------------------------- estimate */

let estimateTimer = 0;
function scheduleEstimate() {
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(runEstimate, 250);
}

/** Measure one real page per file at the current settings, then extrapolate. */
async function runEstimate() {
  if (state.converting) return;
  const key = `${state.settings.quality}:${state.settings.format}:${state.settings.optimize}`;
  for (const entry of state.entries) {
    if (entry.status !== "ready" || entry.sampleKey === key) continue;
    try {
      const doc = await openPdf(await entry.file.arrayBuffer(), entry.password ?? undefined);
      try {
        const samples = [];
        for (const n of samplePages(entry)) {
          if (state.converting) break;
          const r = await renderPage(doc, n, renderOpts());
          samples.push(r.blob.size);
        }
        entry.sampleBytes = samples;
        entry.sampleKey = key;
      } finally {
        await doc.destroy();
      }
    } catch (err) {
      log.warn(`Size estimate failed for ${entry.file.name}: ${/** @type {Error} */ (err).message}`);
      entry.sampleKey = key;
    }
    if (state.converting) return;
    renderEstimate();
  }
  renderEstimate();
}

/**
 * Pick up to five pages spread evenly through the document to measure.
 *
 * Sampling only page 1 was badly wrong on real documents: a 128-page book with
 * a light cover page estimated 13 MB against an actual 54 MB. Spreading the
 * samples catches the mix of text pages and scanned spreads.
 *
 * @param {Entry} entry
 * @returns {number[]} 1-based page numbers
 */
function samplePages(entry) {
  const pages = entry.pages ?? Array.from({ length: entry.pageCount }, (_, i) => i + 1);
  if (pages.length <= 5) return pages;
  const picks = new Set();
  for (let i = 0; i < 5; i++) {
    picks.add(pages[Math.round((i * (pages.length - 1)) / 4)]);
  }
  return [...picks];
}

function renderOpts() {
  const s = state.settings;
  return {
    dpi: QUALITY_DPI[s.quality],
    mime: s.format === "png" ? "image/png" : "image/jpeg",
    quality: s.optimize ? 0.82 : 0.92,
  };
}

/** @returns {{bytes:number, biggest:number}} */
function totalEstimate() {
  let bytes = 0;
  let biggest = 0;
  for (const e of state.entries) {
    if (e.status !== "ready" || !e.sampleBytes.length) continue;
    const b = estimatePptxBytes(e.sampleBytes, pagesOf(e));
    bytes += b;
    biggest = Math.max(biggest, b);
  }
  return { bytes, biggest };
}

/* ------------------------------------------------------------- conversion */

async function convertAll() {
  const queue = state.entries.filter((e) => e.status === "ready");
  if (!queue.length) return;

  const output = makeOutput(state.dirHandle);
  if (!(await output.ensurePermission())) {
    showFatal("Permission to write to that folder was refused. Choose it again, or clear it to use downloads instead.");
    return;
  }

  state.abort = new AbortController();
  state.converting = true;
  state.lastRun = null;
  const totalPages = queue.reduce((n, e) => n + pagesOf(e), 0);
  let pagesDone = 0;
  const result = { ok: 0, failed: 0, names: /** @type {string[]} */ ([]) };
  log.info(`Batch started: ${queue.length} file(s), ${totalPages} page(s), ${JSON.stringify(state.settings)}`);
  render();

  for (const entry of queue) {
    if (state.abort.signal.aborted) break;
    entry.status = "converting";
    entry.message = "Starting…";
    render();

    const pagesHere = pagesOf(entry);
    try {
      const opts = renderOpts();
      const { blob, filename, slideCount } = await convertPdf(
        { file: entry.file, password: entry.password ?? undefined, pages: entry.pages },
        {
          quality: state.settings.quality,
          mime: opts.mime,
          jpegQuality: opts.quality,
          signal: state.abort.signal,
          onProgress: (p) => {
            entry.message =
              p.phase === "opening" ? "Opening…"
              : p.phase === "packaging" ? "Saving…"
              : `Page ${p.page} of ${p.pageCount}`;
            updateProgress(entry, pagesDone + (p.phase === "rendering" ? p.page : 0), totalPages);
          },
        },
      );

      const written = await output.write(sanitizeFilename(filename), blob);
      entry.outputName = written;
      entry.status = "done";
      entry.message = `${slideCount} slide${slideCount === 1 ? "" : "s"} · ${formatBytes(blob.size)}`;
      result.ok++;
      result.names.push(written);
      log.info(`Converted ${entry.file.name} -> ${written} (${slideCount} slides, ${blob.size} bytes)`);
    } catch (err) {
      const e = /** @type {PdfError} */ (err);
      if (e && e.code === CODES.CANCELLED) {
        entry.status = "ready";
        entry.message = "";
        log.info(`Cancelled during ${entry.file.name}`);
        break;
      }
      entry.status = "error";
      entry.message = e?.message ?? "Conversion failed.";
      entry.lastError = /** @type {Error} */ (err);
      result.failed++;
      log.error(`Failed converting ${entry.file.name}`, /** @type {Error} */ (err));
    }
    pagesDone += pagesHere;
    updateProgress(null, pagesDone, totalPages);
    render();
  }

  const cancelled = state.abort.signal.aborted;
  state.converting = false;
  state.abort = null;
  state.lastRun = { ...result, cancelled };
  if (cancelled) log.info("Batch cancelled by user");
  render();
}

function updateProgress(entry, pagesDone, totalPages) {
  // Keep the file row's own status line in step with the progress bar. render()
  // is deliberately not called per page — rebuilding the list 166 times would
  // throw away focus and input state — so this line is updated in place.
  if (entry) {
    const row = document.querySelector(`#filelist li[data-id="${entry.id}"] .f-meta`);
    if (row) {
      const bits = [formatBytes(entry.file.size)];
      if (entry.pageCount) bits.push(`${entry.pageCount} page${entry.pageCount === 1 ? "" : "s"}`);
      if (entry.message) bits.push(entry.message);
      row.textContent = bits.join(" · ");
    }
  }
  const pct = totalPages ? Math.min(100, (pagesDone / totalPages) * 100) : 0;
  $("#bar-fill").style.width = `${pct}%`;
  $("#prog-who").textContent = entry ? entry.file.name : "Finishing…";
  $("#prog-what").textContent = entry ? entry.message : "";
  $("#prog-overall").textContent = `${Math.round(pct)}%`;
  $("#progress-card").setAttribute("aria-valuenow", String(Math.round(pct)));
}

/* ------------------------------------------------------------------- view */

function render() {
  renderList();
  renderControls();
  renderEstimate();
  renderProgress();
  renderResults();
}

function renderList() {
  const list = $("#filelist");
  const has = state.entries.length > 0;
  $("#queue-card").hidden = !has;
  $("#queue-count").textContent = has
    ? `${state.entries.length} file${state.entries.length === 1 ? "" : "s"}`
    : "";
  list.textContent = "";
  for (const e of state.entries) list.appendChild(entryRow(e));
}

function entryRow(e) {
  const li = document.createElement("li");
  li.dataset.id = e.id;

  li.appendChild(icon("file", "f-icon"));

  const name = document.createElement("div");
  name.className = "f-name";
  name.appendChild(document.createTextNode(e.file.name));
  const badge = statusBadge(e);
  if (badge) name.appendChild(badge);
  li.appendChild(name);

  const actions = document.createElement("div");
  actions.className = "f-actions";
  const remove = document.createElement("button");
  remove.className = "ghost danger";
  remove.type = "button";
  remove.title = "Remove from queue";
  remove.setAttribute("aria-label", `Remove ${e.file.name}`);
  remove.textContent = "✕";
  remove.disabled = state.converting;
  remove.addEventListener("click", () => {
    state.entries = state.entries.filter((x) => x.id !== e.id);
    log.info(`Removed ${e.file.name}`);
    render();
  });
  actions.appendChild(remove);
  li.appendChild(actions);

  const meta = document.createElement("div");
  meta.className = "f-meta";
  const bits = [formatBytes(e.file.size)];
  if (e.pageCount) {
    bits.push(`${e.pageCount} page${e.pageCount === 1 ? "" : "s"}`);
    if (e.pages) bits.push(`${e.pages.length} selected`);
  }
  if (e.message && e.status !== "locked") bits.push(e.message);
  meta.textContent = bits.join(" · ");
  li.appendChild(meta);

  if (e.status === "locked") li.appendChild(passwordRow(e));
  else if (e.status === "ready" && e.pageCount > 1) li.appendChild(rangeRow(e));

  return li;
}

function statusBadge(e) {
  const map = {
    probing: ["busy", "Reading"],
    locked: ["warn", "Locked"],
    error: ["err", "Failed"],
    converting: ["busy", "Converting"],
    done: ["ok", "Done"],
  };
  const hit = map[e.status];
  if (!hit) return null;
  const b = document.createElement("span");
  b.className = `badge ${hit[0]}`;
  b.textContent = hit[1];
  return b;
}

function passwordRow(e) {
  const wrap = document.createElement("div");
  wrap.className = "f-extra pw-row";
  const label = document.createElement("label");
  label.className = "sr-only";
  label.htmlFor = `pw-${e.id}`;
  label.textContent = `Password for ${e.file.name}`;
  const input = document.createElement("input");
  input.type = "password";
  input.id = `pw-${e.id}`;
  input.placeholder = "PDF password";
  input.autocomplete = "off";
  const go = document.createElement("button");
  go.type = "button";
  go.textContent = "Unlock";
  const submit = () => {
    if (!input.value) return;
    e.password = input.value;
    e.status = "probing";
    e.message = "Checking…";
    render();
    probe(e);
  };
  go.addEventListener("click", submit);
  input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") submit(); });
  wrap.append(label, input, go);
  if (e.message) {
    const msg = document.createElement("span");
    msg.className = "field-error";
    msg.textContent = e.message;
    wrap.appendChild(msg);
  }
  return wrap;
}

function rangeRow(e) {
  const wrap = document.createElement("div");
  wrap.className = "f-extra";
  const row = document.createElement("div");
  row.className = "range-row";
  const label = document.createElement("label");
  label.htmlFor = `rg-${e.id}`;
  label.textContent = "Pages";
  const input = document.createElement("input");
  input.type = "text";
  input.id = `rg-${e.id}`;
  input.value = e.rangeExpr;
  input.placeholder = `All (1-${e.pageCount})`;
  input.disabled = state.converting;
  if (e.rangeError) input.classList.add("invalid");
  input.addEventListener("input", () => {
    e.rangeExpr = input.value;
    revalidateRange(e);
    input.classList.toggle("invalid", Boolean(e.rangeError));
    const err = wrap.querySelector(".field-error");
    if (err) err.textContent = e.rangeError;
    e.sampleKey = "";
    renderControls();
    scheduleEstimate();
  });
  row.append(label, input);
  wrap.appendChild(row);
  const err = document.createElement("div");
  err.className = "field-error";
  err.textContent = e.rangeError;
  wrap.appendChild(err);
  return wrap;
}

function renderControls() {
  const ready = state.entries.filter((e) => e.status === "ready");
  const blocked = state.entries.some((e) => e.rangeError);
  const btn = /** @type {HTMLButtonElement} */ ($("#convert"));
  btn.hidden = state.converting;
  btn.disabled = ready.length === 0 || blocked;
  const pages = ready.reduce((n, e) => n + pagesOf(e), 0);
  btn.textContent = ready.length
    ? `Convert ${ready.length} PDF${ready.length === 1 ? "" : "s"} · ${pages} slide${pages === 1 ? "" : "s"}`
    : "Convert";
  $("#cancel").hidden = !state.converting;
  for (const el of document.querySelectorAll("#settings input, #settings select, #settings button")) {
    /** @type {HTMLInputElement} */ (el).disabled = state.converting;
  }
  $("#dropzone").classList.toggle("disabled", state.converting);
  /** @type {HTMLButtonElement} */ ($("#clear-all")).disabled = state.converting;
}

function renderEstimate() {
  const { bytes, biggest } = totalEstimate();
  const box = $("#estimate");
  if (!bytes) { box.hidden = true; return; }
  box.hidden = false;
  $("#estimate-value").textContent = formatBytes(bytes);
  // Estimates run ~20% low on image-heavy documents even with five samples,
  // so warn well before the real limit rather than at 90% of it.
  const over = biggest > GOOGLE_SLIDES_LIMIT_BYTES * 0.75;
  const warn = $("#size-warning");
  warn.hidden = !over;
  if (over) {
    $("#size-warning-text").textContent =
      `One of these presentations is about ${formatBytes(biggest)}. Google Slides refuses uploads over ${formatBytes(GOOGLE_SLIDES_LIMIT_BYTES)}.`;
    const fix = /** @type {HTMLButtonElement} */ ($("#size-fix"));
    fix.hidden = state.settings.quality === "standard" && state.settings.format === "jpeg" && state.settings.optimize;
  }
}

function renderProgress() {
  $("#progress-card").hidden = !state.converting;
}

function renderResults() {
  const card = $("#results-card");
  const run = state.lastRun;
  card.hidden = !run || state.converting;
  if (!run || state.converting) return;
  const ok = run.failed === 0 && !run.cancelled;
  $("#result-head").className = `result-head ${ok ? "ok" : "err"}`;
  $("#result-icon").replaceChildren(icon(ok ? "check" : "alert"));
  $("#result-title").textContent = run.cancelled
    ? "Conversion cancelled"
    : run.failed === 0
      ? "Conversion complete"
      : `${run.ok} converted, ${run.failed} failed`;
  $("#result-detail").textContent = run.ok
    ? `Saved to ${makeOutput(state.dirHandle).label}: ${run.names.join(", ")}`
    : "Nothing was saved.";
  $("#result-path").hidden = !state.dirHandle || !run.ok;

  const failures = state.entries.filter((e) => e.status === "error" && e.lastError);
  $("#tech-detail").textContent = failures.length
    ? failures
        .map((e) => {
          const err = /** @type {PdfError} */ (e.lastError);
          const cause = err.cause instanceof Error ? `\n    caused by ${err.cause.name}: ${err.cause.message}` : "";
          return `${e.file.name}\n  ${err.code ?? err.name}: ${err.message}${cause}`;
        })
        .join("\n\n")
    : "No errors recorded.";
}

/* ---------------------------------------------------------------- helpers */

const ICONS = {
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-7-7z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13 2v7h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  check: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="m8 12.4 2.6 2.6L16 9.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  alert: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M12 7.5v5.5M12 16.3v.2" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
};

function icon(name, cls) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  if (cls) svg.setAttribute("class", cls);
  svg.innerHTML = ICONS[name] ?? "";
  return svg;
}

let noticeTimer = 0;
function flashNotice(text) {
  const n = $("#notice");
  $("#notice-text").textContent = text;
  n.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { n.hidden = true; }, 6000);
}

function showFatal(text) {
  state.lastRun = { ok: 0, failed: 1, names: [], cancelled: false };
  render();
  $("#result-title").textContent = "Couldn't start";
  $("#result-detail").textContent = text;
}

function updateFolderUi() {
  const supported = supportsDirectoryOutput();
  $("#folder-unsupported").hidden = supported;
  $("#pick-folder").hidden = !supported;
  $("#clear-folder").hidden = !supported || !state.dirHandle;
  $("#folder-path").textContent = state.dirHandle
    ? state.dirHandle.name
    : supported
      ? "Not set — files will go to your Downloads folder"
      : "Your Downloads folder";
}

/* -------------------------------------------------------------- app start */

function wire() {
  const dz = $("#dropzone");
  const picker = /** @type {HTMLInputElement} */ ($("#file-input"));

  dz.addEventListener("click", () => { if (!state.converting) picker.click(); });
  dz.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && !state.converting) { e.preventDefault(); picker.click(); }
  });
  picker.addEventListener("change", () => {
    if (picker.files) addFiles(picker.files);
    picker.value = "";
  });

  let depth = 0;
  for (const ev of ["dragenter", "dragover"]) {
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      if (state.converting) return;
      if (ev === "dragenter") depth++;
      dz.classList.add("dragover");
    });
  }
  dz.addEventListener("dragleave", (e) => {
    e.preventDefault();
    if (--depth <= 0) { depth = 0; dz.classList.remove("dragover"); }
  });
  dz.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    dz.classList.remove("dragover");
    if (state.converting) return;
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });
  // Dropping anywhere else must not navigate away from the app.
  for (const ev of ["dragover", "drop"]) {
    window.addEventListener(ev, (e) => { if (e.target !== dz && !dz.contains(/** @type {Node} */ (e.target))) e.preventDefault(); });
  }

  for (const input of document.querySelectorAll('input[name="quality"]')) {
    input.addEventListener("change", () => {
      state.settings.quality = /** @type {HTMLInputElement} */ (input).value;
      saveSettings(state.settings);
      invalidateSamples();
    });
  }
  $("#format").addEventListener("change", (e) => {
    state.settings.format = /** @type {HTMLSelectElement} */ (e.target).value;
    saveSettings(state.settings);
    invalidateSamples();
  });
  $("#optimize").addEventListener("change", (e) => {
    state.settings.optimize = /** @type {HTMLInputElement} */ (e.target).checked;
    saveSettings(state.settings);
    invalidateSamples();
  });

  $("#pick-folder").addEventListener("click", async () => {
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      state.dirHandle = handle;
      await saveDirHandle(handle);
      updateFolderUi();
      render();
    } catch (err) {
      flashNotice(/** @type {Error} */ (err).message);
    }
  });
  $("#clear-folder").addEventListener("click", async () => {
    state.dirHandle = null;
    await saveDirHandle(null);
    updateFolderUi();
    render();
  });

  $("#convert").addEventListener("click", () => { convertAll(); });
  $("#cancel").addEventListener("click", () => {
    state.abort?.abort();
    $("#cancel").disabled = true;
    $("#prog-what").textContent = "Cancelling…";
  });
  $("#size-fix").addEventListener("click", () => {
    state.settings.quality = "standard";
    state.settings.format = "jpeg";
    state.settings.optimize = true;
    saveSettings(state.settings);
    applySettingsToUi();
    invalidateSamples();
  });
  $("#download-log").addEventListener("click", () => downloadLog());
  $("#clear-all").addEventListener("click", () => {
    state.entries = [];
    state.lastRun = null;
    render();
  });

  window.addEventListener("beforeunload", (e) => {
    if (state.converting) { e.preventDefault(); e.returnValue = ""; }
  });
  window.addEventListener("error", (e) => log.error("Uncaught error", e.error));
  window.addEventListener("unhandledrejection", (e) => log.error("Unhandled rejection", e.reason));
}

function invalidateSamples() {
  for (const e of state.entries) e.sampleKey = "";
  scheduleEstimate();
  render();
}

function applySettingsToUi() {
  const q = document.querySelector(`input[name="quality"][value="${state.settings.quality}"]`);
  if (q) /** @type {HTMLInputElement} */ (q).checked = true;
  /** @type {HTMLSelectElement} */ ($("#format")).value = state.settings.format;
  /** @type {HTMLInputElement} */ ($("#optimize")).checked = state.settings.optimize;
}

export async function start() {
  log.info(`App started — ${navigator.userAgent}`);
  wire();
  applySettingsToUi();
  state.dirHandle = supportsDirectoryOutput() ? await loadDirHandle() : null;
  updateFolderUi();
  render();
}
