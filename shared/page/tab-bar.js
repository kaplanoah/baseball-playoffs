import { canBendBackdrop, fitLens } from "./glass-lens.js";
import { readSelectedTab } from "./tabs.js";

// Matches the phone layout in chrome.css, where the tabs float at the bottom as a glass bar.
const FLOATING_QUERY = matchMedia("(max-width: 779px)");
const REDUCED_MOTION_QUERY = matchMedia("(prefers-reduced-motion: reduce)");

const BAR_PADDING_PX = 5;
const PILL_OVERHANG_PX = 4;
// The tabs sit in from the pill's inset by its overhang, so every pill can center on its tab.
const ROW_INSET_PX = BAR_PADDING_PX + PILL_OVERHANG_PX;
// How far the pill's rounded ends curve in at label height; the labels it hides stop short of them.
const PILL_END_CURVE_PX = 4;
const DRAG_THRESHOLD_PX = 6;
// A click this soon after a press the bar handled is that press's own click.
const PRESS_CLICK_WINDOW_MS = 600;

// The iOS 27 selection motion, from frame-by-frame captures of UITabBarController: on touch the
// pill lifts into a clear lens 16pt larger that magnifies the tab under it by 16%, travels on a
// spring with a slight overshoot, stretches ahead of the travel and squashes on arrival, and the
// whole bar pulses about 8.7pt wider. UIKit also spreads the touch glow across the bar on
// release; here it only fades where it is, because the spread reads as a flash.
const LIFT_GROW_PX = 16;
const LENS_MAGNIFICATION = 0.16;
const RELEASE_WITHIN_PX = 3.5;
const LIFT_SNAP = 0.975;
const GLOW_PEAK = 0.18;
const MOTION_SECONDS = 1.1;

/**
 * A spring from its response (seconds per cycle) and damping ratio, with unit mass.
 * @param {number} response
 * @param {number} dampingRatio
 */
function createSpringShape(response, dampingRatio) {
  const omega = (2 * Math.PI) / response;
  return { stiffness: omega * omega, damping: 2 * dampingRatio * omega };
}
const TRAVEL_SPRING = createSpringShape(0.4, 0.85);
const LIFT_SPRING = createSpringShape(0.25, 1);
const PLATTER_SPRING = createSpringShape(0.4, 1);
const GLOW_RISE_SPRING = createSpringShape(0.1, 1);
const GLOW_FALL_SPRING = createSpringShape(0.25, 1);
const CALM_SPRING = createSpringShape(0.3, 1);

// A stiff spring blows up if one step covers a long frame, so each frame is split into short slices.
const SPRING_SLICE_SECONDS = 1 / 480;

// A smooth bump that peaks at 1 at `peak` seconds and dies away, and a bell around `center`.
const computeBump = (seconds, peak) =>
  seconds <= 0 ? 0 : (seconds / peak) ** 3 * Math.exp(3 * (1 - seconds / peak));
const computeBell = (seconds, center, width) => Math.exp(-(((seconds - center) / width) ** 2));
const computeStretchX = (seconds, distance) =>
  0.114 * computeBump(seconds, 0.15) - 0.00046 * distance * computeBell(seconds, 0.5, 0.13);
const computeStretchY = (seconds, distance) =>
  -0.157 * computeBump(seconds, 0.15) + 0.00055 * distance * computeBell(seconds, 0.52, 0.14);
const computeLead = (seconds) => 7.6 * computeBump(seconds, 0.17);
const computeBarGrowth = (seconds) =>
  8.7 * computeBump(seconds, 0.13) - 0.9 * computeBell(seconds, 0.38, 0.08);

const createSpring = (value) => ({ value, velocity: 0, target: value });

const motion = {
  x: createSpring(0),
  lift: createSpring(0),
  platter: createSpring(1),
  glow: createSpring(0),
  isReleased: true,
  travel: 0,
  travelStart: null,
  frame: 0,
  lastTime: 0,
};
const press = {
  isActive: false,
  isDragging: false,
  startX: 0,
  pointerId: null,
  lastMoveTime: 0,
  choseAt: -Infinity,
};
/** @type {(tab: string) => void} */
let chooseTab = () => {};

const findBar = () => /** @type {HTMLElement} */ (document.getElementById("tabBar"));
const findGlass = () => /** @type {HTMLElement} */ (document.getElementById("tabGlass"));
const findList = () => /** @type {HTMLElement} */ (findBar().querySelector(".tab-list"));
const findPill = () => /** @type {HTMLElement} */ (findBar().querySelector(".tab-pill"));
const findPillRow = () => /** @type {HTMLElement} */ (findBar().querySelector(".tab-pill-row"));
const findTabButtons = () =>
  /** @type {HTMLButtonElement[]} */ ([...findList().querySelectorAll("[role=tab]")]);
