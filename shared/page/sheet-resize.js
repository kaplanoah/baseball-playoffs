// A sheet as tall as its content eases to its new height when what it shows changes, instead of
// jumping to it.

const RESIZE_MS = 250;
const RESIZE_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** @type {WeakMap<HTMLElement, Animation>} */
const resizes = new WeakMap();

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** @param {HTMLElement} sheet */
const readHeight = (sheet) => getComputedStyle(sheet).height;

/**
 * Redraws a sheet, and if it's open, eases it from the height it had to the one its new content
 * needs. A sheet still easing starts again from wherever it is.
 * @param {HTMLDialogElement} sheet
 * @param {() => void} redraw
 */
export function redrawSheet(sheet, redraw) {
  const from = sheet.open ? readHeight(sheet) : null;
  resizes.get(sheet)?.cancel();
  redraw();
  if (!from || prefersReducedMotion()) return;
  const to = readHeight(sheet);
  if (to === from) return;
  const resize = sheet.animate(
    [
      { height: from, overflow: "hidden" },
      { height: to, overflow: "hidden" },
    ],
    { duration: RESIZE_MS, easing: RESIZE_EASING },
  );
  resizes.set(sheet, resize);
}
