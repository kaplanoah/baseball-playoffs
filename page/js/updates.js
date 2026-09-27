import { rankTag, teamTag } from "./clubs.js";
import { DAYS, countDaysBetween } from "./dates.js";
import { describeEntry } from "./entry-text.js";
import { html, setHtml } from "./html.js";
import { saveSeenAt } from "./season-store.js";
import { session, seasonYear } from "./session.js";
import { showSaveResult } from "./stamp-view.js";
import { TEAMS } from "./teams.js";

const MAX_SHOWN = 12;

function renderClubChip(id) {
  return TEAMS[id] ? html`${rankTag(id)}${teamTag(id, "b")}` : html``;
}

// Markup for an entry, or null for one there is nothing to say about.
export const entryText = (entry) =>
  describeEntry(entry, {
    renderClub: renderClubChip,
    teams: session.state?.teams,
    standings: session.standings,
  });

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
    .filter((entry) => entry && (!seen || Date.parse(entry.at) > seen) && entryText(entry))
    .sort(
      (first, second) => Date.parse(findHappenedAt(second)) - Date.parse(findHappenedAt(first)),
    );
}

function renderEntry(entry) {
  const when = formatWhen(findHappenedAt(entry));
  return html`<li><span class="when">${when}</span><span class="what">${entryText(entry)}</span></li>`;
}

function hideUpdates(panel) {
  panel.hidden = true;
  setHtml(panel, html``);
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
  // The oldest update listed, not the last dismissal: a change can be found after a dismissal
  // but have happened before it.
  const since = formatSince(findHappenedAt(fresh[fresh.length - 1]));
  const head = `${fresh.length} update${fresh.length === 1 ? "" : "s"} ${since}`;

  setHtml(
    panel,
    html`
    <div class="updates-head">
      <span class="updates-count">${head}</span>
      <button type="button" class="updates-x" id="dismissUpdates" aria-label="Dismiss updates" title="Dismiss"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
    </div>
    <ul class="updates-list">
      ${shown.map(renderEntry)}
      ${extra > 0 && html`<li class="more">and ${extra} more</li>`}
    </ul>`,
  );
  document.getElementById("dismissUpdates").addEventListener("click", dismissUpdates);
}

function dismissUpdates() {
  const saving = saveSeenAt(new Date().toISOString());
  renderUpdates();
  return showSaveResult(saving);
}
