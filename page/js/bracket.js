export const ROUND_LABEL = {
  WC: "Wild Card",
  DS: "Division Series",
  CS: "Championship Series",
  WS: "World Series",
};
const BEST_OF = { WC: 3, DS: 5, CS: 7, WS: 7 };

function winsNeeded(round) {
  return Math.ceil(BEST_OF[round] / 2);
}

function seriesState(state, id, teamA, teamB, round) {
  const rec = state.series[id] || { winsA: 0, winsB: 0 };
  const need = winsNeeded(round);
  let winner = null;
  if (teamA && teamB) {
    if (rec.winsA >= need) winner = teamA;
    else if (rec.winsB >= need) winner = teamB;
  }
  return {
    id,
    round,
    teamA,
    teamB,
    winsA: rec.winsA || 0,
    winsB: rec.winsB || 0,
    need,
    bestOf: BEST_OF[round],
    winner,
  };
}

function buildLeagueBracket(state, lg) {
  const teamsInLeague = Object.entries(state.teams).filter(([, t]) => t.league === lg);
  if (teamsInLeague.length < 6) return null;
  const bySeed = {};
  teamsInLeague.forEach(([id, t]) => (bySeed[t.seed] = id));

  const wc1 = seriesState(state, `${lg}_WC1`, bySeed[3], bySeed[6], "WC");
  const wc2 = seriesState(state, `${lg}_WC2`, bySeed[4], bySeed[5], "WC");

  // MLB doesn't reseed: #1 always draws the 4/5 winner and #2 the 3/6 winner.
  const ds1 = seriesState(state, `${lg}_DS1`, bySeed[1], wc2.winner, "DS");
  const ds2 = seriesState(state, `${lg}_DS2`, bySeed[2], wc1.winner, "DS");
  const cs = seriesState(state, `${lg}_CS`, ds1.winner, ds2.winner, "CS");

  return { wc: [wc1, wc2], ds: [ds1, ds2], cs: [cs], champion: cs.winner };
}

export function fullBracket(state) {
  const al = buildLeagueBracket(state, "AL");
  const nl = buildLeagueBracket(state, "NL");
  const ws = al && nl ? seriesState(state, "WS", al.champion, nl.champion, "WS") : null;
  return { al, nl, ws };
}

function feederFor(seriesId, side) {
  if (seriesId === "WS") return side === "A" ? "AL_CS" : "NL_CS";
  const [lg, key] = seriesId.split("_");
  if (key === "DS1" && side === "B") return `${lg}_WC2`;
  if (key === "DS2" && side === "B") return `${lg}_WC1`;
  if (key === "CS") return side === "A" ? `${lg}_DS1` : `${lg}_DS2`;
  return null;
}

export function slotCandidates(state, seriesId, side) {
  const br = fullBracket(state);
  const all = {};
  ["al", "nl"].forEach((k) => {
    if (!br[k]) return;
    [...br[k].wc, ...br[k].ds, ...br[k].cs].forEach((s) => (all[s.id] = s));
  });
  if (br.ws) all.WS = br.ws;

  const walk = (id, sd) => {
    const s = all[id];
    if (!s) return [];
    const team = sd === "A" ? s.teamA : s.teamB;
    if (team) return [team];
    const feeder = feederFor(id, sd);
    return feeder ? [...walk(feeder, "A"), ...walk(feeder, "B")] : [];
  };
  return walk(seriesId, side);
}

export function teamEliminated(state, id) {
  const t = state.teams[id];
  if (!t) return false;
  const br = fullBracket(state);
  const lgBr = t.league === "AL" ? br.al : br.nl;
  if (!lgBr) return false;
  const all = [...lgBr.wc, ...lgBr.ds, ...lgBr.cs, br.ws].filter(Boolean);
  return all.some((s) => s.winner && (s.teamA === id || s.teamB === id) && s.winner !== id);
}

export function teamStatusLabel(state, id) {
  const br = fullBracket(state);
  if (br.ws && br.ws.winner === id) return { label: "Champs", cls: "champ" };
  if (!teamEliminated(state, id)) return { label: "Alive", cls: "alive" };

  const t = state.teams[id];
  const lgBr = t.league === "AL" ? br.al : br.nl;
  const rounds = [
    { round: "WC", series: lgBr.wc },
    { round: "DS", series: lgBr.ds },
    { round: "CS", series: lgBr.cs },
    { round: "WS", series: br.ws ? [br.ws] : [] },
  ];
  for (const { round, series } of rounds) {
    for (const s of series) {
      if (s && s.winner && (s.teamA === id || s.teamB === id) && s.winner !== id) {
        return { label: `Out \u2014 ${ROUND_LABEL[round]}`, cls: "out" };
      }
    }
  }
  return { label: "Eliminated", cls: "out" };
}
