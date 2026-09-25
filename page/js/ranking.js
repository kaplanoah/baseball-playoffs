import { describeTeamStatus } from "./bracket.js";
import { droughtLabel, lastTitle, rankedOrder, rankTag, teamLabel, teamTag } from "./clubs.js";
import { html, setHtml } from "./html.js";
import { session } from "./session.js";
import { TEAMS } from "./teams.js";

export const REORDER_EVENT = "rankingreorder";

const STATUS_CHIPS = {
  champion: { label: "Champs", className: "champ" },
  alive: { label: "Alive", className: "alive" },
  out: { label: "Out", className: "out" },
};
const MOVES = { ArrowUp: -1, ArrowDown: 1 };

function renderStatusChip({ status, round }) {
  const chip = STATUS_CHIPS[status];
  const label = round ? html`${chip.label} &middot; ${round}` : chip.label;
  return html`<span class="status-chip ${chip.className}">${label}</span>`;
}

function renderTitleSummary(id, won) {
  if (!won) return html`Never won WS`;
  return html`<span>Last WS ${won}<span class="sep">&bull;</span></span><span>${droughtLabel(id)}</span>`;
}

function renderRankItem(id, index) {
  const { league } = TEAMS[id];
  const seed = session.state.teams[id].seed;
  const won = lastTitle(id);
  const teamStatus = describeTeamStatus(session.state, id);
  return html`<li class="rank-item ${teamStatus.status === "out" ? "eliminated" : ""}" data-id="${id}">
      <span class="rank-card">
        <button type="button" class="grip" aria-label="Move ${teamLabel(id)}, ranked ${index + 1}. Use the up and down arrow keys.">&#8942;&#8942;</button>
        <span class="rank-id">
          ${teamTag(id)}
          <span class="meta-row">
            <span class="league-tag ${league}">${league}</span>
            <span class="rank-seed tabular">${seed} seed</span>
          </span>
          <span class="rank-ws tabular">${renderTitleSummary(id, won)}</span>
        </span>
        <span class="rank-cols">
          <span class="col-won tabular">${won || html`&mdash;`}</span>
          <span class="col-drought">${droughtLabel(id)}</span>
        </span>
        <span class="status-slot">${renderStatusChip(teamStatus)}</span>
      </span>
    </li>`;
}

export function renderRanking() {
  const list = document.getElementById("rankList");
  const head = document.getElementById("rankHead");
  const gutter = document.getElementById("rankGutter");
  const order = rankedOrder();
  if (!order.length) {
    head.hidden = true;
    setHtml(gutter, html``);
    setHtml(
      list,
      html`<li class="rank-item">Set this year's playoff field first, on the Bracket tab.</li>`,
    );
    return;
  }
  head.hidden = false;
  // Rank numbers live outside the cards so they stay put while cards are dragged.
  const numbers = order.map((_, index) => html`<li class="rank-num tabular">${index + 1}</li>`);
  setHtml(gutter, html`${numbers}`);
  setHtml(list, html`${order.map(renderRankItem)}`);
  wireReordering(list);
}

const announceOrder = (list, order) =>
  list.dispatchEvent(new CustomEvent(REORDER_EVENT, { detail: { order } }));

function moveWithKeyboard(list, event) {
  const grip = event.target instanceof HTMLElement && event.target.closest(".grip");
  const step = MOVES[event.key];
  if (!grip || !step) return;
  event.preventDefault();
  const id = /** @type {HTMLElement} */ (grip.closest(".rank-item")).dataset.id;
  const order = rankedOrder();
  const from = order.indexOf(id);
  const to = from + step;
  if (to < 0 || to >= order.length) return;
  [order[from], order[to]] = [order[to], order[from]];
  announceOrder(list, order);
  /** @type {HTMLElement | null} */ (
    list.querySelector(`.rank-item[data-id="${id}"] .grip`)
  )?.focus();
}

// Bound once: the list element survives re-renders.
let isWired = false;

function wireReordering(list) {
  if (isWired) return;
  isWired = true;
  list.addEventListener("keydown", (event) => moveWithKeyboard(list, event));
  if (typeof Sortable === "undefined") return;
  Sortable.create(list, {
    animation: 140,
    handle: ".grip",
    chosenClass: "dragging",
    ghostClass: "drag-ghost",
    onStart: () => {
      session.isReordering = true;
    },
    onEnd: () => {
      const rows = /** @type {HTMLElement[]} */ ([...list.querySelectorAll(".rank-item")]);
      announceOrder(
        list,
        rows.map((row) => row.dataset.id),
      );
    },
  });
}

export function renderReference() {
  const body = document.getElementById("refBody");
  const rows = Object.entries(TEAMS).sort((first, second) =>
    first[1].name.localeCompare(second[1].name),
  );
  const renderedRows = rows.map(([id, team]) => {
    const won = lastTitle(id);
    const seed = session.state.teams[id] && session.state.teams[id].seed;
    return html`<tr>
      <td class="rank-col">${rankTag(id)}</td>
      <td class="seed-col">${seed || ""}</td>
      <td>${teamTag(id)}</td>
      <td class="lg-col"><span class="league-tag ${team.league}">${team.league}</span></td>
      <td class="tabular won-col">${won || html`&mdash;`}</td>
      <td class="tabular">${droughtLabel(id)}</td>
    </tr>`;
  });
  setHtml(body, html`${renderedRows}`);
}
