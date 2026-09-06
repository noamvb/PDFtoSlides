import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePageRanges } from "../../src/core/pageRanges.js";

test("parsePageRanges parses, sorts, and de-duplicates ranges", () => {
  assert.deepEqual(parsePageRanges("1-10, 14, 20-25", 30), [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 14, 20, 21, 22, 23, 24, 25,
  ]);
  assert.deepEqual(parsePageRanges("1-5,3-8", 30), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(parsePageRanges("5-5", 30), [5]);
});

test("parsePageRanges treats empty input as all pages", () => {
  assert.equal(parsePageRanges("", 30), null);
  assert.equal(parsePageRanges("   ", 30), null);
});

test("parsePageRanges reports each invalid input error", () => {
  assert.throws(() => parsePageRanges("10-3", 30), {
    name: "RangeError",
    message: 'Range "10-3" is backwards',
  });
  assert.throws(() => parsePageRanges("0", 30), {
    name: "RangeError",
    message: "Page numbers start at 1",
  });
  assert.throws(() => parsePageRanges("31", 30), {
    name: "RangeError",
    message: "This PDF has only 30 pages",
  });
  assert.throws(() => parsePageRanges("abc", 30), {
    name: "RangeError",
    message: '"abc" is not a page number or range',
  });
});
