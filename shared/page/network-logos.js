import { html } from "./html.js";

// The channels a game can be on that have a logo in networks/, each a public-domain file from
// Wikimedia Commons or one the repo's owner supplied. A channel goes by more than one name across
// the leagues' feeds, and any of them finds its logo; a channel without one shows its name instead.

/**
 * A channel's logo, for a light background, with a version for a dark one beside it, its name
 * ending in -dark, unless the one works on both.
 * @typedef {{ name: string, file: string, darkFile?: string, scale?: number, nudge?: number }} NetworkLogo
 */

/**
 * @typedef {object} Channel
 * @property {string} name
 * @property {string} file its logo's file
 * @property {string[]} names what the feeds call it, besides its name
 * @property {boolean} [hasDarkVersion]
 * @property {number} [scale] its height against the line's usual logo height, so a square badge
 *   and a long wordmark look about the same size
 * @property {number} [nudge] how far up to move it, as a share of its height, when its weight sits
 *   below its middle (or down, when negative), so it lines up with the rest by eye
 */

/** @type {Channel[]} */
const CHANNELS = [
  { name: "ABC", file: "abc.png", names: [], hasDarkVersion: true, scale: 1.18 },
  { name: "CNBC", file: "cnbc.svg", names: [], hasDarkVersion: true, scale: 1.24, nudge: 0.04 },
  { name: "ESPN", file: "espn.svg", names: [], scale: 0.81, nudge: -0.02 },
  { name: "ESPN2", file: "espn2.svg", names: [], scale: 0.81, nudge: -0.02 },
  { name: "NBC", file: "nbc.svg", names: [], hasDarkVersion: true, scale: 0.94, nudge: 0.08 },
  { name: "Prime Video", file: "prime-video.png", names: [], scale: 1.14, nudge: -0.04 },
  { name: "USA Network", file: "usa.png", names: ["USA Net"], scale: 0.94 },
];

const foldName = (name) => name.trim().toLowerCase();

/**
 * @param {Channel} channel
 * @returns {NetworkLogo}
 */
const describeLogo = ({ name, file, hasDarkVersion, scale, nudge }) => ({
  name,
  file,
  ...(hasDarkVersion && { darkFile: file.replace(/(\.\w+)$/, "-dark$1") }),
  ...(scale && { scale }),
  ...(nudge && { nudge }),
});

export const NETWORK_LOGOS = CHANNELS.map(describeLogo);

const LOGO_BY_NAME = new Map(
  CHANNELS.flatMap((channel, index) =>
    [channel.name, ...channel.names].map((name) => [foldName(name), NETWORK_LOGOS[index]]),
  ),
);

/**
 * Each channel's logo, or its name when it has none, once each: two names for one channel, like
 * ESPN and the ESPN App, show its logo once.
 * @param {string[]} networks
 * @returns {(NetworkLogo | string)[]}
 */
export const listNetworkLogos = (networks) => [
  ...new Set(networks.map((name) => LOGO_BY_NAME.get(foldName(name)) ?? name)),
];

/**
 * @param {NetworkLogo} logo
 * @param {string} file
 * @param {string} classes
 */
const renderLogoImage = (logo, file, classes) =>
  html`<img class="${classes}" src="shared/networks/${file}" alt="${logo.name}"${describeLogoStyle(logo)} />`;

/** @param {NetworkLogo} logo */
function describeLogoStyle({ scale, nudge }) {
  const properties = [scale && `--logo-scale: ${scale}`, nudge && `--logo-nudge: ${nudge}`];
  const style = properties.filter(Boolean).join("; ");
  return style ? html` style="${style}"` : html``;
}

// A logo with a version for each background shows the page's.
/** @param {NetworkLogo} logo */
function renderLogo(logo) {
  if (!logo.darkFile) return renderLogoImage(logo, logo.file, "network-logo");
  return html`${renderLogoImage(logo, logo.file, "network-logo for-light")}${renderLogoImage(
    logo,
    logo.darkFile,
    "network-logo for-dark",
  )}`;
}

/**
 * Where to watch a game, as sheet.css lays it out: its channels in one line, logos standing apart
 * by space alone, and a channel without one by its name.
 * @param {string[]} networks
 */
export const renderNetworks = (networks) =>
  networks.length
    ? html`<div class="networks" role="group" aria-label="Where to watch">
        ${listNetworkLogos(networks).map((network) =>
          typeof network === "string"
            ? html`<span class="network-name">${network}</span>`
            : renderLogo(network),
        )}
      </div>`
    : html``;