const readTabs = () => findTabButtons().map((button) => button.dataset.tab);

const isFloating = () => FLOATING_QUERY.matches;
const isCalm = () => REDUCED_MOTION_QUERY.matches;
const measureRowWidth = () => findList().clientWidth - ROW_INSET_PX * 2;
const measureSlotWidth = () => measureRowWidth() / readTabs().length;
const measurePillWidth = () => measureSlotWidth() + PILL_OVERHANG_PX * 2;
const measurePillHeight = () => findList().clientHeight - BAR_PADDING_PX * 2;
const clampToRow = (x) => Math.min(Math.max(x, 0), measureSlotWidth() * (readTabs().length - 1));
const findPillX = (tab) => readTabs().indexOf(tab) * measureSlotWidth();
const measurePointerX = (event) =>
  event.clientX - findList().getBoundingClientRect().left - ROW_INSET_PX;

function findTabUnderPill() {
  const tabs = readTabs();
  const slot = Math.round(motion.x.value / measureSlotWidth());
  return tabs[Math.min(Math.max(slot, 0), tabs.length - 1)];
}

function findTabUnderPointer(event) {
  const tabs = readTabs();
  const slot = Math.floor(measurePointerX(event) / measureSlotWidth());
  return tabs[Math.min(Math.max(slot, 0), tabs.length - 1)];
}

function stepSpring(spring, { stiffness, damping }, seconds) {
  const slices = Math.max(1, Math.ceil(seconds / SPRING_SLICE_SECONDS));
  const slice = seconds / slices;
  for (let index = 0; index < slices; index++) {
    const force = -stiffness * (spring.value - spring.target) - damping * spring.velocity;
    spring.velocity += force * slice;
    spring.value += spring.velocity * slice;
  }
}

const isSettled = (spring) =>
  Math.abs(spring.velocity) < 0.5 && Math.abs(spring.value - spring.target) < 0.2;

const readSecondsSinceTravel = () =>
  motion.travelStart === null ? null : (performance.now() - motion.travelStart) / 1000;

const RESTING_SHAPE = { scaleX: 1, scaleY: 1, lead: 0, grow: 0 };

function readDraggingShape() {
  const speed = Math.abs(motion.x.velocity);
  return {
    scaleX: 1 + Math.min(speed / 4000, 0.12),
    scaleY: 1 - Math.min(speed / 3000, 0.16),
    lead: 0,
    grow: 0,
  };
}

function readTravelShape(seconds) {
  const distance = Math.abs(motion.travel);
  const moving = distance > 0 ? 1 : 0;
  return {
    scaleX: 1 + moving * computeStretchX(seconds, distance),
    scaleY: 1 + moving * computeStretchY(seconds, distance),
    lead: Math.sign(motion.travel) * computeLead(seconds),
    grow: computeBarGrowth(seconds),
  };
}

// The pill's deformation and lead, and the bar's growth, at this moment of the motion.
function readShape() {
  if (isCalm()) return RESTING_SHAPE;
  if (press.isDragging) return readDraggingShape();
  const seconds = readSecondsSinceTravel();
  return seconds === null ? RESTING_SHAPE : readTravelShape(seconds);
}

// The labels under the pill are hidden, so its frost has nothing to blur into a glow.
function hideLabelsUnderPill(center, halfWidth) {
  const left = center - halfWidth;
  const right = center + halfWidth;
  const mask = `linear-gradient(to right, #000 ${left - 1}px, transparent ${left + 1}px, transparent ${right - 1}px, #000 ${right + 1}px)`;
  findList().style.setProperty("-webkit-mask-image", mask);
  findList().style.setProperty("mask-image", mask);
}

function clearFloatingStyles() {
  for (const property of ["-webkit-mask-image", "mask-image"])
    findList().style.removeProperty(property);
  findBar().style.removeProperty("transform");
}

