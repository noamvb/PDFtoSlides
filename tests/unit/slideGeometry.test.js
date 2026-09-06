import { test } from "node:test";
import assert from "node:assert/strict";
import { chooseSlideSize, placeOnSlide } from "../../src/core/slideGeometry.js";

const a4 = { widthPt: 595.276, heightPt: 841.89 };
const letter = { widthPt: 612, heightPt: 792 };

test("chooseSlideSize chooses A4 and rounds to four decimals", () => {
  assert.deepEqual(chooseSlideSize([a4, a4]), { widthIn: 8.2677, heightIn: 11.6929 });
  assert.deepEqual(chooseSlideSize([a4, letter, a4, letter, a4]), {
    widthIn: 8.2677,
    heightIn: 11.6929,
  });
});

test("chooseSlideSize breaks ties by first occurrence", () => {
  assert.deepEqual(chooseSlideSize([a4, letter]), { widthIn: 8.2677, heightIn: 11.6929 });
});

test("chooseSlideSize clamps large and small pages", () => {
  const large = chooseSlideSize([{ widthPt: 5000, heightPt: 5000 }]);
  assert.equal(Math.max(large.widthIn, large.heightIn), 56);
  const small = chooseSlideSize([{ widthPt: 36, heightPt: 36 }]);
  assert.equal(Math.min(small.widthIn, small.heightIn), 1);
});

test("placeOnSlide fills matching slides and centres portrait pages", () => {
  assert.deepEqual(placeOnSlide({ widthPt: 720, heightPt: 540 }, { widthIn: 10, heightIn: 7.5 }), {
    x: 0, y: 0, w: 10, h: 7.5,
  });
  const placed = placeOnSlide({ widthPt: 540, heightPt: 720 }, { widthIn: 10, heightIn: 7.5 });
  assert.equal(placed.y, 0);
  assert.equal(placed.x, 2.1875);
  assert.ok(placed.x + placed.w <= 10);
  assert.ok(placed.y + placed.h <= 7.5);
});
