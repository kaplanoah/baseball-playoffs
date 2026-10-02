// The sheet a club's name or dot opens: its division, seed, and record, then once the field is
// set how far it has gone in the postseason, its race this season, and every World Series it won.

import { html, joinWithSeparator } from "#shared/html.js";
import { formatOrdinal } from "#shared/ordinal.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { renderTeamDetail, renderTeamStats } from "#shared/team-sheet.js";
import { buildBracket, describeTeamStatus } from "./bracket.js";
import {
  describeDrought,
  listTitles,
  nameTeam,
  renderClub,
  renderRankTag,
  renderStatusChip,
  renderTeamDot,
} from "./clubs.js";
import { nameRound } from "./games-view.js";
import { session } from "./session.js";
import { SEASON_GAMES } from "./snapshot.js";
import { describeDivisionLead, describeNextGame } from "./standings.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("#shared/html.js").Markup} Markup */

const MAGIC_NUMBER_TITLE =
  "Division magic number: combined wins by this team and losses by the club closest behind it that would clinch the division. A dash means clinched.";
const DIVISION_ELIMINATION_TITLE =
  "Division elimination number: combined wins by the division leader and losses by this team that would end its division chances. A dash means clinched, E means out.";
const WILD_CARD_ELIMINATION_TITLE =
  "Wild card elimination number: combined wins by the team holding the last spot and losses by this team that would end its wild card chances. A dash means clinched, E means out.";

/** @param {string} id */
function findDivision(id) {
  const divisions = session.standings?.divisions ?? {};
  const found = Object.entries(divisions).find(([, rows]) => rows.some((row) => row.id === id));
  if (!found) return null;
  const [name, rows] = found;
  // A division's rows come in the order of its standings.
  const place = rows.findIndex((row) => row.id === id) + 1;
  return { name, place, row: rows[place - 1], divisions };
}

const countGamesLeft = (row) => SEASON_GAMES - row.w - row.l;

const renderGamesBack = (value) => (value === "-" ? html`&mdash;` : value || null);

/** @param {string | null | undefined} value an elimination or magic number, a dash, or E */
function renderRaceNumber(value) {
  if (value === "E") return html`<span class="elim-num">E</span>`;
  if (value == null || value === "-") return html`<span class="elim-num clinched">&mdash;</span>`;
  return html`<span class="elim-num live">${value}</span>`;
}

/** @param {string} label @param {string} title */
const renderTitledLabel = (label, title) => html`<span title="${title}">${label}</span>`;

function renderMagicNumber(row) {
  if (row.clinched) return renderRaceNumber("-");
  return /^\d+$/.test(row.magic || "") ? renderRaceNumber(row.magic) : null;
}

// Each race's row starts with the club's place in it: a division leader has only its division's
// race, and anyone else also has the wild card's.
/** @returns {[Markup | string, Markup | string | null][]} */
function listStats({ name, place, row, divisions }) {
  if (row.lead)
    return [
      [name, formatOrdinal(place)],
      ["Lead", renderGamesBack(describeDivisionLead(row, divisions))],
      [renderTitledLabel("M#", MAGIC_NUMBER_TITLE), renderMagicNumber(row)],
    ];
  return [
    [name, formatOrdinal(place)],
    ["GB", renderGamesBack(row.gb)],
    [renderTitledLabel("E#", DIVISION_ELIMINATION_TITLE), renderRaceNumber(row.elim)],
    ["Wild card", row.wcrank ? formatOrdinal(Number(row.wcrank)) : null],
    ["WCGB", renderGamesBack(row.wcgb)],
    [renderTitledLabel("WCE", WILD_CARD_ELIMINATION_TITLE), renderRaceNumber(row.wce)],
  ];
}

/** @param {{ text: unknown, classes: string[] } | null | false} next */
const renderNextDetail = (next) =>
  next &&
  renderTeamDetail(
    "Next",
    html`<span class="${["team-next", ...next.classes].join(" ")}">${next.text}</span>`,
  );

/**
 * @param {ReturnType<typeof findDivision>} division
 * @param {{ isNextShown: boolean, now: number }} options
 */
function renderSeason(division, { isNextShown, now }) {
  if (!division?.row) return false;
  const left = countGamesLeft(division.row);
  const next = isNextShown && describeNextGame(division.row, { now });
  return renderSheetPart(
    "Season",
    html`<div class="team-season">${renderTeamStats(listStats(division))}${renderNextDetail(next)}</div>`,
    left > 0 && html`<span class="tabular">${left} left</span>`,
  );
}

