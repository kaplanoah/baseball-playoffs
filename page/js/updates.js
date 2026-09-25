import { rankTag, teamLabel, teamTag } from "./clubs.js";
import { DAYS, countDaysBetween } from "./dates.js";
import { saveSeenAt } from "./season-store.js";
import { session, seasonYear } from "./session.js";
import { TEAMS } from "./teams.js";

export function seriesLabel(id) {
  if (id === "WS") return "World Series";
  const [lg, key] = String(id).split("_");
  if (!key) return id;
  if (key === "CS") return `${lg}CS`;
  if (key.startsWith("DS")) return `${lg}DS`;
  return `${lg} Wild Card Series`;
}
function logChip(id) {
  return TEAMS[id] ? rankTag(id) + teamTag(id, "b") : "";
}
function score(s) {
  return Array.isArray(s) && s.length === 2 ? `${s[0]}&ndash;${s[1]}` : "";
}

// `via` entries are { team, won, opp, score: [own, opp] }, own score first even in a loss.
function pair(n) {
  return Array.isArray(n) && n.length === 2 ? `${n[0]}-${n[1]}` : "";
}
function viaText(e, mover, other) {
  const v = Array.isArray(e.via) ? e.via : [];
  const mine = v.find((x) => x && x.team === mover);
  const theirs = v.find((x) => x && x.team === other);
  if (mine && mine.won && mine.opp === other) return `beat them ${pair(mine.score)}`;
  const parts = [];
  if (mine && TEAMS[mine.opp]) {
    parts.push(
      mine.won
        ? `beat the ${teamLabel(mine.opp)} ${pair(mine.score)}`
        : `lost to the ${teamLabel(mine.opp)} ${pair([mine.score[1], mine.score[0]])}`,
    );
  }
  if (theirs && TEAMS[theirs.opp] && TEAMS[other]) {
    parts.push(
      `${teamLabel(other)} ${
        theirs.won
          ? `beat the ${teamLabel(theirs.opp)} ${pair(theirs.score)}`
          : `lost to the ${teamLabel(theirs.opp)} ${pair([theirs.score[1], theirs.score[0]])}`
      }`,
    );
  }
  return parts.join(" and ");
}
function withVia(sentence, e, mover, other, also) {
  const tail = [viaText(e, mover, other), also].filter(Boolean).join(", ");
  return tail ? `${sentence} &mdash; ${tail}` : sentence;
}

function divisionOf(id) {
  const divs = session.standings && session.standings.divisions;
  if (!divs) return "";
  return Object.keys(divs).find((d) => divs[d].some((r) => r.id === id)) || "";
}
function spotLabel(e) {
  const lg = TEAMS[e.in] ? TEAMS[e.in].league : "";
  let spot = e.spot,
    div = e.div;
  if (!spot) {
    const seed = session.state?.teams?.[e.in]?.seed;
    if (!seed) return `the last ${lg} spot`;
    spot = seed <= 3 ? "division" : "wildcard";
    div = div || divisionOf(e.in);
  }
  // "an AL", "an NL": both are said letter by letter.
  if (spot === "division") return div ? `the ${div} lead` : `an ${lg} division lead`;
  return `an ${lg} wild card spot`;
}
function gamesBack(v) {
  const n = parseFloat(v);
  if (isNaN(n) || n <= 0) return "even, behind on the tiebreaker";
  const whole = Math.floor(n),
    half = n - whole >= 0.5;
  const num = (whole ? String(whole) : "") + (half ? "\u00bd" : "");
  return `${num} game${n > 1 ? "s" : ""} back`;
}
function outBack(e) {
  if (e.outAlive === false || e.outBack == null) return "";
  return `${teamLabel(e.out)} ${gamesBack(e.outBack)}`;
}

