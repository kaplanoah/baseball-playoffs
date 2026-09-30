import { countDaysBetween } from "./days.js";

// The header's one line about how fresh the page is, or why it isn't.

const FEED_NAMES = {
  scoreboard: "today's scores",
  schedule: "the schedule",
  bracket: "the bracket",
  standings: "the standings",
};

/**
 * @param {string} iso
 * @param {number} now
 */
function formatUpdatedAt(iso, now) {
  const at = new Date(iso);
  if (countDaysBetween(at, new Date(now)) === 0)
    return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return at.toLocaleDateString([], { month: "short", day: "numeric" });
}

/**
 * @param {{ error?: string, detail?: string } | null} status
 * @returns {string}
 */
function describeFeedProblem(status) {
  if (!status?.error) return "";
  if (status.error !== "wnba_feeds_missing") return "The WNBA isn't answering right now.";
  const feeds = String(status.detail ?? "")
    .split(", ")
    .map((feed) => FEED_NAMES[feed] ?? feed);
  return `The WNBA stopped sending ${feeds.join(" and ")}.`;
}

/**
 * @param {{ season: { updatedAt?: string } | null, status: { error?: string, detail?: string } | null, problem: string, now: number }} state
 * @returns {{ text: string, isProblem: boolean }}
 */
export function describeStamp({ season, status, problem, now }) {
  const trouble = problem || describeFeedProblem(status);
  if (trouble) return { text: trouble, isProblem: true };
  if (!season?.updatedAt) return { text: "", isProblem: false };
  return { text: `Updated ${formatUpdatedAt(season.updatedAt, now)}`, isProblem: false };
}
