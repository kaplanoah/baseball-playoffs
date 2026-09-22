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
  if(!state.ranking.length){
    head.hidden = true;
    list.innerHTML = `<li class="rank-item"><span class="rank-info">Set this year's playoff field first, on the Bracket tab.</span></li>`;
    return;
  }
  head.hidden = false;
  /* Rank in a gutter outside the card, the way the wild card race numbers its
     rows; inside, the club name over its league chip and seed, then the two
     title columns, which line up under the headings above the list. */
  list.innerHTML = state.ranking.map((id, i) => {
    const t = state.teams[id];
    const st = teamStatusLabel(state, id);
    const won = lastTitle(id);
    return `<li class="rank-item ${st.cls === 'out' ? 'eliminated' : ''}" data-id="${id}">
      <span class="rank-num tabular">${i+1}</span>
      <span class="rank-card">
        <span class="grip">&#8942;&#8942;</span>
        ${teamDot(id)}
        <span class="rank-id">
          <span class="team-name">${teamLabel(id)}</span>
          <span class="meta-row">
            <span class="league-tag ${t.league}">${t.league}</span>
            <span class="rank-seed tabular">${t.seed} seed</span>
          </span>
        </span>
        <span class="rank-cols">
          <span class="col-won tabular">${won || "&mdash;"}</span>
          <span class="col-drought">${droughtLabel(id)}</span>
        </span>
        <span class="status-chip ${st.cls}">${shortStatus(st)}</span>
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
      if(order.join() === state.ranking.join()) return;

      // Sortable already placed the row; just renumber in place rather than
      // re-rendering the list out from under it.
      state.ranking = order;
      rows.forEach((row, i) => {
        const n = row.querySelector(".rank-num");
        if(n) n.textContent = i + 1;
      });
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
    return `<tr class="${inField.has(id) ? 'in-playoffs' : ''}">
      <td class="rank-col">${rankTag(id)}</td>
      <td class="seed-col">${(state.teams[id] && state.teams[id].seed) || ""}</td>
      <td><span class="cell">${teamDot(id)} ${t.name}</span></td>
      <td class="lg-col"><span class="league-tag ${t.league}">${t.league}</span></td>
      <td class="tabular">${won || "&mdash;"}</td>
      <td class="tabular">${droughtLabel(id)}</td>
    </tr>`;
  }).join("");
}
