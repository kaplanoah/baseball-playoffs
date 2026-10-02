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
  { name: "ABC", file: "abc.png", names: [], hasDarkVersion: true, scale: 1.16 },
  {
    name: "Apple TV",
    file: "apple-tv.svg",
    names: [],
    hasDarkVersion: true,
    scale: 1.08,
    nudge: 0.14,
  },
  { name: "CBS", file: "cbs.png", names: ["CBS Miam"], hasDarkVersion: true, scale: 0.92 },
  { name: "CNBC", file: "cnbc.svg", names: [], hasDarkVersion: true, scale: 1.2, nudge: 0.04 },
  {
    name: "Disney+",
    file: "disney-plus.svg",
    names: [],
    hasDarkVersion: true,
    scale: 1.16,
    nudge: 0.14,
  },
  { name: "ESPN", file: "espn.svg", names: ["ESPN App"], scale: 0.87 },
  { name: "ESPN2", file: "espn2.svg", names: [], scale: 0.81 },
  { name: "FOX", file: "fox.svg", names: [], hasDarkVersion: true },
  { name: "FOX ONE", file: "fox-one.svg", names: [], hasDarkVersion: true, scale: 0.87 },
  { name: "FS1", file: "fs1.svg", names: [], scale: 1.04 },
  {
    name: "HBO Max",
    file: "hbo-max.svg",
    names: [],
    hasDarkVersion: true,
    scale: 1.16,
    nudge: -0.09,
  },
  { name: "ION", file: "ion.png", names: [], scale: 1.08, nudge: 0.17 },
  { name: "NBC", file: "nbc.svg", names: [], hasDarkVersion: true, scale: 0.92, nudge: 0.14 },
  {
    name: "Paramount+",
    file: "paramount-plus.svg",
    names: [],
    hasDarkVersion: true,
    scale: 0.92,
    nudge: 0.12,
  },
  { name: "Peacock", file: "peacock.svg", names: [], hasDarkVersion: true, scale: 0.92 },
  {
    name: "TBS",
    file: "tbs.svg",
    names: ["TBS (out-of-market only)"],
    hasDarkVersion: true,
    scale: 1.04,
  },
  { name: "truTV", file: "trutv.svg", names: [], hasDarkVersion: true },
  { name: "USA Network", file: "usa.png", names: ["USA Net"] },
  {
    name: "MLB Network",
    file: "mlb-network.png",
    names: ["MLBN", "MLBN (out-of-market only)"],
    scale: 1.24,
    nudge: -0.17,
  },
  { name: "NBA TV", file: "nba-tv.png", names: [], scale: 1.16 },
  { name: "WNBA League Pass", file: "league-pass.png", names: [], scale: 1.16 },
  {
    name: "KPIX+",
    file: "kpix-plus.png",
    names: [],
    hasDarkVersion: true,
    scale: 0.96,
    nudge: -0.15,
  },
  { name: "KSMO", file: "ksmo.png", names: [], hasDarkVersion: true, scale: 0.87, nudge: 0.15 },
  {
    name: "NBCSN",
    file: "nbcsn.png",
    names: ["NBC Sports Network", "NBCSN Extra"],
    hasDarkVersion: true,
    scale: 0.87,
    nudge: -0.08,
  },
  { name: "Netflix", file: "netflix.png", names: [], scale: 0.87, nudge: -0.08 },
  { name: "PIX11", file: "pix11.png", names: ["WPIX"], hasDarkVersion: true, scale: 0.92 },
  {
    name: "Prime Video",
    file: "prime-video.png",
    names: ["Amazon Prime Video", "Prime Video-Seattle"],
    scale: 1.12,
    nudge: -0.06,
  },
  { name: "SNY", file: "sny.png", names: [], hasDarkVersion: true, nudge: 0.14 },
  { name: "TSN", file: "tsn.png", names: [], scale: 0.87, nudge: -0.08 },
  {
    name: "NBC10",
    file: "wcau.png",
    names: ["NBC 10"],
    hasDarkVersion: true,
    scale: 1.08,
    nudge: 0.12,
  },
  { name: "FOX 5 Plus", file: "wwor.png", names: ["WWOR-TV"], hasDarkVersion: true, scale: 0.92 },
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
