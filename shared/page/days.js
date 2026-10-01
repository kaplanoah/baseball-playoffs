// Days and times on the viewer's own calendar and clock. A league's own day, written "YYYY-MM-DD",
// is a date on a calendar, not an instant, so it's read as one.

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MS_PER_DAY = 86400000;

/** @param {Date} date */
const readStartOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Midnight of a "YYYY-MM-DD" date on the viewer's calendar.
 * @param {string} date
 */
export function readCalendarDate(date) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Whole days from one date's calendar day to another's, negative when the second comes first.
 * Rounding absorbs the hour a daylight saving change adds or takes away.
 * @param {Date} earlier
 * @param {Date} later
 */
export const countDaysBetween = (earlier, later) =>
  Math.round((readStartOfDay(later).getTime() - readStartOfDay(earlier).getTime()) / MS_PER_DAY);

/**
 * Midnight on the viewer's calendar of the day a game is played, or null without a start or a
 * league's day. Until its time is set, a game's start is a placeholder that can fall on another
 * day where the viewer is, so the league's day stands in for it.
 * @param {{ start?: string | null, isTimeSet: boolean, leagueDate?: string | null }} game
 */
export function readPlayingDay({ start, isTimeSet, leagueDate }) {
  const startMs = Date.parse(start ?? "");
  const hasStart = Number.isFinite(startMs);
  if (leagueDate && !(isTimeSet && hasStart)) return readCalendarDate(leagueDate);
  return hasStart ? readStartOfDay(new Date(startMs)) : null;
}

/** @param {Date} date */
export const formatClockTime = (date) =>
  date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** @param {Date} date */
export const formatShortDate = (date) =>
  date.toLocaleDateString([], { month: "short", day: "numeric" });

/** @param {Date} date */
export const formatWeekdayAndDate = (date) =>
  date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
