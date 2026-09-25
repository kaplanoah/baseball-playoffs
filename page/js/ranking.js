const ROUND_SHORT = {
  "Wild Card": "WC",
  "Division Series": "DS",
  "Championship Series": "CS",
  "World Series": "WS",
};
function shortStatus(st) {
  // \S+ rather than a literal em dash, which a page served without a charset mangles.
  const m = st.label.match(/^Out\s+\S+\s+(.+)$/);
  return m ? `Out &middot; ${ROUND_SHORT[m[1]] || m[1]}` : st.label;
}

function renderRanking() {
  const list = document.getElementById("rankList");
  const head = document.getElementById("rankHead");
  const gutter = document.getElementById("rankGutter");
  if (!rankedOrder().length) {
    head.hidden = true;
    gutter.innerHTML = "";
    list.innerHTML = `<li class="rank-item">Set this year's playoff field first, on the Bracket tab.</li>`;
    return;
  }
  head.hidden = false;
  // Rank numbers live outside the cards so they stay put while cards are dragged.
  gutter.innerHTML = rankedOrder()
    .map((_, i) => `<li class="rank-num tabular">${i + 1}</li>`)
    .join("");
  list.innerHTML = rankedOrder()
    .map((id) => {
      const t = state.teams[id];
      const st = teamStatusLabel(state, id);
      const won = lastTitle(id);
      return `<li class="rank-item ${st.cls === "out" ? "eliminated" : ""}" data-id="${id}">
      <span class="rank-card">
        <span class="grip">&#8942;&#8942;</span>
        <span class="rank-id">
          ${teamTag(id)}
          <span class="meta-row">
            <span class="league-tag ${t.league}">${t.league}</span>
            <span class="rank-seed tabular">${t.seed} seed</span>
          </span>
          <span class="rank-ws tabular">${
            won
              ? `<span>Last WS ${won}<span class="sep">&bull;</span></span><span>${droughtLabel(id)}</span>`
              : "Never won WS"
          }</span>
        </span>
        <span class="rank-cols">
          <span class="col-won tabular">${won || "&mdash;"}</span>
          <span class="col-drought">${droughtLabel(id)}</span>
        </span>
        <span class="status-slot"><span class="status-chip ${st.cls}">${shortStatus(st)}</span></span>
      </span>
    </li>`;
    })
    .join("");
  wireDrag(list);
}

// Bound once: the list element survives re-renders.
let sortable = null;

function wireDrag(list) {
  if (sortable || typeof Sortable === "undefined") return;
  sortable = Sortable.create(list, {
    animation: 140,
    handle: ".grip",
    chosenClass: "dragging",
    ghostClass: "drag-ghost",
    onStart: () => {
      reordering = true;
    },
    onEnd: () => {
      reordering = false;
      const rows = [...list.querySelectorAll(".rank-item")];
      const order = rows.map((el) => el.dataset.id);
      if (order.join() === rankedOrder().join()) return;

      // Sortable has already moved the row, so the list needs no re-render.
      state.ranking = order;
      renderBracket();
      saveRanking(order);
    },
  });
}

function renderReference() {
  const body = document.getElementById("refBody");
  const rows = Object.entries(TEAMS).sort((a, b) => a[1].name.localeCompare(b[1].name));
  body.innerHTML = rows
    .map(([id, t]) => {
      const won = lastTitle(id);
      return `<tr>
      <td class="rank-col">${rankTag(id)}</td>
      <td class="seed-col">${(state.teams[id] && state.teams[id].seed) || ""}</td>
      <td>${teamTag(id)}</td>
      <td class="lg-col"><span class="league-tag ${t.league}">${t.league}</span></td>
      <td class="tabular won-col">${won || "&mdash;"}</td>
      <td class="tabular">${droughtLabel(id)}</td>
    </tr>`;
    })
    .join("");
}