/** @param {string} id */
function renderTitles(id) {
  const titles = listTitles(id);
  const body = titles.length
    ? joinWithSeparator([
        html`<b>${titles.length}</b>`,
        html`<span class="tabular">${titles.join(", ")}</span>`,
      ])
    : "None yet";
  return renderSheetPart(
    "Titles",
    html`<p class="team-titles">${body}</p>`,
    html`<span class="tabular">${describeDrought(id)}</span>`,
  );
}

function describeSeriesResult(series, id) {
  const [own, theirs] =
    series.teamA === id ? [series.winsA, series.winsB] : [series.winsB, series.winsA];
  const score = `${own}-${theirs}`;
  if (series.winner)
    return series.winner === id
      ? { text: `Won ${score}`, kind: "won" }
      : { text: `Lost ${score}`, kind: "lost" };
  if (!series.started) return { text: score, kind: "upcoming" };
  if (own === theirs) return { text: `Tied ${score}`, kind: "" };
  return { text: `${own > theirs ? "Lead" : "Trail"} ${score}`, kind: "" };
}

function renderSeriesRow(series, id) {
  const opponent = series.teamA === id ? series.teamB : series.teamA;
  const result = describeSeriesResult(series, id);
  return html`<li class="series-row">
    <span class="series-round">${nameRound(series)}</span>
    <span class="series-opp">${opponent ? renderClub(opponent) : html`<span class="tbd">TBD</span>`}</span>
    <span class="series-result ${result.kind} tabular">${result.text}</span>
  </li>`;
}

const renderByeRow = (league) =>
  html`<li class="series-row">
    <span class="series-round">${league} WC</span>
    <span class="series-opp"><span class="tbd">Bye</span></span>
    <span class="series-result"></span>
  </li>`;

function listTeamSeries(id) {
  const bracket = buildBracket(session.state);
  const league = TEAMS[id].league === "AL" ? bracket.al : bracket.nl;
  if (!league) return [];
  return [...league.wc, ...league.ds, ...league.cs, bracket.ws]
    .filter(Boolean)
    .filter((series) => series.teamA === id || series.teamB === id);
}

const hasBye = (id) => (session.state.teams[id]?.seed ?? 99) <= 2;

/**
 * @param {string} id
 * @param {ReturnType<typeof findDivision>} division
 * @param {number} now
 */
function renderPlayoffs(id, division, now) {
  const status = describeTeamStatus(session.state, id);
  const next = status === "alive" && division?.row && describeNextGame(division.row, { now });
  const byeRow = hasBye(id) && renderByeRow(TEAMS[id].league);
  return renderSheetPart(
    "Playoffs",
    html`<div class="team-season">
      <ul class="team-series">${byeRow}${listTeamSeries(id).map((series) => renderSeriesRow(series, id))}</ul>
      ${renderNextDetail(next)}
    </div>`,
    renderStatusChip(status),
  );
}

const isInSetField = (id) => session.state?.projected === false && !!session.state.teams?.[id];

/** @param {string} id @param {ReturnType<typeof findDivision>} division */
function listFacts(id, division) {
  const seed = session.state?.teams?.[id]?.seed;
  const { row } = division ?? {};
  return [
    division ? html`<span class="${TEAMS[id].league}">${division.name}</span>` : TEAMS[id].league,
    seed && `${seed} seed`,
    row && html`<span class="tabular">${row.w}-${row.l}</span>`,
    row?.pct && html`<span class="tabular">${row.pct}</span>`,
  ].filter(Boolean);
}

/**
 * The sheet a club opens: its dot, name, and rank over its division, seed, record, and winning
 * percentage, then once the field is set its postseason, then its season, either of them with its
 * next game, and its titles.
 * @param {string} id
 * @param {{ now?: number }} [options]
 */
export function renderTeamSheet(id, { now = Date.now() } = {}) {
  const division = findDivision(id);
  const isPlayoffShown = isInSetField(id);
  return {
    heading: html`${renderTeamDot(id)}<span>${nameTeam(id)}</span>${renderRankTag(id)}`,
    note: joinWithSeparator(listFacts(id, division)),
    body: html`${isPlayoffShown && renderPlayoffs(id, division, now)}
      ${renderSeason(division, { isNextShown: !isPlayoffShown, now })}
      ${renderTitles(id)}`,
  };
}
