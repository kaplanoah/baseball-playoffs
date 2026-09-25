import { ROUND_LABEL, fullBracket, slotCandidates, teamEliminated } from "./bracket.js";
import { rankedOrder, rankTag, seedMark, teamLabel, teamTag } from "./clubs.js";
import { session } from "./session.js";

function preferredSide(s) {
  const rank = (id) => {
    const i = rankedOrder().indexOf(id);
    return i === -1 ? Infinity : i;
  };
  const a = (s.teamA ? [s.teamA] : slotCandidates(session.state, s.id, "A")).map(rank);
  const b = (s.teamB ? [s.teamB] : slotCandidates(session.state, s.id, "B")).map(rank);
  if (!a.length || !b.length) return null;
  if (Math.max(...a) < Math.min(...b)) return "A";
  if (Math.max(...b) < Math.min(...a)) return "B";
  return null;
}

function matchupRow(s, side) {
  const id = side === "A" ? s.teamA : s.teamB;
  const wins = side === "A" ? s.winsA : s.winsB;
  if (!id) return `<div class="matchup-row"><span class="tbd">TBD</span></div>`;
  const isWinner = s.winner === id;
  const isLoser = s.winner && s.winner !== id;
  const isPreferred = preferredSide(s) === side;
  const seed = session.state.teams[id] && session.state.teams[id].seed;
  return `<div class="matchup-row ${isWinner ? "winner" : ""} ${isLoser ? "eliminated" : ""}">
    <div class="team-id">${rankTag(id, isPreferred)}${seedMark(seed)}${teamTag(id)}</div>
    <span class="nscore tabular ${isWinner ? "lead" : ""}">${wins}</span>
  </div>`;
}

/* Card metrics must match styles.css. Each wild card card sits rowDivY - rowTopY
   above its division card, so its connector runs straight into the top slot. */
const LAY = {
  colW: 209,
  gap: 20,
  cardH: 90,
  rowTopY: 41,
  rowDivY: 57,
  rowBotY: 73,
  stageH: 400, // room for a next-game note under the lowest cards
  yWc1: 24,
  yDs1: 40,
  yMid: 160,
  yDs2: 280,
  yWc2: 264,
};
const colX = (i) => i * (LAY.colW + LAY.gap);
const colR = (i) => colX(i) + LAY.colW;
const crisp = (n) => Math.round(n) + 0.5; // a 1px stroke centered on .5 fills one pixel row

function connector(x1, y1, x2, y2) {
  const xm = (x1 + x2) / 2;
  return `M ${crisp(x1)} ${crisp(y1)} H ${crisp(xm)} V ${crisp(y2)} H ${crisp(x2)}`;
}

