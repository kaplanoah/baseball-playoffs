/* The Ranking tab -- your order of the field, dragged by the grip -- and the
   All Teams table, which is the same club information without the ordering. */

/* The status chip is a small box, so the round it names comes in short. */
const ROUND_SHORT = {"Wild Card":"WC", "Division Series":"DS",
                     "Championship Series":"CS", "World Series":"WS"};
function shortStatus(st){
  // The dash is matched as "any one token", not a literal em dash, so a page
  // served without a charset can't break this into "Out A-- Wild Card".
  const m = st.label.match(/^Out\s+\S+\s+(.+)$/);
  return m ? `Out &middot; ${ROUND_SHORT[m[1]] || m[1]}` : st.label;
}

/* ---------- ranking: drag a card by its grip to reorder ---------- */
function renderRanking(){
  const list = document.getElementById("rankList");
  const head = document.getElementById("rankHead");
  const gutter = document.getElementById("rankGutter");
  if(!rankedOrder().length){
    head.hidden = true;
    gutter.innerHTML = "";
    list.innerHTML = `<li class="rank-item">Set this year's playoff field first, on the Bracket tab.</li>`;
    return;
  }
  head.hidden = false;
  /* The ranks are a column of their own beside the list, not part of the
     cards: a slot's number stays put while cards are dragged past it, so 1
     is always the top. Inside each card, the club over its league chip and
     seed, then the two title columns, which line up under the headings above
     the list. A phone has no room for the columns, so it gets them as a third
     line instead. */
  gutter.innerHTML = rankedOrder().map((_, i) => `<li class="rank-num tabular">${i + 1}</li>`).join("");
  list.innerHTML = rankedOrder().map((id, i) => {
    const t = state.teams[id];
    const st = teamStatusLabel(state, id);
    const won = lastTitle(id);
    return `<li class="rank-item ${st.cls === 'out' ? 'eliminated' : ''}" data-id="${id}">
      <span class="rank-card">
        <span class="grip">&#8942;&#8942;</span>
        <span class="rank-id">
          ${teamTag(id)}
          <span class="meta-row">
            <span class="league-tag ${t.league}">${t.league}</span>
            <span class="rank-seed tabular">${t.seed} seed</span>
          </span>
          <span class="rank-ws tabular">${won
            ? `<span>Last WS ${won}<span class="sep">&bull;</span></span><span>${droughtLabel(id)}</span>`
            : "Never won WS"}</span>
        </span>
        <span class="rank-cols">
          <span class="col-won tabular">${won || "&mdash;"}</span>
          <span class="col-drought">${droughtLabel(id)}</span>
        </span>
        <span class="status-slot"><span class="status-chip ${st.cls}">${shortStatus(st)}</span></span>
      </span>
    </li>`;
  }).join("");
  wireDrag(list);
}

/* Reordering runs on Sortable (vendored, see sortable.min.js), which handles
   mouse, touch and pen across browsers. Bound once to the list element, which
   survives re-renders, so re-rendering the rows doesn't need to rebind. */
let sortable = null;

function wireDrag(list){
  if(sortable || typeof Sortable === "undefined") return;
  sortable = Sortable.create(list, {
    animation: 140,
    handle: ".grip",   // the six dots, not the whole card
    chosenClass: "dragging",
    ghostClass: "drag-ghost",
    onStart: () => { reordering = true; },
    onEnd: () => {
      reordering = false;
      const rows = [...list.querySelectorAll(".rank-item")];
      const order = rows.map(el => el.dataset.id);
      if(order.join() === rankedOrder().join()) return;

      // Sortable already placed the row, and the numbers never moved, so
      // there is nothing to redraw here.
      state.ranking = order;
      renderBracket();
      saveRanking(order);
    }
  });
}

function renderReference(){
  const body = document.getElementById("refBody");
  const inField = new Set(Object.keys(state.teams || {}));
  const rows = Object.entries(TEAMS).sort((a,b) => a[1].name.localeCompare(b[1].name));
  body.innerHTML = rows.map(([id,t]) => {
    const won = lastTitle(id);
    return `<tr>
      <td class="rank-col">${rankTag(id)}</td>
      <td class="seed-col">${(state.teams[id] && state.teams[id].seed) || ""}</td>
      <td>${teamTag(id)}</td>
      <td class="lg-col"><span class="league-tag ${t.league}">${t.league}</span></td>
      <td class="tabular won-col">${won || "&mdash;"}</td>
      <td class="tabular">${droughtLabel(id)}</td>
    </tr>`;
  }).join("");
}
