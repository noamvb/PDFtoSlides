import { test } from "node:test";
import assert from "node:assert/strict";
import { pptxNameFor, sanitizeFilename, uniqueName } from "../../src/core/naming.js";

test("pptxNameFor replaces only a trailing PDF extension", () => {
  assert.equal(pptxNameFor("Q3 report.pdf"), "Q3 report.pptx");
  assert.equal(pptxNameFor("a.PDF"), "a.pptx");
  assert.equal(pptxNameFor("notes"), "notes.pptx");
  assert.equal(pptxNameFor("my.pdf.backup.pdf"), "my.pdf.backup.pptx");
});

test("sanitizeFilename replaces illegal characters and trims trailing punctuation", () => {
  assert.equal(sanitizeFilename('a<b>c:d"e/f\\g|h?i*j'), "a_b_c_d_e_f_g_h_i_j");
  assert.equal(sanitizeFilename("trailing... "), "trailing");
  assert.equal(sanitizeFilename("..."), "presentation");
  assert.equal(sanitizeFilename("Отчёт 2024 — итоги.pptx"), "Отчёт 2024 — итоги.pptx");
});

test("uniqueName finds the first free numbered filename", async () => {
  const taken = new Set(["deck.pptx", "deck (2).pptx"]);
  assert.equal(await uniqueName("deck.pptx", async (candidate) => taken.has(candidate)), "deck (3).pptx");
});

test("uniqueName appends the suffix when there is no extension", async () => {
  assert.equal(await uniqueName("deck", async (candidate) => candidate === "deck"), "deck (2)");
});

test("uniqueName gives up after the allowed attempts", async () => {
  await assert.rejects(
    uniqueName("deck.pptx", async () => true),
    { name: "RangeError", message: "Could not find a free filename" },
  );
});