export function entryText(e) {
  const lg = (id) => (TEAMS[id] ? TEAMS[id].league : "");
  switch (e.kind) {
    case "field":
      if (e.in && e.out)
        return withVia(
          `${logChip(e.in)} take ${spotLabel(e)} from the ${logChip(e.out)}`,
          e,
          e.in,
          e.out,
          outBack(e),
        );
      if (e.in) return `${logChip(e.in)} into the projected field`;
      if (e.out) return `${logChip(e.out)} out of the projected field`;
      return "";
    case "seed": {
      const where = `the ${lg(e.team)} ${e.to} seed`;
      return e.over
        ? withVia(
            `${logChip(e.team)} passed the ${logChip(e.over)} for ${where}`,
            e,
            e.team,
            e.over,
          )
        : withVia(`${logChip(e.team)} up to ${where}, from ${e.from}`, e, e.team, null);
    }
    case "game": {
      const g = e.game ? `Game ${e.game}` : "a game";
      const st = Array.isArray(e.score)
        ? e.score[0] > e.score[1]
          ? "lead"
          : e.score[0] === e.score[1]
            ? "even"
            : "trail"
        : "";
      const tail = st
        ? ` &mdash; ${st} the ${seriesLabel(e.series)} ${score(e.score)}`
        : ` of the ${seriesLabel(e.series)}`;
      return `${logChip(e.won)} took ${g}${tail}`;
    }
    case "clinch": {
      const over = e.over ? ` over the ${logChip(e.over)}` : "";
      const sc = score(e.score) ? `, ${score(e.score)}` : "";
      return `${logChip(e.team)} win the ${seriesLabel(e.series)}${sc}${over}`;
    }
    case "elim":
      return withVia(
        `${logChip(e.team)} eliminated`,
        e,
        e.team,
        ((e.via || []).find((v) => v && v.team !== e.team) || {}).team || null,
      );
    case "berth": {
      const what =
        e.what === "division"
          ? `the ${e.div || lg(e.team) + " division"}`
          : e.what === "bye"
            ? "a first-round bye"
            : e.what === "wildcard"
              ? "a wild card spot"
              : e.what === "playoff"
                ? "a playoff spot"
                : "a playoff spot";
      return withVia(`${logChip(e.team)} clinch ${what}`, e, e.team, null);
    }
    case "lock":
      return "The official bracket is set";
    default:
      return e.text || "";
  }
}

function whenLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const days = countDaysBetween(d, now);
  if (days <= 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return DAYS[d.getDay()];
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
function sinceLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  const days = countDaysBetween(d, now);
  if (days <= 0) return "since earlier today";
  if (days === 1) return "since yesterday";
  if (days < 7) return `since ${DAYS[d.getDay()]}`;
  return `since ${d.toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

const MAX_SHOWN = 12;
export function renderUpdates() {
  const el = document.getElementById("updates");
  if (session.activeYear !== seasonYear()) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  const seen = session.state.seenAt ? Date.parse(session.state.seenAt) : 0;
  const fresh = (session.state.log || [])
    .filter((e) => e && (!seen || Date.parse(e.at) > seen))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  if (!fresh.length) {
    el.hidden = true;
    el.innerHTML = "";
    return;
  }
  el.hidden = false;

  const shown = fresh.slice(0, MAX_SHOWN);
  const extra = fresh.length - shown.length;
  const head =
    `${fresh.length} update${fresh.length === 1 ? "" : "s"}` +
    (session.state.seenAt ? ` ${sinceLabel(session.state.seenAt)}` : "");

  el.innerHTML = `
    <div class="updates-head">
      <span class="updates-count">${head}</span>
      <button class="updates-x" id="dismissUpdates" aria-label="Dismiss updates" title="Dismiss"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg></button>
    </div>
    <ul class="updates-list">
      ${shown
        .map((e) => {
          const text = entryText(e);
          return text
            ? `<li><span class="when">${whenLabel(e.at)}</span><span class="what">${text}</span></li>`
            : "";
        })
        .join("")}
      ${extra > 0 ? `<li class="more">and ${extra} more</li>` : ""}
    </ul>`;
  document.getElementById("dismissUpdates").addEventListener("click", dismissUpdates);
}

function dismissUpdates() {
  const saving = saveSeenAt(new Date().toISOString());
  renderUpdates();
  return saving;
}
