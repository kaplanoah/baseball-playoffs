import { findSeries } from "../../page/js/bracket.js";
import { describeKey } from "../../page/js/changes.js";
import { teamLabel } from "../../page/js/clubs.js";
import { describeEntry } from "../../page/js/entry-text.js";
import { convertToText } from "../../page/js/html.js";

// Which new updates become notifications, and what they say.

// A rebuild can find an old change again after changes.js improves, and that is not news.
const RECENT_MS = 60 * 60 * 1000;
const MAX_NOTIFIED = 4;
const SENTENCE_BREAK = " — ";

// The clubs an update is about, or null when it is about the whole field.
function listEntryClubs(entry, state) {
  switch (entry.kind) {
    case "lock":
      return null;
    case "game": {
      const series = findSeries(state, entry.series);
      return [entry.won, series?.teamA, series?.teamB];
    }
    case "field":
      return [entry.in, entry.out];
    default:
      return [entry.team, entry.over];
  }
}

function isAboutRanked(entry, ranking, state) {
  const clubs = listEntryClubs(entry, state);
  return clubs === null ? ranking.length > 0 : clubs.some((id) => id && ranking.includes(id));
}

/**
 * @param {object} options
 * @param {Record<string, any>[]} options.before the updates before this snapshot was saved
 * @param {Record<string, any>[]} options.after the updates after
 * @param {string[]} options.ranking
 * @param {{ teams: object, series: object }} options.state
 * @param {number} options.now
 */
export function findNotableEntries({ before, after, ranking, state, now }) {
  const known = new Set(before.map(describeKey));
  return after.filter(
    (entry) =>
      !known.has(describeKey(entry)) &&
      Date.parse(entry.at) >= now - RECENT_MS &&
      isAboutRanked(entry, ranking, state),
  );
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The sentence's main clause is the title, and what explains it is the body.
export function describeNotification(entry, context) {
  const markup = describeEntry(entry, { renderClub: teamLabel, ...context });
  if (!markup) return null;
  const [title, ...rest] = convertToText(markup).split(SENTENCE_BREAK);
  return { title, body: capitalize(rest.join(SENTENCE_BREAK)), tag: describeKey(entry) };
}

// Past a few at once, the rest are summed up in one, so a busy night doesn't bury the phone.
export function listNotifications(entries, context) {
  const messages = entries.map((entry) => describeNotification(entry, context)).filter(Boolean);
  if (messages.length <= MAX_NOTIFIED) return messages;
  const shown = messages.slice(0, MAX_NOTIFIED - 1);
  const rest = messages.length - shown.length;
  return [
    ...shown,
    { title: `${rest} more updates`, body: "Open the page to see them all.", tag: "more" },
  ];
}
