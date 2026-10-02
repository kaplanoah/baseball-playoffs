import fs from "node:fs";
import path from "node:path";
import { nameScoreboardRequest, nameSummaryRequest, findEventId } from "../../worker/src/lead.js";
import { ESPN_HEADERS } from "../../worker/src/wnba.js";

// Records what the game sheet's lead chart reads from ESPN for one game: the day's scoreboard and
// the game's summary, each trimmed to what the Worker reads.

async function fetchJson(url) {
  const response = await fetch(url, { headers: ESPN_HEADERS });
  if (!response.ok) throw new Error(`${response.status} for ${url}`);
  return response.json();
}

const trimScoreboard = ({ events }) => ({
  events: events.map(({ id, competitions }) => ({
    id,
    competitions: competitions.map(({ competitors }) => ({
      competitors: competitors.map(({ homeAway, team }) => ({ homeAway, team: { id: team.id } })),
    })),
  })),
});

const trimSummary = ({ header, plays }) => ({
  header: {
    competitions: header.competitions.map(({ status }) => ({
      status: { type: { completed: status.type.completed } },
    })),
  },
  plays: plays.map(({ period, clock, awayScore, homeScore, scoringPlay }) => ({
    period: { number: period.number },
    clock: { displayValue: clock.displayValue },
    awayScore,
    homeScore,
    scoringPlay,
  })),
});

async function recordFixture(name, game) {
  const scoreboard = await fetchJson(nameScoreboardRequest(game.start));
  const eventId = findEventId(scoreboard, game);
  if (!eventId) throw new Error(`ESPN has no ${game.away} at ${game.home} that day`);
  const summary = await fetchJson(nameSummaryRequest(eventId));
  const fixture = {
    game,
    eventId,
    scoreboard: trimScoreboard(scoreboard),
    summary: trimSummary(summary),
  };
  const file = path.join(import.meta.dirname, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture));
  console.log(`Wrote ${file}`);
}

const [name, away, home, start] = process.argv.slice(2);
if (!name || !away || !home || !start) {
  console.error("usage: node apps/wnba/tests/fixtures/record-lead.js <name> <away> <home> <start>");
  process.exit(1);
}
recordFixture(name, { away, home, start }).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
