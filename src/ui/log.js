/**
 * Diagnostics log. Keeps a bounded in-memory ring of timestamped entries that
 * the user can download when something goes wrong. Nothing is ever sent
 * anywhere; the log lives only in this tab until the user saves it.
 */

const MAX_ENTRIES = 2000;
/** @type {{t:string, level:string, msg:string, detail?:string}[]} */
const entries = [];

function push(level, msg, detail) {
  entries.push({ t: new Date().toISOString(), level, msg, detail });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
}

export const log = {
  info: (msg, detail) => push("info", msg, detail),
  warn: (msg, detail) => push("warn", msg, detail),
  error: (msg, err) =>
    push("error", msg, err ? `${err.name}: ${err.message}\n${err.stack ?? ""}` : undefined),
};

/** @returns {string} the whole log as plain text, newest last. */
export function logText() {
  const header = [
    "PDF to Slides — diagnostics log",
    `Generated: ${new Date().toISOString()}`,
    `User agent: ${navigator.userAgent}`,
    `Language: ${navigator.language}`,
    "",
    "This file contains no document contents — only filenames, sizes and errors.",
    "".padEnd(72, "-"),
    "",
  ].join("\n");
  const body = entries
    .map((e) => `${e.t} ${e.level.toUpperCase().padEnd(5)} ${e.msg}${e.detail ? `\n    ${e.detail.replace(/\n/g, "\n    ")}` : ""}`)
    .join("\n");
  return header + body + "\n";
}

/** Trigger a download of the current log. */
export function downloadLog() {
  const blob = new Blob([logText()], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pdf-to-slides-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
