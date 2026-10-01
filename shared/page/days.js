// Days and times on the viewer's own calendar and clock, and a league's own day, which is Eastern.
// A league's day, written "YYYY-MM-DD", is a date on a calendar, not an instant, so it's read as one.

const MS_PER_DAY = 86400000;

const EASTERN_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

// The pages' sentences are English, so the words for near days are too, whatever the browser's
// language. Weekdays and dates follow the viewer's locale.
const NEAR_DAY_WORDS = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const NEAR_DAYS = [-1, 0, 1];

/** @param {Date} date */
const readStartOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * The league's day of an instant, as "YYYY-MM-DD", with its hour and year on the Eastern clock.
 * @param {number} ms
 */
export function readEasternDay(ms) {
  const parts = Object.fromEntries(
    EASTERN_PARTS.formatToParts(new Date(ms)).map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    year: Number(parts.year),
  };
}

/**
 * The "YYYY-MM-DD" date some whole days after another, or before it when `days` is negative.
 * @param {string} date
 * @param {number} days
 */
export function addDays(date, days) {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

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

/**
 * A clock time without its AM or PM, for where the time of day goes without saying.
 * @param {Date} date
 */
export const formatClockTimeWithoutMeridiem = (date) =>
  new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" })
    .formatToParts(date)
    .filter(({ type }) => type !== "dayPeriod")
    .map(({ value }) => value)
    .join("")
    .trim();

/** @param {Date} date */
export const formatShortDate = (date) =>
  date.toLocaleDateString([], { month: "short", day: "numeric" });

/** @param {Date} date */
export const formatShortMonth = (date) => date.toLocaleDateString([], { month: "short" });

/** @param {Date} date */
export const formatWeekday = (date) => date.toLocaleDateString([], { weekday: "long" });

/** @param {Date} date */
export const formatShortWeekday = (date) => date.toLocaleDateString([], { weekday: "short" });

/** @param {Date} date */
export const formatWeekdayAndDate = (date) =>
  date.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });

/**
 * A day's weekday within a week of now either way, and its short date further off.
 * @param {Date} date
 * @param {number} daysAway whole days from now, negative for a day gone by
 */
export const formatWeekdayOrDate = (date, daysAway) =>
  Math.abs(daysAway) < 7 ? formatWeekday(date) : formatShortDate(date);

/** @param {string} text */
const capitalize = (text) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/**
 * A day as the viewer would say it from now: "yesterday", "today", or "tomorrow" when it's one of
 * `nearDays`, and whatever `nameOtherDay` calls it otherwise.
 * @param {Date} date
 * @param {Date} now
 * @param {object} [options]
 * @param {number[]} [options.nearDays] whole days from now, negative for a day gone by
 * @param {(date: Date, daysAway: number) => string} [options.nameOtherDay]
 * @param {boolean} [options.isCapitalized] for a name that starts a line
 */
export function nameDay(
  date,
  now,
  { nearDays = NEAR_DAYS, nameOtherDay = formatWeekdayOrDate, isCapitalized = false } = {},
) {
  const daysAway = countDaysBetween(now, date);
  const name = nearDays.includes(daysAway)
    ? NEAR_DAY_WORDS.format(daysAway, "day")
    : nameOtherDay(date, daysAway);
  return isCapitalized ? capitalize(name) : name;
}
