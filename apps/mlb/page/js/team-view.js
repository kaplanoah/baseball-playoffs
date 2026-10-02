// The sheet a club's name or dot opens: its division, seed, and record, its race this season and
// the World Series it last won, and once the field is set, how far it has gone in the postseason.

import { html, joinWithSeparator } from "#shared/html.js";
import { formatOrdinal } from "#shared/ordinal.js";
import { renderSheetPart } from "#shared/sheet-part.js";
import { renderTeamDetail, renderTeamStats } from "#shared/team-sheet.js";
import { buildBracket, describeTeamStatus } from "./bracket.js";
import {
  nameTeam,
  renderClub,
  renderRankTag,
  renderStatusChip,
  renderTeamDot,
  renderTitleSummary,
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
  return { name, row: rows.find((row) => row.id === id), divisions };
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

// A division leader's race is its lead and magic number; anyone else's runs on two rows, its
// division's and the wild card's. Once the season is over, only where it finished is left.
/** @returns {[Markup | string, Markup | string | null][]} */
function listStats({ row, divisions }) {
  const isPlaying = countGamesLeft(row) > 0;
  if (row.lead)
    return [
      ["PCT", row.pct],
      ["Lead", renderGamesBack(describeDivisionLead(row, divisions))],
      [renderTitledLabel("M#", MAGIC_NUMBER_TITLE), isPlaying ? renderMagicNumber(row) : null],
    ];
  if (!isPlaying)
    return [
      ["PCT", row.pct],
      ["GB", renderGamesBack(row.gb)],
      ["WCGB", renderGamesBack(row.wcgb)],
    ];
  return [
    ["PCT", row.pct],
    ["GB", renderGamesBack(row.gb)],
    [renderTitledLabel("E#", DIVISION_ELIMINATION_TITLE), renderRaceNumber(row.elim)],
    ["WC", row.wcrank ? formatOrdinal(Number(row.wcrank)) : null],
    ["WCGB", renderGamesBack(row.wcgb)],
    [renderTitledLabel("WCE", WILD_CARD_ELIMINATION_TITLE), renderRaceNumber(row.wce)],
  ];
}

/** @param {{ text: unknown, classes: string[] } | null} next */
const renderNextDetail = (next) =>
  next &&
  renderTeamDetail(
    "Next",
    html`<span class="${["team-next", ...next.classes].join(" ")}">${next.text}</span>`,
  );

/**
 * @param {string} id
 * @param {ReturnType<typeof findDivision>} division
 * @param {{ isNextShown: boolean, now: number }} options
 */
function renderSeason(id, division, { isNextShown, now }) {
  const titles = renderTeamDetail(
    "Titles",
    html`<span class="tabular">${renderTitleSummary(id)}</span>`,
  );
  if (!division?.row)
    return renderSheetPart("Season", html`<div class="team-season">${titles}</div>`);
  const left = countGamesLeft(division.row);
  const next = isNextShown && describeNextGame(division.row, { now });
  return renderSheetPart(
    "Season",
    html`<div class="team-season">
      ${renderTeamStats(listStats(division))}
      <div class="team-details">${renderNextDetail(next)}${titles}</div>
    </div>`,
    left > 0 && html`<span class="tabular">${left} left</span>`,
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
    html`<ul class="team-series">${byeRow}${listTeamSeries(id).map((series) => renderSeriesRow(series, id))}</ul>
      ${next && html`<div class="team-details">${renderNextDetail(next)}</div>`}`,
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
  ].filter(Boolean);
}

/**
 * The sheet a club opens: its dot, name, and rank over its division, seed, and record, then its
 * season, and once the field is set, its postseason, which then shows its next game.
 * @param {string} id
 * @param {{ now?: number }} [options]
 */
export function renderTeamSheet(id, { now = Date.now() } = {}) {
  const division = findDivision(id);
  const isPlayoffShown = isInSetField(id);
  return {
    heading: html`${renderTeamDot(id)}<span>${nameTeam(id)}</span>${renderRankTag(id)}`,
    note: joinWithSeparator(listFacts(id, division)),
    body: html`${renderSeason(id, division, { isNextShown: !isPlayoffShown, now })}
      ${isPlayoffShown && renderPlayoffs(id, division, now)}`,
  };
}
