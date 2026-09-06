/**
 * Turn a PDF filename into the .pptx output basename.
 *
 * @param {string} pdfFilename
 * @returns {string}
 */
export function pptxNameFor(pdfFilename) {
  return `${pdfFilename.replace(/\.pdf$/i, "")}.pptx`;
}

/**
 * Remove characters illegal in Windows and macOS filenames.
 *
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
  let result = name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_");
  result = result.replace(/[. ]+$/g, "");
  if (result === "" || /^\.+$/.test(result)) return "presentation";
  return result;
}

/**
 * Given a desired name and a predicate that reports whether a name is taken,
 * return the first free name, appending a numbered suffix before its extension.
 *
 * @param {string} name
 * @param {(candidate:string)=>Promise<boolean>} isTaken
 * @returns {Promise<string>}
 */
export async function uniqueName(name, isTaken) {
  if (!(await isTaken(name))) return name;
  const extensionIndex = name.lastIndexOf(".");
  const stem = extensionIndex === -1 ? name : name.slice(0, extensionIndex);
  const extension = extensionIndex === -1 ? "" : name.slice(extensionIndex);
  for (let number = 2; number <= 999; number += 1) {
    const candidate = `${stem} (${number})${extension}`;
    if (!(await isTaken(candidate))) return candidate;
  }
  throw new RangeError("Could not find a free filename");
}
