// On phones, a dialog shown as a sheet from the bottom closes with a swipe down, and slides down
// whichever way it closes.

// Matches chrome.css's phone layout, where dialogs are sheets.
const SHEET_MEDIA = "(max-width: 779px)";
// A swipe down closes the sheet once it goes this far or this fast; anything less springs back.
const CLOSE_DISTANCE_PX = 110;
const CLOSE_SPEED_PX_PER_MS = 0.5;
// A touch has to move this far before it counts as a swipe, so a tap stays a tap.
const SWIPE_START_PX = 6;
const SHEET_MOTION_MS = 250;
const SHEET_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

const isSheet = () => matchMedia(SHEET_MEDIA).matches;
const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

function slideSheet(dialog, to) {
  const from = dialog.style.transform || "none";
  dialog.style.transform = "";
  const duration = prefersReducedMotion() ? 0 : SHEET_MOTION_MS;
  return dialog.animate([{ transform: from }, { transform: to }], {
    duration,
    easing: SHEET_EASING,
    fill: "forwards",
  });
}

function fadeBackdropOut(dialog) {
  const duration = prefersReducedMotion() ? 0 : SHEET_MOTION_MS;
  return dialog.animate([{ opacity: 1 }, { opacity: 0 }], {
    pseudoElement: "::backdrop",
    duration,
    easing: SHEET_EASING,
    fill: "forwards",
  });
}

/** @type {WeakSet<HTMLDialogElement>} */
const closingSheets = new WeakSet();

async function slideSheetClosed(dialog) {
  if (closingSheets.has(dialog)) return;
  closingSheets.add(dialog);
  const motions = [slideSheet(dialog, "translateY(100%)"), fadeBackdropOut(dialog)];
  await motions[0].finished;
  dialog.close();
  for (const motion of motions) motion.cancel();
  closingSheets.delete(dialog);
}

/**
 * Closes a dialog, sliding it down first where it shows as a sheet.
 * @param {HTMLDialogElement} dialog
 */
export function closeSheet(dialog) {
  if (isSheet()) slideSheetClosed(dialog);
  else dialog.close();
}

// Escape closes a sheet the same way as its other ways to close.
function slideClosedOnCancel(event) {
  if (!isSheet()) return;
  event.preventDefault();
  slideSheetClosed(event.currentTarget);
}

/**
 * Moves the sheet with a finger swiping down from its top, and closes it at the end of a far or
 * fast enough swipe. Touches on the sheet's own gestures, and any other swipe, scroll it instead.
 * @param {HTMLDialogElement} dialog
 * @param {(target: EventTarget) => boolean} [isOwnGesture]
 */
export function closeOnSwipeDown(dialog, isOwnGesture = () => false) {
  /** @type {{ startY: number, lastY: number, lastTime: number, speed: number, isDragging: boolean } | null} */
  let swipe = null;

  function startSwipe(event) {
    if (!isSheet() || event.touches.length !== 1 || isOwnGesture(event.target)) return;
    const { clientY } = event.touches[0];
    swipe = {
      startY: clientY,
      lastY: clientY,
      lastTime: event.timeStamp,
      speed: 0,
      isDragging: false,
    };
  }

  function trackSwipeSpeed(clientY, time) {
    const elapsed = time - swipe.lastTime;
    if (elapsed > 0) swipe.speed = (clientY - swipe.lastY) / elapsed;
    swipe.lastY = clientY;
    swipe.lastTime = time;
  }

  function followSwipe(event) {
    if (!swipe) return;
    const { clientY } = event.touches[0];
    const distance = clientY - swipe.startY;
    if (!swipe.isDragging) {
      if (Math.abs(distance) < SWIPE_START_PX) return;
      if (distance < 0 || dialog.scrollTop > 0) {
        swipe = null;
        return;
      }
      swipe.isDragging = true;
    }
    event.preventDefault();
    trackSwipeSpeed(clientY, event.timeStamp);
    dialog.style.transform = `translateY(${Math.max(0, distance)}px)`;
  }

  function endSwipe(event) {
    if (!swipe) return;
    const { isDragging, startY, lastY, speed } = swipe;
    swipe = null;
    if (!isDragging) return;
    const isFarOrFast = lastY - startY > CLOSE_DISTANCE_PX || speed > CLOSE_SPEED_PX_PER_MS;
    if (event.type === "touchend" && isFarOrFast) slideSheetClosed(dialog);
    else slideSheet(dialog, "none").finished.then((slide) => slide.cancel());
  }

  dialog.addEventListener("touchstart", startSwipe, { passive: true });
  dialog.addEventListener("touchmove", followSwipe, { passive: false });
  dialog.addEventListener("touchend", endSwipe);
  dialog.addEventListener("touchcancel", endSwipe);
  dialog.addEventListener("cancel", slideClosedOnCancel);
}
