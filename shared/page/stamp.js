import { DAYS, countDaysBetween, formatClockTime, formatShortDate } from "./days.js";
import { html, setHtml } from "./html.js";

/** @typedef {import("./html.js").Markup} Markup */

// The header's stamp: a few short lines on what last happened and what's next, in the viewer's
// own words for days ("last night", "tomorrow").

const NIGHT_BEGINS_HOUR = 18;
const NIGHT_ENDS_HOUR = 6;

/** @param {Date} date */
const isAfterDark = (date) =>
  date.getHours() >= NIGHT_BEGINS_HOUR || date.getHours() < NIGHT_ENDS_HOUR;

// A game in the small hours belongs to the evening before it, as the viewer's clock tells it.
/** @param {Date} date */
function findEveningOf(date) {
  const evening = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (date.getHours() < NIGHT_ENDS_HOUR) evening.setDate(evening.getDate() - 1);
  return evening;
}

/**
 * When a finished game was played, as a few words: "last night", "today", "yesterday", a weekday
 * within the week, and a date before that.
 * @param {Date} end when the game ended, or the nearest time known to it
 * @param {Date} played when the game started, which names its weekday or date
 * @param {Date} now
 */
export function describeFinishedDay(end, played, now) {
  if (isAfterDark(end) && countDaysBetween(findEveningOf(end), now) === 1) return "last night";
  const days = countDaysBetween(end, now);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return DAYS[played.getDay()];
  return formatShortDate(played);
}

/**
 * @param {Date} date
 * @param {Date} [now]
 */
export function formatStampDay(date, now = new Date()) {
  const days = countDaysBetween(date, now);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (Math.abs(days) < 7) return DAYS[date.getDay()];
  return formatShortDate(date);
}

/**
 * @param {Date} date
 * @param {Date} [now]
 */
export function formatStampWhen(date, now = new Date()) {
  const time = formatClockTime(date);
  const day = formatStampDay(date, now);
  return day === "today" ? time : `${day} ${time}`;
}

// Sets AM/PM apart so it can be styled smaller.
/**
 * @param {Date} date
 * @param {Date} [now]
 */
export function renderStampWhen(date, now = new Date()) {
  const when = formatStampWhen(date, now);
  const parts = /^(.*\d)\s*(\D+)$/.exec(when);
  return parts ? html`${parts[1]}<span class="ap">${parts[2]}</span>` : html`${when}`;
}

/**
 * @param {string} label
 * @param {Markup | string} when
 * @param {string} [why]
 */
export function renderStampLine(label, when, why) {
  return html`<span>${label} <b>${when}</b>${why && html` &mdash; ${why}`}</span>`;
}

/**
 * Writes the stamp's lines, then any problems, and hides it when there's nothing to say.
 * @param {HTMLElement} stamp
 * @param {Markup[]} lines
 * @param {string[]} problems
 */
export function fillStamp(stamp, lines, problems) {
  const all = [
    ...lines,
    ...problems.map((problem) => html`<span class="stamp-err">${problem}</span>`),
  ];
  stamp.hidden = !all.length;
  setHtml(stamp, html`${all}`);
}
