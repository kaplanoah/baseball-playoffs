import { TEAMS } from "./teams.js";

// Which updates read as one: a clinch with the eliminations in its league that its game
// decided or its update found, and eliminations that one game decided. Each group lists its
// lead first.

const isPair = (value) => Array.isArray(value) && value.length === 2;

/** @param {any} value */
export const isResult = (value) =>
  !!value &&
  typeof value === "object" &&
  !!TEAMS[value.team] &&
  !!TEAMS[value.opp] &&
  isPair(value.score);

/** @param {Record<string, any>} entry */
export const listResults = (entry) => (Array.isArray(entry.via) ? entry.via.filter(isResult) : []);

// The same game whichever side a result is from.
export const describeGame = (result) =>
  `${[result.team, result.opp].sort().join("-")}:${[...result.score].sort().join("-")}`;

const listGames = (entry) => listResults(entry).map(describeGame);

/** @param {Record<string, any>[]} entries */
export const findCommonGames = (entries) =>
  entries.map(listGames).reduce((common, games) => common.filter((game) => games.includes(game)));

const leagueOf = (entry) => TEAMS[entry.team]?.league;

const isSameLeague = (first, second) => !!leagueOf(first) && leagueOf(first) === leagueOf(second);

// MLB can post a clinch minutes after the elimination the same game brought, so updates
// that share a game group when found apart. The same clubs with the same score again are
// a day away.
const SAME_GAME_MS = 3 * 60 * 60 * 1000;

const isNearby = (first, second) =>
  Math.abs(Date.parse(first.at) - Date.parse(second.at)) <= SAME_GAME_MS;

const sharesGame = (entries) =>
  isNearby(entries[0], entries[entries.length - 1]) && findCommonGames(entries).length > 0;

const isGameClinchFor = (berth, elimination) =>
  isSameLeague(berth, elimination) &&
  listResults(berth).length > 0 &&
  sharesGame([berth, elimination]);

// A clinch with no game of its own came from what else its update found, unless another
// clinch shares the elimination's game.
const isGamelessClinchFor = (berth, elimination) =>
  isSameLeague(berth, elimination) && !listResults(berth).length && berth.at === elimination.at;

const findClinchFor = (berths, elimination) =>
  berths.find((berth) => isGameClinchFor(berth, elimination)) ||
  berths.find((berth) => isGamelessClinchFor(berth, elimination));

const joinsEliminations = (group, elimination) =>
  isSameLeague(group[0], elimination) && sharesGame([...group, elimination]);

function moveInto(groups, lead, entry) {
  groups.get(lead).push(entry);
  groups.delete(entry);
}

/**
 * @param {Record<string, any>[]} entries
 * @returns {Record<string, any>[][]}
 */
export function groupUpdates(entries) {
  const groups = new Map(entries.map((entry) => [entry, [entry]]));
  const berths = entries.filter((entry) => entry.kind === "berth");
  const unclaimed = [];
  for (const elimination of entries.filter((entry) => entry.kind === "elim")) {
    const berth = findClinchFor(berths, elimination);
    if (berth) moveInto(groups, berth, elimination);
    else unclaimed.push(elimination);
  }
  unclaimed.forEach((elimination, index) => {
    const lead = unclaimed
      .slice(0, index)
      .find((other) => groups.has(other) && joinsEliminations(groups.get(other), elimination));
    if (lead) moveInto(groups, lead, elimination);
  });
  return [...groups.values()];
}
