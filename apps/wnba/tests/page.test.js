import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderBracket } from "../page/js/bracket-view.js";
import { readGameDay } from "../page/js/days.js";
import { renderGames, sortGamesByDay } from "../page/js/games-view.js";
import { renderScoreboard } from "../page/js/scoreboard.js";
import { describeSeriesStanding, listBracketLinks } from "../page/js/series.js";
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

/**
 * @param {object} season
 * @param {"previous" | "today" | "next"} list
 */
const readGameList = (season, list) => readText(renderGames(season, NOW)[list]);

/** @param {object} season */
const readGameMarkup = (season) =>
  Object.values(renderGames(season, NOW))
    .map((list) => list.text)
    .join("");

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
  const readDay = () => {
    const day = readGameDay(tbd);
    return [day.getMonth() + 1, day.getDate()];
  };
  assert.deepEqual(checkInTimeZone("America/Los_Angeles", readDay), [10, 4]);
});

test("a live game shows its clock and who's in the bonus, and stays with today's", () =>
  inEastern(() => {
    const text = readGameList(LIVE_TONIGHT, "today");
    assert.match(
      text,
      /^Wed, Sep 30 4 Dream 1st Rd 1-0 71 68 Q4 3:48 5 Mystics Bonus 2 Valkyries /,
    );
  }));

test("a final dims the loser, and a game not yet played shows its start in the viewer's time", () =>
  inEastern(() => {
    assert.match(
      readGameMarkup(SEASON),
      /data-game="1042600102">\s*<span class="game-side away lost">/,
    );
    assert.match(
      readGameList(SEASON, "today"),
      /^Wed, Sep 30 4 Dream 1st Rd 1-0 7:00 PM 5 Mystics/,
    );
    const western = checkInTimeZone("America/Los_Angeles", () => readGameList(SEASON, "today"));
    assert.match(western, /^Wed, Sep 30 4 Dream 1st Rd 1-0 4:00 PM 5 Mystics/);
  }));

test("a game a finished series no longer needs is left off, and an empty list says so", () =>
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
    assert.doesNotMatch(readGameMarkup(season), /1042600103/);
    const onlyResults = { ...SEASON, games: SEASON.games.filter((game) => game.state === "final") };
    assert.equal(readGameList(onlyResults, "today"), "No games today.");
    assert.equal(readGameList(onlyResults, "next"), "No more games scheduled.");
    assert.match(readGameList(onlyResults, "previous"), /^Yesterday .* Final 2 Valkyries$/);
    assert.equal(readGameList({ games: [] }, "previous"), "No playoff games yet.");
    const nothingPlayed = {
      ...SEASON,
      games: SEASON.games.filter((game) => game.state !== "final"),
    };
    assert.equal(readGameList(nothingPlayed, "previous"), "No results yet.");
    assert.match(readGameList(nothingPlayed, "today"), /^Wed, Sep 30 4 Dream /);
  }));

test("each game's label counts its series as it stood at tip-off, or after the game once it's final", () =>
  inEastern(() => {
    assert.match(
      readGameList(SEASON, "today"),
      /^Wed, Sep 30 4 Dream 1st Rd 1-0 7:00 PM 5 Mystics /,
    );
    const results = readGameList(SEASON, "previous");
    assert.match(results, / 8 Liberty 1st Rd 1-0 91 75 Final 1 Lynx /);
    assert.match(results, / 1 Lynx 1st Rd 0-2 71 87 Final 8 Liberty /);
    const labels = [...readGameMarkup(SEASON).matchAll(/class="series-label( decided)?"/g)];
    assert.deepEqual(
      labels.filter(([, decided]) => decided).length,
      1,
      "only the game that ended a series marks it decided",
    );
  }));

test("a game whose teams aren't both known yet names its number instead of a series count", () =>
  inEastern(() => {
    const text = readGameList(SEASON, "next");
    assert.match(text, / 8 Liberty Semis G1 TBD TBD /);
    assert.match(text, / TBD Semis G3 TBD 8 Liberty /);
  }));

test("a game that may not be needed says so under its time", () =>
  inEastern(() => {
    assert.match(
      readGameMarkup(SEASON),
      /<span class="time tabular">TBD<\/span><\/span\s*><span class="game-status">If needed<\/span>/,
    );
  }));

