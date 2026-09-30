import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderBracket } from "../page/js/bracket-view.js";
import { readGameDay } from "../page/js/days.js";
import { renderGames, sortGamesByDay } from "../page/js/games-view.js";
import { describeSeriesStanding } from "../page/js/series.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { describeStamp } from "../page/js/stamp.js";
import { renderStandings } from "../page/js/standings-view.js";
import { renderTeams } from "../page/js/teams-view.js";
import { normalizeSpaces } from "../../../tests/text.js";
import { checkInTimeZone, EASTERN } from "../../../tests/time-zone.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
const SEASON = buildSnapshot(AFTERNOON.responses, { season: 2026, now: NOW });

// Each tag reads as a space, and the page's separator as a bar.
const readText = (markup) =>
  normalizeSpaces(markup.text)
    .replace(/<[^>]+>/g, " ")
    .replace(/&bull;/g, "|")
    .replace(/\s+/g, " ")
    .trim();
const inEastern = (check) => checkInTimeZone(EASTERN, check);

function replaceGame(season, id, changes) {
  return {
    ...season,
    games: season.games.map((game) => (game.id === id ? { ...game, ...changes } : game)),
  };
}

// Tonight's Dream and Mystics game, under way in the fourth.
const LIVE_TONIGHT = replaceGame(SEASON, "1042600132", {
  state: "live",
  status: "Q4 3:48",
  period: 4,
  clock: "3:48",
  away: { team: "ATL", seed: 4, score: 71, seriesWins: 1, isInBonus: false, timeouts: 2 },
  home: { team: "WAS", seed: 5, score: 68, seriesWins: 0, isInBonus: true, timeouts: 1 },
});

test("a series reads as who leads, a tie, or who won it", () => {
  const [liberty, valkyries, aces] = SEASON.series;
  assert.equal(describeSeriesStanding(liberty), "Liberty win 2-0");
  assert.equal(describeSeriesStanding(valkyries), "Valkyries lead 1-0");
  assert.equal(describeSeriesStanding(aces), "Tied 1-1");
  assert.equal(describeSeriesStanding(SEASON.series.find((series) => series.id === "2-1")), "");
});

test("today's games come first, then the days ahead, then results newest first", () =>
  inEastern(() => {
    const games = SEASON.games.filter((game) => game.away.team || game.home.team);
    const { today, ahead, before } = sortGamesByDay(games, NOW);
    assert.deepEqual(
      today.map((game) => game.id),
      ["1042600132", "1042600112"],
    );
    assert.equal(ahead[0].games[0].id, "1042600123");
    assert.deepEqual(
      before.map(({ games: dayGames }) => dayGames.map((game) => game.id)),
      [
        ["1042600122", "1042600102"],
        ["1042600101", "1042600121", "1042600131", "1042600111"],
      ],
    );
  }));

test("a game without a set time falls on the league's day, even out west", () => {
  const tbd = SEASON.games.find((game) => game.id === "1042600201");
  const day = checkInTimeZone("America/Los_Angeles", () => readGameDay(tbd));
  assert.deepEqual([day.getMonth() + 1, day.getDate()], [10, 4]);
});

test("a live game shows its clock and who's in the bonus, and stays with today's", () =>
  inEastern(() => {
    const text = readText(renderGames(LIVE_TONIGHT, NOW));
    assert.match(
      text,
      /^Today 4 Dream 71 68 Q4 3:48 5 Mystics Bonus First Round Game 2 \| Dream lead 1-0 /,
    );
  }));

test("a final dims the loser, and a game not yet played shows its start in the viewer's time", () =>
  inEastern(() => {
    const markup = renderGames(SEASON, NOW).text;
    assert.match(markup, /data-game="1042600102"[\s\S]*?class="side home lost"/);
    assert.match(readText(renderGames(SEASON, NOW)), /^Today 4 Dream 7:00 PM 5 Mystics/);
    const western = checkInTimeZone("America/Los_Angeles", () =>
      readText(renderGames(SEASON, NOW)),
    );
    assert.match(western, /^Today 4 Dream 4:00 PM 5 Mystics/);
  }));

test("a game a finished series no longer needs is left off, and an empty section says nothing", () =>
  inEastern(() => {
    const game3 = {
      ...SEASON.games.find((game) => game.id === "1042600102"),
      id: "1042600103",
      number: 3,
      state: "pre",
      isIfNeeded: true,
      start: "2026-10-02T23:00:00Z",
    };
    const season = { ...SEASON, games: [...SEASON.games, game3] };
    assert.doesNotMatch(renderGames(season, NOW).text, /1042600103/);
    const onlyResults = { ...SEASON, games: SEASON.games.filter((game) => game.state === "final") };
    const text = readText(renderGames(onlyResults, NOW));
    assert.match(text, /^Today No games today\. Results /);
    assert.match(text, /Valkyries lead 1-0$/);
  }));

test("the bracket pairs each semifinal with the first-round series that feed it", () =>
  inEastern(() => {
    const markup = renderBracket(SEASON, NOW).text;
    const order = [...markup.matchAll(/data-series="([\d-]+)"/g)].map((match) => match[1]);
    assert.deepEqual(order, ["1-0", "1-3", "1-1", "1-2", "2-0", "2-1", "3-0"]);
    const text = readText(renderBracket(SEASON, NOW));
    assert.match(
      text,
      /^First Round 1 Lynx 0 8 Liberty 2 Liberty win 2-0 4 Dream 1 5 Mystics 0 Game 2 Today 7:00 PM /,
    );
    assert.match(text, /Semifinals 8 Liberty 0 TBD TBD TBD/);
    assert.match(markup, /class="team-line out"[\s\S]*?Lynx/);
  }));

test("a series with a game under way says so", () =>
  inEastern(() => {
    assert.match(readText(renderBracket(LIVE_TONIGHT, NOW)), /Mystics 0 Live, Game 2/);
  }));

test("the league's standings draw the playoff line after eighth, and each conference ranks its own", () => {
  const markup = renderStandings(SEASON).text;
  const rows = markup.split("<tr").slice(1);
  const cutRow = rows.findIndex((row) => row.includes('class="cut below"'));
  assert.equal(cutRow, 9, "the header row, then eight teams above the line");
  const text = readText(renderStandings(SEASON));
  assert.match(
    text,
    /^League Team W-L GB L10 Strk 1 Lynx W 33-11 - 6-4 W 1 2 Valkyries W 32-12 1\.0 /,
  );
  assert.match(text, /East Team W-L GB L10 Strk 1 Dream 30-14 - /);
  assert.match(text, /West Team W-L GB L10 Strk 1 Lynx 33-11 -/);
});

test("teams list how far each one got, in the order of the standings", () => {
  const text = readText(renderTeams(SEASON));
  assert.match(text, /^Minnesota Lynx West \| 33-11 \| Out in the First Round /);
  assert.match(text, /New York Liberty East \| 26-18 \| In the Semifinals /);
  assert.match(text, /Seattle Storm West \| 8-36 \| Missed the playoffs$/);
});

test("the header says when the page was updated, or which feeds stopped", () =>
  inEastern(() => {
    const season = { updatedAt: "2026-09-30T21:40:00Z" };
    assert.equal(
      normalizeSpaces(describeStamp({ season, status: null, problem: "", now: NOW }).text),
      "Updated 5:40 PM",
    );
    const status = { error: "wnba_feeds_missing", detail: "bracket, standings" };
    assert.deepEqual(describeStamp({ season, status, problem: "", now: NOW }), {
      text: "The WNBA stopped sending the bracket and the standings.",
      isProblem: true,
    });
  }));
