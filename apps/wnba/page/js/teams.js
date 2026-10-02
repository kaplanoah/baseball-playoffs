// Keyed by the league's own three-letter codes. `id` is the league's team ID, which its
// standings name teams by, and `espnId` is ESPN's, which the backup scores name teams by. Colors
// are the top and bottom of the team's dot, in the shades of its own logo. `chartColors` are what
// the game sheet draws the team's side of its charts and bars in, on each theme, first choice then
// other, each its color made just dark or light enough for the team's name to read in it. The
// first choice is the color that best tells the team apart, which is usually its dot's top.
// `titles` are the seasons the franchise won the WNBA Finals before the current one, which the page
// counts from its bracket, and `titlesAs` names the team the franchise was when it won them, if it
// has since moved.
export const TEAMS = {
  ATL: {
    id: 1611661330,
    espnId: 20,
    city: "Atlanta",
    name: "Dream",
    color: "#e3173e",
    color2: "#4891ce",
    chartColors: { light: ["#bb012e", "#0b5f99"], dark: ["#ff3e54", "#4891ce"] },
    titles: [],
  },
  CHI: {
    id: 1611661329,
    espnId: 19,
    city: "Chicago",
    name: "Sky",
    color: "#4d90cd",
    color2: "#ffd520",
    chartColors: { light: ["#186099", "#6f5b01"], dark: ["#4d90cd", "#ffd520"] },
    titles: [2021],
  },
  CON: {
    id: 1611661323,
    espnId: 18,
    city: "Connecticut",
    name: "Sun",
    color: "#f05023",
    color2: "#0a2240",
    chartColors: { light: ["#ae2d00", "#0a2240"], dark: ["#f45427", "#708cb1"] },
    titles: [],
  },
  DAL: {
    id: 1611661321,
    espnId: 3,
    city: "Dallas",
    name: "Wings",
    color: "#002b5c",
    color2: "#c4d600",
    chartColors: { light: ["#5a6200", "#002b5c"], dark: ["#c4d600", "#618dc6"] },
    titles: [2003, 2006, 2008],
    titlesAs: "Detroit Shock",
  },
  GSV: {
    id: 1611661331,
    espnId: 129689,
    city: "Golden State",
    name: "Valkyries",
    color: "#b896d4",
    color2: "#000000",
    chartColors: { light: ["#6f4f88", "#000000"], dark: ["#b896d4", "#e4e4e4"] },
    titles: [],
  },
  IND: {
    id: 1611661325,
    espnId: 5,
    city: "Indiana",
    name: "Fever",
    color: "#20305d",
    color2: "#fad412",
    chartColors: { light: ["#20305d", "#6d5b00"], dark: ["#748abe", "#fad412"] },
    titles: [2012],
  },
  LAS: {
    id: 1611661320,
    espnId: 6,
    city: "Los Angeles",
    name: "Sparks",
    color: "#552583",
    color2: "#fdb927",
    chartColors: { light: ["#552583", "#7a5600"], dark: ["#a275d9", "#fdb927"] },
    titles: [2001, 2002, 2016],
  },
  LVA: {
    id: 1611661319,
    espnId: 17,
    city: "Las Vegas",
    name: "Aces",
    color: "#000000",
    color2: "#a7a8aa",
    chartColors: { light: ["#000000", "#5c5d5e"], dark: ["#e4e4e4", "#a7a8aa"] },
    titles: [2022, 2023, 2025],
  },
  MIN: {
    id: 1611661324,
    espnId: 8,
    city: "Minnesota",
    name: "Lynx",
    color: "#315c98",
    color2: "#6cc32e",
    chartColors: { light: ["#315c98", "#326900"], dark: ["#5f8ccc", "#6cc32e"] },
    titles: [2011, 2013, 2015, 2017],
  },
  NYL: {
    id: 1611661313,
    espnId: 9,
    city: "New York",
    name: "Liberty",
    color: "#87d5b5",
    color2: "#100f0d",
    chartColors: { light: ["#11694d", "#100f0d"], dark: ["#87d5b5", "#e4e4e4"] },
    titles: [2024],
  },
  PDX: {
    id: 1611661327,
    espnId: 132052,
    city: "Portland",
    name: "Fire",
    color: "#c8102e",
    color2: "#ffffff",
    chartColors: { light: ["#bb0127", "#5c5c5c"], dark: ["#f74c54", "#ffffff"] },
    titles: [],
  },
  PHX: {
    id: 1611661317,
    espnId: 11,
    city: "Phoenix",
    name: "Mercury",
    color: "#fa4b0a",
    color2: "#3c286e",
    chartColors: { light: ["#aa2f02", "#3c286e"], dark: ["#fa4b0a", "#8f7fcd"] },
    titles: [2007, 2009, 2014],
  },
  SEA: {
    id: 1611661328,
    espnId: 14,
    city: "Seattle",
    name: "Storm",
    color: "#2c5235",
    color2: "#fee11a",
    chartColors: { light: ["#2c5235", "#6a5d01"], dark: ["#6b9473", "#fee11a"] },
    titles: [2004, 2010, 2018, 2020],
  },
  TOR: {
    id: 1611661332,
    espnId: 131935,
    city: "Toronto",
    name: "Tempo",
    color: "#441e36",
    color2: "#b3c7e7",
    chartColors: { light: ["#441e36", "#4c5d79"], dark: ["#ab7d98", "#b3c7e7"] },
    titles: [],
  },
  WAS: {
    id: 1611661322,
    espnId: 16,
    city: "Washington",
    name: "Mystics",
    color: "#002b5c",
    color2: "#e03a3e",
    chartColors: { light: ["#bc021f", "#002b5c"], dark: ["#f44e4e", "#618dc6"] },
    titles: [2019],
  },
};

const CODE_BY_ID = new Map(Object.entries(TEAMS).map(([code, team]) => [team.id, code]));

/** @param {number} id */
export const findTeamCode = (id) => CODE_BY_ID.get(Number(id)) ?? null;

const CODE_BY_ESPN_ID = new Map(Object.entries(TEAMS).map(([code, team]) => [team.espnId, code]));

/** @param {number | string} espnId */
export const findTeamCodeByEspnId = (espnId) => CODE_BY_ESPN_ID.get(Number(espnId)) ?? null;