// Until the time is set MLB's `at` is a placeholder, so the day comes from `date`:
// converting the placeholder to local time can land on the wrong day out west.
function nextGameNote(s) {
  const next = (session.state.series[s.id] || {}).next;
  if (s.winner || !next) return "";
  const timeKnown = next.tbd === false && next.at;

  let day;
  if (next.date) {
    const [y, m, d] = next.date.split("-").map(Number);
    day = new Date(y, m - 1, d);
  } else if (next.at) {
    const at = new Date(next.at);
    if (isNaN(at)) return "";
    day = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  } else return "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((day - today) / 86400000);

  const time = timeKnown
    ? ", " + new Date(next.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "";
  if (days === 0) return `Next game today${time}`;
  if (days === 1) return `Next game tomorrow${time}`;

  // Drop the weekday once a time is shown, to keep the note on one line.
  const date = day.toLocaleDateString(
    undefined,
    timeKnown
      ? { month: "short", day: "numeric" }
      : { weekday: "short", month: "short", day: "numeric" },
  );
  return days < 0 ? `Next game ${date}${time}` : `Next game ${date}${time} &bull; ${days} days`;
}

// The higher seed hosts within a league; the World Series goes to the better record.
function homeSide(s) {
  if (!s.teamA || !s.teamB) return null;
  const a = session.state.teams[s.teamA],
    b = session.state.teams[s.teamB];
  if (!a || !b) return null;

  if (s.round === "WS") {
    const pct = (t) => (t.w != null && t.l != null && t.w + t.l > 0 ? t.w / (t.w + t.l) : null);
    const pa = pct(a),
      pb = pct(b);
    if (pa == null || pb == null) return null;
    return pa >= pb ? "A" : "B";
  }
  return a.seed <= b.seed ? "A" : "B";
}

// The host goes on the bottom, as in a line score. In the WC and DS, teamA is the higher seed.
function rowOrder(s) {
  const home = homeSide(s);
  if (home) return home === "A" ? ["B", "A"] : ["A", "B"];
  return s.round === "WC" || s.round === "DS" ? ["B", "A"] : ["A", "B"];
}

function box(s, top, col, opts = {}) {
  const [first, second] = rowOrder(s);
  const rows = `${matchupRow(s, first)}${matchupRow(s, second)}`;
  const note = opts.champLine
    ? `<div class="card-note champ">${opts.champLine}</div>`
    : ((n) => (n ? `<div class="card-note">${n}</div>` : ""))(nextGameNote(s));
  return `<div class="box" style="left:${colX(col)}px; top:${top}px; width:${LAY.colW}px;">
    <div class="series">
      <div class="bestof"><span>${ROUND_LABEL[s.round]}</span><span>BO${s.bestOf}</span></div>
      ${rows}
    </div>
    ${note}
  </div>`;
}

export function renderBracket() {
  const wrap = document.getElementById("bracketWrap");
  const setupPrompt = document.getElementById("setupPrompt");
  const hasField = Object.keys(session.state.teams).length >= 12;
  setupPrompt.hidden = hasField;
  if (!hasField) {
    wrap.innerHTML = "";
    renderBanner(null);
    return;
  }

  const br = fullBracket(session.state);
  const alChampLine = br.al.champion ? `${teamLabel(br.al.champion)} advance` : "";
  const nlChampLine = br.nl.champion ? `${teamLabel(br.nl.champion)} advance` : "";
  const wsChampLine = br.ws.winner ? `${teamLabel(br.ws.winner)} win the World Series` : "";

  const W = colR(6);
  const labels = [
    ["AL Wild Card", "al"],
    ["AL Division", "al"],
    ["AL Championship", "al"],
    ["World Series", "champ"],
    ["NL Championship", "nl"],
    ["NL Division", "nl"],
    ["NL Wild Card", "nl"],
  ]
    .map(
      ([text, cls], i) =>
        `<div class="lg-label ${cls}" style="left:${colX(i)}px; width:${LAY.colW}px;">${text}</div>`,
    )
    .join("");

  const wc1Out = LAY.yWc1 + LAY.rowDivY,
    wc2Out = LAY.yWc2 + LAY.rowDivY;
  const ds1Out = LAY.yDs1 + LAY.rowDivY,
    ds2Out = LAY.yDs2 + LAY.rowDivY;
  const midOut = LAY.yMid + LAY.rowDivY;
  const ds1Slot = LAY.yDs1 + LAY.rowTopY,
    ds2Slot = LAY.yDs2 + LAY.rowTopY;

  const paths = [
    connector(colR(0), wc1Out, colX(1), ds1Slot),
    connector(colR(0), wc2Out, colX(1), ds2Slot),
    connector(colR(1), ds1Out, colX(2), midOut),
    connector(colR(1), ds2Out, colX(2), midOut),
    connector(colR(2), midOut, colX(3), midOut),
    connector(colX(6), wc1Out, colR(5), ds1Slot),
    connector(colX(6), wc2Out, colR(5), ds2Slot),
    connector(colX(5), ds1Out, colR(4), midOut),
    connector(colX(5), ds2Out, colR(4), midOut),
    connector(colX(4), midOut, colR(3), midOut),
  ]
    .map((d) => `<path d="${d}"/>`)
    .join("");

  // wc[1] (4/5) feeds DS1 and wc[0] (3/6) feeds DS2, so each sits beside the card it feeds.
  const boxes = [
    box(br.al.wc[1], LAY.yWc1, 0),
    box(br.al.wc[0], LAY.yWc2, 0),
    box(br.al.ds[0], LAY.yDs1, 1),
    box(br.al.ds[1], LAY.yDs2, 1),
    box(br.al.cs[0], LAY.yMid, 2, { champLine: alChampLine }),
    box(br.ws, LAY.yMid, 3, { champLine: wsChampLine }),
    box(br.nl.cs[0], LAY.yMid, 4, { champLine: nlChampLine }),
    box(br.nl.ds[0], LAY.yDs1, 5),
    box(br.nl.ds[1], LAY.yDs2, 5),
    box(br.nl.wc[1], LAY.yWc1, 6),
    box(br.nl.wc[0], LAY.yWc2, 6),
  ].join("");

  wrap.innerHTML = `
    <div class="tree-scroll"><div class="bracket-inner" style="width:${W}px;">
      <div class="lg-labels-row">${labels}</div>
      <div class="bracket-stage" style="height:${LAY.stageH}px;">
        <svg class="bracket-lines" width="${W}" height="${LAY.stageH}" viewBox="0 0 ${W} ${LAY.stageH}">${paths}</svg>
        ${boxes}
      </div>
    </div></div>
  `;
  renderBanner(br);
}

function renderBanner(br) {
  const banner = document.getElementById("banner");
  if (!br || !rankedOrder().length) {
    banner.hidden = true;
    return;
  }
  banner.hidden = false;

  const champ = br.ws && br.ws.winner;
  if (champ) {
    banner.innerHTML = `<span class="banner-label">World Series champions</span>
      <span class="banner-team">${rankTag(champ)}${teamTag(champ)}</span>`;
    return;
  }

  const aliveRanked = rankedOrder().filter((id) => !teamEliminated(session.state, id));
  if (aliveRanked.length === 0) {
    banner.innerHTML = `<span class="banner-label">All eliminated</span>`;
    return;
  }
  const top = aliveRanked[0];
  banner.innerHTML = `<span class="banner-label">Highest still in</span>
    <span class="banner-team">${rankTag(top)}${teamTag(top)}</span>`;
}
