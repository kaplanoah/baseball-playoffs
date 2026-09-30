import { TEAMS } from "./teams.js";

/** @typedef {{ team: string, seed: number | null, wins: number }} SeriesSide */
/** @typedef {{ id: string, round: number, top: SeriesSide | null, bottom: SeriesSide | null, winner: string | null, status: string, nextGame: { id: string, start: string | null } | null }} Series */

// The bracket pairs the 1-8 and 4-5 series' winners in one semifinal, and 2-7 and 3-6 in the other.
export const BRACKET_ORDER = {
  1: ["1-0", "1-3", "1-1", "1-2"],
  2: ["2-0", "2-1"],
  3: ["3-0"],
};

/** @param {string | null} code */
export const nameTeam = (code) => (code && TEAMS[code]?.name) || "TBD";

/**
 * Where a series stands, as "Dream lead 1-0", "Tied 1-1", or "Liberty win 2-0".
 * @param {Series | undefined} series
 */
export function describeSeriesStanding(series) {
  if (!series?.top || !series.bottom) return "";
  const [ahead, behind] =
    series.top.wins >= series.bottom.wins
      ? [series.top, series.bottom]
      : [series.bottom, series.top];
  const score = `${ahead.wins}-${behind.wins}`;
  if (series.winner) return `${nameTeam(series.winner)} win ${score}`;
  if (ahead.wins === behind.wins) return `Tied ${score}`;
  return `${nameTeam(ahead.team)} lead ${score}`;
}

/**
 * How far each team got: the round it's playing or went out in, and whether it won it all.
 * @param {Series[]} allSeries
 * @returns {Map<string, { round: number, isOut: boolean, isChampion: boolean }>}
 */
export function readPlayoffRuns(allSeries) {
  const runs = new Map();
  const byRound = [...allSeries].sort((first, second) => first.round - second.round);
  for (const series of byRound) {
    for (const side of [series.top, series.bottom]) {
      if (!side?.team) continue;
      const isOut = !!series.winner && series.winner !== side.team;
      const isChampion = series.round === 3 && series.winner === side.team;
      runs.set(side.team, { round: series.round, isOut, isChampion });
    }
  }
  return runs;
}
