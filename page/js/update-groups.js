import { TEAMS } from "./teams.js";

// Which updates read as one: a clinch with the eliminations in its league that the same
// update found, and eliminations that one game decided. Each group lists its lead first.

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

const isSameUpdate = (first, second) =>
  first.at === second.at && !!leagueOf(first) && leagueOf(first) === leagueOf(second);

// A clinch with no game of its own came from what else the update found.
const isClinchFor = (berth, elimination) =>
  isSameUpdate(berth, elimination) &&
  (!listResults(berth).length || findCommonGames([berth, elimination]).length > 0);

const joinsEliminations = (group, elimination) =>
  isSameUpdate(group[0], elimination) && findCommonGames([...group, elimination]).length > 0;

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
    const berth = berths.find((candidate) => isClinchFor(candidate, elimination));
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
