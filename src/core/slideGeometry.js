/** @typedef {{widthPt:number, heightPt:number}} PageSize */

const round4 = (value) => Math.round(value * 10000) / 10000;

/**
 * Decide the presentation-wide slide size from every page's size.
 *
 * @param {PageSize[]} pages one entry per page being converted, length >= 1
 * @returns {{widthIn:number, heightIn:number}} rounded to 4 decimal places
 */
export function chooseSlideSize(pages) {
  const groups = new Map();
  pages.forEach((page, index) => {
    const width = Math.round(page.widthPt * 2) / 2;
    const height = Math.round(page.heightPt * 2) / 2;
    const key = `${width}x${height}`;
    const group = groups.get(key);
    if (group) {
      group.count += 1;
    } else {
      groups.set(key, { count: 1, firstIndex: index, page });
    }
  });

  let winner;
  for (const group of groups.values()) {
    if (!winner || group.count > winner.count ||
        (group.count === winner.count && group.firstIndex < winner.firstIndex)) {
      winner = group;
    }
  }

  let widthIn = winner.page.widthPt / 72;
  let heightIn = winner.page.heightPt / 72;
  const longerSide = Math.max(widthIn, heightIn);
  const shorterSide = Math.min(widthIn, heightIn);
  if (longerSide > 56) {
    const scale = 56 / longerSide;
    widthIn *= scale;
    heightIn *= scale;
  } else if (shorterSide < 1) {
    const scale = 1 / shorterSide;
    widthIn *= scale;
    heightIn *= scale;
  }
  return { widthIn: round4(widthIn), heightIn: round4(heightIn) };
}

/**
 * Place one page image on the slide: fit inside without cropping, centred,
 * never stretched.
 *
 * @param {PageSize} page
 * @param {{widthIn:number, heightIn:number}} slide
 * @returns {{x:number, y:number, w:number, h:number}} inches, 4 decimals
 */
export function placeOnSlide(page, slide) {
  const pageWidthIn = page.widthPt / 72;
  const pageHeightIn = page.heightPt / 72;
  const scale = Math.min(slide.widthIn / pageWidthIn, slide.heightIn / pageHeightIn);
  const w = pageWidthIn * scale;
  const h = pageHeightIn * scale;
  const x = Math.max(0, round4((slide.widthIn - w) / 2));
  const y = Math.max(0, round4((slide.heightIn - h) / 2));
  return { x, y, w: round4(w), h: round4(h) };
}
