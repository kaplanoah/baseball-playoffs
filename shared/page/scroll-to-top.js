const REDUCED_MOTION_QUERY = matchMedia("(prefers-reduced-motion: reduce)");

// Like UIKit's scroll to top, the page takes off at once and eases into the top on a critically
// damped spring, so the trip takes about the same time from any distance.
const SPRING_RESPONSE_SECONDS = 0.4;
const SPRING_OMEGA = (2 * Math.PI) / SPRING_RESPONSE_SECONDS;
const ARRIVED_WITHIN_PX = 0.5;

// Any touch, click, wheel or key stops the scroll where it is, as a touch does on a phone.
const INTERRUPTING_EVENTS = ["pointerdown", "touchstart", "wheel", "keydown"];

const scroll = { frame: 0, startY: 0, startTime: 0 };

const readRemainingFraction = (seconds) =>
  (1 + SPRING_OMEGA * seconds) * Math.exp(-SPRING_OMEGA * seconds);

const jumpTo = (y) => window.scrollTo({ top: y, behavior: "instant" });

function stopScrolling() {
  cancelAnimationFrame(scroll.frame);
  scroll.frame = 0;
  for (const type of INTERRUPTING_EVENTS) removeEventListener(type, stopScrolling, true);
}

function stepScroll(time) {
  const seconds = Math.max((time - scroll.startTime) / 1000, 0);
  const y = scroll.startY * readRemainingFraction(seconds);
  if (y < ARRIVED_WITHIN_PX) {
    jumpTo(0);
    stopScrolling();
    return;
  }
  jumpTo(y);
  scroll.frame = requestAnimationFrame(stepScroll);
}

function startScrolling() {
  Object.assign(scroll, { startY: window.scrollY, startTime: performance.now() });
  for (const type of INTERRUPTING_EVENTS)
    addEventListener(type, stopScrolling, { capture: true, passive: true });
  scroll.frame = requestAnimationFrame(stepScroll);
}

export function scrollToTop() {
  stopScrolling();
  if (window.scrollY === 0) return;
  if (REDUCED_MOTION_QUERY.matches) jumpTo(0);
  else startScrolling();
}
