import { seriesLabel } from "./bracket.js";
import { teamLabel } from "./clubs.js";
import { html } from "./html.js";
import { TEAMS } from "./teams.js";

// The sentence for an update. The page shows each club as a chip and a notification as its
// name, so the caller says how to show one; `teams` and `standings` fill in a spot the entry
// doesn't name.

const BERTHS = {
  bye: "a first-round bye",
  wildcard: "a wild card spot",
  playoff: "a playoff spot",
};

const leagueOf = (id) => (TEAMS[id] ? TEAMS[id].league : "");

const isPair = (value) => Array.isArray(value) && value.length === 2;
function renderSeriesScore(score) {
  return html`${score[0]}&ndash;${score[1]}`;
}
function formatGameScore(score) {
  return isPair(score) ? `${score[0]}-${score[1]}` : "";
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
  return tail ? html`${sentence} &mdash; ${tail}` : sentence;
}

function findDivision(id, standings) {
  const divisions = standings && standings.divisions;
  if (!divisions) return "";
  return (
    Object.keys(divisions).find((division) => divisions[division].some((row) => row.id === id)) ||
    ""
  );
}

function describeSpot(entry, context) {
  const league = leagueOf(entry.in);
  let spot = entry.spot;
  let division = entry.div;
  if (!spot) {
    const seed = context.teams?.[entry.in]?.seed;
    if (!seed) return `the last ${league} spot`;
    spot = seed <= 3 ? "division" : "wildcard";
    division = division || findDivision(entry.in, context.standings);
  }
  // "an AL", "an NL": both are said letter by letter.
  if (spot === "division") return division ? `the ${division} lead` : `an ${league} division lead`;
  return `an ${league} wild card spot`;
}

function describeGamesBack(value) {
  const games = parseFloat(value);
  if (isNaN(games) || games <= 0) return "even, behind on the tiebreaker";
  const whole = Math.floor(games);
  const hasHalf = games - whole >= 0.5;
  const count = (whole ? String(whole) : "") + (hasHalf ? "½" : "");
  return `${count} game${games > 1 ? "s" : ""} back`;
}

function describeOutBack(entry) {
  if (entry.outAlive === false || entry.outBack == null) return "";
  return `${teamLabel(entry.out)} ${describeGamesBack(entry.outBack)}`;
}

function describeFieldEntry(entry, context) {
  const { renderClub } = context;
  if (entry.in && entry.out) {
    const sentence = html`${renderClub(entry.in)} take ${describeSpot(entry, context)} from the ${renderClub(entry.out)}`;
    return appendVia(sentence, entry, entry.in, entry.out, describeOutBack(entry));
  }
  if (entry.in) return html`${renderClub(entry.in)} into the projected field`;
  if (entry.out) return html`${renderClub(entry.out)} out of the projected field`;
  return null;
}

function describeSeedEntry(entry, { renderClub }) {
  const where = `the ${leagueOf(entry.team)} ${entry.to} seed`;
  if (entry.over) {
    const sentence = html`${renderClub(entry.team)} passed the ${renderClub(entry.over)} for ${where}`;
    return appendVia(sentence, entry, entry.team, entry.over);
  }
  const sentence = html`${renderClub(entry.team)} up to ${where}, from ${entry.from}`;
  return appendVia(sentence, entry, entry.team, null);
}

function describeSeriesStanding(score) {
  if (!isPair(score)) return "";
  if (score[0] > score[1]) return "lead";
  if (score[0] === score[1]) return "even";
  return "trail";
}

function describeGameEntry(entry, { renderClub }) {
  const game = entry.game ? `Game ${entry.game}` : "a game";
  const standing = describeSeriesStanding(entry.score);
  const series = seriesLabel(entry.series);
  const tail = standing
    ? html` &mdash; ${standing} the ${series} ${renderSeriesScore(entry.score)}`
    : ` of the ${series}`;
  return html`${renderClub(entry.won)} took ${game}${tail}`;
}

function describeClinchEntry(entry, { renderClub }) {
  const over = entry.over && html` over the ${renderClub(entry.over)}`;
  const score = isPair(entry.score) && html`, ${renderSeriesScore(entry.score)}`;
  return html`${renderClub(entry.team)} win the ${seriesLabel(entry.series)}${score}${over}`;
}

function describeEliminationEntry(entry, { renderClub }) {
  const chaser = (entry.via || []).find((result) => result && result.team !== entry.team);
  return appendVia(
    html`${renderClub(entry.team)} eliminated`,
    entry,
    entry.team,
    chaser ? chaser.team : null,
  );
}

function describeBerthEntry(entry, { renderClub }) {
  const berth =
    entry.what === "division"
      ? `the ${entry.div || `${leagueOf(entry.team)} division`}`
      : BERTHS[entry.what] || BERTHS.playoff;
  return appendVia(html`${renderClub(entry.team)} clinch ${berth}`, entry, entry.team, null);
}

const DESCRIBE_ENTRY = {
  field: describeFieldEntry,
  seed: describeSeedEntry,
  game: describeGameEntry,
  clinch: describeClinchEntry,
  elim: describeEliminationEntry,
  berth: describeBerthEntry,
  lock: () => html`The official bracket is set`,
};

/**
 * Markup for an entry, or null for one there is nothing to say about.
 * @param {Record<string, any>} entry
 * @param {{ renderClub: (id: string) => unknown, teams?: object, standings?: object }} context
 */
export function describeEntry(entry, context) {
  const describe = DESCRIBE_ENTRY[entry.kind];
  return describe ? describe(entry, context) : null;
}
