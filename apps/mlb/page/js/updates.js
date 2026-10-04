import { renderClub, renderRankTag } from "./clubs.js";
import { describeEntry, describeUpdate } from "./entry-text.js";
import { html } from "#shared/html.js";
import { listFreshNotes, showUpdates } from "#shared/updates.js";
import { RELEASE_NOTES } from "./release-notes.js";
import { saveSeenAt } from "./season-store.js";
import { session, readSeasonYear } from "./session.js";
import { showSaveResult } from "./stamp-view.js";
import { TEAMS } from "./teams.js";
import { renderMatchupButton } from "./games-view.js";
import { describeGame, findCommonGames, groupUpdates, isResult } from "./update-groups.js";

function renderClubChip(id) {
  return TEAMS[id] ? html`${renderRankTag(id)}${renderClub(id)}` : html``;
}

const readTextContext = () => ({
  renderClub: renderClubChip,
  teams: session.state?.teams,
  standings: session.standings,
});

// Markup for an entry, or null for one there is nothing to say about.
export const renderEntryText = (entry) => describeEntry(entry, readTextContext());

export const renderUpdateText = (entries) => describeUpdate(entries, readTextContext());

// Freshness goes by when a change was noticed; the list shows when it happened, which for a
// group is when its last game ended.
const findHappenedAt = (group) =>
  Math.max(...group.map((entry) => Date.parse(entry.ended || entry.at)));

const readNoticedAt = (entry) => Date.parse(entry.at);

const readSeenAt = () => (session.state.seenAt ? Date.parse(session.state.seenAt) : 0);

const isCurrentSeason = () => session.activeYear === readSeasonYear();

const listFreshReleaseNotes = () => listFreshNotes(RELEASE_NOTES, readSeenAt());

function listFreshUpdates() {
  const seen = readSeenAt();
  const fresh = (session.state.log || []).filter(
    (entry) => entry && (!seen || readNoticedAt(entry) > seen) && renderEntryText(entry),
  );
  return groupUpdates(fresh).sort(
    (first, second) => findHappenedAt(second) - findHappenedAt(first),
  );
}

// A series game's entry has its own result, winner first, and any other update is about one game
// only when every entry in it came from the same one.
function readSeriesResult(entry) {
  if (entry.kind === "game") return { team: entry.won, opp: entry.lost, score: entry.runs };
  if (entry.kind === "clinch") return { team: entry.team, opp: entry.over, score: entry.runs };
  return null;
}

function nameUpdateGame(group) {
  const result = readSeriesResult(group[0]);
  if (result) return isResult(result) ? describeGame(result) : null;
  const games = findCommonGames(group);
  return games.length === 1 ? games[0] : null;
}

const describeSlateGame = (game) =>
  describeGame({ team: game.away, opp: game.home, score: game.score });

function listSlateFinals(slate) {
  const today = slate.today.games.map((game) => ({ date: slate.today.date, ...game }));
  return [...today, ...(slate.previous || [])].filter(
    (game) => game.state === "final" && game.score,
  );
}

/**
 * The final in the Games view that an update is about, or null for an update about no one game,
 * or one the Games view no longer lists. The same clubs with the same score again is the latest.
 */
export function findUpdateGame(group, slate) {
  const name = nameUpdateGame(group);
  if (!name || !slate) return null;
  const matches = listSlateFinals(slate).filter((game) => describeSlateGame(game) === name);
  return (
    matches.sort((first, second) => Date.parse(first.end) - Date.parse(second.end)).pop() ?? null
  );
}

function renderUpdateAction(group) {
  const { slate } = session.state;
  const game = findUpdateGame(group, slate);
  return Boolean(game) && renderMatchupButton(game, game.date === slate.today.date);
}

export function renderUpdates() {
  const fresh = isCurrentSeason() ? listFreshUpdates() : [];
  const updates = fresh.map((group) => ({
    at: findHappenedAt(group),
    text: renderUpdateText(group),
    action: renderUpdateAction(group),
  }));
  showUpdates(/** @type {HTMLElement} */ (document.getElementById("updates")), updates, {
    dismiss: dismissUpdates,
    notes: isCurrentSeason() ? listFreshReleaseNotes() : [],
  });
}

// Updates are stamped by the Worker's clock, and a note by the time it was given, so the dismissal
// goes by the newest of them, not by this device's clock, which can be off.
function dismissUpdates() {
  const newest = Math.max(
    ...listFreshUpdates().flatMap((group) => group.map(readNoticedAt)),
    ...listFreshReleaseNotes().map((note) => note.at),
  );
  const saving = saveSeenAt(new Date(newest).toISOString());
  renderUpdates();
  return showSaveResult(saving);
}
