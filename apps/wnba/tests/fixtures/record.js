import fs from "node:fs";
import path from "node:path";
import { nameBoxScoreRequest } from "../../worker/src/box-score.js";
import { listPreviewRequests } from "../../worker/src/preview.js";
import { FEED_HEADERS } from "../../worker/src/wnba.js";

// Records what the game sheet's routes read from the league: the box scores of the games named,
// and the season's schedule, standings, and player averages.

// Asked for anything but gzip alone, the stats site can answer from a months-old copy.
async function fetchJson(url) {
  const response = await fetch(url, { headers: { ...FEED_HEADERS, "accept-encoding": "gzip" } });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

// The whole season's schedule is a megabyte, so the fixture keeps only what a preview reads.
const trimGame = (game) => ({
  gameId: game.gameId,
  gameStatus: game.gameStatus,
  gameDateTimeUTC: game.gameDateTimeUTC,
  awayTeam: { teamTricode: game.awayTeam.teamTricode, score: game.awayTeam.score },
  homeTeam: { teamTricode: game.homeTeam.teamTricode, score: game.homeTeam.score },
});

const trimSchedule = ({ leagueSchedule }) => ({
  leagueSchedule: {
    seasonYear: leagueSchedule.seasonYear,
    gameDates: leagueSchedule.gameDates.map((day) => ({ games: day.games.map(trimGame) })),
  },
});

async function recordFixture(season, name, gameIds) {
  const now = Date.now();
  const requests = listPreviewRequests(season);
  const [schedule, standings, players, ...boxScores] = await Promise.all([
    fetchJson(requests.schedule),
    fetchJson(requests.standings),
    fetchJson(requests.players),
    ...gameIds.map((id) => fetchJson(nameBoxScoreRequest(id))),
  ]);
  const fixture = {
    season,
    now: new Date(now).toISOString(),
    preview: { schedule: trimSchedule(schedule), standings, players },
    boxScores: Object.fromEntries(gameIds.map((id, index) => [id, boxScores[index]])),
  };
  const file = path.join(import.meta.dirname, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture));
  console.log(`Wrote ${file}`);
}

const [season, name, ...gameIds] = process.argv.slice(2);
if (!season || !name) {
  console.error("usage: node apps/wnba/tests/fixtures/record.js <season> <name> [game id ...]");
  process.exit(1);
}
recordFixture(Number(season), name, gameIds).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
