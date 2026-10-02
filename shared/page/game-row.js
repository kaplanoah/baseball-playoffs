import { html } from "./html.js";
import { listNetworkLogos } from "./network-logos.js";

/** @typedef {import("./html.js").Markup} Markup */

/** @param {(string | false)[]} names */
const joinClasses = (...names) => names.filter(Boolean).join(" ");

/**
 * One club's half of a game row.
 * @typedef {object} GameRowSide
 * @property {Markup} lines the club, and any facts under it
 * @property {(string | false)[]} [classes] falsy ones are left out
 * @property {Markup | false} [extra] a line of its own under the side, like a starter; false
 *   leaves none, and empty markup still holds the line's place
 */

/**
 * A game in a list, as game-row.css lays it out: the away and home sides face each other across
 * the middle, which holds the time or score, with an optional label over it and status under it.
 * Where to watch it, when given, takes a line of its own under the rest. An action, like a button
 * that opens the game, may cover the whole row.
 * @param {{ id?: string, classes?: (string | false)[], away: GameRowSide, home: GameRowSide, label?: Markup | false, headline: Markup, status?: Markup | false, networks?: string[], action?: Markup | false }} row
 */
export const renderGameRow = ({
  id,
  classes = [],
  away,
  home,
  label = false,
  headline,
  status = false,
  networks = [],
  action = false,
}) =>
  html`<li class="${joinClasses("game-row", ...classes)}"${id && html` data-game="${id}"`}>
    ${renderSide(away, "away")}
    <span class="game-middle"
      >${label && html`<span class="game-label">${label}</span>`}<span class="game-headline">${headline}</span
      >${status && html`<span class="game-status">${status}</span>`}</span
    >
    ${renderSide(home, "home")} ${renderExtra(away, "away")} ${renderExtra(home, "home")}
    ${renderNetworks(networks)} ${action}
  </li>`;

/**
 * @param {GameRowSide} side
 * @param {"away" | "home"} place
 */
const renderSide = (side, place) =>
  html`<span class="${joinClasses("game-side", place, ...(side.classes ?? []))}">${side.lines}</span>`;

/**
 * @param {GameRowSide} side
 * @param {"away" | "home"} place
 */
const renderExtra = (side, place) =>
  side.extra ? html`<span class="game-extra ${place}">${side.extra}</span>` : html``;

/**
 * @param {import("./network-logos.js").NetworkLogo} logo
 * @param {string} file
 * @param {string} classes
 */
const renderLogoImage = (logo, file, classes) =>
  html`<img class="${classes}" src="shared/networks/${file}" alt="${logo.name}"${describeLogoStyle(logo)} />`;

/** @param {import("./network-logos.js").NetworkLogo} logo */
function describeLogoStyle({ scale, nudge }) {
  const properties = [scale && `--logo-scale: ${scale}`, nudge && `--logo-nudge: ${nudge}`];
  const style = properties.filter(Boolean).join("; ");
  return style ? html` style="${style}"` : html``;
}

// A logo with a version for each background shows the page's.
/** @param {import("./network-logos.js").NetworkLogo} logo */
function renderLogo(logo) {
  if (!logo.darkFile) return renderLogoImage(logo, logo.file, "network-logo");
  return html`${renderLogoImage(logo, logo.file, "network-logo for-light")}${renderLogoImage(
    logo,
    logo.darkFile,
    "network-logo for-dark",
  )}`;
}

// Logos stand apart by space alone, and a channel without one shows its name.
/** @param {string[]} networks */
const renderNetworks = (networks) =>
  networks.length
    ? html`<span class="game-networks"
        >${listNetworkLogos(networks).map((network) =>
          typeof network === "string"
            ? html`<span class="network-name">${network}</span>`
            : renderLogo(network),
        )}</span
      >`
    : html``;

/** @param {Event} event */
const findOpenButton = (event) =>
  /** @type {HTMLElement | null} */ (
    /** @type {HTMLElement} */ (event.target).closest(".game-open")
  );

/**
 * Opens a game when its row's button is tapped, and starts loading what it shows as soon as a
 * finger or pointer comes down on the button, so the wait for it is shorter by the tap's length.
 * @param {HTMLElement} lists the element that holds the game rows
 * @param {{ open: (button: HTMLElement) => void, prepare: (button: HTMLElement) => void }} actions
 */
export function watchGameOpens(lists, { open, prepare }) {
  lists.addEventListener("pointerdown", (event) => {
    const button = findOpenButton(event);
    if (button) prepare(button);
  });
  lists.addEventListener("click", (event) => {
    const button = findOpenButton(event);
    if (button) open(button);
  });
}
