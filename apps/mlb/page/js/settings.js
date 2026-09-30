// The settings panel behind the header's sliders button: the season, notifications, the ranking,
// and which release of the page this is. Phones show it as a sheet from the bottom that a swipe
// down closes, wider screens as a modal.

import { joinWithSeparator, setHtml } from "./html.js";
import { loadRelease } from "./release.js";
import { session } from "./session.js";

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
const findDialog = () =>
  /** @type {HTMLDialogElement} */ (document.getElementById("settingsDialog"));

// Matches the stylesheet's phone layout, where settings are a sheet.
const SHEET_MEDIA = "(max-width: 779px)";
// A swipe down closes the sheet once it goes this far or this fast; anything less springs back.
const CLOSE_DISTANCE_PX = 110;
const CLOSE_SPEED_PX_PER_MS = 0.5;
// A touch has to move this far before it counts as a swipe, so a tap stays a tap.
const SWIPE_START_PX = 6;
const SHEET_MOTION_MS = 250;
const SHEET_EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** @type {{ startY: number, lastY: number, lastTime: number, speed: number, isDragging: boolean } | null} */
let swipe = null;

const isShowingPastSeason = () => session.activeYear !== session.currentSeason;

// Outside settings, only this tag says the page is showing an earlier season.
export function renderSeasonLabel() {
  const tag = findElement("yearTag");
  tag.hidden = !isShowingPastSeason();
  tag.textContent = String(session.activeYear);
}

// A release from an earlier year names its year; this year's go without.
function formatReleaseTime(iso) {
  const released = new Date(iso);
  const isThisYear = released.getFullYear() === new Date().getFullYear();
  return released.toLocaleString([], {
    year: isThisYear ? undefined : "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// The commit is there on hover, and stands in for a version the build couldn't work out.
/** @param {import("./release.js").Release} release */
function renderRelease({ version, commit, builtAt }) {
  const note = findElement("versionNote");
  const name = version ? `v${version}` : commit;
  setHtml(note, joinWithSeparator([name, `Released ${formatReleaseTime(builtAt)}`]));
  note.title = `Commit ${commit}`;
  note.hidden = false;
}

async function showRelease() {
  const release = await loadRelease();
  if (release) renderRelease(release);
}

// A click on the backdrop lands on the dialog itself; its content fills it edge to edge.
function closeOnBackdropClick(event) {
  if (event.target === event.currentTarget) findDialog().close();
}

// A line under the pinned header shows once the settings have scrolled under it.
function markScrolled() {
  const dialog = findDialog();
  dialog.querySelector(".sheet-top").classList.toggle("scrolled", dialog.scrollTop > 0);
}

const isSheet = () => matchMedia(SHEET_MEDIA).matches;
const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
// The ranking's grips drag rows, and the season picker opens its own menu.
const isOwnGesture = (target) => target instanceof Element && !!target.closest(".grip, select");

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

// Only a swipe down from the top of the settings moves the sheet; any other one scrolls them.
function followSwipe(event) {
  if (!swipe) return;
  const dialog = findDialog();
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

async function slideSheetClosed(dialog) {
  const slide = slideSheet(dialog, "translateY(100%)");
  await slide.finished;
  dialog.close();
  slide.cancel();
}

function endSwipe(event) {
  if (!swipe) return;
  const { isDragging, startY, lastY, speed } = swipe;
  swipe = null;
  if (!isDragging) return;
  const dialog = findDialog();
  const isFarOrFast = lastY - startY > CLOSE_DISTANCE_PX || speed > CLOSE_SPEED_PX_PER_MS;
  if (event.type === "touchend" && isFarOrFast) slideSheetClosed(dialog);
  else slideSheet(dialog, "none").finished.then((slide) => slide.cancel());
}

// Settings open at the top each time, with the ranking below them.
function openSettings() {
  const dialog = findDialog();
  dialog.showModal();
  dialog.scrollTop = 0;
  markScrolled();
}

export function startSettings() {
  const dialog = findDialog();
  findElement("settingsBtn").addEventListener("click", openSettings);
  findElement("settingsDoneBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", closeOnBackdropClick);
  dialog.addEventListener("scroll", markScrolled);
  dialog.addEventListener("touchstart", startSwipe, { passive: true });
  dialog.addEventListener("touchmove", followSwipe, { passive: false });
  dialog.addEventListener("touchend", endSwipe);
  dialog.addEventListener("touchcancel", endSwipe);
  showRelease();
}