test("the bracket pairs each semifinal with the first-round series that feed it", () =>
  inEastern(() => {
    const markup = renderBracket(SEASON, NOW).text;
    const order = [...markup.matchAll(/data-series="([\d-]+)"/g)].map((match) => match[1]);
    assert.deepEqual(order, ["1-0", "1-3", "1-1", "1-2", "2-0", "2-1", "3-0"]);
    const text = readText(renderBracket(SEASON, NOW));
    assert.match(
      text,
      /^First Round Best of 3 Semifinals Best of 5 WNBA Finals Best of 7 Liberty win 2-0 1 Lynx 0 8 Liberty 2 Game 2 \| Today 7:00 PM 4 Dream 1 5 Mystics 0 /,
    );
    assert.match(
      text,
      /Waits on 4-5 8 Liberty 0 TBD Waits on 2-7 and 3-6 TBD TBD Starts after the Semifinals TBD TBD$/,
    );
    assert.match(markup, /class="team-line out"[\s\S]*?Lynx/);
    assert.match(markup, /class="series-note decided">Liberty win 2-0/);
    assert.match(markup, /class="series-note today">Game 2/);
  }));

test("a series with a game under way says so", () =>
  inEastern(() => {
    assert.match(readText(renderBracket(LIVE_TONIGHT, NOW)), /Live, Game 2 4 Dream 1 5 Mystics 0/);
  }));

/**
 * The afternoon's season with every first-round series won by the side named, and the semifinals
 * set with the higher seed on top.
 */
function finishFirstRound() {
  const season = structuredClone(SEASON);
  const findSeries = (id) => season.series.find((series) => series.id === id);
  const finish = (id, side) => {
    const series = findSeries(id);
    series.winner = series[side].team;
    series[side].wins = 2;
  };
  finish("1-1", "top");
  finish("1-2", "bottom");
  finish("1-3", "top");
  const semifinal = findSeries("2-0");
  semifinal.top = { team: "ATL", seed: 4, wins: 0 };
  semifinal.bottom = { team: "NYL", seed: 8, wins: 0 };
  Object.assign(findSeries("2-1"), {
    top: { team: "GSV", seed: 2, wins: 0 },
    bottom: { team: "IND", seed: 6, wins: 0 },
  });
  return season;
}

test("the bracket opens on the earliest round with a series still to finish", () =>
  inEastern(() => {
    assert.match(renderBracket(SEASON, NOW).text, /data-opening-round="1"/);
    assert.match(renderBracket(SEASON, NOW).text, /class="round-name round-1 now"/);
    const markup = renderBracket(finishFirstRound(), NOW).text;
    assert.match(markup, /data-opening-round="2"/);
    assert.match(markup, /class="round-name round-2 now"/);
  }));

test("each winner's line runs to the row it holds next, and one still going to where it will go", () => {
  const findLink = (links, from) => links.find((link) => link.from === from);
  const afternoon = listBracketLinks(SEASON.series);
  assert.deepEqual(findLink(afternoon, "1-0"), {
    from: "1-0",
    fromRow: "bottom",
    to: "2-0",
    toRow: "top",
    isDecided: true,
  });
  assert.deepEqual(findLink(afternoon, "1-3"), {
    from: "1-3",
    fromRow: "middle",
    to: "2-0",
    toRow: "bottom",
    isDecided: false,
  });
  assert.equal(findLink(afternoon, "1-1").toRow, "middle");

  // The 8-seed Liberty win the upper series but play under the 4-seed Dream, so the lines cross.
  const finished = listBracketLinks(finishFirstRound().series);
  assert.equal(findLink(finished, "1-0").toRow, "bottom");
  assert.equal(findLink(finished, "1-3").fromRow, "top");
  assert.equal(findLink(finished, "1-3").toRow, "top");
  assert.equal(findLink(finished, "1-2").fromRow, "bottom");
  assert.equal(findLink(finished, "1-2").toRow, "bottom");
  assert.equal(findLink(finished, "2-0").toRow, "middle");
});

// The rows of a standings table's body, each with its class and text.
const readStandingsRows = (markup) =>
  markup.text
    .split("<tbody>")[1]
    .split("<tr")
    .slice(1)
    .map((row) => ({
      className: row.match(/^ class="([^"]*)"/)?.[1] ?? "",
      text: readText({ text: `<tr${row}` }),
    }));

