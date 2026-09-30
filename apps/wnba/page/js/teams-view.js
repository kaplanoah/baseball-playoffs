import { html, joinWithSeparator } from "#shared/html.js";
import { renderDot } from "./clubs.js";
import { readPlayoffRuns } from "./series.js";
import { ROUNDS } from "./snapshot.js";
import { TEAMS } from "./teams.js";

/** @typedef {import("./series.js").Series} Series */
/** @typedef {import("./standings-view.js").StandingsRow} StandingsRow */

/**
 * @param {{ round: number, isOut: boolean, isChampion: boolean } | undefined} run
 * @param {boolean} hasField
 */
function describeRun(run, hasField) {
  if (!run) return hasField ? "Missed the playoffs" : "";
  if (run.isChampion) return "Champions";
  const round = ROUNDS[run.round].name;
  return run.isOut ? `Out in the ${round}` : `In the ${round}`;
}

/** @param {StandingsRow | undefined} row */
const describeRecord = (row) => (row ? `${row.wins}-${row.losses}` : "");

/**
 * Every team, in the order of the league's standings: its record, and how far it got.
 * @param {{ series?: Series[], standings?: StandingsRow[] } | null} season
 */
export function renderTeams(season) {
  const rowsByTeam = new Map((season?.standings ?? []).map((row) => [row.team, row]));
  const runs = readPlayoffRuns(season?.series ?? []);
  const place = (code) => rowsByTeam.get(code)?.place ?? Infinity;
  const codes = Object.keys(TEAMS).sort(
    (first, second) => place(first) - place(second) || first.localeCompare(second),
  );
  const items = codes.map((code) => {
    const team = TEAMS[code];
    const row = rowsByTeam.get(code);
    const run = runs.get(code);
    const facts = [row?.conference, describeRecord(row), describeRun(run, runs.size > 0)].filter(
      Boolean,
    );
    const state = run ? (run.isOut ? " out" : run.isChampion ? " champion" : " alive") : " missed";
    return html`<li class="team-row${runs.size ? state : ""}">
      ${renderDot(code)}
      <div class="team-text">
        <span class="team-full-name">${team.city} ${team.name}</span>
        <span class="facts">${joinWithSeparator(facts)}</span>
      </div>
    </li>`;
  });
  return html`<ul class="team-list">
    ${items}
  </ul>`;
}
