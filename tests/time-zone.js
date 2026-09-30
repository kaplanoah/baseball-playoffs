// Node reads TZ each time it formats a date, so a test can pick the viewer's time zone.
export const EASTERN = "America/New_York";

/** @param {string} zone */
export function useTimeZone(zone) {
  process.env.TZ = zone;
}

/**
 * @template T
 * @param {string} zone
 * @param {() => T} check
 */
export function checkInTimeZone(zone, check) {
  const previous = process.env.TZ;
  useTimeZone(zone);
  try {
    return check();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}
