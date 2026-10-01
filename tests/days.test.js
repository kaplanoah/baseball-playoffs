import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DAYS,
  countDaysBetween,
  formatClockTime,
  formatShortDate,
  formatWeekdayAndDate,
  readCalendarDate,
  readPlayingDay,
} from "../shared/page/days.js";
import { normalizeSpaces } from "./text.js";
import { checkInTimeZone, EASTERN } from "./time-zone.js";

/** @param {Date | null} date */
const readMonthAndDay = (date) => date && [date.getMonth() + 1, date.getDate()];

// 9:00 PM Eastern on Thursday, October 1.
const THURSDAY_NIGHT = "2026-10-02T01:00:00Z";

test("days between count calendar days, whatever the hour, backward as well as forward", () =>
  checkInTimeZone(EASTERN, () => {
    const lateThursday = new Date(2026, 9, 1, 23, 59);
    assert.equal(countDaysBetween(new Date(2026, 9, 1, 0, 1), lateThursday), 0);
    assert.equal(countDaysBetween(lateThursday, new Date(2026, 9, 2, 0, 1)), 1);
    assert.equal(countDaysBetween(lateThursday, new Date(2026, 8, 30, 12)), -1);
  }));

test("days between stay whole across a daylight saving change", () =>
  checkInTimeZone(EASTERN, () => {
    assert.equal(countDaysBetween(new Date(2026, 9, 31, 12), new Date(2026, 10, 2, 12)), 2);
    assert.equal(countDaysBetween(new Date(2026, 2, 7, 12), new Date(2026, 2, 9, 12)), 2);
  }));

test("a league's date is midnight of that date on the viewer's calendar, in any zone", () => {
  for (const zone of ["America/Los_Angeles", EASTERN, "Asia/Tokyo"])
    checkInTimeZone(zone, () => {
      const day = readCalendarDate("2026-10-01");
      assert.deepEqual(readMonthAndDay(day), [10, 1], zone);
      assert.equal(day.getHours(), 0, zone);
    });
});

test("a game with a set time is played on the viewer's own day", () => {
  const game = { start: THURSDAY_NIGHT, isTimeSet: true, leagueDate: "2026-10-01" };
  const expected = { "America/Los_Angeles": [10, 1], [EASTERN]: [10, 1], "Asia/Tokyo": [10, 2] };
  for (const [zone, day] of Object.entries(expected))
    assert.deepEqual(
      checkInTimeZone(zone, () => readMonthAndDay(readPlayingDay(game))),
      day,
      zone,
    );
});

test("a game without a set time is played on the league's day, wherever the viewer is", () => {
  const game = { start: "2026-10-01T04:00:00Z", isTimeSet: false, leagueDate: "2026-10-01" };
  for (const zone of ["America/Los_Angeles", "Asia/Tokyo"])
    assert.deepEqual(
      checkInTimeZone(zone, () => readMonthAndDay(readPlayingDay(game))),
      [10, 1],
      zone,
    );
});

test("a game falls back on whichever of its start and its league's day it has", () =>
  checkInTimeZone(EASTERN, () => {
    const leagueDate = "2026-10-01";
    assert.deepEqual(readMonthAndDay(readPlayingDay({ isTimeSet: true, leagueDate })), [10, 1]);
    assert.deepEqual(
      readMonthAndDay(readPlayingDay({ start: THURSDAY_NIGHT, isTimeSet: false })),
      [10, 1],
    );
    assert.equal(readPlayingDay({ start: "not a time", isTimeSet: true }), null);
    assert.equal(readPlayingDay({ start: null, isTimeSet: false, leagueDate: null }), null);
  }));

test("times and dates read the viewer's clock and calendar", () =>
  checkInTimeZone("America/Los_Angeles", () => {
    const start = new Date(THURSDAY_NIGHT);
    assert.equal(normalizeSpaces(formatClockTime(start)), "6:00 PM");
    assert.equal(formatShortDate(start), "Oct 1");
    assert.equal(formatWeekdayAndDate(start), "Thu, Oct 1");
    assert.equal(DAYS[start.getDay()], "Thursday");
  }));
