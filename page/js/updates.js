import { seriesLabel } from "./bracket.js";
import { rankTag, teamLabel, teamTag } from "./clubs.js";
import { DAYS, countDaysBetween } from "./dates.js";
import { escapeHtml } from "./html.js";
import { saveSeenAt } from "./season-store.js";
import { session, seasonYear } from "./session.js";
import { showSaveResult } from "./stamp-view.js";
import { TEAMS } from "./teams.js";

const MAX_SHOWN = 12;
const BERTHS = {
  bye: "a first-round bye",
  wildcard: "a wild card spot",
  playoff: "a playoff spot",
};

const leagueOf = (id) => (TEAMS[id] ? TEAMS[id].league : "");

function renderClubChip(id) {
  return TEAMS[id] ? rankTag(id) + teamTag(id, "b") : "";
}
const isPair = (value) => Array.isArray(value) && value.length === 2;
function formatSeriesScore(score) {
  return isPair(score) ? `${escapeHtml(score[0])}&ndash;${escapeHtml(score[1])}` : "";
}
function formatGameScore(score) {
  return isPair(score) ? `${escapeHtml(score[0])}-${escapeHtml(score[1])}` : "";
}

// `via` entries are { team, won, opp, score: [own, opp] }, own score first even in a loss.
function describeResult(result) {
  const opponent = teamLabel(result.opp);
  return result.won
    ? `beat the ${opponent} ${formatGameScore(result.score)}`
    : `lost to the ${opponent} ${formatGameScore([result.score[1], result.score[0]])}`;
}

function describeVia(entry, mover, other) {
  const results = Array.isArray(entry.via) ? entry.via : [];
  const own = results.find((result) => result && result.team === mover);
  const theirs = results.find((result) => result && result.team === other);
  if (own && own.won && own.opp === other) return `beat them ${formatGameScore(own.score)}`;
  const parts = [];
  if (own && TEAMS[own.opp]) parts.push(describeResult(own));
  if (theirs && TEAMS[theirs.opp] && TEAMS[other])
    parts.push(`${teamLabel(other)} ${describeResult(theirs)}`);
  return parts.join(" and ");
}

function appendVia(sentence, entry, mover, other, also = "") {
  const tail = [describeVia(entry, mover, other), also].filter(Boolean).join(", ");
  return tail ? `${sentence} &mdash; ${tail}` : sentence;
}

function findDivision(id) {
  const divisions = session.standings && session.standings.divisions;
  if (!divisions) return "";
  return (
    Object.keys(divisions).find((division) => divisions[division].some((row) => row.id === id)) ||
    ""
  );
}

function describeSpot(entry) {
  const league = leagueOf(entry.in);
  let spot = entry.spot;
  let division = entry.div;
  if (!spot) {
    const seed = session.state?.teams?.[entry.in]?.seed;
    if (!seed) return `the last ${league} spot`;
    spot = seed <= 3 ? "division" : "wildcard";
    division = division || findDivision(entry.in);
  }
  // "an AL", "an NL": both are said letter by letter.
  if (spot === "division")
    return division ? `the ${escapeHtml(division)} lead` : `an ${league} division lead`;
  return `an ${league} wild card spot`;
}

function describeGamesBack(value) {
  const games = parseFloat(value);
  if (isNaN(games) || games <= 0) return "even, behind on the tiebreaker";
  const whole = Math.floor(games);
  const hasHalf = games - whole >= 0.5;
  const count = (whole ? String(whole) : "") + (hasHalf ? "\u00bd" : "");
  return `${count} game${games > 1 ? "s" : ""} back`;
}

function describeOutBack(entry) {
  if (entry.outAlive === false || entry.outBack == null) return "";
  return `${teamLabel(entry.out)} ${describeGamesBack(entry.outBack)}`;
}

function describeFieldEntry(entry) {
  if (entry.in && entry.out) {
    const sentence = `${renderClubChip(entry.in)} take ${describeSpot(entry)} from the ${renderClubChip(entry.out)}`;
    return appendVia(sentence, entry, entry.in, entry.out, describeOutBack(entry));
  }
  if (entry.in) return `${renderClubChip(entry.in)} into the projected field`;
  if (entry.out) return `${renderClubChip(entry.out)} out of the projected field`;
  return "";
}

function describeSeedEntry(entry) {
  const where = `the ${leagueOf(entry.team)} ${escapeHtml(entry.to)} seed`;
  if (entry.over) {
    const sentence = `${renderClubChip(entry.team)} passed the ${renderClubChip(entry.over)} for ${where}`;
    return appendVia(sentence, entry, entry.team, entry.over);
  }
  const sentence = `${renderClubChip(entry.team)} up to ${where}, from ${escapeHtml(entry.from)}`;
  return appendVia(sentence, entry, entry.team, null);
}

