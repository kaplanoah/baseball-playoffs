import {
  countDaysBetween,
  formatShortWeekday,
  formatWeekday,
  formatWeekdayAndDate,
  nameDay,
  readEasternDay,
  readPlayingDay,
} from "#shared/days.js";

/**
 * Midnight on the viewer's calendar of the day a game is played, or null without a start. A game
 * whose time isn't set yet has a placeholder start at midnight Eastern, so its day is the league's.
 * @param {{ start: string | null, isTimeSet: boolean }} game
 */
export function readGameDay({ start, isTimeSet }) {
  const startMs = Date.parse(start ?? "");
  const leagueDate = Number.isFinite(startMs) ? readEasternDay(startMs).date : null;
  return readPlayingDay({ start, isTimeSet, leagueDate });
}

/**
 * @param {Date} day
 * @param {number} now
 */
export const describeDay = (day, now) =>
  nameDay(day, new Date(now), { nameOtherDay: formatWeekdayAndDate, isCapitalized: true });

/**
 * describeDay's name for the middle of a sentence, as in "Next game tomorrow".
 * @param {Date} day
 * @param {number} now
 */
export const describeDayInSentence = (day, now) =>
  nameDay(day, new Date(now), { nameOtherDay: formatWeekdayAndDate });

/**
 * A day's name beside its date, which doesn't need "Today": the Games list it heads already says so.
 * @param {Date} day
 * @param {number} now
 */
export const nameListDay = (day, now) =>
  nameDay(day, new Date(now), {
    nearDays: [-1, 1],
    nameOtherDay: formatWeekday,
    isCapitalized: true,
  });

const NEAR_DAY_ABBREVIATIONS = new Map([
  [-1, "Yest"],
  [1, "Tmrw"],
]);

/**
 * nameListDay's short form, for the narrow column beside a day's games.
 * @param {Date} day
 * @param {number} now
 */
export const abbreviateDay = (day, now) =>
  NEAR_DAY_ABBREVIATIONS.get(countDaysBetween(new Date(now), day)) ?? formatShortWeekday(day);
