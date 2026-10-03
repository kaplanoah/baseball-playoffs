// The page shows every time in the viewer's own time zone, while MLB's day stays Eastern.
import test from "node:test";
import assert from "node:assert/strict";
import { readGameDay } from "../page/js/dates.js";
import { describeLastStamp } from "../page/js/stamp.js";
import { renderNextCell } from "../page/js/standings.js";
import { normalizeSpaces, readStampText } from "../../../tests/text.js";
import { checkInTimeZone } from "../../../tests/time-zone.js";
import { readEasternDay } from "#shared/days.js";

const MARINERS_WIN = {
  away: "HOU",
  home: "SEA",
  state: "final",
  score: [5, 6],
  start: "2026-09-24T01:40:00Z",
  end: "2026-09-24T05:30:00Z",
};
// 1:17 PM Eastern, the afternoon after a final at 1:30 AM Eastern.
const AFTERNOON_AFTER = new Date("2026-09-24T17:17:00Z");

const describeLastFinal = () =>
  readStampText(
    describeLastStamp(
      { today: { games: [] }, lastFinal: MARINERS_WIN },
      { ranking: [], alive: () => true, now: AFTERNOON_AFTER },
    ),
  );

test("a late final names the day it ended where the viewer is", () => {
  const expected = {
    "America/New_York": "final at 1:30 AM today",
    "America/Los_Angeles": "final at 10:30 PM yesterday",
    "Pacific/Honolulu": "final at 7:30 PM yesterday",
    "Europe/London": "final at 6:30 AM today",
    "Asia/Kolkata": "final at 11:00 AM today",
    "Asia/Tokyo": "final at 2:30 PM yesterday",
    "Pacific/Auckland": "final at 5:30 PM yesterday",
  };
  for (const [zone, when] of Object.entries(expected))
    assert.equal(
      checkInTimeZone(zone, describeLastFinal),
      `Last game Mariners 6 Astros 5 ${when}`,
      zone,
    );
});

test("the Next column names the viewer's own day and time", () => {
  // 9:40 PM Eastern on Thursday, seen at noon Eastern that day.
  const row = { next: { at: "2026-09-25T01:40:00Z", home: false, opp: "ATH" } };
  const noon = Date.parse("2026-09-24T16:00:00Z");
  const expected = {
    "America/New_York": "Today 9:40",
    "America/Los_Angeles": "Today 6:40",
    "Europe/London": "Fri 2:40",
    "Asia/Tokyo": "Today 10:40",
  };
  for (const [zone, when] of Object.entries(expected))
    assert.equal(
      checkInTimeZone(zone, () => normalizeSpaces(renderNextCell(row, { now: noon }))),
      `<td class="next-cell">${when} @ ATH</td>`,
      zone,
    );
});

test("a game's day is the viewer's own once its time is set, and MLB's until then", () => {
  // 8:08 PM Eastern on October 1 is already October 2 in Berlin and Tokyo.
  const timed = { at: "2026-10-02T00:08:00Z", date: "2026-10-01", tbd: false };
  // MLB's placeholder time for a game with no time yet is the evening before out west.
  const untimed = { at: "2026-09-29T07:33:00Z", date: "2026-09-29", tbd: true };
  const expected = {
    "America/New_York": ["10/1", "9/29"],
    "Pacific/Honolulu": ["10/1", "9/29"],
    "Europe/Berlin": ["10/2", "9/29"],
    "Asia/Tokyo": ["10/2", "9/29"],
  };
  const formatDay = (game) => {
    const day = readGameDay(game);
    return `${day.getMonth() + 1}/${day.getDate()}`;
  };
  for (const [zone, days] of Object.entries(expected))
    assert.deepEqual(
      checkInTimeZone(zone, () => [formatDay(timed), formatDay(untimed)]),
      days,
      zone,
    );
});

test("the Next column gives a game with no time yet MLB's day", () => {
  const row = { next: { at: "2026-09-29T07:33:00Z", date: "2026-09-29", tbd: true, opp: "CLE" } };
  const mondayAfternoon = Date.parse("2026-09-28T20:00:00Z");
  for (const zone of ["America/New_York", "Pacific/Honolulu", "America/Anchorage"])
    assert.equal(
      checkInTimeZone(zone, () => normalizeSpaces(renderNextCell(row, { now: mondayAfternoon }))),
      `<td class="next-cell">Tue @ CLE</td>`,
      zone,
    );
});

test("MLB's day is Eastern wherever the page is open", () => {
  // 10 PM Eastern on September 24 is already the 25th in London and Tokyo.
  const lateEvening = Date.parse("2026-09-25T02:00:00Z");
  for (const zone of ["America/Los_Angeles", "Europe/London", "Asia/Tokyo"])
    assert.equal(
      checkInTimeZone(zone, () => readEasternDay(lateEvening).date),
      "2026-09-24",
      zone,
    );
});
