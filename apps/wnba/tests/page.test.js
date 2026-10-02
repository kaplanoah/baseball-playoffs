import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderBracket } from "../page/js/bracket-view.js";
import { readGameDay } from "../page/js/days.js";
import { renderGames, renderHeadline, sortGamesByDay } from "../page/js/games-view.js";
import { renderScoreboard } from "../page/js/scoreboard.js";
import { describeSeriesStanding } from "../page/js/series.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { describeStampProblem, renderStampLines } from "../page/js/stamp.js";
import { renderStandings } from "../page/js/standings-view.js";
import { renderTeamSheet } from "../page/js/team-view.js";
import { normalizeSpaces } from "../../../tests/text.js";
import { checkInTimeZone, EASTERN } from "../../../tests/time-zone.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
// The afternoon's recording has no players' averages, so the next day's stand in for them.
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const SEASON = buildSnapshot(
  { ...AFTERNOON.responses, players: GAMES.preview.players },
  { season: 2026, now: NOW },
);

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
    assert.match(text, /^Sep 30 Wed 4 Dream 1st Rd 1-0 71 68 Q4 3:48 5 Mystics Bonus 2 Valkyries /);
  }));

test("a final dims the loser, and a game not yet played shows its start in the viewer's time", () =>
  inEastern(() => {
    assert.match(
      readGameMarkup(SEASON),
      /data-game="1042600102">\s*<span class="game-side away lost">/,
    );
    assert.match(readGameList(SEASON, "today"), /^Sep 30 Wed 4 Dream 1st Rd 1-0 7:00 PM 5 Mystics/);
    const western = checkInTimeZone("America/Los_Angeles", () => readGameList(SEASON, "today"));
    assert.match(western, /^Sep 30 Wed 4 Dream 1st Rd 1-0 4:00 PM 5 Mystics/);
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
    assert.match(readGameList(onlyResults, "previous"), /^Sep 29 Yest .* Final 2 Valkyries$/);
    assert.equal(readGameList({ games: [] }, "previous"), "No playoff games yet.");
    const nothingPlayed = {
      ...SEASON,
      games: SEASON.games.filter((game) => game.state !== "final"),
    };
    assert.equal(readGameList(nothingPlayed, "previous"), "No results yet.");
    assert.match(readGameList(nothingPlayed, "today"), /^Sep 30 Wed 4 Dream /);
  }));

