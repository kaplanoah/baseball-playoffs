import { fullBracket, teamEliminated } from "./bracket.js";
import { session } from "./session.js";
import { stampName, lastStampText, upNextText, stampWhenHtml, stampDay } from "./stamp.js";
import { seriesLabel } from "./updates.js";

function stampContext() {
  const projected = !session.state || session.state.projected !== false;
  const rows =
    session.standings && session.standings.divisions
      ? Object.values(session.standings.divisions).flat()
      : [];
  const alive = (id) => {
    if (!projected)
      return (
        !!(session.state.teams && session.state.teams[id]) && !teamEliminated(session.state, id)
      );
    const r = rows.find((x) => x.id === id);
    return !r || !(r.elim === "E" && r.wce === "E");
  };
  const seriesNote = (g) => {
    if (projected) return "";
    const br = fullBracket(session.state);
    const all = [br.al, br.nl]
      .filter(Boolean)
      .flatMap((b) => [...b.wc, ...b.ds, ...b.cs])
      .concat(br.ws ? [br.ws] : []);
    const s = all.find(
      (x) =>
        x.teamA && x.teamB && [x.teamA, x.teamB].sort().join() === [g.away, g.home].sort().join(),
    );
    if (!s) return "";
    const hi = Math.max(s.winsA, s.winsB),
      lo = Math.min(s.winsA, s.winsB);
    const lead = s.winsA > s.winsB ? s.teamA : s.teamB;
    if (s.winner) return ` \u2014 ${stampName(s.winner)} win the ${seriesLabel(s.id)} ${hi}-${lo}`;
    if (hi === lo) return ` \u2014 series even ${hi}-${lo}`;
    return ` \u2014 ${stampName(lead)} now lead ${hi}-${lo}`;
  };
  return {
    ranking: (session.state && session.state.ranking) || [],
    alive,
    seriesNote,
    now: new Date(),
  };
}

function stampLine(label, when, why) {
  return `<span>${label} <b>${when}</b>${why ? ` &mdash; ${why}` : ""}</span>`;
}

function stampLines() {
  const ctx = stampContext();
  if (session.live && session.live.season === session.activeYear) {
    if (!session.state.slate) return [];
    const latest = lastStampText(session.state.slate, ctx);
    const lines = latest
      ? [`<span><b class="lead">${stampWhenHtml(new Date(session.live.asOf))}</b>${latest}</span>`]
      : [];
    const next = upNextText(session.state.slate, ctx);
    if (next) {
      const at = new Date(next.at);
      lines.push(
        stampLine("Next first pitch", next.tbd ? stampDay(at) : stampWhenHtml(at), next.text),
      );
    }
    return lines;
  }
  const saved = [
    session.state && session.state.updatedAt,
    session.standings && session.standings.updatedAt,
  ]
    .map((t) => Date.parse(t))
    .filter((n) => !isNaN(n));
  if (!saved.length) return [];
  return [
    stampLine(
      "Saved",
      stampWhenHtml(new Date(Math.max(...saved))),
      session.state.slate ? lastStampText(session.state.slate, ctx) : "",
    ),
  ];
}

export function renderStamp() {
  const el = document.getElementById("stamp");
  const lines = session.state ? stampLines() : [];
  const problem = session.liveProblem;
  if (problem) lines.push(`<span class="stamp-err">${problem}</span>`);
  el.hidden = !lines.length;
  el.innerHTML = lines.join("");
}
