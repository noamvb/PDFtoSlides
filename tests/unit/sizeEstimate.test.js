import { test } from "node:test";
import assert from "node:assert/strict";
import { estimatePptxBytes, formatBytes } from "../../src/core/sizeEstimate.js";

test("estimatePptxBytes uses the sample mean plus overhead", () => {
  assert.equal(estimatePptxBytes([100, 200, 300], 10), 42000);
  assert.equal(estimatePptxBytes([], 5), 40000);
});

test("formatBytes formats all size bands", () => {
  assert.equal(formatBytes(0), "0 bytes");
  assert.equal(formatBytes(1), "1 byte");
  assert.equal(formatBytes(512), "512 bytes");
  assert.equal(formatBytes(1434), "1.4 KB");
  assert.equal(formatBytes(2 * 1024 ** 2), "2.0 MB");
  assert.equal(formatBytes(2.4 * 1024 ** 2), "2.4 MB");
  assert.equal(formatBytes(1.1 * 1024 ** 3), "1.1 GB");
});
