import { findSeries } from "../../page/js/bracket.js";
import { describeKey, isFoundEntry } from "../../page/js/changes.js";
import { nameTeam } from "../../page/js/clubs.js";
import { describeUpdate } from "../../page/js/entry-text.js";
import { convertToText } from "../../page/js/html.js";
import { groupUpdates } from "../../page/js/update-groups.js";

// Which new updates become notifications, and what they say.

// A rebuild can find an old change again after changes.js improves, and that is not news.
const RECENT_MS = 60 * 60 * 1000;
// A game's time is when it should have ended, which a delay can put hours before its final.
const RECENT_GAME_MS = 24 * 60 * 60 * 1000;
const MAX_NOTIFIED = 4;
const SENTENCE_BREAK = " \u2014 ";

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

// The ranking lists every club in the field, whether or not it was dragged into place.
function isAboutRanked(entry, state) {
  const clubs = listEntryClubs(entry, state);
  return clubs === null || clubs.some((id) => id && state.teams[id]);
}

const isRecent = (entry, now) =>
  Date.parse(entry.at) >= now - (isFoundEntry(entry) ? RECENT_MS : RECENT_GAME_MS);

// Grouped before the ranking is checked, so a ranked club's update brings along the
// eliminations it caused.
/**
 * @param {object} options
 * @param {Record<string, any>[]} options.before the updates before this snapshot was saved
 * @param {Record<string, any>[]} options.after the updates after
 * @param {{ teams: object, series: object }} options.state
 * @param {number} options.now
 */
export function findNotableUpdates({ before, after, state, now }) {
  const known = new Set(before.map(describeKey));
  const fresh = after.filter((entry) => !known.has(describeKey(entry)) && isRecent(entry, now));
  return groupUpdates(fresh).filter((group) => group.some((entry) => isAboutRanked(entry, state)));
}

const capitalize = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// The sentence's main clause is the title, and what explains it is the body.
export function describeNotification(group, context) {
  const markup = describeUpdate(group, { renderClub: nameTeam, ...context });
  if (!markup) return null;
  const [title, ...rest] = convertToText(markup).split(SENTENCE_BREAK);
  return { title, body: capitalize(rest.join(SENTENCE_BREAK)), tag: describeKey(group[0]) };
}

// Past a few at once, the rest are summed up in one, so a busy night doesn't bury the phone.
// The summary's tag is its first update's, so a later summary doesn't replace it.
export function listNotifications(groups, context) {
  const messages = groups.map((group) => describeNotification(group, context)).filter(Boolean);
  if (messages.length <= MAX_NOTIFIED) return messages;
  const shown = messages.slice(0, MAX_NOTIFIED - 1);
  const hidden = messages.slice(shown.length);
  return [
    ...shown,
    {
      title: `${hidden.length} more updates`,
      body: "Open the page to see them all.",
      tag: `more:${hidden[0].tag}`,
    },
  ];
}
