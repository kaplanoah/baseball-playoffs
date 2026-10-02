import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSnapshot } from "../page/js/snapshot.js";
import { session } from "../page/js/session.js";
import { listFreshUpdates, listPlayoffWins } from "../page/js/updates.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const SEASON = buildSnapshot(AFTERNOON.responses, { season: 2026, now: Date.parse(AFTERNOON.now) });

/** @param {{ text: { text: string } }} update */
const readText = (update) =>
  update.text.text
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "--")
    .replace(/&ndash;/g, "-");

/** @param {any} season */
const readWins = (season) => listPlayoffWins(season).map(readText);

/** @param {any} season */
function readFreshWins(season) {
  session.season = season;
  return listFreshUpdates().map(readText);
}

/** @param {Partial<Storage>} storage */
const useStorage = (storage) =>
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });

/** @param {Map<string, string>} saved */
const useSavedStorage = (saved) =>
  useStorage({
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  });

const refuseAccess = () => {
  throw new Error("Access denied");
};

const TUESDAY_WINS = [
  "Liberty beat the Lynx 87-71 to win the First Round 2-0",
  "Fever beat the Aces 99-89 in Game 2 -- tie the First Round 1-1",
];

const SUNDAY_WINS = [
  "Valkyries beat the Wings 104-80 in Game 1 -- lead the First Round 1-0",
  "Dream beat the Mystics 92-77 in Game 1 -- lead the First Round 1-0",
  "Aces beat the Fever 102-85 in Game 1 -- lead the First Round 1-0",
  "Liberty beat the Lynx 91-75 in Game 1 -- lead the First Round 1-0",
];

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

test("a device that has never dismissed the box starts it at the latest day's finals", () => {
  useSavedStorage(new Map());

  assert.deepEqual(readFreshWins(SEASON), TUESDAY_WINS);
});

test("a device keeps its first start, so every final after it shows until it's dismissed", () => {
  useSavedStorage(new Map());
  const throughSunday = {
    ...SEASON,
    games: SEASON.games.filter((game) => Date.parse(game.start) < Date.parse("2026-09-29")),
  };

  assert.deepEqual(readFreshWins(throughSunday), SUNDAY_WINS);
  assert.deepEqual(readFreshWins(SEASON), [...TUESDAY_WINS, ...SUNDAY_WINS]);
});

test("after a dismissal the box lists only the finals since", () => {
  useSavedStorage(new Map([["updatesSeenAt", String(Date.parse("2026-09-28T01:00:00Z"))]]));

  assert.deepEqual(readFreshWins(SEASON), TUESDAY_WINS);
});

test("a device whose storage refuses access starts at the latest day's finals on every load", () => {
  useStorage({ getItem: refuseAccess, setItem: refuseAccess });

  assert.deepEqual(readFreshWins(SEASON), TUESDAY_WINS);
  assert.deepEqual(readFreshWins(SEASON), TUESDAY_WINS);
});

test("a final that ends after midnight counts on the day it started", () => {
  useSavedStorage(new Map());
  const isFeverGame2 = (game) =>
    game.number === 2 && [game.away.team, game.home.team].includes("IND");
  const games = SEASON.games.map((game) =>
    isFeverGame2(game) ? { ...game, end: "2026-09-30T04:30:00Z" } : game,
  );

  assert.deepEqual(readFreshWins({ ...SEASON, games }), [...TUESDAY_WINS].reverse());
});
