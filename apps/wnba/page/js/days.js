import { countDaysBetween, formatWeekdayAndDate, readPlayingDay } from "#shared/days.js";

const EASTERN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** @param {number} ms */
function readEasternDate(ms) {
  const parts = Object.fromEntries(
    EASTERN.formatToParts(new Date(ms)).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Midnight on the viewer's calendar of the day a game is played, or null without a start. A game
 * whose time isn't set yet has a placeholder start at midnight Eastern, so its day is the league's.
 * @param {{ start: string | null, isTimeSet: boolean }} game
 */
export function readGameDay({ start, isTimeSet }) {
  const startMs = Date.parse(start ?? "");
  const leagueDate = Number.isFinite(startMs) ? readEasternDate(startMs) : null;
  return readPlayingDay({ start, isTimeSet, leagueDate });
}

const NEAR_DAYS = { "-1": "Yesterday", 0: "Today", 1: "Tomorrow" };

/**
 * @param {Date} day
 * @param {number} now
 */
export function describeDay(day, now) {
  return NEAR_DAYS[countDaysBetween(new Date(now), day)] ?? formatWeekdayAndDate(day);
}
