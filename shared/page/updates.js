// The box under the tabs that lists what's new since the viewer last dismissed it, newest first,
// each beside when it happened, and under them, what's new in the app. An app says what its
// updates and release notes are and where the dismissal is kept.

import { countDaysBetween, formatClockTime, nameDay } from "./days.js";
import { html, setHtml } from "./html.js";

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
    ${isFirst && html`<button type="button" class="updates-x" id="dismissUpdates" aria-label="Dismiss updates" title="Dismiss"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>`}
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

/**
 * Shows the updates and release notes in the box, or hides it when there are none. Its dismiss
 * button calls `dismiss`, which forgets them.
 * @param {HTMLElement} panel
 * @param {Update[]} updates newest first
 * @param {{ dismiss: () => void, notes?: Note[] }} options
 */
export function showUpdates(panel, updates, { dismiss, notes = [] }) {
  if (!dismissals.has(panel)) listenForDismiss(panel);
  dismissals.set(panel, dismiss);
  const isEmpty = !updates.length && !notes.length;
  panel.hidden = isEmpty;
  setHtml(panel, isEmpty ? html`` : renderUpdates(updates, notes));
}
