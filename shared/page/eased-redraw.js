import { logPatches } from "./html.js";

// New data that changes what the page shows eases in: a part that grows or shrinks moves to its
// new height, so what's under it slides instead of jumping, and what's new fades in. The page
// stays live under a finger throughout, unlike in a view transition, which takes every touch
// while it runs.

const EASE_MS = 250;
const EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** @type {WeakMap<Element, Animation>} */
const resizes = new WeakMap();

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const canEase = () => !document.hidden && !prefersReducedMotion();

/** @param {Element} element */
const readHeight = (element) => element.getBoundingClientRect().height;

// Clipping, unlike hiding what overflows, leaves a sticky header inside the part stuck.
/**
 * @param {{ element: Element, from: number, to: number }} size
 */
function easeHeight({ element, from, to }) {
  if (Math.abs(to - from) < 1) return;
  const resize = element.animate(
    [
      { height: `${from}px`, overflow: "clip" },
      { height: `${to}px`, overflow: "clip" },
    ],
    { duration: EASE_MS, easing: EASING },
  );
  resizes.set(element, resize);
}

/** @param {Element} element */
function fadeIn(element) {
  if (element.isConnected)
    element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: EASE_MS, easing: EASING });
}

/**
 * Redraws the page, easing each part whose height the redraw changes from the height it had,
 * and fading in what it adds. A part still easing starts again from wherever it is.
 * @param {() => void} redraw
 */
export function redrawEased(redraw) {
  if (!canEase()) {
    redraw();
    return;
  }
  const { heights, added } = logPatches(redraw);
  const changed = [...heights].filter(([element]) => element.isConnected);
  for (const [element] of changed) resizes.get(element)?.cancel();
  const sizes = changed.map(([element, from]) => ({ element, from, to: readHeight(element) }));
  sizes.forEach(easeHeight);
  added.forEach(fadeIn);
}
