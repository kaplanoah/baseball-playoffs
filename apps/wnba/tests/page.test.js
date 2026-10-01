import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderBracket } from "../page/js/bracket-view.js";
import { readGameDay } from "../page/js/days.js";
import { renderGames, sortGamesByDay } from "../page/js/games-view.js";
import { renderScoreboard } from "../page/js/scoreboard.js";
import { describeSeriesStanding, listBracketLinks } from "../page/js/series.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { describeStampProblem, renderStampLines } from "../page/js/stamp.js";
import { renderStandings } from "../page/js/standings-view.js";
import { renderTeams } from "../page/js/teams-view.js";
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
    assert.match(
      text,
      /^Sep 30 Wednesday First Round, Game 2 4 Dream 1st Rd 1-0 71 68 Q4 3:48 5 Mystics Bonus 2 Valkyries /,
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
      /^Sep 30 Wednesday First Round, Game 2 4 Dream 1st Rd 1-0 7:00 PM 5 Mystics/,
    );
    const western = checkInTimeZone("America/Los_Angeles", () => readGameList(SEASON, "today"));
    assert.match(
      western,
      /^Sep 30 Wednesday First Round, Game 2 4 Dream 1st Rd 1-0 4:00 PM 5 Mystics/,
    );
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
    assert.match(readGameList(onlyResults, "previous"), /^Sep 29 Yesterday .* Final 2 Valkyries$/);
    assert.equal(readGameList({ games: [] }, "previous"), "No playoff games yet.");
    const nothingPlayed = {
      ...SEASON,
      games: SEASON.games.filter((game) => game.state !== "final"),
    };
    assert.equal(readGameList(nothingPlayed, "previous"), "No results yet.");
    assert.match(
      readGameList(nothingPlayed, "today"),
      /^Sep 30 Wednesday First Round, Game 2 4 Dream /,
    );
  }));

