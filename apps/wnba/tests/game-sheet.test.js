import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderBoxScore, renderPendingBoxScore } from "../page/js/box-score-view.js";
import { renderGames } from "../page/js/games-view.js";
import { renderPendingPreview, renderPreview } from "../page/js/preview-view.js";
import { buildSnapshot } from "../page/js/snapshot.js";
import { describeBoxScore } from "../worker/src/box-score.js";
import { describePreview } from "../worker/src/preview.js";
import { checkInTimeZone, EASTERN } from "../../../tests/time-zone.js";
import { normalizeSpaces } from "../../../tests/text.js";

const AFTERNOON = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-09-30-afternoon.json`, "utf8"),
);
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const NOW = Date.parse(AFTERNOON.now);
const SEASON = buildSnapshot(AFTERNOON.responses, { season: 2026, now: NOW });

// Each tag reads as a space, and the page's separator as a bar.
const readText = (markup) =>
  normalizeSpaces(markup.text)
    .replace(/<[^>]+>/g, " ")
    .replace(/&bull;/g, "|")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** @param {string} id */
const readBoxScore = (id) => describeBoxScore(GAMES.boxScores[id]);

// Valkyries at Wings, Game 2, as if it were still in the third quarter.
function readLiveBoxScore() {
  const box = readBoxScore("1042600112");
  box.state = "live";
  box.period = 3;
  return box;
}

/** @param {any} markup */
const listRows = (markup, table) =>
  [...markup.text.matchAll(new RegExp(`<table class="${table}[^"]*">[\\s\\S]*?</table>`, "g"))].map(
    ([found]) =>
      [...found.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].map(([, row]) => readText({ text: row })),
  );

/**
 * The two bars of the tape row a measure names, away then home, as "lead 52" or "42".
 * @param {any} markup
 * @param {string} label
 */
function readTapeBars(markup, label) {
  const row = markup.text
    .split('<div class="tape-row">')
    .find((chunk) => chunk.includes(`<span class="tape-label">${label}</span>`));
  return [...row.matchAll(/<i class="(lead)?" style="width: (\d+)%">/g)].map(([, lead, width]) =>
    lead ? `lead ${width}` : width,
  );
}

test("every game with both teams known opens its sheet, named for the game", () => {
  const markup = Object.values(renderGames(SEASON, NOW))
    .map((list) => list.text)
    .join("");
  const labels = [...markup.matchAll(/class="game-open" aria-label="([^"]*)"/g)].map(
    ([, label]) => label,
  );
  assert.ok(labels.includes("Game details: Aces at Fever, First Round Game 2"));
  assert.ok(labels.includes("Game details: Fever at Aces, First Round Game 3"));
  assert.equal(new Set(labels).size, labels.length);
  const withTeams = SEASON.games.filter((game) => game.away.team && game.home.team).length;
  assert.equal(labels.length, withTeams);
  assert.ok(SEASON.games.some((game) => !game.home.team));
});

test("a final's line score gives every quarter, and dims the loser's total", () => {
  const [lineScore] = listRows(renderBoxScore(readBoxScore("1042600122")), "line-score");
  assert.deepEqual(lineScore, ["1 2 3 4 T", "Aces 26 17 17 29 89", "Fever 18 30 24 27 99"]);
  assert.match(renderBoxScore(readBoxScore("1042600122")).text, /<td class="total lost">89/);
});

test("a game in overtime gets a column for it", () => {
  const [lineScore] = listRows(renderBoxScore(readBoxScore("1042600112")), "line-score");
  assert.deepEqual(lineScore, [
    "1 2 3 4 OT T",
    "Valkyries 26 19 29 19 7 100",
    "Wings 23 27 22 21 15 108",
  ]);
});

test("while a game is on, its line score marks the quarter under way and leaves the rest blank", () => {
  const markup = renderBoxScore(readLiveBoxScore());
  const [lineScore] = listRows(markup, "line-score");
  assert.deepEqual(lineScore.slice(1), ["Valkyries 26 19 29 - - 100", "Wings 23 27 22 - - 108"]);
  assert.match(markup.text, /<th class="now">3<\/th>/);
  assert.match(readText(markup), /Team stats So far/);
});

test("team stats face off with each side's shooting, and the better side leads each row", () => {
  const markup = renderBoxScore(readBoxScore("1042600122"));
  const text = readText(markup);
  assert.match(text, /42\.4% 25-59 Field goals 52\.1% 37-71/);
  assert.match(text, /26 Points in the paint 58/);
  assert.match(text, /Biggest lead: Aces 11, Fever 15 \| Lead changes: 4 \| Ties: 4/);
  assert.doesNotMatch(text, /Timeouts left/);
  assert.deepEqual(readTapeBars(markup, "Field goals"), ["42", "lead 52"]);
  assert.deepEqual(readTapeBars(markup, "Points in the paint"), ["45", "lead 100"]);
});

test("fewer turnovers lead, and a tie leads neither way", () => {
  assert.deepEqual(readTapeBars(renderBoxScore(readBoxScore("1042600122")), "Turnovers"), [
    "100",
    "100",
  ]);
  const box = readBoxScore("1042600122");
  box.away.stats.turnovers = 9;
  assert.deepEqual(readTapeBars(renderBoxScore(box), "Turnovers"), ["lead 75", "100"]);
});