test("each game's label counts its series as it stood at tip-off, or after the game once it's final", () =>
  inEastern(() => {
    assert.match(
      readGameList(SEASON, "today"),
      /^Sep 30 Wed 4 Dream 1st Rd 1-0 7:00 PM 5 Mystics /,
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

/**
 * Each day's heading in a list, as it reads.
 * @param {object} season
 * @param {"previous" | "today" | "next"} list
 */
const readDayLabels = (season, list) =>
  [
    ...renderGames(season, NOW)[list].text.matchAll(/<h3 class="day-label"[^>]*>([\s\S]*?)<\/h3>/g),
  ].map(([, label]) => readText({ text: label }));

test("each day's games share a box beside its date, named for yesterday, tomorrow, or its weekday", () =>
  inEastern(() => {
    const markup = renderGames(SEASON, NOW);
    assert.equal(markup.previous.text.match(/<section class="game-day">/g).length, 2);
    assert.deepEqual(readDayLabels(SEASON, "previous"), ["Sep 29 Yest", "Sep 27 Sun"]);
    assert.deepEqual(readDayLabels(SEASON, "today"), ["Sep 30 Wed"]);
    assert.deepEqual(readDayLabels(SEASON, "next").slice(0, 3), [
      "Oct 1 Tmrw",
      "Oct 2 Fri",
      "Oct 4 Sun",
    ]);
  }));

test("a day's date reads in full to a screen reader, and every day's name looks alike", () =>
  inEastern(() => {
    const markup = renderGames(SEASON, NOW);
    const readNames = (list) =>
      [...markup[list].text.matchAll(/<h3 class="day-label" aria-label="([^"]*)"/g)].map(
        ([, name]) => name,
      );
    const readDayNameClasses = (list) =>
      [...markup[list].text.matchAll(/<span class="(day-name[^"]*)">/g)].map(([, name]) => name);
    assert.deepEqual(readNames("previous"), ["Yesterday, Sep 29", "Sunday, Sep 27"]);
    assert.deepEqual(readNames("today"), ["Wednesday, Sep 30"]);
    assert.deepEqual(readNames("next").slice(0, 2), ["Tomorrow, Oct 1", "Friday, Oct 2"]);
    for (const list of ["previous", "today", "next"])
      assert.deepEqual(new Set(readDayNameClasses(list)), new Set(["day-name"]));
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
      /^First Round Best of 3 Semifinals Best of 5 WNBA Finals Best of 7 1 seed Lynx 0 8 seed Liberty 2 4 seed Dream 1 5 seed Mystics 0 Next game today at 7:00 PM 2 seed Valkyries 1 7 seed Wings 0 /,
    );
    assert.match(
      text,
      / 6 seed Fever 1 Next game tomorrow at 9:00 PM Liberty 0 TBD Next game TBD TBD TBD Next game TBD TBD TBD Next game TBD$/,
    );
    assert.match(markup, /class="team-line out"[\s\S]*?Lynx/);
  }));

test("every series still to finish has a note under its card, which leaves out the game's number", () =>
  inEastern(() => {
    const markup = renderBracket(SEASON, NOW).text;
    const notes = [
      ...markup.matchAll(/data-series="([\d-]+)"(?:(?!data-series)[\s\S])*?class="card-note"/g),
    ];
    assert.deepEqual(
      notes.map((note) => note[1]),
      ["1-3", "1-1", "1-2", "2-0", "2-1", "3-0"],
    );
    assert.doesNotMatch(markup, /Game \d|win 2-0|Waits on|Starts after/);
  }));

test("a series still waiting on a team says its next game is TBD", () =>
  inEastern(() => {
    const text = readText(renderBracket(SEASON, NOW));
    assert.match(text, / Liberty 0 TBD Next game TBD /);
    assert.match(readText(renderBracket(finishFirstRound(), NOW)), / TBD TBD Next game TBD$/);
  }));

test("a next game without a set time says its time is TBD, and without a day says only TBD", () =>
  inEastern(() => {
    const nextId = SEASON.series.find((series) => series.id === "1-3")?.nextGame?.id;
    const untimed = replaceGame(SEASON, nextId, { isTimeSet: false });
    assert.match(readText(renderBracket(untimed, NOW)), /Mystics 0 Next game today, time TBD /);
    const undated = replaceGame(SEASON, nextId, { isTimeSet: false, start: null });
    assert.match(readText(renderBracket(undated, NOW)), /Mystics 0 Next game TBD /);
  }));

test("a series with a game under way says its score, top team first, and where the game is", () =>
  inEastern(() => {
    const text = readText(renderBracket(LIVE_TONIGHT, NOW));
    assert.match(text, /4 seed Dream 1 5 seed Mystics 0 71-68 with 3:48 in Q4 /);
    assert.match(renderBracket(LIVE_TONIGHT, NOW).text, /class="card-note live"/);
    const dreamAtHome = replaceGame(LIVE_TONIGHT, "1042600132", {
      away: { team: "WAS", seed: 5, score: 68, seriesWins: 0, isInBonus: false, timeouts: 1 },
      home: { team: "ATL", seed: 4, score: 71, seriesWins: 1, isInBonus: true, timeouts: 2 },
    });
    assert.match(readText(renderBracket(dreamAtHome, NOW)), /Mystics 0 71-68 with 3:48 in Q4 /);
  }));

test("a live game's note says where the game is in overtime, at halftime, and after a quarter", () =>
  inEastern(() => {
    const readNote = (changes) =>
      readText(renderBracket(replaceGame(LIVE_TONIGHT, "1042600132", changes), NOW));
    assert.match(readNote({ period: 5, clock: "2:05" }), /Mystics 0 71-68 with 2:05 in OT /);
    assert.match(readNote({ period: 4, clock: "42.3" }), /Mystics 0 71-68 with 42.3 in Q4 /);
    assert.match(
      readNote({ period: 2, clock: "0.0", status: "Half" }),
      /Mystics 0 71-68 at halftime /,
    );
    assert.match(readNote({ period: 3, clock: "0.0" }), /Mystics 0 71-68 after Q3 /);
  }));

test("a live game without its score yet still says where it is", () =>
  inEastern(() => {
    const noScores = replaceGame(LIVE_TONIGHT, "1042600132", {
      away: { team: "ATL", seed: 4, score: null, seriesWins: 1, isInBonus: false, timeouts: 2 },
      home: { team: "WAS", seed: 5, score: null, seriesWins: 0, isInBonus: false, timeouts: 1 },
    });
    assert.match(readText(renderBracket(noScores, NOW)), /Mystics 0 Live with 3:48 in Q4 /);
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

test("a seed is labeled only in the first round, where its team enters the bracket", () =>
  inEastern(() => {
    const text = readText(renderBracket(finishFirstRound(), NOW));
    assert.match(text, / 4 seed Dream 2 5 seed Mystics 0 /);
    assert.match(
      text,
      / Fever 2 Dream 0 Liberty 0 Next game Sun, Oct 4, time TBD Valkyries 0 Fever 0 /,
    );
  }));

test("the bracket opens on the earliest round with a series still to finish", () =>
  inEastern(() => {
    assert.match(renderBracket(SEASON, NOW).text, /data-opening-round="1"/);
    assert.match(renderBracket(finishFirstRound(), NOW).text, /data-opening-round="2"/);
  }));

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
    /^Season Recent Team W-L GB L10 Strk 1 Lynx W 33-11 - 6-4 W 1 2 Valkyries W 32-12 1\.0 7-3 W 1 /,
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
    /Strk 1 Dream 4 seed 30-14 - 9-1 W 5 2 Mystics 5 seed 28-16 2\.0 8-2 W 4 3 Fever 6 seed /,
  );
  const rows = readStandingsRows(renderStandings(SEASON, "East"));
  assert.deepEqual(
    rows.map((row) => row.className),
    ["", "", "", "", "playoff-line", "below", "below", "below"],
  );
  assert.match(rows[5].text, /^5 Sky 16-28 14\.0 4-6 L 1$/, "no seed below the line");
  assert.match(readText(renderStandings(SEASON, "West")), /Strk 1 Lynx 1 seed 33-11 - /);
});

test("each standings table names the view it shows", () => {
  assert.match(renderStandings(SEASON, "West").text, /aria-label="West standings"/);
});

test("a winning streak is marked, so one below the line can show paler than one above it", () => {
  const rows = renderStandings(SEASON).text.split("<tr").slice(1);
  const fire = rows.find((row) => row.includes(">Fire<"));
  const lynx = rows.find((row) => row.includes(">Lynx<"));
  assert.match(fire, /^ class="below"[\s\S]*<span class="streak-won">W 1<\/span>/);
  assert.match(lynx, /^ class=""[\s\S]*<span class="streak-won">W 1<\/span>/);
});

/**
 * A team's sheet, as text: its heading, the line of facts under it, and its body.
 * @param {any} season
 * @param {string} code
 */
function readTeam(season, code) {
  const { heading, note, body } = renderTeamSheet(season, code, { year: 2026, now: NOW });
  return { heading: readText(heading), note: readText(note), body: readText(body) };
}

test("a team's sheet names it over its conference, seed, and record", () => {
  assert.deepEqual(
    [readTeam(SEASON, "MIN").heading, readTeam(SEASON, "MIN").note],
    ["Minnesota Lynx", "West | 1 seed | 33-11"],
  );
  assert.equal(readTeam(SEASON, "DAL").note, "West | 7 seed | 27-17");
  assert.equal(readTeam(SEASON, "SEA").note, "West | 8-36");
  assert.match(
    renderTeamSheet(SEASON, "ATL", { year: 2026, now: NOW }).heading.text,
    /class="dot"/,
  );
});

test("a team's sheet shows its averages, its three leading scorers, its titles, and its playoff games", () =>
  inEastern(() => {
    assert.equal(
      readTeam(SEASON, "ATL").body,
      "Season PPG 91.3 Opp PPG 84.5 Differential +6.9 Home 15-7 Road 15-7 Last 10 9-1 " +
        "Leading scorers Pts Reb Ast Allisha Gray 19.0 3.5 2.6 Rhyne Howard 17.7 3.8 3.7 " +
        "Angel Reese 16.4 12.1 2.8 Titles None yet " +
        "Playoffs 1st Rd today G1 W vs Mystics 1st Rd 92-77 G2 &rsaquo; at Mystics 1st Rd Today 7:00 PM",
    );
    assert.match(
      readTeam(SEASON, "DAL").body,
      / Titles 3 \| 2003, 2006, 2008 \(as Detroit Shock\) Playoffs 1st Rd today /,
    );
    assert.match(
      readTeam(SEASON, "MIN").body,
      /Playoffs Out 1st Rd G1 L vs Liberty 1st Rd 75-91 G2 L at Liberty 1st Rd 71-87$/,
    );
    assert.match(readTeam(SEASON, "SEA").body, /Playoffs Missed$/);
  }));

test("a team's next game is in the round it's playing, not one left over from a round it won", () =>
  inEastern(() => {
    assert.match(
      readTeam(SEASON, "NYL").body,
      /Playoffs Semis .* G1 &rsaquo; at TBD Semis Sun, Oct 4$/,
    );
  }));

test("a champion counts this season's title, and the team it beat is out in the Finals", () => {
  const finals = {
    id: "3-0",
    round: 3,
    top: { team: "DAL", seed: 7, wins: 4 },
    bottom: { team: "LVA", seed: 3, wins: 2 },
    winner: "DAL",
    status: "DAL wins 4-2",
    nextGame: null,
  };
  const season = {
    ...SEASON,
    series: [...SEASON.series.filter((series) => series.id !== "3-0"), finals],
  };
  const dallas = readTeam(season, "DAL");
  assert.match(
    dallas.body,
    / Titles 4 \| 2003, 2006, 2008 \(as Detroit Shock\), 2026 Playoffs Champions /,
  );
  assert.match(readTeam(season, "LVA").body, / Playoffs Out Finals /);
});

test("before the playoffs, a team has no seed or playoff run, and its season shows what it has", () => {
  const standings = SEASON.standings.map(({ team, conference, wins, losses, place, lastTen }) => ({
    team,
    conference,
    wins,
    losses,
    place,
    lastTen,
  }));
  const minnesota = readTeam({ standings, series: [], games: [] }, "MIN");
  assert.equal(minnesota.note, "West | 33-11");
  assert.equal(minnesota.body, "Season Last 10 6-4 Titles 4 | 2011, 2013, 2015, 2017");
});

test("each standings row and each team in the bracket opens its team's sheet", () => {
  const rows = renderStandings(SEASON)
    .text.split("<tr")
    .filter((row) => !row.includes("playoff-line"))
    .slice(3);
  assert.deepEqual(
    rows.map((row) => row.match(/data-team="(\w+)"/)?.[1]),
    SEASON.standings.map((row) => row.team),
  );
  for (const row of rows)
    assert.match(row, /<button type="button" class="team-open" aria-label="Team details: /);
  assert.match(rows[0], /aria-label="Team details: Minnesota Lynx"/);
  const bracket = renderBracket(SEASON, NOW).text;
  assert.match(
    bracket,
    /<div class="team-line[^"]*" data-team="LVA">[\s\S]*?aria-label="Team details: Las Vegas Aces"/,
  );
  assert.doesNotMatch(bracket, /class="team-line tbd" data-team/);
});

/**
 * @param {any} season
 * @param {number} now
 */
const readStampLines = (season, now) =>
  renderStampLines(season, now).map((line) => readText(line).replace(/&mdash;|\u2014/g, "-"));

/**
 * @param {any} season
 * @param {string} id
 * @param {(game: any) => void} change
 */
function changeGame(season, id, change) {
  const games = structuredClone(season.games);
  change(games.find((game) => game.id === id));
  return { ...season, games };
}

test("the header says how the latest game ended and when the next one tips off, not when the page last saved", () =>
  inEastern(() => {
    assert.deepEqual(readStampLines(SEASON, NOW), [
      "No games since Liberty 87 Lynx 71 final last night - Liberty won series 2-0",
      "Next tip-off 7:00 PM - Dream @ Mystics",
    ]);
    const nextMorning = Date.parse("2026-10-01T14:00:00Z");
    assert.deepEqual(readStampLines(SEASON, nextMorning), [
      "No games since Liberty 87 Lynx 71 final Tuesday - Liberty won series 2-0",
      "Next tip-off yesterday 7:00 PM - Dream @ Mystics",
    ]);
  }));

test("a game the Worker saw end says when, its time set apart as the next tip-off's is", () =>
  inEastern(() => {
    const ended = changeGame(SEASON, "1042600102", (game) => {
      game.end = "2026-09-30T02:41:00Z";
    });
    assert.equal(
      readStampLines(ended, NOW)[0],
      "No games since Liberty 87 Lynx 71 final at 10:41 PM last night - Liberty won series 2-0",
    );
    assert.match(
      normalizeSpaces(renderStampLines(ended, NOW)[0]),
      /final at <b>10:41<span class="ap">PM<\/span><\/b> last night/,
    );
    const endedToday = changeGame(SEASON, "1042600132", (game) => {
      Object.assign(game, { start: "2026-09-30T17:00:00Z", state: "final", status: "Final" });
      Object.assign(game, { end: "2026-09-30T19:10:00Z" });
      Object.assign(game.away, { score: 80 });
      Object.assign(game.home, { score: 70 });
    });
    assert.equal(
      readStampLines(endedToday, NOW)[0],
      "Dream 80 Mystics 70 final at 3:10 PM - Dream lead series 1-0",
    );
  }));

test("a game that ended today leads the header without its day", () =>
  inEastern(() => {
    const atAfternoon = changeGame(SEASON, "1042600132", (game) => {
      Object.assign(game, { start: "2026-09-30T17:00:00Z", state: "final", status: "Final" });
      Object.assign(game.away, { score: 80 });
      Object.assign(game.home, { score: 70 });
    });
    assert.equal(
      readStampLines(atAfternoon, NOW)[0],
      "Dream 80 Mystics 70 final - Dream lead series 1-0",
    );
  }));

test("a final names its series as won, tied, or led", () =>
  inEastern(() => {
    const tiedSeries = changeGame(SEASON, "1042600123", (game) => {
      Object.assign(game, { start: "2026-09-30T17:00:00Z", state: "final", status: "Final" });
      Object.assign(game.away, { score: 84 });
      Object.assign(game.home, { score: 90 });
    });
    assert.equal(readStampLines(tiedSeries, NOW)[0], "Aces 90 Fever 84 final - series tied 1-1");
  }));

test("while a game is on, the header gives its score and clock, and still the next tip-off", () =>
  inEastern(() => {
    const live = changeGame(SEASON, "1042600132", (game) => {
      Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
      Object.assign(game.away, { score: 30 });
      Object.assign(game.home, { score: 27 });
    });
    assert.deepEqual(readStampLines(live, NOW), [
      "NOW Dream @ Mystics 30-27 with 5:10 in Q2",
      "Next tip-off 9:00 PM - Valkyries @ Wings",
    ]);
    const atHalf = changeGame(live, "1042600132", (game) => {
      Object.assign(game, { status: "Half", period: 2, clock: "0.0" });
    });
    assert.equal(readStampLines(atHalf, NOW)[0], "NOW Dream @ Mystics 30-27 at halftime");
    const afterThird = changeGame(live, "1042600132", (game) => {
      Object.assign(game, { status: "End of Q3", period: 3, clock: "0.0" });
    });
    assert.equal(readStampLines(afterThird, NOW)[0], "NOW Dream @ Mystics 30-27 at the end of Q3");
    const inOvertime = changeGame(live, "1042600132", (game) => {
      Object.assign(game, { status: "OT 1:12", period: 5, clock: "1:12" });
    });
    assert.equal(readStampLines(inOvertime, NOW)[0], "NOW Dream @ Mystics 30-27 with 1:12 in OT");
    const bothLive = changeGame(live, "1042600112", (game) => {
      Object.assign(game, { state: "live", status: "Q1 2:00", period: 1, clock: "2:00" });
      Object.assign(game.away, { score: 10 });
      Object.assign(game.home, { score: 8 });
    });
    assert.deepEqual(readStampLines(bothLive, NOW), [
      "NOW Dream @ Mystics 30-27 with 5:10 in Q2 | Valkyries @ Wings 10-8 with 2:00 in Q1",
      "Next tip-off tomorrow 9:00 PM - Fever @ Aces",
    ]);
  }));

test("a game whose time isn't set tips off on its day, and one its series no longer needs never does", () =>
  inEastern(() => {
    const finals = ["1042600132", "1042600112", "1042600123"].reduce(
      (season, id) =>
        changeGame(season, id, (game) => {
          Object.assign(game, { state: "final", status: "Final" });
          Object.assign(game.away, { score: 90 });
          Object.assign(game.home, { score: 80 });
        }),
      SEASON,
    );
    const decided = {
      ...finals,
      series: finals.series.map((series) =>
        series.id === "1-1" ? { ...series, winner: "GSV" } : series,
      ),
    };
    const lateThursday = Date.parse("2026-10-02T03:30:00Z");
    assert.equal(
      readStampLines(decided, lateThursday)[1],
      "Next tip-off tomorrow - Mystics @ Dream",
    );
  }));

test("the header names a problem with the page's server or the league's feeds", () => {
  assert.equal(
    describeStampProblem({ status: null, problem: "Can't reach the page's server right now." }),
    "Can't reach the page's server right now.",
  );
  assert.equal(describeStampProblem({ status: null, problem: "" }), "");
  const status = { error: "wnba_feeds_missing", detail: "bracket, standings" };
  assert.equal(
    describeStampProblem({ status, problem: "" }),
    "The WNBA stopped sending the bracket and the standings.",
  );
  const standingIn = { error: "wnba_feeds_missing", detail: "scoreboard", standIn: "espn" };
  assert.equal(
    describeStampProblem({ status: standingIn, problem: "" }),
    "The WNBA stopped sending today's scores. Scores are from ESPN for now.",
  );
});

test("a score shows in scoreboard digits, and still reads as its number", () => {
  const markup = renderScoreboard(89).text;
  assert.match(markup, /<span class="scoreboard-text">89<\/span>/);
  assert.equal(markup.match(/<svg/g).length, 3);
  assert.equal(
    markup.match(/class="on"/g).length,
    7 + 6,
    "an 8 lights every segment, a 9 all but one",
  );
  assert.match(renderScoreboard(68, { isLoser: true }).text, /class="scoreboard lost"/);
});

/** @param {{ text: string }} markup */
const readLitPlaces = (markup) =>
  markup.text
    .split("<svg")
    .slice(1)
    .map((place) => (place.match(/class="on"/g) ?? []).length);

test("every score fills a narrow hundreds place and two digits, with the places it doesn't reach dark", () => {
  assert.match(renderScoreboard(7).text, /<svg class="hundreds"/);
  assert.equal(renderScoreboard(7).text.match(/class="hundreds"/g).length, 1);
  assert.deepEqual(readLitPlaces(renderScoreboard(7)), [0, 0, 3]);
  assert.deepEqual(readLitPlaces(renderScoreboard(89)), [0, 7, 6]);
  assert.deepEqual(readLitPlaces(renderScoreboard(100)), [2, 6, 6]);
  assert.deepEqual(readLitPlaces(renderScoreboard(108)), [2, 6, 7]);
});

test("a game's two panels hold the same places, whatever its scores", () => {
  const [game] = structuredClone(SEASON.games.filter((each) => each.state === "final"));
  Object.assign(game.away, { score: 7 });
  Object.assign(game.home, { score: 104 });
  assert.deepEqual(readLitPlaces(renderHeadline(game)), [0, 0, 3, 2, 6, 4]);
});

test("between periods the league's word for the break shows in place of the clock", () =>
  inEastern(() => {
    const running = readGameMarkup(LIVE_TONIGHT);
    assert.match(running, /<span class="clock tabular">Q4 3:48<\/span>/);
    assert.doesNotMatch(running, /class="break"/);
    const atHalf = replaceGame(LIVE_TONIGHT, "1042600132", {
      status: "Half",
      period: 2,
      clock: "0.0",
    });
    const markup = readGameMarkup(atHalf);
    assert.match(markup, /<span class="game-status"><span class="break">Half<\/span><\/span>/);
    assert.doesNotMatch(markup, /class="clock/);
  }));

test("each game's score shows in scoreboard digits, the loser's dimmed", () =>
  inEastern(() => {
    const markup = renderGames(SEASON, NOW).previous.text;
    assert.match(markup, /class="scoreboard lost"\s*><span class="scoreboard-text">71<\/span>/);
    assert.match(markup, /class="scoreboard"\s*><span class="scoreboard-text">87<\/span>/);
  }));
