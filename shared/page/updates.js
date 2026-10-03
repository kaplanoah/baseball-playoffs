// The box under the tabs that lists what's new since the viewer last dismissed it, newest first,
// each beside when it happened, and under them, what's new in the app. An app says what its
// updates and release notes are and where the dismissal is kept.

import { countDaysBetween, formatClockTime, nameDay } from "./days.js";
import { easeClosed, stopEasing } from "./eased-redraw.js";
import { html, noteHeight, setHtml } from "./html.js";

// Phosphor's x, at its Light weight, like the page's other close buttons.
const DISMISS_ICON = html`<svg viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
  <path
    d="M204.24,195.76a6,6,0,1,1-8.48,8.48L128,136.49,60.24,204.24a6,6,0,0,1-8.48-8.48L119.51,128,51.76,60.24a6,6,0,0,1,8.48-8.48L128,119.51l67.76-67.75a6,6,0,0,1,8.48,8.48L136.49,128Z"
  />
</svg>`;

/** @typedef {import("./html.js").Markup} Markup */
/** @typedef {{ at: number, text: Markup }} Update when it happened, and what it says */
/** @typedef {{ at: string, text: string }} ReleaseNote when it went out, as an ISO time, and what it says */
/** @typedef {{ at: number, text: string }} Note a release note to show */

const MAX_SHOWN = 12;
const NOTE_SHOWN_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * @param {number} at
 * @param {Date} now
 */
function formatWhen(at, now) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  if (countDaysBetween(date, now) <= 0) return formatClockTime(date);
  return nameDay(date, now, { isCapitalized: true });
}

/**
 * @param {number} at
 * @param {Date} now
 */
function formatSince(at, now) {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  if (countDaysBetween(date, now) <= 0) return "since earlier today";
  return `since ${nameDay(date, now)}`;
}

// Updates that share a time show it once, on the first of them.
/**
 * @param {Update[]} updates
 * @param {Date} now
 */
function formatTimeColumn(updates, now) {
  const times = updates.map((update) => formatWhen(update.at, now));
  return times.map((time, index) => (time === times[index - 1] ? "" : time));
}

/**
 * The release notes still to show: each out since the last dismissal, for its first two weeks.
 * @param {ReleaseNote[]} notes
 * @param {number} seenAt
 * @param {number} [now]
 * @returns {Note[]}
 */
export const listFreshNotes = (notes, seenAt, now = Date.now()) =>
  notes
    .map((note) => ({ at: Date.parse(note.at), text: note.text }))
    .filter((note) => note.at > seenAt && note.at <= now && now - note.at < NOTE_SHOWN_MS);

// Only the box's first heading carries its dismiss button, which closes all of it.
/**
 * @param {string} title
 * @param {boolean} isFirst
 */
const renderHead = (title, isFirst) =>
  html`<div class="updates-head">
    <span class="updates-count">${title}</span>
    ${isFirst && html`<button type="button" class="updates-x" id="dismissUpdates" aria-label="Dismiss updates" title="Dismiss">${DISMISS_ICON}</button>`}
  </div>`;

/**
 * How many updates there are and since when, the newest dozen, and how many more.
 * @param {Update[]} updates newest first
 * @param {Date} now
 */
function renderUpdateList(updates, now) {
  const shown = updates.slice(0, MAX_SHOWN);
  const times = formatTimeColumn(shown, now);
  const extra = updates.length - shown.length;
  // The oldest update listed, not the last dismissal: a change can be found after a dismissal
  // but have happened before it.
  const since = formatSince(updates[updates.length - 1].at, now);
  const head = `${updates.length} update${updates.length === 1 ? "" : "s"} ${since}`;
  return html`${renderHead(head, true)}
    <ul class="updates-list">
      ${shown.map(
        (update, index) =>
          html`<li><span class="when">${times[index]}</span><span class="what">${update.text}</span></li>`,
      )}
      ${extra > 0 && html`<li class="more">and ${extra} more</li>`}
    </ul>`;
}

/**
 * @param {Note[]} notes
 * @param {boolean} isFirst
 */
const renderNoteList = (notes, isFirst) =>
  html`<div class="${isFirst ? "updates-notes" : "updates-notes updates-section"}">
    ${renderHead("New in the app", isFirst)}
    <ul class="updates-list">
      ${notes.map((note) => html`<li><span class="what">${note.text}</span></li>`)}
    </ul>
  </div>`;

/**
 * The box's markup: the updates, newest first, and under them the release notes.
 * @param {Update[]} updates
 * @param {Note[]} [notes]
 * @param {Date} [now]
 */
export const renderUpdates = (updates, notes = [], now = new Date()) =>
  html`${updates.length > 0 && renderUpdateList(updates, now)}${notes.length > 0 && renderNoteList(notes, !updates.length)}`;

// Redraws keep a box's markup when it hasn't changed, so each box listens for its dismiss button
// once, and calls whichever `dismiss` its latest showing handed it.
/** @type {WeakMap<HTMLElement, () => void>} */
const dismissals = new WeakMap();

/** @param {HTMLElement} panel */
function listenForDismiss(panel) {
  panel.addEventListener("click", (event) => {
    const target = /** @type {Element} */ (event.target);
    if (target.closest("#dismissUpdates")) dismissals.get(panel)?.();
  });
}

/** @type {WeakSet<HTMLElement>} */
const closingPanels = new WeakSet();

// A box that appears with new data grows open, pushing what's under it down smoothly, and one
// that fills again as it shrinks away stays open.
/**
 * @param {HTMLElement} panel
 * @param {Markup} markup
 */
function openBox(panel, markup) {
  if (closingPanels.delete(panel)) stopEasing(panel);
  if (panel.hidden) noteHeight(panel);
  panel.hidden = false;
  setHtml(panel, markup);
}

/** @param {HTMLElement} panel */
function hideBox(panel) {
  closingPanels.delete(panel);
  panel.hidden = true;
  setHtml(panel, html``);
}

// A box that empties keeps what it said while it shrinks away.
/** @param {HTMLElement} panel */
function closeBox(panel) {
  if (panel.hidden || closingPanels.has(panel)) return;
  closingPanels.add(panel);
  easeClosed(panel, () => hideBox(panel));
}

/**
 * @param {HTMLElement} panel
 * @param {Markup | null} markup null for a box with nothing to show
 */
function showBoxAtOnce(panel, markup) {
  if (!markup) {
    hideBox(panel);
    return;
  }
  panel.hidden = false;
  setHtml(panel, markup);
}

/**
 * @param {HTMLElement} panel
 * @param {Markup | null} markup null for a box with nothing to show
 */
function showBoxEased(panel, markup) {
  if (markup) openBox(panel, markup);
  else closeBox(panel);
}

/**
 * Shows the updates and release notes in the box, or hides it when there are none. Its dismiss
 * button calls `dismiss`, which forgets them. The box's first showing draws at once, as the rest
 * of the page does, and later ones ease it open or closed.
 * @param {HTMLElement} panel
 * @param {Update[]} updates newest first
 * @param {{ dismiss: () => void, notes?: Note[] }} options
 */
export function showUpdates(panel, updates, { dismiss, notes = [] }) {
  const isFirstShowing = !dismissals.has(panel);
  if (isFirstShowing) listenForDismiss(panel);
  dismissals.set(panel, dismiss);
  const markup = updates.length || notes.length ? renderUpdates(updates, notes) : null;
  if (isFirstShowing) showBoxAtOnce(panel, markup);
  else showBoxEased(panel, markup);
}