test("each team's top three scorers show, and a live game flags a player in foul trouble", () => {
  const final = renderBoxScore(readBoxScore("1042600122"));
  const [aces, fever] = listRows(final, "players");
  assert.deepEqual(aces, [
    "Aces Min Pts Reb Ast",
    "Jackie Young 36 31 4 5",
    "A'ja Wilson 34 22 9 2",
    "Chelsea Gray 37 10 1 7",
  ]);
  assert.equal(fever[1], "Caitlin Clark Fouled out 33 27 7 15");

  const [, wings] = listRows(renderBoxScore(readLiveBoxScore()), "players");
  assert.deepEqual(wings.slice(1, 3), [
    "Arike Ogunbowale 5 fouls 42 45 7 4",
    "Alysha Clark 4 fouls 31 21 3 2",
  ]);
  assert.match(readText(renderBoxScore(readLiveBoxScore())), /Timeouts left: Valkyries 0, Wings 1/);
  const [, finalWings] = listRows(renderBoxScore(readBoxScore("1042600112")), "players");
  assert.ok(!finalWings.some((row) => /fouls/.test(row)));
});

test("a preview lists the meetings, each by its winner, with the regular season's series", () =>
  checkInTimeZone(EASTERN, () => {
    const preview = describePreview(GAMES.preview, { season: 2026, away: "IND", home: "LVA" });
    const text = readText(renderPreview(preview));
    assert.match(text, /Meetings Fever won the season series 2-1/);
    assert.match(text, /Sep 29 Fever 99-89 1st Rd G2/);
    assert.match(text, /Sep 27 Aces 102-85 1st Rd G1/);
    assert.match(text, /Aug 6 Aces 86-84 on the road/);
    assert.match(text, /Jul 12 Fever 109-75 on the road/);
  }));

test("a preview compares the seasons, the visitors on the road and the hosts at home", () => {
  const preview = describePreview(GAMES.preview, { season: 2026, away: "IND", home: "LVA" });
  const markup = renderPreview(preview);
  const text = readText(markup);
  assert.match(text, /28-16 Record 31-13/);
  assert.match(text, /96\.0 Points 91\.5/);
  assert.match(text, /90\.4 Allowed 85\.8/);
  assert.match(text, /\+5\.5 Margin \+5\.7/);
  assert.match(text, /13-9 Road \/ Home 15-7/);
  assert.deepEqual(readTapeBars(markup, "Allowed"), ["100", "lead 95"]);
  assert.deepEqual(readTapeBars(markup, "Road / Home"), ["59", "lead 68"]);
  const [fever] = listRows(markup, "players");
  assert.deepEqual(fever.slice(0, 2), ["Fever Pts Reb Ast", "Kelsey Mitchell 24.7 1.7 2.8"]);
});

test("a preview missing a part says so, and a split season series says that", () => {
  const preview = describePreview(
    { schedule: null, standings: null, players: null },
    { season: 2026, away: "IND", home: "LVA" },
  );
  const text = readText(renderPreview(preview));
  assert.match(text, /Couldn't load this season's meetings\./);
  assert.match(text, /Couldn't load the standings\./);
  assert.match(text, /Couldn't load the players' averages\./);

  const split = describePreview(GAMES.preview, { season: 2026, away: "IND", home: "LVA" });
  split.meetings = split.meetings.filter((meeting) => meeting.id !== "1022600153");
  assert.match(readText(renderPreview(split)), /Season series split 1-1/);
});

/**
 * The titles of a sheet's parts, and the names of its measures, in order.
 * @param {any} markup
 */
const readShape = (markup) =>
  [...markup.text.matchAll(/<(?:h3|span class="tape-label")>([^<]*)</g)].map(([, name]) => name);

/** @param {any} markup */
const countPlaceholders = (markup) => markup.text.split('class="placeholder"').length - 1;

test("a box score still loading has the loaded one's parts and measures, with placeholders for its numbers", () => {
  const pending = renderPendingBoxScore({ away: "LVA", home: "IND" });
  assert.deepEqual(readShape(pending), readShape(renderBoxScore(readBoxScore("1042600122"))));
  assert.deepEqual(listRows(pending, "line-score")[0], [
    "1 2 3 4 T",
    "Aces 00 00 00 00 00",
    "Fever 00 00 00 00 00",
  ]);
  assert.deepEqual(
    listRows(pending, "players").map((rows) => rows.length),
    [4, 4],
  );
  assert.ok(countPlaceholders(pending) > 0);
});

test("a preview still loading has the loaded one's parts and measures, with placeholders for its numbers", () => {
  const pending = renderPendingPreview({ away: "IND", home: "LVA" });
  const preview = describePreview(GAMES.preview, { season: 2026, away: "IND", home: "LVA" });
  assert.deepEqual(readShape(pending), readShape(renderPreview(preview)));
  assert.deepEqual(
    listRows(pending, "players").map((rows) => rows.length),
    [4, 4],
  );
  assert.ok(countPlaceholders(pending) > 0);
});
