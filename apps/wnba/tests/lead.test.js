import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderBoxScore } from "../page/js/box-score-view.js";
import { renderLeadChart } from "../page/js/lead-chart.js";
import { describeBoxScore } from "../worker/src/box-score.js";
import {
  createLeadServer,
  describeLead,
  findEventId,
  nameScoreboardRequest,
  nameSummaryRequest,
} from "../worker/src/lead.js";

// Valkyries at Wings, Game 2, which the Wings won 108-100 in overtime.
const LEAD = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-espn-lead.json`, "utf8"),
);
const GAMES = JSON.parse(
  readFileSync(`${import.meta.dirname}/fixtures/2026-10-01-games.json`, "utf8"),
);
const TEAMS = { away: "GSV", home: "DAL" };

/** @param {Record<string, any>} answers */
const createFetch = (answers) => async (url) =>
  url in answers
    ? new Response(JSON.stringify(answers[url]))
    : new Response("Not found", { status: 404 });

const ESPN_ANSWERS = {
  [nameScoreboardRequest(LEAD.game.start)]: LEAD.scoreboard,
  [nameSummaryRequest(LEAD.eventId)]: LEAD.summary,
};

/** @param {Record<string, string>} params */
const askForLead = (answers, params) =>
  createLeadServer({ fetchImpl: createFetch(answers) }).serveLead(
    new URL(`https://wnba.test/lead?${new URLSearchParams(params)}`),
  );

test("ESPN's game is the day's one between the same away and home teams, on the league's Eastern day", () => {
  assert.equal(
    nameScoreboardRequest("2026-10-01T01:00:00Z"),
    "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=20260930",
  );
  assert.equal(findEventId(LEAD.scoreboard, TEAMS), "401918020");
  assert.equal(findEventId(LEAD.scoreboard, { away: "DAL", home: "GSV" }), null);
});

test("the lead is each basket's seconds from tip-off with the score after it, overtime included", () => {
  const lead = describeLead(LEAD.summary);

  assert.equal(lead.periods, 5);
  assert.equal(lead.isOver, true);
  assert.deepEqual(lead.scores.slice(0, 3), [
    [0, 0, 0],
    [35, 2, 0],
    [65, 4, 0],
  ]);
  assert.deepEqual(lead.scores.at(-1), [2691, 100, 108]);
  assert.ok(lead.scores.every(([at], index) => !index || at >= lead.scores[index - 1][0]));
});

test("a basket in a period's last minute counts its tenths of a second", () => {
  const summary = {
    plays: [
      {
        scoringPlay: true,
        period: { number: 2 },
        clock: { displayValue: "45.2" },
        awayScore: 30,
        homeScore: 28,
      },
    ],
  };

  assert.deepEqual(describeLead(summary).scores.at(-1), [1155, 30, 28]);
  assert.equal(describeLead(summary).isOver, false);
});

test("the Worker answers a game's lead, says when ESPN has no such game, and turns away a bad ask", async () => {
  const answer = await askForLead(ESPN_ANSWERS, { ...TEAMS, start: LEAD.game.start });
  const body = await answer.json();
  assert.equal(answer.status, 200);
  assert.deepEqual(
    [body.away, body.home, body.start, body.periods],
    ["GSV", "DAL", LEAD.game.start, 5],
  );

  const missing = await askForLead(ESPN_ANSWERS, {
    away: "IND",
    home: "LVA",
    start: LEAD.game.start,
  });
  assert.equal(missing.status, 404);

  const refused = await askForLead({}, { ...TEAMS, start: LEAD.game.start });
  assert.equal(refused.status, 502);

  for (const params of [{ ...TEAMS }, { away: "GSV", home: "GSV", start: LEAD.game.start }]) {
    assert.equal((await askForLead(ESPN_ANSWERS, params)).status, 400);
  }
});

test("the chart marks each side's biggest lead and names each period, overtime too", () => {
  const markup = renderLeadChart(describeLead(LEAD.summary), TEAMS).text;

  assert.match(
    markup,
    /aria-label="The Wings led by as many as 8, the Valkyries led by as many as 8"/,
  );
  assert.deepEqual(
    [...markup.matchAll(/class="lead-peak-label"[^>]*>([^<]+)</g)].map((match) => match[1]),
    ["+8", "+8"],
  );
  assert.deepEqual(
    [...markup.matchAll(/class="lead-period"[^>]*>([^<]+)</g)].map((match) => match[1]),
    ["Q1", "Q2", "Q3", "Q4", "OT"],
  );
  assert.match(markup, /&#9650; Wings ahead<\/span><span>&#9660; Valkyries ahead/);
});

test("a live game's line stops at its latest basket, and a side that never led has no mark", () => {
  /** @type {import("../page/js/lead-chart.js").Lead} */
  const lead = {
    periods: 4,
    isOver: false,
    scores: [
      [0, 0, 0],
      [60, 0, 2],
      [600, 10, 20],
    ],
  };
  const markup = renderLeadChart(lead, TEAMS).text;
  const line = markup.match(/class="lead-line" d="([^"]+)"/)[1];

  assert.match(markup, /aria-label="The Wings led by as many as 10, the Valkyries never led"/);
  assert.equal(markup.match(/class="lead-peak"/g).length, 1);
  assert.equal(line.split("L").at(-1).split(",")[0], String(24 + (600 / 2400) * 290));
});

test("the box score shows the lead under the quarters once it has a basket", () => {
  const box = describeBoxScore(GAMES.boxScores["1042600112"]);
  const lead = describeLead(LEAD.summary);

  assert.match(
    renderBoxScore(box, lead).text,
    /By quarter[\s\S]*Lead through the game[\s\S]*Team stats/,
  );
  assert.doesNotMatch(renderBoxScore(box).text, /Lead through the game/);
  assert.doesNotMatch(
    renderBoxScore(box, { periods: 4, isOver: false, scores: [[0, 0, 0]] }).text,
    /Lead through the game/,
  );
});
