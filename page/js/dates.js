export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MS_PER_DAY = 86400000;

export function countDaysBetween(earlier, later) {
  const start = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  const end = new Date(later.getFullYear(), later.getMonth(), later.getDate());
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

// A game's day on the viewer's calendar. Until its time is set MLB's `at` is a placeholder,
// which can land on the wrong day out west, so the day comes from MLB's `date`.
export function readGameDay(game) {
  const at = new Date(game.at);
  const isTimed = !game.tbd && !Number.isNaN(at.getTime());
  if (!isTimed && game.date) {
    const [year, month, day] = game.date.split("-").map(Number);
    return new Date(year, month - 1, day);
  }
  if (Number.isNaN(at.getTime())) return null;
  return new Date(at.getFullYear(), at.getMonth(), at.getDate());
}