function paintPill() {
  if (!isFloating()) {
    clearFloatingStyles();
    return;
  }
  const { scaleX, scaleY, lead, grow } = readShape();
  const lift = motion.lift.value;
  const width = measurePillWidth();
  const height = measurePillHeight();
  const liftX = (width + LIFT_GROW_PX * lift) / width;
  const liftY = (height + LIFT_GROW_PX * lift) / height;
  const x = motion.x.value + lead;
  const magnification = 1 + LENS_MAGNIFICATION * lift;
  const pill = findPill();
  pill.style.transform = `translateX(${x}px) scale(${liftX * scaleX}, ${liftY * scaleY})`;
  pill.style.setProperty("--lift", lift.toFixed(3));
  pill.style.setProperty("--platter", motion.platter.value.toFixed(3));
  // The copy inside undoes the pill's change of shape, so the glass deforms and the tab only magnifies.
  const row = findPillRow();
  row.style.transformOrigin = `${x + width / 2 - PILL_OVERHANG_PX}px ${height / 2}px`;
  row.style.transform = `translateX(${-x}px) scale(${magnification / (liftX * scaleX)}, ${magnification / (liftY * scaleY)})`;
  hideLabelsUnderPill(
    BAR_PADDING_PX + x + width / 2,
    (width * liftX * scaleX) / 2 - PILL_END_CURVE_PX,
  );
  const bar = findBar();
  const barWidth = bar.offsetWidth;
  bar.style.transform = grow ? `scale(${(barWidth + grow) / barWidth})` : "";
  const glow = Math.min(Math.max(motion.glow.value, 0), GLOW_PEAK);
  bar.style.setProperty("--glow-alpha", glow.toFixed(3));
}

// The lift falls once the finger is up, the lift has fully risen, and the pill has nearly arrived.
function releaseLiftOnArrival() {
  const hasArrived = Math.abs(motion.x.target - motion.x.value) < RELEASE_WITHIN_PX;
  if (motion.isReleased || press.isActive || motion.lift.value < LIFT_SNAP || !hasArrived) return;
  motion.isReleased = true;
  motion.lift.target = 0;
  motion.platter.target = 1;
}

function stepLift(seconds) {
  stepSpring(motion.lift, isCalm() ? CALM_SPRING : LIFT_SPRING, seconds);
  if (motion.lift.target === 1 && motion.lift.value > LIFT_SNAP)
    Object.assign(motion.lift, { value: 1, velocity: 0 });
  if (motion.isReleased)
    stepSpring(motion.platter, isCalm() ? CALM_SPRING : PLATTER_SPRING, seconds);
  else Object.assign(motion.platter, { value: 1 - motion.lift.value, velocity: 0 });
}

function stepGlow(seconds) {
  const isRising = motion.glow.target > 0;
  stepSpring(motion.glow, isRising ? GLOW_RISE_SPRING : GLOW_FALL_SPRING, seconds);
  if (!isRising && motion.glow.value < 0.005) motion.glow.value = 0;
}

function isMotionOver() {
  const seconds = readSecondsSinceTravel();
  return (
    !press.isActive &&
    motion.isReleased &&
    isSettled(motion.x) &&
    motion.lift.value < 0.002 &&
    motion.platter.value > 0.998 &&
    motion.glow.value === 0 &&
    (seconds === null || seconds > MOTION_SECONDS)
  );
}

function finishMotion() {
  Object.assign(motion.x, { value: motion.x.target, velocity: 0 });
  Object.assign(motion.lift, { value: 0, velocity: 0 });
  Object.assign(motion.platter, { value: 1, velocity: 0 });
  motion.travelStart = null;
  motion.frame = 0;
  motion.lastTime = 0;
  paintPill();
}

function animatePill(time) {
  const seconds = Math.min((time - (motion.lastTime || time)) / 1000, 1 / 20);
  motion.lastTime = time;
  if (!press.isDragging) stepSpring(motion.x, isCalm() ? CALM_SPRING : TRAVEL_SPRING, seconds);
  releaseLiftOnArrival();
  stepLift(seconds);
  stepGlow(seconds);
  paintPill();
  if (isMotionOver()) finishMotion();
  else motion.frame = requestAnimationFrame(animatePill);
}

function startMotion() {
  if (!motion.frame) motion.frame = requestAnimationFrame(animatePill);
}

function travelTo(tab) {
  const target = findPillX(tab);
  motion.travel = target - motion.x.value;
  motion.travelStart = performance.now();
  motion.x.target = target;
  startMotion();
}

function liftPill() {
  if (isCalm()) return;
  motion.isReleased = false;
  motion.lift.target = 1;
  startMotion();
}

function moveGlow(event) {
  const bounds = findBar().getBoundingClientRect();
  findBar().style.setProperty("--glow-x", `${event.clientX - bounds.left}px`);
  findBar().style.setProperty("--glow-y", `${event.clientY - bounds.top}px`);
}

