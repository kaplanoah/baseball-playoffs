// A team's row eases open to its season and closed again, instead of jumping. A row stays open
// while it closes, marked closing, so its season shows until it's out of sight.

const EASE_MS = 250;
const EASING = "cubic-bezier(0.2, 0.8, 0.2, 1)";

/** @type {WeakMap<HTMLDetailsElement, Animation>} */
const easings = new WeakMap();

const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** @param {HTMLDetailsElement} team */
const isClosing = (team) => team.classList.contains("closing");

/** @param {Element} element */
const readHeight = (element) => element.getBoundingClientRect().height;

/**
 * The row's height with only its summary showing, borders included.
 * @param {HTMLDetailsElement} team
 * @param {HTMLElement} summary
 */
function readClosedHeight(team, summary) {
  const { borderTopWidth, borderBottomWidth } = getComputedStyle(team);
  return readHeight(summary) + parseFloat(borderTopWidth) + parseFloat(borderBottomWidth);
}

/**
 * @param {HTMLDetailsElement} team
 * @param {number} from
 * @param {number} to
 */
function easeHeight(team, from, to) {
  const easing = team.animate(
    [
      { height: `${from}px`, overflow: "hidden" },
      { height: `${to}px`, overflow: "hidden" },
    ],
    { duration: EASE_MS, easing: EASING },
  );
  easings.set(team, easing);
  return easing;
}

/**
 * Eases a row from the height it has now, so one still easing turns back from wherever it is.
 * @param {HTMLDetailsElement} team
 * @param {HTMLElement} summary
 */
function toggleTeam(team, summary) {
  const from = readHeight(team);
  easings.get(team)?.cancel();
  if (team.open && !isClosing(team)) {
    team.classList.add("closing");
    easeHeight(team, from, readClosedHeight(team, summary)).onfinish = () => {
      team.classList.remove("closing");
      team.open = false;
    };
    return;
  }
  team.classList.remove("closing");
  team.open = true;
  easeHeight(team, from, readHeight(team));
}

/**
 * @param {Event} event
 * @returns {{ team: HTMLDetailsElement, summary: HTMLElement } | null}
 */
function findTeamSummary(event) {
  if (!(event.target instanceof Element)) return null;
  const summary = /** @type {HTMLElement | null} */ (event.target.closest(".team > summary"));
  const team = summary?.parentElement;
  return summary && team instanceof HTMLDetailsElement ? { team, summary } : null;
}

/** @param {HTMLElement} wrap */
export function startTeamEasing(wrap) {
  wrap.addEventListener("click", (event) => {
    const found = findTeamSummary(event);
    if (!found || prefersReducedMotion()) return;
    event.preventDefault();
    toggleTeam(found.team, found.summary);
  });
}
