import { DAYS, countDaysBetween } from "./dates.js";
import { html } from "./html.js";
import { TEAMS } from "./teams.js";

function formatClock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
export function stampName(id) {
  return TEAMS[id] ? TEAMS[id].name : String(id ?? "");
}
function formatOrdinal(number) {
  const suffixes = ["th", "st", "nd", "rd"];
  const lastTwoDigits = number % 100;
  return number + (suffixes[(lastTwoDigits - 20) % 10] || suffixes[lastTwoDigits] || suffixes[0]);
}

function describeFinal(game, day) {
  const [awayScore, homeScore] = game.score || [0, 0];
  const [winner, winnerScore, loser, loserScore] =
    awayScore > homeScore
      ? [game.away, awayScore, game.home, homeScore]
      : [game.home, homeScore, game.away, awayScore];
  const when = `final at ${formatClock(game.end)}${day ? " " + day : ""}`;
  return `${stampName(winner)} ${winnerScore} ${stampName(loser)} ${loserScore} ${when}`;
}
function describeLive(game) {
  const [awayScore, homeScore] = game.score || [0, 0];
  return `${stampName(game.away)} @ ${stampName(game.home)} ${awayScore}-${homeScore} in the ${formatOrdinal(game.inning || 1)}`;
}
function describeFirstPitch(game) {
  return `${stampName(game.away)} @ ${stampName(game.home)} first pitch at ${formatClock(game.start)}`;
}
function describeGame(game) {
  if (game.state === "final") return describeFinal(game);
  if (game.state === "live") return describeLive(game);
  return describeFirstPitch(game);
}

function describeSlate(games) {
  if (games.length < 3) return "";
  return games.every((game) => game.state === "final")
    ? `slate of ${games.length} over`
    : `slate of ${games.length} under way`;
}
const joinClause = (phrase, clause) => (clause ? `${phrase}, ${clause}` : phrase);

function rankGame(game, context) {
  const ranks = [game.away, game.home]
    .map((id) => context.ranking.indexOf(id))
    .filter((index) => index >= 0);
  return ranks.length ? Math.min(...ranks) : Infinity;
}
const rankAlive = (game, context) => (context.alive(game.away) || context.alive(game.home) ? 0 : 1);
const parseTime = (iso) => Date.parse(iso);

function pickGame(games, context, order) {
  const sortKeys = {
    latestEnd: (game) => -parseTime(game.end),
    earliest: (game) => parseTime(game.start),
    latestStart: (game) => -parseTime(game.start),
    rank: (game) => rankGame(game, context),
    alive: (game) => rankAlive(game, context),
  };
  return games.slice().sort((first, second) => {
    for (const key of order) {
      const difference = sortKeys[key](first) - sortKeys[key](second);
      if (difference) return difference;
    }
    return 0;
  })[0];
}
const PICK_ENDED = ["latestEnd", "rank", "alive"];
const PICK_UNDER_WAY = ["rank", "alive", "latestStart"];
const PICK_STARTS = ["earliest", "rank", "alive"];

function describeLastFinal(lastFinal, now) {
  if (!lastFinal || !lastFinal.end) return "";
  const days = countDaysBetween(new Date(lastFinal.end), now);
  const when = days <= 1 ? "last night" : DAYS[new Date(lastFinal.start || lastFinal.end).getDay()];
  return `No games since ${describeFinal(lastFinal, when)}`;
}

// With three or more games, one leads the line: a fresh final, else a live game, else the latest final.
function pickLeadGame(slate, started, context) {
  const since = slate.since ? parseTime(slate.since) : -Infinity;
  const finals = started.filter((game) => game.state === "final");
  const fresh = finals.filter((game) => parseTime(game.end) > since);
  const live = started.filter((game) => game.state === "live");
  if (fresh.length) return pickGame(fresh, context, PICK_ENDED);
  if (live.length) return pickGame(live, context, PICK_UNDER_WAY);
  return pickGame(finals, context, PICK_ENDED);
}

export function lastStampText(slate, context) {
  const games = (slate.today && slate.today.games) || [];
  const started = games.filter((game) => game.state !== "pre");
  if (!started.length) return describeLastFinal(slate.lastFinal, context.now);
  const describeWithNote = (game) =>
    describeGame(game) + ((game.state === "final" && context.seriesNote?.(game)) || "");
  if (games.length <= 2) {
    return started
      .slice()
      .sort((first, second) => parseTime(first.start) - parseTime(second.start))
      .map(describeWithNote)
      .join(", ");
  }
  return joinClause(describeWithNote(pickLeadGame(slate, started, context)), describeSlate(games));
}

export function upNextText(slate, context) {
  const days = [slate.today, slate.nextDay].filter(Boolean);
  if (days.some((day) => (day.games || []).some((game) => game.state === "live"))) return null;
  for (const day of days) {
    const games = day.games || [];
    const ahead = games.filter((game) => game.state === "pre");
    if (!ahead.length) continue;
    const game = pickGame(ahead, context, PICK_STARTS);
    const matchup = `${stampName(game.away)} @ ${stampName(game.home)}`;
    const hasBegun = games.some((other) => other.state !== "pre");
    return {
      at: game.start,
      tbd: !!game.tbd,
      text:
        !hasBegun && games.length >= 3 ? `${matchup}, starts slate of ${games.length}` : matchup,
    };
  }
  return null;
}

export function stampWhen(date, now = new Date()) {
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const day = stampDay(date, now);
  return day === "today" ? time : `${day} ${time}`;
}
// Sets AM/PM apart so it can be styled smaller.
export function stampWhenHtml(date, now = new Date()) {
  const when = stampWhen(date, now);
  const parts = /^(.*\d)\s*(\D+)$/.exec(when);
  return parts ? html`${parts[1]}<span class="ap">${parts[2]}</span>` : html`${when}`;
}
export function stampDay(date, now = new Date()) {
  const days = countDaysBetween(date, now);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  if (Math.abs(days) < 7) return DAYS[date.getDay()];
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
