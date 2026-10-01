import { readPlayingDay } from "#shared/days.js";

// A game's day on the viewer's calendar. Until its time is set MLB's `at` is a placeholder,
// which can land on the wrong day out west, so the day comes from MLB's `date`.
export const readGameDay = (game) =>
  readPlayingDay({ start: game.at, isTimeSet: !game.tbd, leagueDate: game.date });
