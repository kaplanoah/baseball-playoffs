// Keyed by the league's own three-letter codes. `id` is the league's team ID, which its
// standings name teams by. Colors are the team's primary and secondary.
export const TEAMS = {
  ATL: { id: 1611661330, city: "Atlanta", name: "Dream", color: "#e31837", color2: "#5091cc" },
  CHI: { id: 1611661329, city: "Chicago", name: "Sky", color: "#5091cd", color2: "#ffd520" },
  CON: { id: 1611661323, city: "Connecticut", name: "Sun", color: "#f05023", color2: "#0a2240" },
  DAL: { id: 1611661321, city: "Dallas", name: "Wings", color: "#002b5c", color2: "#c4d600" },
  GSV: {
    id: 1611661331,
    city: "Golden State",
    name: "Valkyries",
    color: "#b38fcf",
    color2: "#000000",
  },
  IND: { id: 1611661325, city: "Indiana", name: "Fever", color: "#002d62", color2: "#e03a3e" },
  LAS: { id: 1611661320, city: "Los Angeles", name: "Sparks", color: "#552583", color2: "#fdb927" },
  LVA: { id: 1611661319, city: "Las Vegas", name: "Aces", color: "#a7a8aa", color2: "#000000" },
  MIN: { id: 1611661324, city: "Minnesota", name: "Lynx", color: "#266092", color2: "#79bc43" },
  NYL: { id: 1611661313, city: "New York", name: "Liberty", color: "#86cebc", color2: "#000000" },
  PDX: { id: 1611661327, city: "Portland", name: "Fire", color: "#cee5eb", color2: "#000000" },
  PHX: { id: 1611661317, city: "Phoenix", name: "Mercury", color: "#3c286e", color2: "#fa4b0a" },
  SEA: { id: 1611661328, city: "Seattle", name: "Storm", color: "#2c5235", color2: "#fee11a" },
  TOR: { id: 1611661332, city: "Toronto", name: "Tempo", color: "#33476d", color2: "#7b1b38" },
  WAS: {
    id: 1611661322,
    city: "Washington",
    name: "Mystics",
    color: "#e03a3e",
    color2: "#002b5c",
  },
};

const CODE_BY_ID = new Map(Object.entries(TEAMS).map(([code, team]) => [team.id, code]));

/** @param {number} id */
export const findTeamCode = (id) => CODE_BY_ID.get(Number(id)) ?? null;
