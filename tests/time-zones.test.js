// The page shows every time in the viewer's own time zone, while MLB's day stays Eastern.
import test from "node:test";
import assert from "node:assert/strict";
import { easternDay } from "../page/js/snapshot.js";
import { lastStampText } from "../page/js/stamp.js";
import { renderNextCell } from "../page/js/standings.js";
import { normalizeSpaces } from "./text.js";
import { checkInTimeZone } from "./time-zone.js";

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
  normalizeSpaces(
    lastStampText(
      { today: { games: [] }, lastFinal: MARINERS_WIN },
      { ranking: [], alive: () => true, now: AFTERNOON_AFTER },
    ),
  );

test("a late final is last night only where it ended after dark", () => {
  const expected = {
    "America/New_York": "final at 1:30 AM last night",
    "America/Los_Angeles": "final at 10:30 PM last night",
    "Pacific/Honolulu": "final at 7:30 PM last night",
    "Europe/London": "final at 6:30 AM today",
    "Asia/Kolkata": "final at 11:00 AM today",
    "Asia/Tokyo": "final at 2:30 PM yesterday",
    "Pacific/Auckland": "final at 5:30 PM yesterday",
  };
  for (const [zone, when] of Object.entries(expected))
    assert.equal(
      checkInTimeZone(zone, describeLastFinal),
      `No games since Mariners 6 Astros 5 ${when}`,
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
      checkInTimeZone(zone, () => normalizeSpaces(renderNextCell(row, noon))),
      `<td class="next-cell">${when} @ ATH</td>`,
      zone,
    );
});

test("MLB's day is Eastern wherever the page is open", () => {
  // 10 PM Eastern on September 24 is already the 25th in London and Tokyo.
  const lateEvening = Date.parse("2026-09-25T02:00:00Z");
  for (const zone of ["America/Los_Angeles", "Europe/London", "Asia/Tokyo"])
    assert.equal(
      checkInTimeZone(zone, () => easternDay(lateEvening).date),
      "2026-09-24",
      zone,
    );
});
