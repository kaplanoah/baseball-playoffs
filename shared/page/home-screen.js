// The thin bar over the top of the page and the box at the bottom of settings that ask a phone's
// browser to add the page to the Home Screen. Neither shows on a computer, or once the page is
// opened from the Home Screen. Closing the bar keeps it closed on this device, and the box stays,
// so the steps are still there. The page supplies an empty #homeScreenBar and #homeScreenTip.

import { isIos, isOnHomeScreen, isTouchDevice } from "./device.js";
import { html, setHtml } from "./html.js";

/**
 * Chrome's own install dialog, which it offers only to a page it can install.
 * @typedef {Event & {
 *   prompt: () => Promise<void>,
 *   userChoice: Promise<{ outcome: "accepted" | "dismissed" }>,
 * }} InstallPrompt
 */

const CLOSED_KEY = "homeScreenBarClosed";
const TITLE = "Use this site like an app";
const BENEFIT = "It opens full screen, without the browser's bars.";

// Phosphor's export, at its Regular weight, the glyph on Safari's Share button.
const SHARE_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M216,112v96a16,16,0,0,1-16,16H56a16,16,0,0,1-16-16V112A16,16,0,0,1,56,96H80a8,8,0,0,1,0,16H56v96H200V112H176a8,8,0,0,1,0-16h24A16,16,0,0,1,216,112ZM93.66,69.66,120,43.31V136a8,8,0,0,0,16,0V43.31l26.34,26.35a8,8,0,0,0,11.32-11.32l-40-40a8,8,0,0,0-11.32,0l-40,40A8,8,0,0,0,93.66,69.66Z"
  />
</svg>`;
// Phosphor's dots-three-vertical, at its Regular weight, the glyph on Chrome's menu button.
const MENU_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M140,128a12,12,0,1,1-12-12A12,12,0,0,1,140,128ZM128,72a12,12,0,1,0-12-12A12,12,0,0,0,128,72Zm0,112a12,12,0,1,0,12,12A12,12,0,0,0,128,184Z"
  />
</svg>`;
const CLOSE_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z"
  />
</svg>`;
const ICON = html`<span class="home-screen-icon" aria-hidden="true"></span>`;
const INSTALL_BUTTON = html`<button type="button" class="home-screen-install">Install</button>`;

/** @type {InstallPrompt | null} */
let installPrompt = null;
let isInstalled = false;
let isBarClosed = false;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

// Storage can be off, as in a private window, and then the bar comes back on the next visit.
function readBarClosed() {
  try {
    return localStorage.getItem(CLOSED_KEY) === "closed";
  } catch {
    return false;
  }
}

function saveBarClosed() {
  try {
    localStorage.setItem(CLOSED_KEY, "closed");
  } catch {
    /* the bar stays closed until the page reloads */
  }
}

const isAsking = () => isTouchDevice() && !isOnHomeScreen() && !isInstalled;

function renderSteps() {
  if (isIos()) return html`Tap ${SHARE_ICON} <b>Share</b>, then <b>Add to Home Screen</b>`;
  return html`Tap ${MENU_ICON} <b>Menu</b>, then <b>Add to Home screen</b>`;
}

// With Chrome's dialog to hand, Install takes the place of the steps.
function renderBar() {
  return html`${ICON}
    <span class="home-screen-copy">
      <span class="home-screen-title">${TITLE}</span>
      ${!installPrompt && html`<span class="home-screen-steps">${renderSteps()}</span>`}
    </span>
    ${!!installPrompt && INSTALL_BUTTON}
    <button type="button" class="home-screen-close" aria-label="Close">${CLOSE_ICON}</button>`;
}

function renderTip() {
  const steps = installPrompt ? BENEFIT : html`${renderSteps()}. ${BENEFIT}`;
  return html`${ICON}
    <span class="home-screen-copy">
      <span class="home-screen-title">${TITLE}</span>
      <span class="home-screen-steps">${steps}</span>
      ${!!installPrompt && INSTALL_BUTTON}
    </span>`;
}

function showAsks() {
  const bar = findElement("homeScreenBar");
  const tip = findElement("homeScreenTip");
  bar.hidden = !isAsking() || isBarClosed;
  tip.hidden = !isAsking();
  if (!bar.hidden) setHtml(bar, renderBar());
  if (!tip.hidden) setHtml(tip, renderTip());
}

function closeBar() {
  isBarClosed = true;
  saveBarClosed();
  showAsks();
}

// Chrome's dialog can be shown only once, so the steps come back if it's turned down or fails.
async function install() {
  const prompt = installPrompt;
  installPrompt = null;
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") isInstalled = true;
  } catch {
    /* the steps take its place */
  }
  showAsks();
}

/** @param {Event} event */
function followClick(event) {
  const target = /** @type {Element} */ (event.target);
  if (target.closest(".home-screen-close")) closeBar();
  else if (target.closest(".home-screen-install") && installPrompt) install();
}

/** @param {Event} event */
function keepInstallPrompt(event) {
  event.preventDefault();
  installPrompt = /** @type {InstallPrompt} */ (event);
  showAsks();
}

function forgetAsks() {
  isInstalled = true;
  installPrompt = null;
  showAsks();
}

export function startHomeScreen() {
  isBarClosed = readBarClosed();
  findElement("homeScreenBar").addEventListener("click", followClick);
  findElement("homeScreenTip").addEventListener("click", followClick);
  // Chrome would otherwise show its own banner along the bottom of the screen.
  window.addEventListener("beforeinstallprompt", keepInstallPrompt);
  window.addEventListener("appinstalled", forgetAsks);
  showAsks();
}
