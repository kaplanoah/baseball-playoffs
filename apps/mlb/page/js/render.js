import { renderBracket } from "./bracket-view.js";
import { renderGames } from "./games-view.js";
import { renderRanking } from "./ranking.js";
import { renderSeasonLabel } from "./settings.js";
import { renderStamp } from "./stamp-view.js";
import { renderStandings } from "./standings.js";
import { refreshTeamSheet } from "#shared/team-sheet.js";
import { renderUpdates } from "./updates.js";

export function renderAll() {
  renderStamp();
  renderUpdates();
  renderBracket();
  renderGames();
  renderStandings();
  renderRanking();
  renderSeasonLabel();
  refreshTeamSheet();
}
