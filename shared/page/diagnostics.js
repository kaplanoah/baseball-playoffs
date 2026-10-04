// While Diagnostics is on in settings, each open of the page, and each return to it, records what
// the page draws in its first seconds: what the store sends, and how much each part it draws whole
// (each `data-last-drawn` element) shows, frame by frame. The last few records stay on this device,
// for the viewer to copy from settings. It records nothing while it's off, which it starts as.

import { formatClockTime, nameDay } from "./days.js";
import { html, joinWithSeparator, setHtml } from "./html.js";
import { watchTimeAway } from "./resume.js";

const SWITCH_KEY = "diagnostics";
const RECORDS_KEY = "diagnosticsRecords";
const RECORD_MS = 5000;
const KEPT_RECORDS = 5;
// A part whose text shrinks by more than this share dipped, which is what a flicker looks like.
const DIP_SHARE = 0.25;
const MINUTE_MS = 60 * 1000;

/** @typedef {{ ms: number, text: string, isDip?: boolean }} RecordLine */
/** @typedef {{ at: number, how: string, tab: string, lines: RecordLine[] }} OpenRecord */
/** @typedef {{ text: number, height: number }} PartSize */

/** @type {OpenRecord | null} */
let record = null;
let recordStartedAt = 0;
/** @type {Map<string, PartSize>} */
let shownSizes = new Map();
let isCopied = false;

const findElement = (id) => /** @type {HTMLElement} */ (document.getElementById(id));

// Storage can be empty or refuse access, as in a private window, so the page never depends on it.

function isRecording() {
  try {
    return localStorage.getItem(SWITCH_KEY) === "on";
  } catch {
    return false;
  }
}

/** @returns {OpenRecord[]} */
function readRecords() {
  try {
    const records = JSON.parse(localStorage.getItem(RECORDS_KEY) ?? "[]");
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

/** @param {OpenRecord[]} records */
function saveRecords(records) {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(records.slice(-KEPT_RECORDS)));
  } catch {
    /* the record is lost, and the next one tries again */
  }
}

/** @param {boolean} isOn */
function saveSwitch(isOn) {
  try {
    if (isOn) localStorage.setItem(SWITCH_KEY, "on");
    else {
      localStorage.removeItem(SWITCH_KEY);
      localStorage.removeItem(RECORDS_KEY);
    }
  } catch {
    /* the switch stays as it was */
  }
}

/**
 * Adds a step to the record under way, if there is one.
 * @param {string} text
 * @param {boolean} [isDip]
 */
export function noteStep(text, isDip = false) {
  if (!record) return;
  record.lines.push({ ms: Math.round(performance.now() - recordStartedAt), text, isDip });
}

function readPartSizes() {
  const parts = /** @type {HTMLElement[]} */ ([...document.querySelectorAll("[data-last-drawn]")]);
  return new Map(
    parts.map((part) => [
      part.id,
      {
        text: (part.textContent ?? "").replace(/\s+/g, "").length,
        height: Math.round(part.getBoundingClientRect().height),
      },
    ]),
  );
}

/**
 * @param {string} id
 * @param {PartSize} before
 * @param {PartSize} after
 */
function describeChange(id, before, after) {
  const changes = [
    before.text !== after.text && `text ${before.text} to ${after.text}`,
    before.height !== after.height && `height ${before.height} to ${after.height}px`,
  ].filter(Boolean);
  return `${id}: ${changes.join(", ")}`;
}

/** @param {Map<string, PartSize>} sizes */
const describeSizes = (sizes) =>
  [...sizes].map(([id, size]) => `${id} ${size.text}/${size.height}px`).join(", ");

/**
 * @param {PartSize} before
 * @param {PartSize} after
 */
const isDip = (before, after) => after.text < before.text * (1 - DIP_SHARE);

function noteChangedParts() {
  const sizes = readPartSizes();
  for (const [id, after] of sizes) {
    const before = shownSizes.get(id);
    if (!before || (before.text === after.text && before.height === after.height)) continue;
    noteStep(describeChange(id, before, after), isDip(before, after));
  }
  shownSizes = sizes;
}

function finishRecord() {
  if (!record) return;
  saveRecords([...readRecords(), record]);
  record = null;
  drawRecords();
}

function sampleParts() {
  if (!record) return;
  noteChangedParts();
  if (performance.now() - recordStartedAt < RECORD_MS) requestAnimationFrame(sampleParts);
  else finishRecord();
}

const readShownTab = () =>
  document.querySelector("nav.tabs [role=tab][aria-selected=true]")?.textContent?.trim() ?? "";

/** @param {string} how */
function startRecord(how) {
  finishRecord();
  if (!isRecording()) return;
  record = { at: Date.now(), how, tab: readShownTab(), lines: [] };
  recordStartedAt = performance.now();
  shownSizes = readPartSizes();
  noteStep(`Shows ${describeSizes(shownSizes)}`);
  requestAnimationFrame(sampleParts);
}

