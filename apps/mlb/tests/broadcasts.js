import { readFileSync } from "node:fs";

const LISTINGS = JSON.parse(
  readFileSync(new URL("fixtures/2026-09-24-broadcasts.json", import.meta.url), "utf8"),
);

/**
 * A fixture's games with where MLB says they were on, recorded later for the same days.
 * @param {any} fixture
 */
export function addBroadcasts(fixture) {
  const listings = LISTINGS.dates.flatMap((day) => day.games);
  const broadcastsByPk = new Map(listings.map((game) => [game.gamePk, game.broadcasts]));
  const copy = structuredClone(fixture);
  for (const game of copy.responses.schedule.dates.flatMap((day) => day.games))
    game.broadcasts = broadcastsByPk.get(game.gamePk);
  return copy;
}
