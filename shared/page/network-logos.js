// The channels a game can be on that have a logo in networks/, each a public-domain file from
// Wikimedia Commons or one the repo's owner supplied. A channel goes by more than one name across
// the leagues' feeds, and any of them finds its logo; a channel without one shows its name instead.

/**
 * A channel's logo, for a light background, with a version for a dark one beside it, its name
 * ending in -dark, unless the one works on both.
 * @typedef {{ name: string, file: string, darkFile?: string }} NetworkLogo
 */

/**
 * @typedef {object} Channel
 * @property {string} name
 * @property {string} file its logo's file
 * @property {string[]} names what the feeds call it, besides its name
 * @property {boolean} [hasDarkVersion]
 */

/** @type {Channel[]} */
const CHANNELS = [
  { name: "ABC", file: "abc.png", names: [], hasDarkVersion: true },
  { name: "Apple TV", file: "apple-tv.svg", names: [], hasDarkVersion: true },
  { name: "CBS", file: "cbs.png", names: ["CBS Miam"], hasDarkVersion: true },
  { name: "CNBC", file: "cnbc.svg", names: [], hasDarkVersion: true },
  { name: "Disney+", file: "disney-plus.svg", names: [], hasDarkVersion: true },
  { name: "ESPN", file: "espn.svg", names: ["ESPN App"] },
  { name: "ESPN2", file: "espn2.svg", names: [] },
  { name: "FOX", file: "fox.svg", names: [], hasDarkVersion: true },
  { name: "FOX ONE", file: "fox-one.svg", names: [], hasDarkVersion: true },
  { name: "FS1", file: "fs1.svg", names: [] },
  { name: "HBO Max", file: "hbo-max.svg", names: [], hasDarkVersion: true },
  { name: "ION", file: "ion.png", names: [] },
  { name: "NBC", file: "nbc.svg", names: [], hasDarkVersion: true },
  { name: "Paramount+", file: "paramount-plus.svg", names: [], hasDarkVersion: true },
  { name: "Peacock", file: "peacock.svg", names: [], hasDarkVersion: true },
  { name: "TBS", file: "tbs.svg", names: ["TBS (out-of-market only)"], hasDarkVersion: true },
  { name: "truTV", file: "trutv.svg", names: [], hasDarkVersion: true },
  { name: "USA Network", file: "usa.png", names: ["USA Net"] },
  {
    name: "MLB Network",
    file: "mlb-network.png",
    names: ["MLBN", "MLBN (out-of-market only)"],
  },
  { name: "NBA TV", file: "nba-tv.png", names: [] },
  { name: "WNBA League Pass", file: "league-pass.png", names: [] },
  { name: "KPIX+", file: "kpix-plus.png", names: [], hasDarkVersion: true },
  { name: "KSMO", file: "ksmo.png", names: [], hasDarkVersion: true },
  {
    name: "NBCSN",
    file: "nbcsn.png",
    names: ["NBC Sports Network", "NBCSN Extra"],
    hasDarkVersion: true,
  },
  { name: "Netflix", file: "netflix.png", names: [] },
  { name: "PIX11", file: "pix11.png", names: ["WPIX"], hasDarkVersion: true },
  {
    name: "Prime Video",
    file: "prime-video.png",
    names: ["Amazon Prime Video", "Prime Video-Seattle"],
  },
  { name: "SNY", file: "sny.png", names: [], hasDarkVersion: true },
  { name: "TSN", file: "tsn.png", names: [] },
  { name: "NBC10", file: "wcau.png", names: ["NBC 10"], hasDarkVersion: true },
  { name: "FOX 5 Plus", file: "wwor.png", names: ["WWOR-TV"], hasDarkVersion: true },
];

const foldName = (name) => name.trim().toLowerCase();

/**
 * @param {Channel} channel
 * @returns {NetworkLogo}
 */
const describeLogo = ({ name, file, hasDarkVersion }) => ({
  name,
  file,
  ...(hasDarkVersion && { darkFile: file.replace(/(\.\w+)$/, "-dark$1") }),
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
