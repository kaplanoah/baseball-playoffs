import { renderBracket } from "./bracket-view.js";
import { renderRanking, renderReference } from "./ranking.js";
import { renderStamp } from "./stamp-view.js";
import { renderStandings } from "./standings.js";
import { renderUpdates } from "./updates.js";

export function renderAll() {
  renderStamp();
  renderUpdates();
  renderBracket();
  renderStandings();
  renderRanking();
  renderReference();
}