/**
 * @param {number} awayMs
 * @returns {string}
 */
export function describeTimeAway(awayMs) {
  const minutes = Math.round(awayMs / MINUTE_MS);
  if (minutes < 1) return "Back after less than a minute";
  if (minutes < 60) return `Back after ${minutes} min`;
  return `Back after ${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * @param {string | undefined} navigationType a PerformanceNavigationTiming's type
 * @returns {string}
 */
export const describeLoad = (navigationType) =>
  navigationType === "reload" ? "Reloaded" : "Opened";

function readNavigationType() {
  const [navigation] = /** @type {PerformanceNavigationTiming[]} */ (
    performance.getEntriesByType("navigation")
  );
  return navigation?.type;
}

/** @param {OpenRecord} openRecord */
const hasDip = (openRecord) => openRecord.lines.some((line) => line.isDip);

/**
 * @param {OpenRecord} openRecord
 * @param {Date} now
 */
function describeWhen(openRecord, now) {
  const at = new Date(openRecord.at);
  return `${nameDay(at, now, { isCapitalized: true })} ${formatClockTime(at)}`;
}

/**
 * @param {OpenRecord} openRecord
 * @param {Date} now
 */
const describeRecord = (openRecord, now) =>
  [describeWhen(openRecord, now), openRecord.how, openRecord.tab].filter(Boolean);

/**
 * @param {OpenRecord[]} records newest first
 * @param {Date} now
 * @returns {string}
 */
export const writeRecordsAsText = (records, now) =>
  records
    .map((openRecord) =>
      [
        describeRecord(openRecord, now).join(", ") + (hasDip(openRecord) ? " (dip)" : ""),
        ...openRecord.lines.map((line) => `+${line.ms} ${line.text}`),
      ].join("\n"),
    )
    .join("\n\n");

/** @param {RecordLine} line */
const renderLine = (line) =>
  html`<li class="${line.isDip ? "diagnostics-dip" : ""}">
    <span class="diagnostics-ms">+${line.ms}</span><span>${line.text}</span>
  </li>`;

/**
 * @param {OpenRecord} openRecord
 * @param {number} index
 */
const renderRecord = (openRecord, index) =>
  html`<details class="diagnostics-record" ${index === 0 ? "open" : ""}>
    <summary>
      <span class="diagnostics-when"
        >${joinWithSeparator(describeRecord(openRecord, new Date()))}</span
      >
      <span class="diagnostics-flag ${hasDip(openRecord) ? "dip" : ""}"
        >${hasDip(openRecord) ? "Dip" : "Steady"}</span
      >
    </summary>
    <ol class="diagnostics-lines">
      ${openRecord.lines.map(renderLine)}
    </ol>
  </details>`;

function renderRecords() {
  const records = readRecords().toReversed();
  return html`<div class="diagnostics-head">
      <h3>Recent opens</h3>
      ${
        records.length > 0 &&
        html`<button type="button" class="diagnostics-copy" id="diagnosticsCopy">
        ${isCopied ? "Copied" : "Copy"}
      </button>`
      }
    </div>
    ${
      records.length
        ? records.map(renderRecord)
        : html`<p class="diagnostics-empty">Nothing yet. Each open from now on shows here.</p>`
    }`;
}

function drawRecords() {
  const isOn = isRecording();
  findElement("diagnosticsSwitch").setAttribute("aria-checked", String(isOn));
  const section = findElement("diagnostics");
  section.hidden = !isOn;
  setHtml(section, isOn ? renderRecords() : html``);
}

function toggleRecording() {
  const isOn = !isRecording();
  saveSwitch(isOn);
  if (!isOn) record = null;
  isCopied = false;
  drawRecords();
}

async function copyRecords() {
  try {
    await navigator.clipboard.writeText(writeRecordsAsText(readRecords().toReversed(), new Date()));
    isCopied = true;
  } catch {
    isCopied = false;
  }
  drawRecords();
}

/** @param {Event} event */
function followSectionClick(event) {
  if (/** @type {Element} */ (event.target).closest("#diagnosticsCopy")) copyRecords();
}

/**
 * Wires the settings switch (#diagnosticsSwitch) and the records under it (#diagnostics), and,
 * while the switch is on, records this load and each return to the page. A page that leaves the
 * screen keeps what it recorded so far, as when it reloads for a new release or the phone drops it.
 */
export function startDiagnostics() {
  findElement("diagnosticsSwitch").addEventListener("click", toggleRecording);
  findElement("diagnostics").addEventListener("click", followSectionClick);
  drawRecords();
  startRecord(describeLoad(readNavigationType()));
  watchTimeAway((awayMs) => startRecord(describeTimeAway(awayMs)));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) finishRecord();
  });
  addEventListener("pagehide", finishRecord);
}
