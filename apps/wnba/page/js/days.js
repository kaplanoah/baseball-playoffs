// Games show on the viewer's own calendar. A game whose time isn't set yet has a placeholder start
// at midnight Eastern, so its day is the league's day, not the viewer's.

const EASTERN = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const MS_PER_DAY = 86400000;

/** @param {number} ms */
function readEasternDate(ms) {
  const parts = Object.fromEntries(
    EASTERN.formatToParts(new Date(ms)).map(({ type, value }) => [type, Number(value)]),
  );
  return new Date(parts.year, parts.month - 1, parts.day);
}

/** @param {Date} date */
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Midnight on the viewer's calendar of the day a game is played, or null without a start.
 * @param {{ start: string | null, isTimeSet: boolean }} game
 */
export function readGameDay(game) {
  const start = Date.parse(game.start ?? "");
  if (!Number.isFinite(start)) return null;
  return game.isTimeSet ? startOfDay(new Date(start)) : readEasternDate(start);
}

/**
 * @param {Date} earlier
 * @param {Date} later
 */
export const countDaysBetween = (earlier, later) =>
  Math.round((startOfDay(later).getTime() - startOfDay(earlier).getTime()) / MS_PER_DAY);

const NEAR_DAYS = { "-1": "Yesterday", 0: "Today", 1: "Tomorrow" };

/**
 * @param {Date} day
 * @param {number} now
 */
export function describeDay(day, now) {
  const near = NEAR_DAYS[countDaysBetween(new Date(now), day)];
  if (near) return near;
  return day.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

/** @param {string} start */
export const formatStartTime = (start) =>
  new Date(start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
