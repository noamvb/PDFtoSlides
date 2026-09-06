import { test } from "node:test";
import assert from "node:assert/strict";
import { CODES, PdfError } from "../../src/core/errors.js";

test("PdfError carries its code, message, cause, and name", () => {
  const cause = new Error("original");
  const error = new PdfError(CODES.CORRUPT, "The PDF is corrupt", cause);
  assert.ok(error instanceof Error);
  assert.equal(error.name, "PdfError");
  assert.equal(error.code, CODES.CORRUPT);
  assert.equal(error.message, "The PDF is corrupt");
  assert.equal(error.cause, cause);
});
