// Keyed by the league's own three-letter codes. `id` is the league's team ID, which its
// standings name teams by, and `espnId` is ESPN's, which the backup scores name teams by. Colors
// are the team's primary and secondary. `titles` are the seasons the franchise won the WNBA
// Finals before the current one, which the page counts from its bracket, and `titlesAs` names the
// team the franchise was when it won them, if it has since moved.
export const TEAMS = {
  ATL: {
    id: 1611661330,
    espnId: 20,
    city: "Atlanta",
    name: "Dream",
    color: "#e31837",
    color2: "#5091cc",
    titles: [],
  },
  CHI: {
    id: 1611661329,
    espnId: 19,
    city: "Chicago",
    name: "Sky",
    color: "#5091cd",
    color2: "#ffd520",
    titles: [2021],
  },
  CON: {
    id: 1611661323,
    espnId: 18,
    city: "Connecticut",
    name: "Sun",
    color: "#f05023",
    color2: "#0a2240",
    titles: [],
  },
  DAL: {
    id: 1611661321,
    espnId: 3,
    city: "Dallas",
    name: "Wings",
    color: "#002b5c",
    color2: "#c4d600",
    titles: [2003, 2006, 2008],
    titlesAs: "Detroit Shock",
  },
  GSV: {
    id: 1611661331,
    espnId: 129689,
    city: "Golden State",
    name: "Valkyries",
    color: "#b38fcf",
    color2: "#000000",
    titles: [],
  },
  IND: {
    id: 1611661325,
    espnId: 5,
    city: "Indiana",
    name: "Fever",
    color: "#002d62",
    color2: "#e03a3e",
    titles: [2012],
  },
  LAS: {
    id: 1611661320,
    espnId: 6,
    city: "Los Angeles",
    name: "Sparks",
    color: "#552583",
    color2: "#fdb927",
    titles: [2001, 2002, 2016],
  },
  LVA: {
    id: 1611661319,
    espnId: 17,
    city: "Las Vegas",
    name: "Aces",
    color: "#a7a8aa",
    color2: "#000000",
    titles: [2022, 2023, 2025],
  },
  MIN: {
    id: 1611661324,
    espnId: 8,
    city: "Minnesota",
    name: "Lynx",
    color: "#266092",
    color2: "#79bc43",
    titles: [2011, 2013, 2015, 2017],
  },
  NYL: {
    id: 1611661313,
    espnId: 9,
    city: "New York",
    name: "Liberty",
    color: "#86cebc",
    color2: "#000000",
    titles: [2024],
  },
  PDX: {
    id: 1611661327,
    espnId: 132052,
    city: "Portland",
    name: "Fire",
    color: "#cee5eb",
    color2: "#000000",
    titles: [],
  },
  PHX: {
    id: 1611661317,
    espnId: 11,
    city: "Phoenix",
    name: "Mercury",
    color: "#3c286e",
    color2: "#fa4b0a",
    titles: [2007, 2009, 2014],
  },
  SEA: {
    id: 1611661328,
    espnId: 14,
    city: "Seattle",
    name: "Storm",
    color: "#2c5235",
    color2: "#fee11a",
    titles: [2004, 2010, 2018, 2020],
  },
  TOR: {
    id: 1611661332,
    espnId: 131935,
    city: "Toronto",
    name: "Tempo",
    color: "#33476d",
    color2: "#7b1b38",
    titles: [],
  },
  WAS: {
    id: 1611661322,
    espnId: 16,
    city: "Washington",
    name: "Mystics",
    color: "#e03a3e",
    color2: "#002b5c",
    titles: [2019],
  },
};

const CODE_BY_ID = new Map(Object.entries(TEAMS).map(([code, team]) => [team.id, code]));

/** @param {number} id */
export const findTeamCode = (id) => CODE_BY_ID.get(Number(id)) ?? null;

const CODE_BY_ESPN_ID = new Map(Object.entries(TEAMS).map(([code, team]) => [team.espnId, code]));

/** @param {number | string} espnId */
export const findTeamCodeByEspnId = (espnId) => CODE_BY_ESPN_ID.get(Number(espnId)) ?? null;
