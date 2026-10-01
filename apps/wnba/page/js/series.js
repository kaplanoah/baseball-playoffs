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

/** @typedef {"top" | "bottom" | "middle"} BracketRow */
/** @typedef {{ from: string, fromRow: BracketRow, to: string, toRow: BracketRow, isDecided: boolean }} BracketLink */

/**
 * @param {Series | undefined} series
 * @param {string | null | undefined} team
 * @returns {BracketRow | null}
 */
function findTeamRow(series, team) {
  if (!team) return null;
  if (series?.top?.team === team) return "top";
  if (series?.bottom?.team === team) return "bottom";
  return null;
}

/**
 * Where each series' winner goes next. The higher seed always takes the top row, so a winner's
 * line runs to the row it holds, which crosses the other's when the seeds flip. Until a series
 * ends, its line runs to the row the other winner left open, or to the middle while neither is in.
 * @param {Series[]} allSeries
 * @returns {BracketLink[]}
 */
export function listBracketLinks(allSeries) {
  const seriesById = new Map(allSeries.map((series) => [series.id, series]));
  return Object.entries(BRACKET_FEEDERS).flatMap(([to, feeders]) => {
    const target = seriesById.get(to);
    return feeders.map((from, index) => {
      const feeder = seriesById.get(from);
      const winner = feeder?.winner ?? null;
      const otherRow = findTeamRow(target, seriesById.get(feeders[1 - index])?.winner);
      const openRow = otherRow ? (otherRow === "top" ? "bottom" : "top") : null;
      return {
        from,
        fromRow: findTeamRow(feeder, winner) ?? "middle",
        to,
        toRow: findTeamRow(target, winner) ?? (winner ? null : openRow) ?? "middle",
        isDecided: !!winner,
      };
    });
  });
}

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
