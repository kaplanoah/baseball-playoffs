// The channels a game can be on that have a logo in networks/, each a public-domain file from
// Wikimedia Commons or one the repo's owner supplied. A channel goes by more than one name across
// the leagues' feeds, and any of them finds its logo; a channel without one shows its name instead.

/**
 * A channel's logo, for a light background, with a version for a dark one beside it, its name
 * ending in -dark, unless it works on only one: then drawnFor names that one.
 * @typedef {{ name: string, file: string, darkFile?: string, drawnFor?: "light" | "dark" }} NetworkLogo
 */

/**
 * @typedef {object} Channel
 * @property {string} name
 * @property {string} file its logo's file
 * @property {string[]} names what the feeds call it, besides its name
 * @property {boolean} [hasDarkVersion]
 * @property {"light" | "dark"} [drawnFor]
 */

/** @type {Channel[]} */
const CHANNELS = [
  { name: "ABC", file: "abc.png", names: [], hasDarkVersion: true },
  { name: "Apple TV", file: "apple-tv.svg", names: [], hasDarkVersion: true },
  { name: "CBS", file: "cbs.png", names: ["CBS Miam"], hasDarkVersion: true },
  { name: "CBS 8", file: "kfmb.svg", names: ["KFMB 8.1 (CBS)"], hasDarkVersion: true },
  { name: "CNBC", file: "cnbc.svg", names: [], hasDarkVersion: true },
  { name: "Disney+", file: "disney-plus.svg", names: [], hasDarkVersion: true },
  { name: "ESPN", file: "espn.svg", names: ["ESPN App"] },
  { name: "ESPN2", file: "espn2.svg", names: [] },
  {
    name: "FanDuel Sports Network West",
    file: "fanduel-west.svg",
    names: [],
    drawnFor: "light",
  },
  { name: "FOX", file: "fox.svg", names: [], hasDarkVersion: true },
  { name: "FOX ONE", file: "fox-one.svg", names: [], hasDarkVersion: true },
  { name: "FS1", file: "fs1.svg", names: [] },
  { name: "Gray Media", file: "gray.svg", names: ["Gray TV"] },
  { name: "HBO Max", file: "hbo-max.svg", names: [], hasDarkVersion: true },
  { name: "ION", file: "ion.svg", names: [], hasDarkVersion: true },
  { name: "Arizona's Family 3TV", file: "ktvk.svg", names: [] },
  { name: "NBC", file: "nbc.svg", names: [], hasDarkVersion: true },
  {
    name: "NBC Sports Boston",
    file: "nbcs-boston.svg",
    names: ["NBC Sports BO"],
    hasDarkVersion: true,
  },
  {
    name: "NBC Sports California",
    file: "nbcs-california.svg",
    names: ["NBCSCA", "NBCSCA+"],
    hasDarkVersion: true,
  },
  { name: "Paramount+", file: "paramount-plus.svg", names: [], hasDarkVersion: true },
  { name: "Peacock", file: "peacock.svg", names: [], hasDarkVersion: true },
  {
    name: "Spectrum SportsNet LA",
    file: "sportsnet-la.svg",
    names: ["SportsNet LA"],
    hasDarkVersion: true,
  },
  { name: "TBS", file: "tbs.svg", names: ["TBS (out-of-market only)"], hasDarkVersion: true },
  { name: "truTV", file: "trutv.svg", names: [], hasDarkVersion: true },
  { name: "USA Network", file: "usa.svg", names: ["USA Net"] },
  { name: "Arizona's Family Sports", file: "azfamily.png", names: ["AZ Family Sports Net"] },
  { name: "KARE 11", file: "kare.png", names: [] },
  { name: "FOX LA Plus", file: "kcop.png", names: ["KCOP 13"], hasDarkVersion: true },
  { name: "KCTV5", file: "kctv.png", names: [] },
  { name: "CW33", file: "kdaf.png", names: [], hasDarkVersion: true },
  { name: "KFAA", file: "kfaa.png", names: ["KFAA-TV"] },
  { name: "KING 5", file: "king.png", names: [] },
  { name: "KMOV 4", file: "kmov.png", names: ["KMOV-4"], drawnFor: "dark" },
  { name: "NBC Bay Area", file: "kntv.png", names: ["KNTV"], hasDarkVersion: true },
  { name: "KOMO 4", file: "komo.png", names: ["KOMO-TV"], hasDarkVersion: true },
  { name: "FOX 12 Plus", file: "kpdx.png", names: [] },
  { name: "KPIX+", file: "kpix-plus.png", names: [], hasDarkVersion: true },
  { name: "12 News", file: "kpnx.png", names: ["12 News KPNX"], drawnFor: "light" },
  { name: "KSMO", file: "ksmo.png", names: [], hasDarkVersion: true },
  { name: "Marquee Sports Network", file: "marquee.png", names: [] },
  { name: "MASN", file: "masn.png", names: [], hasDarkVersion: true },
  { name: "MeTV", file: "metv.png", names: ["MeTV Indianapolis"] },
  { name: "BravesVision", file: "bravesvision.png", names: [] },
  { name: "Detroit SportsNet", file: "detroit-sportsnet.png", names: [], hasDarkVersion: true },
  {
    name: "Space City Home Network",
    file: "space-city.png",
    names: ["Space City Home Network 2"],
    hasDarkVersion: true,
  },
  { name: "NESN", file: "nesn.png", names: ["NESN+"], hasDarkVersion: true },
  {
    name: "NBC Sports Bay Area",
    file: "nbcs-bay-area.png",
    names: ["NBCS BA", "NBCS BA+"],
    hasDarkVersion: true,
  },
  {
    name: "NBC Sports Philadelphia",
    file: "nbcs-philadelphia.png",
    names: ["NBCSP"],
    hasDarkVersion: true,
  },
  {
    name: "NBC Sports Philadelphia+",
    file: "nbcs-philadelphia-plus.png",
    names: ["NBCSP+"],
    hasDarkVersion: true,
  },
  {
    name: "NBCSN",
    file: "nbcsn.png",
    names: ["NBC Sports Network", "NBCSN Extra"],
    hasDarkVersion: true,
  },
  { name: "Netflix", file: "netflix.png", names: [] },
  { name: "Peachtree TV", file: "peachtree.png", names: ["PeachtreeTV"] },
  { name: "PIX11", file: "pix11.png", names: ["WPIX"], hasDarkVersion: true },
  {
    name: "Prime Video",
    file: "prime-video.png",
    names: ["Amazon Prime Video", "Prime Video-Seattle"],
    hasDarkVersion: true,
  },
  { name: "SNY", file: "sny.png", names: [], hasDarkVersion: true },
  {
    name: "Spectrum SportsNet",
    file: "spectrum-sportsnet.png",
    names: ["Spectrum Sports Net"],
    hasDarkVersion: true,
  },
  {
    name: "Sportsnet",
    file: "sportsnet.png",
    names: ["SN1", "Sportsnet ONE", "Sportsnet+"],
    hasDarkVersion: true,
  },
  {
    name: "SportsNet Pittsburgh",
    file: "sportsnet-pittsburgh.png",
    names: ["SportsNet-PIT+"],
    drawnFor: "dark",
  },
  { name: "TSN", file: "tsn.png", names: [] },
  { name: "Vegas 34", file: "vegas34.png", names: [] },
  { name: "Atlanta News First", file: "wanf.png", names: [], drawnFor: "light" },
  { name: "CW Miami 33", file: "wbfs.png", names: ["CW 33 WBFS"], hasDarkVersion: true },
  { name: "NBC10", file: "wcau.png", names: ["NBC 10"], hasDarkVersion: true },
  { name: "CW26", file: "wciu.png", names: ["WCIU TV"] },
  { name: "FOX 9+", file: "wftc.png", names: ["Fox 9+"] },
  { name: "WKYC 3", file: "wkyc.png", names: [] },
  { name: "FOX 5 New York", file: "wnyw.png", names: [] },
  { name: "WTHR 13", file: "wthr.png", names: ["WTHR Channel 13"] },
  { name: "FOX 5 Plus", file: "wwor.png", names: ["WWOR-TV"], hasDarkVersion: true },
];

const foldName = (name) => name.trim().toLowerCase();

/**
 * @param {Channel} channel
 * @returns {NetworkLogo}
 */
const describeLogo = ({ name, file, hasDarkVersion, drawnFor }) => ({
  name,
  file,
  ...(hasDarkVersion && { darkFile: file.replace(/(\.\w+)$/, "-dark$1") }),
  ...(drawnFor && { drawnFor }),
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
