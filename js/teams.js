/* Every club: league, the year of its last World Series win (null = never),
   and its two official colors, which the split-circle team dot uses.

   This is a script rather than a JSON file on purpose — a published artifact
   can't fetch() its own data, so the table has to arrive as a global.

   `lastWS` is only a starting point. Once a season is tracked here, that
   season's World Series result supersedes this table (see lastTitle in
   app.js), so these values never need editing again — they only cover titles
   won before the tracker existed. */
const TEAMS = {
  ARI: { name: "Diamondbacks", league: "NL", lastWS: 2001, color: "#A71930", color2: "#E3D4AD" },
  ATL: { name: "Braves",       league: "NL", lastWS: 2021, color: "#CE1141", color2: "#13274F" },
  BAL: { name: "Orioles",      league: "AL", lastWS: 1983, color: "#DF4601", color2: "#000000" },
  BOS: { name: "Red Sox",      league: "AL", lastWS: 2018, color: "#BD3039", color2: "#0C2340" },
  CHC: { name: "Cubs",         league: "NL", lastWS: 2016, color: "#0E3386", color2: "#CC3433" },
  CWS: { name: "White Sox",    league: "AL", lastWS: 2005, color: "#27251F", color2: "#C4CED4" },
  CIN: { name: "Reds",         league: "NL", lastWS: 1990, color: "#C6011F", color2: "#000000" },
  CLE: { name: "Guardians",    league: "AL", lastWS: 1948, color: "#0C2340", color2: "#E31937" },
  COL: { name: "Rockies",      league: "NL", lastWS: null, color: "#33006F", color2: "#C4CED4" },
  DET: { name: "Tigers",       league: "AL", lastWS: 1984, color: "#0C2340", color2: "#FA4616" },
  HOU: { name: "Astros",       league: "AL", lastWS: 2022, color: "#002D62", color2: "#EB6E1F" },
  KC:  { name: "Royals",       league: "AL", lastWS: 2015, color: "#004687", color2: "#BD9B60" },
  LAA: { name: "Angels",       league: "AL", lastWS: 2002, color: "#BA0021", color2: "#003263" },
  LAD: { name: "Dodgers",      league: "NL", lastWS: 2025, color: "#005A9C", color2: "#FFFFFF" },
  MIA: { name: "Marlins",      league: "NL", lastWS: 2003, color: "#00A3E0", color2: "#EF3340" },
  MIL: { name: "Brewers",      league: "NL", lastWS: null, color: "#12284B", color2: "#FFC52F" },
  MIN: { name: "Twins",        league: "AL", lastWS: 1991, color: "#002B5C", color2: "#D31145" },
  NYM: { name: "Mets",         league: "NL", lastWS: 1986, color: "#002D72", color2: "#FF5910" },
  NYY: { name: "Yankees",      league: "AL", lastWS: 2009, color: "#003087", color2: "#FFFFFF" },
  ATH: { name: "Athletics",    league: "AL", lastWS: 1989, color: "#003831", color2: "#EFB21E" },
  PHI: { name: "Phillies",     league: "NL", lastWS: 2008, color: "#E81828", color2: "#FFFFFF" },
  PIT: { name: "Pirates",      league: "NL", lastWS: 1979, color: "#27251F", color2: "#FDB827" },
  SD:  { name: "Padres",       league: "NL", lastWS: null, color: "#2F241D", color2: "#FFC425" },
  SF:  { name: "Giants",       league: "NL", lastWS: 2014, color: "#FD5A1E", color2: "#27251F" },
  SEA: { name: "Mariners",     league: "AL", lastWS: null, color: "#0C2C56", color2: "#005C5C" },
  STL: { name: "Cardinals",    league: "NL", lastWS: 2011, color: "#C41E3A", color2: "#0C2340" },
  TB:  { name: "Rays",         league: "AL", lastWS: null, color: "#092C5C", color2: "#8FBCE6" },
  TEX: { name: "Rangers",      league: "AL", lastWS: 2023, color: "#003278", color2: "#C0111F" },
  TOR: { name: "Blue Jays",    league: "AL", lastWS: 1993, color: "#134A8E", color2: "#E8291C" },
  WSH: { name: "Nationals",    league: "NL", lastWS: 2019, color: "#AB0003", color2: "#14225A" }
};
