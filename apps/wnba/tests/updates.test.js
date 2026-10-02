import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot } from "../page/js/snapshot.js";
import { listPlayoffWins } from "../page/js/updates.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const SEASON = buildSnapshot(AFTERNOON.responses, { season: 2026, now: Date.parse(AFTERNOON.now) });

/** @param {any} season */
const readWins = (season) =>
  listPlayoffWins(season).map((update) =>
    update.text.text
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&mdash;/g, "--")
      .replace(/&ndash;/g, "-"),
  );

test("each finished playoff game is an update, newest first, with where its series stood after it", () => {
  assert.deepEqual(readWins(SEASON), [
    "Liberty beat the Lynx 87-71 to win the First Round 2-0",
    "Fever beat the Aces 99-89 in Game 2 -- tie the First Round 1-1",
    "Valkyries beat the Wings 104-80 in Game 1 -- lead the First Round 1-0",
    "Dream beat the Mystics 92-77 in Game 1 -- lead the First Round 1-0",
    "Aces beat the Fever 102-85 in Game 1 -- lead the First Round 1-0",
    "Liberty beat the Lynx 91-75 in Game 1 -- lead the First Round 1-0",
  ]);
});

test("a game goes by when the Worker found it final, or by its start when it wasn't seen live", () => {
  const isFeverGame1 = (game) => game.home.team === "LVA" && game.away.team === "IND";
  const games = SEASON.games.map((game) =>
    isFeverGame1(game) && game.number === 1 ? { ...game, end: "2026-10-01T03:00:00Z" } : game,
  );
  const [newest] = listPlayoffWins({ ...SEASON, games });

  assert.equal(newest.at, Date.parse("2026-10-01T03:00:00Z"));
  assert.match(newest.text.text, /^<b>Aces<\/b> beat the <b>Fever<\/b> 102-85 in Game/);
});

test("a team down in a longer series trails it after a win, and games still to finish aren't news", () => {
  const semis = (number, away, home, state = "final") => ({
    id: `10426002${number}`,
    round: 2,
    series: "2-0",
    number,
    start: `2026-10-0${number}T23:00:00Z`,
    state,
    away: { team: "NYL", score: away },
    home: { team: "ATL", score: home },
  });
  const games = [semis(1, 70, 80), semis(2, 75, 81), semis(3, 90, 84), semis(4, 40, 38, "live")];

  assert.deepEqual(readWins({ games }), [
    "Liberty beat the Dream 90-84 in Game 3 -- trail the Semifinals 1-2",
    "Dream beat the Liberty 81-75 in Game 2 -- lead the Semifinals 2-0",
    "Dream beat the Liberty 80-70 in Game 1 -- lead the Semifinals 1-0",
  ]);
});
