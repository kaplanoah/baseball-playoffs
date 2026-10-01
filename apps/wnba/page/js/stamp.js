import { html } from "#shared/html.js";
import {
  describeFinishedDay,
  formatStampDay,
  renderStampLine,
  renderStampWhen,
} from "#shared/stamp.js";
import { readGameDay } from "./days.js";
import { describeLiveClock, isCalledOff } from "./games-view.js";
import { describeSeriesStanding, nameTeam } from "./series.js";

// The header's lines on the latest score and the next tip-off, or on why the page isn't current.

/** @typedef {import("./games-view.js").Game} Game */
/** @typedef {import("./series.js").Series} Series */

const FEED_NAMES = {
  scoreboard: "today's scores",
  schedule: "the schedule",
  bracket: "the bracket",
  standings: "the standings",
  players: "the players' stats",
};

/** @param {Game} game */
const hasBothTeams = (game) => !!(game.away.team && game.home.team);

/** @param {Game} game */
const readStart = (game) => Date.parse(game.start ?? "");

/** @param {Game} game */
const formatMatchup = (game) => `${nameTeam(game.away.team)} @ ${nameTeam(game.home.team)}`;

/** @param {Game} game */
const describeLiveGame = (game) =>
  `${formatMatchup(game)} ${game.away.score}-${game.home.score}, ${describeLiveClock(game)}`;

/** @param {Game} game */
function describeScore(game) {
  const [winner, loser] =
    game.away.score > game.home.score ? [game.away, game.home] : [game.home, game.away];
  return `${nameTeam(winner.team)} ${winner.score} ${nameTeam(loser.team)} ${loser.score} final`;
}

// The feeds give no time a game ended, so its start stands in for that.
/**
 * @param {Game} game
 * @param {Map<string, Series>} seriesById
 * @param {Date} now
 */
function describeLatestFinal(game, seriesById, now) {
  const start = new Date(readStart(game));
  const day = describeFinishedDay(start, start, now);
  const score =
    day === "today" ? describeScore(game) : `No games since ${describeScore(game)} ${day}`;
  const standing = describeSeriesStanding(seriesById.get(game.series ?? ""));
  return standing ? `${score} \u2014 ${standing}` : score;
}

/**
 * The games in one state whose teams and start are known, earliest first.
 * @param {Game[]} games
 * @param {string} state
 */
const listGamesInState = (games, state) =>
  games
    .filter(
      (game) => game.state === state && hasBothTeams(game) && Number.isFinite(readStart(game)),
    )
    .sort((first, second) => readStart(first) - readStart(second));

/**
 * @param {Game[]} games
 * @param {Map<string, Series>} seriesById
 * @param {Date} now
 */
function describeLatest(games, seriesById, now) {
  const live = listGamesInState(games, "live");
  if (live.length) return live.map(describeLiveGame).join(", ");
  const latestFinal = listGamesInState(games, "final").at(-1);
  return latestFinal ? describeLatestFinal(latestFinal, seriesById, now) : "";
}

/**
 * @param {Game[]} games
 * @param {Map<string, Series>} seriesById
 */
const findNextGame = (games, seriesById) =>
  listGamesInState(games, "pre").find((game) => !isCalledOff(game, seriesById));

/**
 * @param {Game} game
 * @param {Date} now
 */
function renderNextTipOff(game, now) {
  const when = game.isTimeSet
    ? renderStampWhen(new Date(readStart(game)), now)
    : formatStampDay(/** @type {Date} */ (readGameDay(game)), now);
  return renderStampLine("Next tip-off", when, formatMatchup(game));
}

/**
 * What last happened, or the score of each game under way, and which game is next.
 * @param {{ games?: Game[], series?: Series[] } | null} season
 * @param {number} now
 */
export function renderStampLines(season, now) {
  const games = season?.games ?? [];
  const seriesById = new Map((season?.series ?? []).map((series) => [series.id, series]));
  const today = new Date(now);
  const latest = describeLatest(games, seriesById, today);
  const lines = latest ? [html`<span>${latest}</span>`] : [];
  const next = findNextGame(games, seriesById);
  if (next) lines.push(renderNextTipOff(next, today));
  return lines;
}

/**
 * @param {{ error?: string, detail?: string, standIn?: string } | null} status
 * @returns {string}
 */
function describeFeedProblem(status) {
  if (!status?.error) return "";
  if (status.error !== "wnba_feeds_missing") return "The WNBA isn't answering right now.";
  const feeds = String(status.detail ?? "")
    .split(", ")
    .map((feed) => FEED_NAMES[feed] ?? feed);
  const standIn = status.standIn === "espn" ? " Scores are from ESPN for now." : "";
  return `The WNBA stopped sending ${feeds.join(" and ")}.${standIn}`;
}

/**
 * @param {{ status: { error?: string, detail?: string, standIn?: string } | null, problem: string }} state
 * @returns {string}
 */
export const describeStampProblem = ({ status, problem }) => problem || describeFeedProblem(status);
