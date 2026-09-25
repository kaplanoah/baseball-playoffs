import { rankTag, teamTag } from "./clubs.js";
import { DAYS, countDaysBetween } from "./dates.js";
import { session } from "./session.js";

const DIV_ORDER = ["AL East", "AL Central", "AL West", "NL East", "NL Central", "NL West"];
const E_TITLE =
  "Division elimination number: combined wins by the division leader and losses by this team that would end its division chances. A dash means clinched, E means out.";
const WC_TITLE =
  "Wild card elimination number: combined wins by the team holding the last spot and losses by this team that would end its wild card chances. A dash means clinched, E means out.";

function gbCell(v) {
  if (v == null || v === "") return `<td class="tabular"></td>`;
  return `<td class="tabular">${v === "-" ? "&mdash;" : v}</td>`;
}

function elimCell(v) {
  if (v === "E") return `<td class="elim-num mid">E</td>`;
  if (v == null || v === "-") return `<td class="elim-num clinched mid">&mdash;</td>`;
  return `<td class="elim-num live tabular mid">${v}</td>`;
}

export function nextCell(t, now = Date.now()) {
  // A game that has started isn't next, even before the standings refresh.
  let n = t.next;
  const started = (g) => g && g.at && !g.tbd && Date.parse(g.at) <= now;
  if (started(n)) n = started(t.then) ? null : t.then;
  if (!n || !n.at) return `<td class="next-cell"></td>`;
  const d = new Date(n.at);
  if (Number.isNaN(d.getTime())) return `<td class="next-cell"></td>`;
  const days = countDaysBetween(d, new Date());
  const day = days === 0 ? "Today" : DAYS[d.getDay()].slice(0, 3);
  const time = n.tbd
    ? ""
    : " " +
      d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
  return `<td class="next-cell">${day}${time} ${n.home ? "vs" : "@"} ${n.opp || ""}</td>`;
}

function standRow(t, cells, opts = {}) {
  const seed = session.state.teams[t.id] && session.state.teams[t.id].seed;
  const cls = opts.out ? "eliminated" : "alive";
  const row = `<tr class="${cls} ${opts.cut ? "cut" : ""}">
    <td class="rank-cell">${rankTag(t.id)}</td>
    <td class="seed-cell">${seed || ""}</td>
    <td class="team">${teamTag(t.id)}</td>
    ${cells}
  </tr>`;
  // One cell spanning the table, so the dashes run at a single even pitch.
  return opts.cut ? `${row}<tr class="cutline"><td colspan="${opts.cols}"></td></tr>` : row;
}

// Shared column classes, sized in styles.css, line the columns up across every table.
function stCols(next) {
  return (
    `<colgroup><col class="c-rank"><col class="c-seed"><col class="c-team">` +
    `<col class="c-w"><col class="c-l"><col class="c-pct"><col class="c-gb"><col class="c-e">` +
    `${next ? "<col>" : ""}</colgroup>`
  );
}

export function divisionBlock(name, rows) {
  const lg = name.slice(0, 2);
  const leader = rows[0] || {};
  const tag = leader.clinched
    ? `<span class="clinch-tag">clinched</span>`
    : /^\d+$/.test(leader.magic || "")
      ? `<span class="magic-tag">magic ${leader.magic}</span>`
      : "";
  const anyNext = rows.some((t) => t.next && t.next.at);
  return `<div class="div-block">
    <div class="div-title">
      <span class="${lg}">${name}</span><span class="title-right">${tag}</span>
    </div>
    <div class="st-scroll"><table class="st">
      ${stCols(anyNext)}
      <thead><tr>
        <th></th><th>Seed</th><th class="left">Team</th><th class="mid">W</th><th class="mid">L</th><th class="mid pct">PCT</th><th>GB</th>
        <th class="mid" title="${E_TITLE}">E#</th>${anyNext ? '<th class="left next-cell">Next</th>' : ""}
      </tr></thead>
      <tbody>${rows
        .map((t) =>
          standRow(
            t,
            `<td class="tabular mid">${t.w ?? ""}</td><td class="tabular mid">${t.l ?? ""}</td>` +
              `<td class="tabular mid">${t.pct ?? ""}</td>${gbCell(t.gb)}` +
              elimCell(t.elim) +
              (anyNext ? (t.elim === "E" ? `<td class="next-cell"></td>` : nextCell(t)) : ""),
            { out: t.elim === "E" },
          ),
        )
        .join("")}</tbody>
    </table></div>
  </div>`;
}

function wildCardBlock(lg, all) {
  const pool = DIV_ORDER.filter((d) => d.startsWith(lg))
    .flatMap((d) => (all[d] || []).filter((t) => !t.lead))
    // Eliminated clubs go last: MLB's wildCardRank can rank one above a live
    // club on a tiebreaker that no longer matters to the race.
    .sort((a, b) => {
      const ae = a.wce === "E" ? 1 : 0,
        be = b.wce === "E" ? 1 : 0;
      return ae !== be ? ae - be : Number(a.wcrank || 99) - Number(b.wcrank || 99);
    })
    .slice(0, 7);
  if (!pool.length) return "";
  const anyNext = pool.some((t) => t.next && t.next.at);
  const cols = 8 + (anyNext ? 1 : 0);
  return `<div class="div-block">
    <div class="div-title"><span class="${lg}">${lg} Wild Card</span></div>
    <div class="st-scroll"><table class="st">
      ${stCols(anyNext)}
      <thead><tr>
        <th></th><th>Seed</th><th class="left">Team</th><th class="mid">W</th><th class="mid">L</th><th class="mid pct">PCT</th><th>WCGB</th>
        <th class="mid" title="${WC_TITLE}">WCE</th>${anyNext ? '<th class="left next-cell">Next</th>' : ""}
      </tr></thead>
      <tbody>${pool
        .map((t, i) =>
          standRow(
            t,
            `<td class="tabular mid">${t.w ?? ""}</td><td class="tabular mid">${t.l ?? ""}</td>` +
              `<td class="tabular mid">${t.pct ?? ""}</td>${gbCell(t.wcgb)}` +
              elimCell(t.wce) +
              (anyNext ? (t.wce === "E" ? `<td class="next-cell"></td>` : nextCell(t)) : ""),
            { cut: i === 2, cols, out: t.wce === "E" },
          ),
        )
        .join("")}</tbody>
    </table></div>
  </div>`;
}

export function renderStandings() {
  const wrap = document.getElementById("standingsWrap");
  const divs = session.standings && session.standings.divisions;
  if (!divs || !Object.keys(divs).length) {
    wrap.innerHTML = `<p class="stand-empty">No session.standings for this season yet. They
      appear here as soon as the page can reach MLB.</p>`;
    return;
  }
  const blocks = DIV_ORDER.filter((d) => divs[d] && divs[d].length)
    .map((d) => divisionBlock(d, divs[d]))
    .join("");
  const races = ["AL", "NL"].map((lg) => wildCardBlock(lg, divs)).join("");
  wrap.innerHTML = `
    <div class="stand-head">Divisions</div>
    <div class="div-grid">${blocks}</div>
    ${races ? `<div class="stand-head second">Wild Card</div><div class="wc-grid">${races}</div>` : ""}`;
}
