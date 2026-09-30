import { isSameJson } from "#shared/compare.js";
import { ROUNDS } from "../../page/js/snapshot.js";
import { TEAMS } from "../../page/js/teams.js";

// Keeps the current season's saved data up to date from the league, whether or not a page is
// open, and says which finished games and series are news. `docs` reads and writes the store's
// documents: read(key), list(collection), write(key, doc), and remove(key).

export const RETRY_MS = [30e3, 60e3, 2 * 60e3, 5 * 60e3, 10 * 60e3];
const STATUS_KEY = "live/status";
const SAVED_FIELDS = ["games", "series", "standings"];
// A game or series found finished long after it ended, as after a gap in updates, isn't news.
const RECENT_MS = 12 * 60 * 60 * 1000;
const MAX_NOTIFIED = 4;

const nameSeasonKey = (year) => `seasons/${year}`;

export const loadCurrentSnapshot = (loadSnapshot, now) =>
  loadSnapshot(new Date(now).getUTCFullYear());

// A feed that didn't answer leaves its saved field as it was. The games need both of theirs: the
// schedule alone can be behind on today's, and the scoreboard alone has only today's.
export async function saveSnapshot(docs, snapshot) {
  const key = nameSeasonKey(snapshot.season);
  const doc = (await docs.read(key)) ?? { year: snapshot.season };
  const missing = new Set(snapshot.missing);
  const hasGames = !missing.has("scoreboard") && !missing.has("schedule");
  const answered = {
    games: hasGames,
    series: !missing.has("bracket") || hasGames,
    standings: !missing.has("standings"),
  };
  const changed = SAVED_FIELDS.filter(
    (field) => answered[field] && !isSameJson(doc[field], snapshot[field]),
  );
  if (!changed.length) return;
  const fields = Object.fromEntries(changed.map((field) => [field, snapshot[field]]));
  await docs.write(key, { ...doc, ...fields, updatedAt: snapshot.asOf });
}

export const readUpdates = (docs, year) => docs.read(nameSeasonKey(year));

export function describeSnapshotStatus(snapshot) {
  const missing = snapshot.missing || [];
  return { error: missing.length ? "wnba_feeds_missing" : "", detail: missing.join(", ") };
}

// Stored so updates that stop can be diagnosed without the Worker's logs.
export async function saveStatus(docs, status, now) {
  const stored = await docs.read(STATUS_KEY);
  const current = { error: "", detail: "", write: "", ...status };
  const isSame =
    stored &&
    stored.error === current.error &&
    stored.detail === current.detail &&
    stored.write === current.write;
  if (!isSame) await docs.write(STATUS_KEY, { ...current, at: new Date(now).toISOString() });
}

const nameTeam = (code) => TEAMS[code]?.name ?? code;

function describeFinal(game) {
  const [winner, loser] =
    game.home.score > game.away.score ? [game.home, game.away] : [game.away, game.home];
  return `The ${nameTeam(winner.team)} beat the ${nameTeam(loser.team)} ${winner.score}-${loser.score}`;
}

function describeSeriesStanding(series) {
  if (!series?.top || !series.bottom) return "";
  const round = ROUNDS[series.round].name;
  const [ahead, behind] =
    series.top.wins >= series.bottom.wins
      ? [series.top, series.bottom]
      : [series.bottom, series.top];
  const score = `${ahead.wins}-${behind.wins}`;
  if (series.winner) return `The ${nameTeam(series.winner)} win the ${round} ${score}.`;
  if (ahead.wins === behind.wins) return `The ${round} is tied ${score}.`;
  return `The ${nameTeam(ahead.team)} lead the ${round} ${score}.`;
}

const isFinalGame = (game) => game?.state === "final";

/**
 * A notification for each game that finished since the last update, each naming where its
 * series stands.
 * @param {{ before: any, after: any, now: number }} change the saved season before and after
 */
export function listNotifications({ before, after, now }) {
  const wasFinal = new Set((before?.games ?? []).filter(isFinalGame).map((game) => game.id));
  const seriesById = new Map((after?.series ?? []).map((series) => [series.id, series]));
  const messages = (after?.games ?? [])
    .filter((game) => isFinalGame(game) && !wasFinal.has(game.id))
    .filter((game) => Date.parse(game.start) >= now - RECENT_MS)
    .map((game) => ({
      title: describeFinal(game),
      body: describeSeriesStanding(seriesById.get(game.series)),
      tag: `final:${game.id}`,
    }));
  if (messages.length <= MAX_NOTIFIED) return messages;
  const shown = messages.slice(0, MAX_NOTIFIED - 1);
  return [
    ...shown,
    {
      title: `${messages.length - shown.length} more final scores`,
      body: "Open the page to see them all.",
      tag: `more:${messages[shown.length].tag}`,
    },
  ];
}
