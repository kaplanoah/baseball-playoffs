// The channels a game can be on that have a logo in networks/, each from Wikimedia Commons,
// where it's in the public domain. A channel goes by more than one name across the leagues'
// feeds, and any of them finds its logo; a channel without one shows its name instead.

/**
 * A channel's logo. One drawn for a light background has a version for a dark one beside it,
 * named <file>-dark.svg, unless it works on only one: then drawnFor names that one.
 * @typedef {{ name: string, file: string, darkFile?: string, drawnFor?: "light" | "dark" }} NetworkLogo
 */

/**
 * @typedef {object} Channel
 * @property {string} name
 * @property {string} slug its logo's file, without .svg
 * @property {string[]} names what the feeds call it, besides its name
 * @property {boolean} [hasDarkVersion]
 * @property {"light" | "dark"} [drawnFor]
 */

/** @type {Channel[]} */
const CHANNELS = [
  { name: "ABC", slug: "abc", names: [] },
  { name: "Apple TV", slug: "apple-tv", names: [], hasDarkVersion: true },
  { name: "CBS", slug: "cbs", names: ["CBS Miam"], hasDarkVersion: true },
  { name: "CBS 8", slug: "kfmb", names: ["KFMB 8.1 (CBS)"], hasDarkVersion: true },
  { name: "CNBC", slug: "cnbc", names: [], hasDarkVersion: true },
  { name: "Disney+", slug: "disney-plus", names: [], hasDarkVersion: true },
  { name: "ESPN", slug: "espn", names: ["ESPN App"] },
  { name: "ESPN2", slug: "espn2", names: [] },
  {
    name: "FanDuel Sports Network West",
    slug: "fanduel-west",
    names: [],
    drawnFor: "light",
  },
  { name: "FOX", slug: "fox", names: [], hasDarkVersion: true },
  { name: "FOX ONE", slug: "fox-one", names: [], hasDarkVersion: true },
  { name: "FS1", slug: "fs1", names: [] },
  { name: "Gray Media", slug: "gray", names: ["Gray TV"] },
  { name: "HBO Max", slug: "hbo-max", names: [], hasDarkVersion: true },
  { name: "ION", slug: "ion", names: [], hasDarkVersion: true },
  { name: "Arizona's Family 3TV", slug: "ktvk", names: [] },
  { name: "NBC", slug: "nbc", names: [], hasDarkVersion: true },
  {
    name: "NBC Sports Boston",
    slug: "nbcs-boston",
    names: ["NBC Sports BO"],
    hasDarkVersion: true,
  },
  {
    name: "NBC Sports California",
    slug: "nbcs-california",
    names: ["NBCSCA", "NBCSCA+"],
    hasDarkVersion: true,
  },
  { name: "Paramount+", slug: "paramount-plus", names: [], hasDarkVersion: true },
  { name: "Peacock", slug: "peacock", names: [], hasDarkVersion: true },
  {
    name: "Spectrum SportsNet LA",
    slug: "sportsnet-la",
    names: ["SportsNet LA"],
    hasDarkVersion: true,
  },
  { name: "TBS", slug: "tbs", names: ["TBS (out-of-market only)"], hasDarkVersion: true },
  { name: "truTV", slug: "trutv", names: [], hasDarkVersion: true },
  { name: "USA Network", slug: "usa", names: ["USA Net"] },
];

const foldName = (name) => name.trim().toLowerCase();

/**
 * @param {Channel} channel
 * @returns {NetworkLogo}
 */
const describeLogo = ({ name, slug, hasDarkVersion, drawnFor }) => ({
  name,
  file: `${slug}.svg`,
  ...(hasDarkVersion && { darkFile: `${slug}-dark.svg` }),
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