test("each game's label counts its series as it stood at tip-off, or after the game once it's final", () =>
  inEastern(() => {
    assert.match(
      readGameList(SEASON, "today"),
      /^Sep 30 Wednesday First Round, Game 2 4 Dream 1st Rd 1-0 7:00 PM 5 Mystics /,
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
  [...renderGames(season, NOW)[list].text.matchAll(/<h3 class="day-label">([\s\S]*?)<\/h3>/g)].map(
    ([, label]) => readText({ text: label }),
  );

test("each day's games share a box under its date, named for yesterday, tomorrow, or its weekday", () =>
  inEastern(() => {
    const markup = renderGames(SEASON, NOW);
    assert.equal(markup.previous.text.match(/<section class="game-day">/g).length, 2);
    assert.deepEqual(readDayLabels(SEASON, "previous"), [
      "Sep 29 Yesterday First Round, Game 2",
      "Sep 27 Sunday First Round, Game 1",
    ]);
    assert.deepEqual(readDayLabels(SEASON, "today"), ["Sep 30 Wednesday First Round, Game 2"]);
    assert.deepEqual(readDayLabels(SEASON, "next").slice(0, 3), [
      "Oct 1 Tomorrow First Round, Game 3",
      "Oct 2 Friday First Round, Game 3",
      "Oct 4 Sunday Semifinals, Game 1",
    ]);
  }));

test("a day names each of its rounds, with the game only when all of that round's games share it", () =>
  inEastern(() => {
    const today = SEASON.games.filter((game) => ["1042600132", "1042600112"].includes(game.id));
    const withGames = (changes) => ({
      ...SEASON,
      games: SEASON.games.map((game) => {
        const index = today.indexOf(game);
        return index === -1 ? game : { ...game, ...changes[index] };
      }),
    });
    assert.deepEqual(readDayLabels(withGames([{}, { number: 3 }]), "today"), [
      "Sep 30 Wednesday First Round",
    ]);
    assert.deepEqual(readDayLabels(withGames([{}, { round: 2, number: 1 }]), "today"), [
      "Sep 30 Wednesday First Round, Game 2 | Semifinals, Game 1",
    ]);
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
      /^First Round Best of 3 Semifinals Best of 5 WNBA Finals Best of 7 Liberty win 2-0 Seed 1 Lynx 0 Seed 8 Liberty 2 Game 2 \| Today 7:00 PM Seed 4 Dream 1 Seed 5 Mystics 0 /,
    );
    assert.match(
      text,
      /Waits on 4-5 Liberty 0 TBD Waits on 2-7 and 3-6 TBD TBD Starts after the Semifinals TBD TBD$/,
    );
    assert.match(markup, /class="team-line out"[\s\S]*?Lynx/);
    assert.match(markup, /class="series-note decided">Liberty win 2-0/);
    assert.match(markup, /class="series-note today">Game 2/);
  }));

test("a series with a game under way says so", () =>
  inEastern(() => {
    assert.match(
      readText(renderBracket(LIVE_TONIGHT, NOW)),
      /Live, Game 2 Seed 4 Dream 1 Seed 5 Mystics 0/,
    );
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
    assert.match(text, /Dream win 2-0 Seed 4 Dream 2 Seed 5 Mystics 0 /);
    assert.match(text, /Oct 4 Dream 0 Liberty 0 Game 1 \| Sun, Oct 4 Valkyries 0 Fever 0 /);
  }));

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

/**
 * One team's row, and the season it opens to, as text.
 * @param {any} season
 * @param {string} code
 */
function readTeam(season, code) {
  const markup = renderTeams(season, { year: 2026, now: NOW }).text;
  const team = markup.split("<details").find((part) => part.includes(`data-team="${code}"`));
  const [row, details] = team.split("</summary>");
  return { row: readText({ text: `<${row}` }), details: readText({ text: details }) };
}

test("teams follow the standings, each with its conference, seed, record, last title, and how far it got", () =>
  inEastern(() => {
    const markup = renderTeams(SEASON, { year: 2026, now: NOW }).text;
    const order = [...markup.matchAll(/data-team="(\w+)"/g)].map((match) => match[1]);
    assert.deepEqual(
      order,
      SEASON.standings.map((row) => row.team),
    );
    assert.equal(
      readTeam(SEASON, "MIN").row,
      "West 1 seed Minnesota Lynx 33-11 Last title 2017 Out 1st Rd",
    );
    assert.equal(
      readTeam(SEASON, "ATL").row,
      "East 4 seed Atlanta Dream 30-14 Last title None yet 1st Rd today",
    );
    assert.equal(
      readTeam(SEASON, "LVA").row,
      "West 3 seed Las Vegas Aces 31-13 Last title 2025 1st Rd",
    );
    assert.equal(
      readTeam(SEASON, "DAL").row,
      "West 7 seed Dallas Wings 27-17 Last title 2008 (as Detroit Shock) 1st Rd today",
    );
    assert.equal(readTeam(SEASON, "SEA").row, "West Seattle Storm 8-36 Last title 2020 Missed");
    assert.match(markup, /class="team done" data-team="MIN"/);
    assert.match(markup, /class="team" data-team="NYL"/);
  }));

test("a team opens to its season: its averages, its top scorer, its titles, and its playoff games", () =>
  inEastern(() => {
    assert.equal(
      readTeam(SEASON, "ATL").details,
      "Points 91.3 Allowed 84.5 Net +6.9 Home 15-7 Road 15-7 Last 10 9-1 " +
        "Top scorer Allisha Gray | 19.0 pts | 3.5 reb | 2.6 ast " +
        "Playoffs G1 W vs Mystics 1st Rd 92-77 G2 &rsaquo; at Mystics 1st Rd Today 7:00 PM",
    );
    assert.match(
      readTeam(SEASON, "DAL").details,
      / Titles 3 \| 2003, 2006, 2008 \(as Detroit Shock\) Playoffs /,
    );
    assert.match(
      readTeam(SEASON, "MIN").details,
      /G1 L vs Liberty 1st Rd 75-91 G2 L at Liberty 1st Rd 71-87$/,
    );
  }));

test("a team's next game is in the round it's playing, not one left over from a round it won", () =>
  inEastern(() => {
    assert.match(
      readTeam(SEASON, "NYL").details,
      /G2 W vs Lynx 1st Rd 87-71 G1 &rsaquo; at TBD Semis Sun, Oct 4$/,
    );
  }));

test("a champion counts this season's title as its last", () => {
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
  assert.equal(dallas.row, "West 7 seed Dallas Wings 27-17 Last title 2026 Champions");
  assert.match(dallas.details, / Titles 4 \| 2003, 2006, 2008 \(as Detroit Shock\), 2026 /);
  assert.match(readTeam(season, "LVA").row, / Last title 2025 Out Finals$/);
});

test("before the playoffs, a team has no seed or playoff chip, and a season shows what it has", () => {
  const standings = SEASON.standings.map(({ team, conference, wins, losses, place, lastTen }) => ({
    team,
    conference,
    wins,
    losses,
    place,
    lastTen,
  }));
  const season = { standings, series: [], games: [] };
  const minnesota = readTeam(season, "MIN");
  assert.equal(minnesota.row, "West Minnesota Lynx 33-11 Last title 2017");
  assert.equal(minnesota.details, "Last 10 6-4 Titles 4 | 2011, 2013, 2015, 2017");
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
      "No games since Liberty 87 Lynx 71 final last night - Liberty win 2-0",
      "Next tip-off 7:00 PM - Dream @ Mystics",
    ]);
    const nextMorning = Date.parse("2026-10-01T14:00:00Z");
    assert.deepEqual(readStampLines(SEASON, nextMorning), [
      "No games since Liberty 87 Lynx 71 final Tuesday - Liberty win 2-0",
      "Next tip-off yesterday 7:00 PM - Dream @ Mystics",
    ]);
  }));

