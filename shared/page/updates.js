// The box under the tabs that lists what's new since the viewer last dismissed it, newest first,
// each beside when it happened. An app says what its updates are and where the dismissal is kept.

import { countDaysBetween, formatClockTime, nameDay } from "./days.js";
import { html, setHtml } from "./html.js";

/** @typedef {import("./html.js").Markup} Markup */
/** @typedef {{ at: number, text: Markup }} Update when it happened, and what it says */

const MAX_SHOWN = 12;

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
 * The box's markup for updates listed newest first: how many there are and since when, the newest
 * dozen, and how many more.
 * @param {Update[]} updates
 * @param {Date} [now]
 */
export function renderUpdates(updates, now = new Date()) {
  const shown = updates.slice(0, MAX_SHOWN);
  const times = formatTimeColumn(shown, now);
  const extra = updates.length - shown.length;
  // The oldest update listed, not the last dismissal: a change can be found after a dismissal
  // but have happened before it.
  const since = formatSince(updates[updates.length - 1].at, now);
  const head = `${updates.length} update${updates.length === 1 ? "" : "s"} ${since}`;
  return html`
    <div class="updates-head">
      <span class="updates-count">${head}</span>
      <button type="button" class="updates-x" id="dismissUpdates" aria-label="Dismiss updates" title="Dismiss"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
    </div>
    <ul class="updates-list">
      ${shown.map(
        (update, index) =>
          html`<li><span class="when">${times[index]}</span><span class="what">${update.text}</span></li>`,
      )}
      ${extra > 0 && html`<li class="more">and ${extra} more</li>`}
    </ul>`;
}

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
 * Shows the updates in the box, or hides it when there are none. Its dismiss button calls
 * `dismiss`, which forgets them.
 * @param {HTMLElement} panel
 * @param {Update[]} updates newest first
 * @param {{ dismiss: () => void }} actions
 */
export function showUpdates(panel, updates, { dismiss }) {
  if (!dismissals.has(panel)) listenForDismiss(panel);
  dismissals.set(panel, dismiss);
  panel.hidden = !updates.length;
  setHtml(panel, updates.length ? renderUpdates(updates) : html``);
}
