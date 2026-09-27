import { html, setHtml } from "./html.js";

// A temporary diagnostic: triple-tap the title to see what the phone reports about its viewport.
const TAPS_TO_TOGGLE = 3;
const TAP_WINDOW_MS = 600;
const REFRESH_MS = 500;

const SAFE_AREA_SIDES = ["top", "right", "bottom", "left"];

function measureSafeAreas() {
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:fixed;visibility:hidden;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)";
  document.body.append(probe);
  const style = getComputedStyle(probe);
  const insets = SAFE_AREA_SIDES.map((side) =>
    parseFloat(style.getPropertyValue(`padding-${side}`)),
  );
  probe.remove();
  return insets;
}

function measureTabBar() {
  const bar = document.getElementById("tabBar");
  const bounds = bar.getBoundingClientRect();
  const bottom = getComputedStyle(bar).getPropertyValue("bottom");
  return { top: bounds.top, bottom: bounds.bottom, height: bounds.height, cssBottom: bottom };
}

function describeViewport() {
  const viewport = window.visualViewport;
  const bar = measureTabBar();
  const [top, right, bottom, left] = measureSafeAreas();
  const isStandalone =
    matchMedia("(display-mode: standalone)").matches ||
    Boolean(/** @type {any} */ (navigator).standalone);
  const round = (value) => Math.round(value * 10) / 10;
  return [
    `standalone ${isStandalone}`,
    `screen ${screen.width} x ${screen.height}`,
    `inner ${innerWidth} x ${innerHeight}`,
    `client ${document.documentElement.clientWidth} x ${document.documentElement.clientHeight}`,
    `visual ${round(viewport.width)} x ${round(viewport.height)}, top ${round(viewport.offsetTop)}, scale ${round(viewport.scale)}`,
    `safe areas top ${top}, right ${right}, bottom ${bottom}, left ${left}`,
    `tab bar top ${round(bar.top)}, bottom ${round(bar.bottom)}, height ${round(bar.height)}`,
    `tab bar css bottom ${bar.cssBottom}`,
    `bar bottom to inner bottom ${round(innerHeight - bar.bottom)}`,
    `bar bottom to screen bottom ${round(screen.height - bar.bottom)}`,
    `scroll y ${round(scrollY)} of ${document.documentElement.scrollHeight}`,
  ].join("\n");
}

function findReadout() {
  let readout = document.getElementById("viewportReadout");
  if (!readout) {
    readout = document.createElement("pre");
    readout.id = "viewportReadout";
    readout.className = "viewport-readout";
    readout.hidden = true;
    document.body.append(readout);
  }
  return readout;
}

let refreshTimer = 0;

function refreshReadout() {
  setHtml(findReadout(), html`${describeViewport()}`);
}

function toggleReadout() {
  const readout = findReadout();
  readout.hidden = !readout.hidden;
  window.clearInterval(refreshTimer);
  if (readout.hidden) return;
  refreshReadout();
  refreshTimer = window.setInterval(refreshReadout, REFRESH_MS);
}

export function wireViewportReadout() {
  const title = document.querySelector("header.top h1");
  let taps = [];
  title.addEventListener("pointerup", () => {
    const now = performance.now();
    taps = [...taps.filter((time) => now - time < TAP_WINDOW_MS), now];
    if (taps.length < TAPS_TO_TOGGLE) return;
    taps = [];
    toggleReadout();
  });
}
