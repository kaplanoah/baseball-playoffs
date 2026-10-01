// The init script runs in the page, whose globals Node's lint doesn't know, so it reaches them
// through globalThis.

/**
 * Notes each height animation the page starts, by its element's id and the heights it eases
 * between, for the returned function to read. Call it before the page loads.
 * @param {import("@playwright/test").Page} page
 * @returns {Promise<() => Promise<{ id: string, heights: string[] }[]>>}
 */
export async function recordSheetResizes(page) {
  await page.addInitScript(() => {
    const resizes = [];
    /** @type {any} */ (globalThis).sheetResizes = resizes;
    const { prototype } = globalThis.Element;
    const animate = prototype.animate;
    prototype.animate = function (keyframes, options) {
      if (Array.isArray(keyframes) && keyframes.every((keyframe) => "height" in keyframe))
        resizes.push({ id: this.id, heights: keyframes.map((keyframe) => keyframe.height) });
      return animate.call(this, keyframes, options);
    };
  });
  return () => page.evaluate(() => /** @type {any} */ (globalThis).sheetResizes);
}
