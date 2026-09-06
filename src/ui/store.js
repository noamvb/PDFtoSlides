/**
 * Persistence for settings and the chosen output directory.
 *
 * Settings live in localStorage (small, synchronous, survives everything).
 * The output directory is a FileSystemDirectoryHandle, which is a structured-
 * cloneable object that ONLY IndexedDB can hold, so it gets its own store.
 *
 * Every accessor is defensive: a private window, cleared site data, or a
 * browser that blocks storage must degrade to defaults, never throw.
 */

const SETTINGS_KEY = "pdf-to-slides:settings:v1";
const DB_NAME = "pdf-to-slides";
const DB_STORE = "handles";
const DIR_KEY = "outputDir";

/** @typedef {{quality:"standard"|"high"|"veryHigh", format:"jpeg"|"png", optimize:boolean}} Settings */

/** @type {Settings} */
export const DEFAULT_SETTINGS = Object.freeze({
  quality: "high",
  format: "jpeg",
  optimize: true,
});

/** @returns {Settings} */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      quality: ["standard", "high", "veryHigh"].includes(parsed.quality) ? parsed.quality : DEFAULT_SETTINGS.quality,
      format: ["jpeg", "png"].includes(parsed.format) ? parsed.format : DEFAULT_SETTINGS.format,
      optimize: typeof parsed.optimize === "boolean" ? parsed.optimize : DEFAULT_SETTINGS.optimize,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** @param {Settings} settings */
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage blocked — settings simply do not persist */
  }
}

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      req = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const req = fn(tx.objectStore(DB_STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** @returns {Promise<FileSystemDirectoryHandle|null>} */
export async function loadDirHandle() {
  try {
    return (await idb("readonly", (s) => s.get(DIR_KEY))) ?? null;
  } catch {
    return null;
  }
}

/** @param {FileSystemDirectoryHandle|null} handle */
export async function saveDirHandle(handle) {
  try {
    if (handle) await idb("readwrite", (s) => s.put(handle, DIR_KEY));
    else await idb("readwrite", (s) => s.delete(DIR_KEY));
  } catch {
    /* storage blocked — the folder is simply re-picked next session */
  }
}
