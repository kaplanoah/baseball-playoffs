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

/**
 * The text of each of the chart's labels with the class named.
 * @param {string} markup
 * @param {string} name
 */
const readLabels = (markup, name) =>
  [...markup.matchAll(new RegExp(`class="${name}( leader)?"[^>]*>([^<]+)<`, "g"))].map(
    (match) => match[2],
  );

/**
 * A game the home side leads from its first basket by up to `biggest`, and wins.
 * @param {number} biggest
 * @returns {import("../page/js/lead-chart.js").Lead}
 */
const leadBy = (biggest) => ({
  periods: 4,
  isOver: true,
  scores: [
    [0, 0, 0],
    [600, 0, biggest],
    [2400, 0, 2],
  ],
});

test("the chart names each side on its own half, marks each side's biggest lead, and names each period, overtime too", () => {
  const markup = renderLeadChart(describeLead(LEAD.summary), TEAMS).text;

  assert.match(
    markup,
    /aria-label="The Wings led by as many as 8, the Valkyries led by as many as 8"/,
  );
  assert.deepEqual(readLabels(markup, "lead-side"), [
    "&#9650; Wings ahead",
    "&#9660; Valkyries ahead",
  ]);
  assert.deepEqual(readLabels(markup, "lead-peak-label"), ["Wings +8", "Valkyries +8"]);
  assert.deepEqual(readLabels(markup, "lead-period"), ["Q1", "Q2", "Q3", "Q4", "OT"]);
});

test("the side ahead at the line's end takes the accent, and a tied live game gives it to neither", () => {
  const final = renderLeadChart(describeLead(LEAD.summary), TEAMS).text;

  assert.deepEqual(
    [...final.matchAll(/class="(lead-area|lead-side|lead-peak-label)( leader)?"/g)].map(
      ([, name, leader]) => `${name}${leader ?? ""}`,
    ),
    [
      "lead-area leader",
      "lead-area",
      "lead-side leader",
      "lead-side",
      "lead-peak-label leader",
      "lead-peak-label",
    ],
  );

  const tied = renderLeadChart(
    {
      periods: 4,
      isOver: false,
      scores: [
        [0, 0, 0],
        [60, 0, 2],
        [90, 2, 2],
      ],
    },
    TEAMS,
  ).text;
  assert.doesNotMatch(tied, /leader/);
});

test("the scale reaches past the biggest lead far enough to keep its label on the tile", () => {
  assert.deepEqual(readLabels(renderLeadChart(leadBy(8), TEAMS).text, "lead-reach"), [
    "+10",
    "+10",
  ]);
  assert.deepEqual(readLabels(renderLeadChart(leadBy(9), TEAMS).text, "lead-reach"), [
    "+15",
    "+15",
  ]);
  assert.deepEqual(readLabels(renderLeadChart(leadBy(12), TEAMS).text, "lead-reach"), [
    "+15",
    "+15",
  ]);
  assert.deepEqual(readLabels(renderLeadChart(leadBy(13), TEAMS).text, "lead-reach"), [
    "+20",
    "+20",
  ]);
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
  assert.equal(line.split("L").at(-1).split(",")[0], String(30 + (600 / 2400) * 284));
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
