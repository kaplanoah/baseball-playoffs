/* Postseason bracket rules, as pure functions over a season document.
   Nothing here touches the DOM or the store — given the same season doc,
   these always produce the same bracket. */

const ROUND_LABEL = {WC:"Wild Card", DS:"Division Series", CS:"Championship Series", WS:"World Series"};
const BEST_OF = {WC:3, DS:5, CS:7, WS:7};

function winsNeeded(round){ return Math.ceil(BEST_OF[round]/2); }

function seriesState(state, id, teamA, teamB, round){
  const rec = state.series[id] || {winsA:0, winsB:0};
  const need = winsNeeded(round);
  let winner = null;
  if(teamA && teamB){
    if(rec.winsA >= need) winner = teamA;
    else if(rec.winsB >= need) winner = teamB;
  }
  return { id, round, teamA, teamB, winsA:rec.winsA||0, winsB:rec.winsB||0, need, bestOf:BEST_OF[round], winner };
}

function buildLeagueBracket(state, lg){
  const teamsInLeague = Object.entries(state.teams).filter(([,t]) => t.league === lg);
  if(teamsInLeague.length < 6) return null;
  const bySeed = {};
  teamsInLeague.forEach(([id,t]) => bySeed[t.seed] = id);

  const wc1 = seriesState(state, `${lg}_WC1`, bySeed[3], bySeed[6], "WC");
  const wc2 = seriesState(state, `${lg}_WC2`, bySeed[4], bySeed[5], "WC");

  // Reseed: #1 draws the surviving wild-card team with the worse (higher) seed
  // number; #2 draws the other.
  let ds1TeamB = null, ds2TeamB = null;
  if(wc1.winner && wc2.winner){
    const seedOf = id => state.teams[id].seed;
    const winners = [wc1.winner, wc2.winner].sort((a,b) => seedOf(b) - seedOf(a));
    ds1TeamB = winners[0];
    ds2TeamB = winners[1];
  }
  const ds1 = seriesState(state, `${lg}_DS1`, bySeed[1], ds1TeamB, "DS");
  const ds2 = seriesState(state, `${lg}_DS2`, bySeed[2], ds2TeamB, "DS");
  const cs = seriesState(state, `${lg}_CS`, ds1.winner, ds2.winner, "CS");

  return { wc:[wc1,wc2], ds:[ds1,ds2], cs:[cs], champion: cs.winner };
}

function fullBracket(state){
  const al = buildLeagueBracket(state, "AL");
  const nl = buildLeagueBracket(state, "NL");
  const ws = (al && nl) ? seriesState(state, "WS", al.champion, nl.champion, "WS") : null;
  return {al, nl, ws};
}

function teamEliminated(state, id){
  const t = state.teams[id];
  if(!t) return false;
  const br = fullBracket(state);
  const lgBr = t.league === "AL" ? br.al : br.nl;
  if(!lgBr) return false;
  const all = [...lgBr.wc, ...lgBr.ds, ...lgBr.cs, br.ws].filter(Boolean);
  return all.some(s => s.winner && (s.teamA === id || s.teamB === id) && s.winner !== id);
}

function teamStatusLabel(state, id){
  const br = fullBracket(state);
  if(br.ws && br.ws.winner === id) return {label:"Champs", cls:"champ"};
  if(!teamEliminated(state, id)) return {label:"Alive", cls:"alive"};

  const t = state.teams[id];
  const lgBr = t.league === "AL" ? br.al : br.nl;
  const rounds = [["WC",lgBr.wc],["DS",lgBr.ds],["CS",lgBr.cs],["WS",br.ws?[br.ws]:[]]];
  for(const [round, arr] of rounds){
    for(const s of arr){
      if(s && s.winner && (s.teamA===id||s.teamB===id) && s.winner!==id){
        return {label:`Out — ${ROUND_LABEL[round]}`, cls:"out"};
      }
    }
  }
  return {label:"Eliminated", cls:"out"};
}