test("the league's standings show the season, then recent form, with the playoff line above ninth", () => {
  const text = readText(renderStandings(SEASON));
  assert.match(
    text,
    /^League East West Season Recent Team W-L GB L10 Strk 1 Lynx W 33-11 - 6-4 W 1 2 Valkyries W 32-12 1\.0 7-3 W 1 /,
  );
  const rows = readStandingsRows(renderStandings(SEASON));
  const line = rows.findIndex((row) => row.className === "playoff-line");
  assert.equal(line, 8, "eight teams above the line");
  assert.match(rows[line + 1].text, /^9 Fire W 17-27 16\.0 3-7 W 1$/);
  assert.deepEqual(
    rows.filter((row) => row.className === "below").length,
    7,
    "every team below the line is marked",
  );
});

test("a conference's standings rank its own teams, note each playoff team's league seed, and draw the line after its last one", () => {
  const text = readText(renderStandings(SEASON, "East"));
  assert.match(
    text,
    /Strk 1 Dream Seed 4 30-14 - 9-1 W 5 2 Mystics Seed 5 28-16 2\.0 8-2 W 4 3 Fever Seed 6 /,
  );
  const rows = readStandingsRows(renderStandings(SEASON, "East"));
  assert.deepEqual(
    rows.map((row) => row.className),
    ["", "", "", "", "playoff-line", "below", "below", "below"],
  );
  assert.match(rows[5].text, /^5 Sky 16-28 14\.0 4-6 L 1$/, "no seed below the line");
  assert.match(readText(renderStandings(SEASON, "West")), /Strk 1 Lynx Seed 1 33-11 - /);
});

test("the standings pill marks the view it shows", () => {
  const markup = renderStandings(SEASON, "West").text;
  const pressed = [...markup.matchAll(/data-standings-view="(\w+)" aria-pressed="(\w+)"/g)];
  assert.deepEqual(
    pressed.map(([, view, isPressed]) => [view, isPressed]),
    [
      ["League", "false"],
      ["East", "false"],
      ["West", "true"],
    ],
  );
  assert.match(markup, /aria-label="West standings"/);
});

test("a winning streak is marked, so one below the line can show paler than one above it", () => {
  const rows = renderStandings(SEASON).text.split("<tr").slice(1);
  const fire = rows.find((row) => row.includes(">Fire<"));
  const lynx = rows.find((row) => row.includes(">Lynx<"));
  assert.match(fire, /^ class="below"[\s\S]*<span class="streak-won">W 1<\/span>/);
  assert.match(lynx, /^ class=""[\s\S]*<span class="streak-won">W 1<\/span>/);
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
    const standingIn = { error: "wnba_feeds_missing", detail: "scoreboard", standIn: "espn" };
    assert.equal(
      describeStamp({ season, status: standingIn, problem: "", now: NOW }).text,
      "The WNBA stopped sending today's scores. Scores are from ESPN for now.",
    );
  }));

test("a score shows in scoreboard digits, and still reads as its number", () => {
  const markup = renderScoreboard(89).text;
  assert.match(markup, /<span class="scoreboard-text">89<\/span>/);
  assert.equal(markup.match(/<svg/g).length, 2);
  assert.equal(
    markup.match(/class="on"/g).length,
    7 + 6,
    "an 8 lights every segment, a 9 all but one",
  );
  assert.match(renderScoreboard(68, { isLoser: true }).text, /class="scoreboard lost"/);
});

test("a lone 1 sits in the middle of its panel, and a 1 among other digits stays in its place", () => {
  const readShifts = (score) =>
    [...renderScoreboard(score).text.matchAll(/translate\(([-\d.]+) 0\)/g)].map((match) =>
      Number(match[1]),
    );
  assert.ok(readShifts(1)[0] < 0);
  assert.deepEqual(readShifts(101), [0, 0, 0]);
});

test("each game's score shows in scoreboard digits, the loser's dimmed", () =>
  inEastern(() => {
    const markup = renderGames(SEASON, NOW).previous.text;
    assert.match(markup, /class="scoreboard lost"\s*><span class="scoreboard-text">71<\/span>/);
    assert.match(markup, /class="scoreboard"\s*><span class="scoreboard-text">87<\/span>/);
  }));