// Like UIKit, the pill lifts and heads for the touched tab on touch-down; the view switches on release.
function startPress(event) {
  if (!isFloating() || event.button !== 0) return;
  Object.assign(press, {
    isActive: true,
    isDragging: false,
    startX: event.clientX,
    pointerId: event.pointerId,
  });
  findBar().setPointerCapture(event.pointerId);
  moveGlow(event);
  if (!isCalm()) motion.glow.target = GLOW_PEAK;
  liftPill();
  travelTo(findTabUnderPointer(event));
}

function measureDragVelocity(x) {
  const now = performance.now();
  const seconds = Math.max((now - (press.lastMoveTime || now)) / 1000, 1 / 120);
  press.lastMoveTime = now;
  return (x - motion.x.value) / seconds;
}

// While dragging, the pill tracks the finger one to one and its speed drives the stretch.
function trackPress(event) {
  if (!press.isActive || event.pointerId !== press.pointerId) return;
  moveGlow(event);
  if (!press.isDragging && Math.abs(event.clientX - press.startX) < DRAG_THRESHOLD_PX) return;
  press.isDragging = true;
  motion.travelStart = null;
  const x = clampToRow(measurePointerX(event) - measureSlotWidth() / 2);
  motion.x.velocity = measureDragVelocity(x);
  Object.assign(motion.x, { value: x, target: x });
  startMotion();
}

function endPress(event) {
  if (!press.isActive || event.pointerId !== press.pointerId) return;
  const wasDragging = press.isDragging;
  const tab = wasDragging ? findTabUnderPill() : findTabUnderPointer(event);
  Object.assign(press, { isActive: false, isDragging: false, lastMoveTime: 0 });
  motion.glow.target = 0;
  if (event.type === "pointercancel") {
    travelTo(readSelectedTab(findTabButtons()));
    return;
  }
  if (wasDragging) travelTo(tab);
  press.choseAt = performance.now();
  // Only a tap on the selected tab asks it to scroll to the top, not a drag that wanders back.
  const isDragBackToSelected = wasDragging && tab === readSelectedTab(findTabButtons());
  if (!isDragBackToSelected) chooseTab(tab);
  startMotion();
}

// A press chooses its tab itself, so the click that follows it must not choose again.
// Screen readers activate tabs with a bare click, which still goes through.
function ignorePressClicks(event) {
  const isPressClick = performance.now() - press.choseAt < PRESS_CLICK_WINDOW_MS;
  if (isFloating() && isPressClick) event.stopPropagation();
}

function snapPillToSelectedTab() {
  const x = findPillX(readSelectedTab(findTabButtons()));
  Object.assign(motion.x, { value: x, target: x, velocity: 0 });
  paintPill();
}

function fitBar() {
  if (!isFloating()) {
    clearFloatingStyles();
    return;
  }
  const bar = findBar();
  bar.style.setProperty("--pill-width", `${measurePillWidth()}px`);
  bar.style.setProperty("--row-width", `${measureRowWidth()}px`);
  const glass = findGlass();
  if (glass.classList.contains("bends"))
    fitLens(
      /** @type {SVGFilterElement} */ (document.querySelector("#glassLens")),
      glass.offsetWidth,
      glass.offsetHeight,
    );
  if (!motion.frame) snapPillToSelectedTab();
  bar.classList.add("placed");
}

function copyTabsIntoPill() {
  const copies = findTabButtons().map((button) => {
    const copy = document.createElement("span");
    copy.className = "tab-copy";
    copy.append(...[...button.cloneNode(true).childNodes]);
    return copy;
  });
  findPillRow().replaceChildren(...copies);
}

/**
 * Moves the selection pill to a tab chosen some other way, like the keyboard.
 * @param {string} tab
 */
export function moveTabSelection(tab) {
  if (!isFloating()) return;
  const isHeadingThere = motion.frame && motion.x.target === findPillX(tab);
  if (isHeadingThere) return;
  liftPill();
  travelTo(tab);
}

/**
 * Wires the floating glass tab bar that phones show.
 * @param {(tab: string) => void} onChoose
 */
export function startTabBar(onChoose) {
  chooseTab = onChoose;
  copyTabsIntoPill();
  if (canBendBackdrop(navigator.userAgent)) findGlass().classList.add("bends");
  const bar = findBar();
  bar.addEventListener("pointerdown", startPress);
  bar.addEventListener("pointermove", trackPress);
  bar.addEventListener("pointerup", endPress);
  bar.addEventListener("pointercancel", endPress);
  bar.addEventListener("click", ignorePressClicks, true);
  FLOATING_QUERY.addEventListener("change", fitBar);
  new ResizeObserver(fitBar).observe(findList());
  fitBar();
}