function describeSeriesStanding(score) {
  if (!isPair(score)) return "";
  if (score[0] > score[1]) return "lead";
  if (score[0] === score[1]) return "even";
  return "trail";
}

function describeGameEntry(entry) {
  const game = entry.game ? `Game ${escapeHtml(entry.game)}` : "a game";
  const standing = describeSeriesStanding(entry.score);
  const series = seriesLabel(entry.series);
  const tail = standing
    ? ` &mdash; ${standing} the ${series} ${formatSeriesScore(entry.score)}`
    : ` of the ${series}`;
  return `${renderClubChip(entry.won)} took ${game}${tail}`;
}

function describeClinchEntry(entry) {
  const over = entry.over ? ` over the ${renderClubChip(entry.over)}` : "";
  const score = formatSeriesScore(entry.score);
  return `${renderClubChip(entry.team)} win the ${seriesLabel(entry.series)}${score ? `, ${score}` : ""}${over}`;
}

function describeEliminationEntry(entry) {
  const chaser = (entry.via || []).find((result) => result && result.team !== entry.team);
  return appendVia(
    `${renderClubChip(entry.team)} eliminated`,
    entry,
    entry.team,
    chaser ? chaser.team : null,
  );
}

function describeBerthEntry(entry) {
  const berth =
    entry.what === "division"
      ? `the ${entry.div ? escapeHtml(entry.div) : `${leagueOf(entry.team)} division`}`
      : BERTHS[entry.what] || BERTHS.playoff;
  return appendVia(`${renderClubChip(entry.team)} clinch ${berth}`, entry, entry.team, null);
}

const DESCRIBE_ENTRY = {
  field: describeFieldEntry,
  seed: describeSeedEntry,
  game: describeGameEntry,
  clinch: describeClinchEntry,
  elim: describeEliminationEntry,
  berth: describeBerthEntry,
  lock: () => "The official bracket is set",
};

export function entryText(entry) {
  const describe = DESCRIBE_ENTRY[entry.kind];
  return describe ? describe(entry) : "";
}

function formatWhen(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = countDaysBetween(date, now);
  if (days <= 0) return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return DAYS[date.getDay()];
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
function formatSince(iso, now = new Date()) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = countDaysBetween(date, now);
  if (days <= 0) return "since earlier today";
  if (days === 1) return "since yesterday";
  if (days < 7) return `since ${DAYS[date.getDay()]}`;
  return `since ${date.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

// Freshness goes by when a change was noticed; the list shows when it happened.
const findHappenedAt = (entry) => entry.ended || entry.at;

function listFreshEntries() {
  const seen = session.state.seenAt ? Date.parse(session.state.seenAt) : 0;
  return (session.state.log || [])
    .filter((entry) => entry && (!seen || Date.parse(entry.at) > seen))
    .sort(
      (first, second) => Date.parse(findHappenedAt(second)) - Date.parse(findHappenedAt(first)),
    );
}

function renderEntry(entry) {
  const text = entryText(entry);
  const when = formatWhen(findHappenedAt(entry));
  return text ? `<li><span class="when">${when}</span><span class="what">${text}</span></li>` : "";
}

function hideUpdates(panel) {
  panel.hidden = true;
  panel.innerHTML = "";
}

export function renderUpdates() {
  const panel = document.getElementById("updates");
  const fresh = session.activeYear === seasonYear() ? listFreshEntries() : [];
  if (!fresh.length) {
    hideUpdates(panel);
    return;
  }
  panel.hidden = false;

  const shown = fresh.slice(0, MAX_SHOWN);
  const extra = fresh.length - shown.length;
  const since = session.state.seenAt ? ` ${formatSince(session.state.seenAt)}` : "";
  const head = `${fresh.length} update${fresh.length === 1 ? "" : "s"}${since}`;

  panel.innerHTML = `
    <div class="updates-head">
      <span class="updates-count">${head}</span>
      <button type="button" class="updates-x" id="dismissUpdates" aria-label="Dismiss updates" title="Dismiss"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
    </div>
    <ul class="updates-list">
      ${shown.map(renderEntry).join("")}
      ${extra > 0 ? `<li class="more">and ${extra} more</li>` : ""}
    </ul>`;
  document.getElementById("dismissUpdates").addEventListener("click", dismissUpdates);
}

function dismissUpdates() {
  const saving = saveSeenAt(new Date().toISOString());
  renderUpdates();
  return showSaveResult(saving);
}