test("a game that ended today leads the header without its day", () =>
  inEastern(() => {
    const atAfternoon = changeGame(SEASON, "1042600132", (game) => {
      Object.assign(game, { start: "2026-09-30T17:00:00Z", state: "final", status: "Final" });
      Object.assign(game.away, { score: 80 });
      Object.assign(game.home, { score: 70 });
    });
    assert.equal(readStampLines(atAfternoon, NOW)[0], "Dream 80 Mystics 70 final - Dream lead 1-0");
  }));

test("while a game is on, the header gives its score and clock, and still the next tip-off", () =>
  inEastern(() => {
    const live = changeGame(SEASON, "1042600132", (game) => {
      Object.assign(game, { state: "live", status: "Q2 5:10", period: 2, clock: "5:10" });
      Object.assign(game.away, { score: 30 });
      Object.assign(game.home, { score: 27 });
    });
    assert.deepEqual(readStampLines(live, NOW), [
      "Dream @ Mystics 30-27, Q2 5:10",
      "Next tip-off 9:00 PM - Valkyries @ Wings",
    ]);
    const atHalf = changeGame(live, "1042600132", (game) => {
      Object.assign(game, { status: "Half", period: 2, clock: "0.0" });
    });
    assert.equal(readStampLines(atHalf, NOW)[0], "Dream @ Mystics 30-27, Half");
    const bothLive = changeGame(live, "1042600112", (game) => {
      Object.assign(game, { state: "live", status: "Q1 2:00", period: 1, clock: "2:00" });
      Object.assign(game.away, { score: 10 });
      Object.assign(game.home, { score: 8 });
    });
    assert.deepEqual(readStampLines(bothLive, NOW), [
      "Dream @ Mystics 30-27, Q2 5:10 | Valkyries @ Wings 10-8, Q1 2:00",
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

test("every score fills three places, so each panel is one width, with the unused places dark", () => {
  const readLitPlaces = (score) =>
    renderScoreboard(score)
      .text.split("<svg")
      .slice(1)
      .map((place) => (place.match(/class="on"/g) ?? []).length);
  assert.deepEqual(readLitPlaces(7), [0, 0, 3]);
  assert.deepEqual(readLitPlaces(89), [0, 7, 6]);
  assert.deepEqual(readLitPlaces(101), [2, 6, 2]);
});

test("each game's score shows in scoreboard digits, the loser's dimmed", () =>
  inEastern(() => {
    const markup = renderGames(SEASON, NOW).previous.text;
    assert.match(markup, /class="scoreboard lost"\s*><span class="scoreboard-text">71<\/span>/);
    assert.match(markup, /class="scoreboard"\s*><span class="scoreboard-text">87<\/span>/);
  }));
