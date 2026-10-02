import { TEAMS } from "./teams.js";

/** @typedef {{ team: string, seed: number | null, wins: number }} SeriesSide */
/** @typedef {{ id: string, round: number, top: SeriesSide | null, bottom: SeriesSide | null, winner: string | null, status: string, nextGame: { id: string, start: string | null } | null }} Series */

// The bracket pairs the 1-8 and 4-5 series' winners in one semifinal, and 2-7 and 3-6 in the other.
export const BRACKET_ORDER = {
  1: ["1-0", "1-3", "1-1", "1-2"],
  2: ["2-0", "2-1"],
  3: ["3-0"],
};

/** The two series whose winners meet in each later one, upper first. */
export const BRACKET_FEEDERS = {
  "2-0": ["1-0", "1-3"],
  "2-1": ["1-1", "1-2"],
  "3-0": ["2-0", "2-1"],
};

/** @param {string | null} code */
export const nameTeam = (code) => (code && TEAMS[code]?.name) || "TBD";

/**
 * A series' two sides, the one with more wins first.
 * @param {SeriesSide} top
 * @param {SeriesSide} bottom
 */
export const orderBySeriesWins = (top, bottom) =>
  top.wins >= bottom.wins ? [top, bottom] : [bottom, top];

/**
 * Where a series stands, as "Dream lead 1-0", "Tied 1-1", or "Liberty win 2-0".
 * @param {Series | undefined} series
 */
export function describeSeriesStanding(series) {
  if (!series?.top || !series.bottom) return "";
  const [ahead, behind] = orderBySeriesWins(series.top, series.bottom);
  const score = `${ahead.wins}-${behind.wins}`;
  if (series.winner) return `${nameTeam(series.winner)} win ${score}`;
  if (ahead.wins === behind.wins) return `Tied ${score}`;
  return `${nameTeam(ahead.team)} lead ${score}`;
}

/**
 * Where a series stood after a game, as its winner tells it: "Dream won to lead 2-0", "Dream won
 * to tie 1-1", "Dream won but trail 1-2", or "Dream won the series 2-0".
 * @param {{ winner: string, wins: number, losses: number, winsNeeded: number }} result
 */
export function describeSeriesAfterWin({ winner, wins, losses, winsNeeded }) {
  const score = `${wins}-${losses}`;
  const name = nameTeam(winner);
  if (wins === winsNeeded) return `${name} won the series ${score}`;
  if (wins === losses) return `${name} won to tie ${score}`;
  if (wins < losses) return `${name} won but trail ${score}`;
  return `${name} won to lead ${score}`;
}

/**
 * How far each team got: its seed, the round it's playing or went out in, and whether it won it
 * all.
 * @param {Series[]} allSeries
 * @returns {Map<string, { seed: number | null, round: number, isOut: boolean, isChampion: boolean }>}
 */
export function readPlayoffRuns(allSeries) {
  const runs = new Map();
  const byRound = [...allSeries].sort((first, second) => first.round - second.round);
  for (const series of byRound) {
    for (const side of [series.top, series.bottom]) {
      if (!side?.team) continue;
      const isOut = !!series.winner && series.winner !== side.team;
      const isChampion = series.round === 3 && series.winner === side.team;
      runs.set(side.team, { seed: side.seed, round: series.round, isOut, isChampion });
    }
  }
  return runs;
}
