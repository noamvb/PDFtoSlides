/**
 * Where finished .pptx files go.
 *
 * Two strategies behind one interface:
 *  - DirectoryOutput  — File System Access API (Chrome/Edge). Real folder,
 *                       real collision detection, files appear where the user
 *                       asked for them.
 *  - DownloadOutput   — everywhere else. The browser's own download flow; the
 *                       browser handles collisions by appending " (1)".
 *
 * Nothing here uploads anything. `showDirectoryPicker` and `<a download>` are
 * both entirely local.
 */

import { uniqueName } from "../core/naming.js";
import { PdfError, CODES } from "../core/errors.js";
import { log } from "./log.js";

/** @returns {boolean} true when the browser can write to a chosen folder. */
export function supportsDirectoryOutput() {
  return typeof globalThis.showDirectoryPicker === "function" && globalThis.isSecureContext !== false;
}

class DirectoryOutput {
  /** @param {FileSystemDirectoryHandle} handle */
  constructor(handle) {
    this.handle = handle;
    this.kind = "directory";
  }

  get label() {
    return this.handle.name;
  }

  /** Ensure we still hold write permission; may prompt once per session. */
  async ensurePermission() {
    const opts = { mode: "readwrite" };
    if ((await this.handle.queryPermission(opts)) === "granted") return true;
    return (await this.handle.requestPermission(opts)) === "granted";
  }

  /** @param {string} name @returns {Promise<boolean>} */
  async #exists(name) {
    try {
      await this.handle.getFileHandle(name);
      return true;
    } catch (err) {
      if (err && err.name === "NotFoundError") return false;
      throw err;
    }
  }

  /**
   * @param {string} desiredName
   * @param {Blob} blob
   * @returns {Promise<string>} the name actually written
   */
  async write(desiredName, blob) {
    const name = await uniqueName(desiredName, (candidate) => this.#exists(candidate));
    let writable;
    try {
      const fileHandle = await this.handle.getFileHandle(name, { create: true });
      writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      log.info(`Wrote ${name} (${blob.size} bytes) to folder "${this.handle.name}"`);
      return name;
    } catch (err) {
      // A failed write must not leave a zero-byte file behind.
      try {
        if (writable) await writable.abort();
      } catch { /* already closed */ }
      try {
        await this.handle.removeEntry(name);
      } catch { /* nothing to remove */ }
      throw classifyWriteError(err, name);
    }
  }
}

class DownloadOutput {
  constructor() {
    this.kind = "download";
  }

  get label() {
    return "your Downloads folder";
  }

  async ensurePermission() {
    return true;
  }

  /**
   * @param {string} desiredName
   * @param {Blob} blob
   * @returns {Promise<string>}
   */
  async write(desiredName, blob) {
    const url = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = url;
      a.download = desiredName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      log.info(`Downloaded ${desiredName} (${blob.size} bytes)`);
      return desiredName;
    } finally {
      // Revoking immediately can cancel the download in some browsers.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
  }
}

/** @param {unknown} err @param {string} name */
function classifyWriteError(err, name) {
  const e = /** @type {Error} */ (err);
  const n = e && e.name;
  if (n === "QuotaExceededError") {
    return new PdfError(CODES.DISK_FULL, `There isn't enough space to save "${name}".`, e);
  }
  if (n === "NotAllowedError" || n === "SecurityError") {
    return new PdfError(CODES.PERMISSION, `Permission to write "${name}" was refused.`, e);
  }
  if (n === "NoModificationAllowedError" || n === "InvalidStateError") {
    return new PdfError(CODES.WRITE_FAILED, `"${name}" is locked or already open in another program.`, e);
  }
  return new PdfError(CODES.WRITE_FAILED, `"${name}" couldn't be saved.`, e);
}

/** @param {FileSystemDirectoryHandle|null} handle */
export function makeOutput(handle) {
  return handle ? new DirectoryOutput(handle) : new DownloadOutput();
}

/** Prompt for an output folder. @returns {Promise<FileSystemDirectoryHandle|null>} */
export async function pickDirectory() {
  try {
    return await globalThis.showDirectoryPicker({ id: "pdf-to-slides-output", mode: "readwrite" });
  } catch (err) {
    if (err && err.name === "AbortError") return null; // user cancelled
    log.error("Folder picker failed", /** @type {Error} */ (err));
    throw new PdfError(CODES.PERMISSION, "That folder couldn't be opened.", /** @type {Error} */ (err));
  }
}
