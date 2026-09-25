/* The live snapshot: everything the page shows that comes from MLB -- the
   field and its seeds, every series record, the standings table and the
   day's games -- built from three Stats API responses by pure functions.

   This replaced a scheduled Claude run that read the same three responses
   and wrote the same fields by following several pages of instructions.
   Every rule it followed is here as code instead, so the page can ask for a
   snapshot as often as it likes: the answer costs one HTTP round trip, not a
   model run.

   It runs in two places and must stay plain enough for both:
   - the MLB Live connector (worker/), which fetches for the page, and
   - the page itself, when the artifact is allowed to fetch MLB directly.
   So: no DOM, no globals, nothing but the language. A snapshot is plain JSON,
   the same shape wherever it was built. */

const MLBSnapshot = (() => {

  const MLB_API = "https://statsapi.mlb.com";

  /* MLB's numeric team ids, to the ids the page uses everywhere else. The
     Stats API also uses made-up ids for postseason placeholders ("AL #3
     Seed"), which is why a lookup miss means "not a real club yet". */
  const MLB_TEAM = {
    108:"LAA", 109:"ARI", 110:"BAL", 111:"BOS", 112:"CHC", 113:"CIN", 114:"CLE",
    115:"COL", 116:"DET", 117:"HOU", 118:"KC",  119:"LAD", 120:"WSH", 121:"NYM",
    133:"ATH", 134:"PIT", 135:"SD",  136:"SEA", 137:"SF",  138:"STL", 139:"TB",
    140:"TEX", 141:"TOR", 142:"MIN", 143:"PHI", 144:"ATL", 145:"CWS", 146:"MIA",
    147:"NYY", 158:"MIL"
  };
  const MLB_DIVISION = {
    200:"AL West", 201:"AL East", 202:"AL Central",
    203:"NL West", 204:"NL East", 205:"NL Central"
  };

  /* Ask only for the fields used below. The standings response is 80KB whole
     and 31KB filtered; nine days of games with line scores drop from about
     130KB to 43KB. Less to send, and less to parse on every poll. */
  const GAME_FIELDS = [
    "dates", "date", "games", "gamePk", "gameType", "gameDate", "officialDate",
    "status", "abstractGameState", "detailedState", "codedGameState", "startTimeTBD",
    "teams", "away", "home", "team", "id", "name", "score",
    "seriesGameNumber", "seriesDescription",
    "linescore", "currentInning", "gameInfo", "firstPitch", "gameDurationMinutes"
  ].join(",");
  const STANDINGS_FIELDS = [
    "records", "division", "id", "teamRecords", "team", "wins", "losses",
    "winningPercentage", "divisionGamesBack", "wildCardGamesBack",
    "eliminationNumber", "wildCardEliminationNumber",
    "divisionChamp", "divisionLeader", "divisionRank", "wildCardRank", "leagueRank", "clinchIndicator"
  ].join(",");

  /* Each game type in the postseason is one round. */
  const ROUND_OF_TYPE = { F:"WC", D:"DS", L:"CS", W:"WS" };
  const WINS_TO_TAKE = { WC:2, DS:3, CS:4, WS:4 };
  const GAME_TYPES = new Set(["R", "F", "D", "L", "W"]);

  /* When the page should ask again -- see pollDelay. Thirty seconds is as
     fast as the connector polls, and MLB caches its own responses for twenty,
     so asking faster would only fetch the same answer twice. */
  const POLL_LIVE_MS = 30 * 1000;
  const POLL_LEAD_MS = 15 * 60 * 1000;     // start watching this long before a first pitch
  const POLL_CHECK_MS = 60 * 60 * 1000;    // and look at the schedule at least this often

  /* ---------- dates ----------
     Baseball's day is Eastern: `officialDate` is an Eastern calendar date, and
     a west coast game that ends at 1am still belongs to the night before. */
  const EASTERN = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23"
  });
  function easternDay(ms){
    const p = {};
    for(const { type, value } of EASTERN.formatToParts(new Date(ms))) p[type] = value;
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), year: Number(p.year) };
  }
  function addDays(date, n){
    const [y, m, d] = date.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  }

  /* ---------- what to fetch ----------
     Paths only; the caller supplies the host, so the Worker can route through
     its cache and tests can serve fixtures. A past season has nothing left to
     play, so it skips the schedule: its standings and bracket are final. */
  function mlbRequests(season, now){
    const today = easternDay(now);
    const req = {
      standings: `/api/v1/standings?leagueId=103,104&season=${season}` +
        `&standingsTypes=regularSeason&fields=${STANDINGS_FIELDS}`,
      postseason: `/api/v1/schedule/postseason?season=${season}&hydrate=gameInfo&fields=${GAME_FIELDS}`,
      schedule: null
    };
    if(season === today.year){
      /* Four days back finds the last final across a postseason off day;
         four ahead gives every club its next game. */
      req.schedule = `/api/v1/schedule?sportId=1&startDate=${addDays(today.date, -4)}` +
        `&endDate=${addDays(today.date, 4)}&hydrate=linescore,gameInfo&fields=${GAME_FIELDS}`;
    }
    return req;
  }

  /* getJson(path) resolves the parsed body of one request. */
  async function fetchSnapshot(getJson, season, now = Date.now()){
    const req = mlbRequests(season, now);
    const [standings, postseason, schedule] = await Promise.all([
      getJson(req.standings),
      getJson(req.postseason),
      req.schedule ? getJson(req.schedule) : null
    ]);
    return buildSnapshot({ standings, postseason, schedule }, { season, now });
  }

  /* ---------- games ---------- */

  /* A postponed or cancelled game reads "Final" in abstractGameState, so the
     coded state has to be checked first or a rainout shows up as a final with
     no score. Suspended games resume on a later date under the same gamePk. */
  function gameState(status){
    const coded = status.codedGameState;
    if(["C", "D", "T", "U"].includes(coded) || /postpon|cancel|suspend/i.test(status.detailedState || "")) return "off";
    if(status.abstractGameState === "Live") return "live";
    if(status.abstractGameState === "Final") return "final";
    return "pre";
  }

  function normalizeGame(g){
    const side = key => {
      const t = (g.teams && g.teams[key]) || {};
      const team = t.team || {};
      return { id: MLB_TEAM[team.id] || null, name: team.name || "", score: t.score };
    };
    const status = g.status || {};
    const state = gameState(status);
    const info = g.gameInfo || {};
    /* A final's end is its first pitch plus its length. Without gameInfo,
       three hours past the scheduled start is close enough to order finals. */
    let end = null;
    if(state === "final"){
      const first = Date.parse(info.firstPitch || g.gameDate);
      const minutes = info.gameDurationMinutes || (info.firstPitch ? 0 : 180);
      if(!isNaN(first)) end = new Date(first + minutes * 60000).toISOString().replace(".000Z", "Z");
    }
    const league = /^(AL|NL)\b/.exec(g.seriesDescription || "");
    return {
      pk: g.gamePk, type: g.gameType, date: g.officialDate, start: g.gameDate,
      tbd: !!status.startTimeTBD, state, away: side("away"), home: side("home"),
      inning: g.linescore ? g.linescore.currentInning : undefined,
      number: g.seriesGameNumber, league: league ? league[1] : null, end
    };
  }

  /* Every game in a schedule response, once each. A suspended game is listed
     again on the day it resumes; the later listing is the one that counts. */
  function scheduleGames(resp){
    const byPk = new Map();
    for(const day of (resp && resp.dates) || []){
      for(const g of day.games || []){
        if(GAME_TYPES.has(g.gameType)) byPk.set(g.gamePk, normalizeGame(g));
      }
    }
    return [...byPk.values()];
  }

  const real = g => !!(g.away.id && g.home.id);
  const byStart = (a, b) => Date.parse(a.start) - Date.parse(b.start);
  const byEnd = (a, b) => Date.parse(a.end) - Date.parse(b.end);

  /* The shape stamp.js reads: each game with its state, and the score, inning
     and end time only where the state has one. */
  function stampGame(g){
    const out = { away: g.away.id, home: g.home.id, state: g.state, start: g.start };
    if(g.tbd) out.tbd = true;
    if(g.state !== "pre") out.score = [g.away.score || 0, g.home.score || 0];
    if(g.state === "live") out.inning = g.inning || 1;
    if(g.state === "final") out.end = g.end;
    return out;
  }

  /* ---------- the day's games ----------
     `today` is the day being played. Until 6am Eastern that is still last
     night: at 1am the news is "slate of 15 over", not an empty morning. */
  function buildSlate(games, now){
    const clock = easternDay(now);
    const playable = games.filter(g => g.state !== "off" && real(g));
    const on = date => playable.filter(g => g.date === date).sort(byStart);
    let day = clock.date;
    if(clock.hour < 6 && on(addDays(day, -1)).length) day = addDays(day, -1);

    const later = [...new Set(playable.map(g => g.date))].filter(d => d > day).sort();
    const last = playable.filter(g => g.state === "final" && g.date < day).sort(byEnd).pop();
    return {
      today: { date: day, games: on(day).map(stampGame) },
      nextDay: later.length ? { date: later[0], games: on(later[0]).map(stampGame) } : null,
      lastFinal: last ? stampGame(last) : null
    };
  }

  /* ---------- standings ---------- */

  function standingsRows(resp){
    const rows = [];
    for(const rec of (resp && resp.records) || []){
      const div = MLB_DIVISION[rec.division && rec.division.id];
      if(!div) continue;
      for(const r of rec.teamRecords || []){
        const id = MLB_TEAM[r.team && r.team.id];
        if(id) rows.push({ id, div, r });
      }
    }
    return rows;
  }

  /* The Standings tab's table, one row per club in division order. `next` is
     the club's next regular-season game that hasn't started, and `then` the
     one after it: a copy saved before a first pitch still knows what comes
     next once that game is under way (see nextCell in standings.js). Once
     the season is over no club has either, and the column drops off. */
  function buildStandings(resp, season, games){
    const upcoming = {};
    games.filter(g => g.type === "R" && g.state === "pre" && real(g))
      .sort(byStart)
      .forEach(g => {
        for(const [us, them, home] of [[g.away.id, g.home.id, false], [g.home.id, g.away.id, true]]){
          (upcoming[us] = upcoming[us] || []).push({ at: g.start, opp: them, home, tbd: g.tbd });
        }
      });

    const divisions = {};
    for(const { id, div, r } of standingsRows(resp)){
      const row = {
        id, w: r.wins, l: r.losses, pct: r.winningPercentage,
        gb: r.divisionGamesBack, wcgb: r.wildCardGamesBack,
        elim: r.eliminationNumber, wce: r.wildCardEliminationNumber,
        magic: null,
        /* divisionChamp, not the clinch indicator: "x" and "w" also mean
           clinched, but a playoff spot, not the division this tag is for. */
        clinched: !!r.divisionChamp, lead: !!r.divisionLeader,
        // MLB's own marker: x a playoff spot, w a wild card, y the division, z a bye.
        clinch: r.clinchIndicator || null,
        wcrank: r.divisionLeader ? null : (r.wildCardRank || null),
        rank: Number(r.divisionRank) || 99
      };
      const [next, then] = upcoming[id] || [];
      if(next) row.next = next;
      if(then) row.then = then;
      (divisions[div] = divisions[div] || []).push(row);
    }
    for(const rows of Object.values(divisions)){
      rows.sort((a, b) => a.rank - b.rank).forEach(row => delete row.rank);
      /* The leader's magic number for the division is the closest chaser's
         elimination number: wins by the leader plus losses by that club that
         end it. Not MLB's `magicNumber`, which counts toward clinching a
         playoff spot -- a leader that already has one gets "-" there while
         the division is still open. None left to chase, or already won: none. */
      const leader = rows.find(r => r.lead);
      const chasing = rows.filter(r => r !== leader).map(r => Number(r.elim)).filter(Number.isFinite);
      if(leader && !leader.clinched && chasing.length) leader.magic = String(Math.min(...chasing));
    }
    return { year: season, divisions };
  }

  /* The field as it would stand if the season ended today: per league, the
     three division leaders seeded 1-3 by record, then the top three wild
     cards seeded 4-6 in MLB's own wild card order. League rank breaks a tie on
     record, because it already carries MLB's tiebreakers. */
  function projectedField(resp){
    const rows = standingsRows(resp);
    const teams = {};
    for(const lg of ["AL", "NL"]){
      const mine = rows.filter(x => x.div.startsWith(lg));
      const leagueRank = x => Number(x.r.leagueRank) || 99;
      // One leader per division: its top-ranked club.
      const leaders = [...new Set(mine.map(x => x.div))].map(div => mine
        .filter(x => x.div === div)
        .sort((a, b) => ((Number(a.r.divisionRank) || 99) - (Number(b.r.divisionRank) || 99)) ||
          (leagueRank(a) - leagueRank(b)))[0]);
      leaders.sort((a, b) =>
        (Number(b.r.winningPercentage) - Number(a.r.winningPercentage)) || (leagueRank(a) - leagueRank(b)));
      const lead = new Set(leaders.map(x => x.id));
      const wild = mine.filter(x => !lead.has(x.id) && x.r.wildCardRank)
        .sort((a, b) => Number(a.r.wildCardRank) - Number(b.r.wildCardRank));
      [...leaders.slice(0, 3), ...wild.slice(0, 3)].forEach((x, i) => {
        teams[x.id] = { league: lg, seed: i + 1, w: x.r.wins, l: x.r.losses };
      });
    }
    return teams;
  }

  /* ---------- the postseason ----------
     MLB publishes every possible postseason game in advance, with placeholder
     clubs ("AL #3 Seed", "AL 4/5 Winner") that turn into real ones as seeds
     clinch and series end. A game belongs to a series by those placeholder
     names while they last, and by the clubs that replaced them after. */

  /* Which series a postseason game belongs to. `wildCard` holds the real
     clubs already known in each wild card series, which is how a division
     series game tells DS1 (the 4/5 winner's) from DS2 once its placeholder is
     gone. `champs` is the division winners: in a wild card series between two
     real clubs, the host is the 3 seed if it won its division and the 4 seed
     if it didn't. */
  function seriesOf(g, wildCard, champs){
    if(g.type === "W") return "WS";
    const lg = g.league;
    if(!lg) return null;
    const names = `${g.away.name} | ${g.home.name}`;
    const has = key => [g.away.id, g.home.id].some(id => id && wildCard[`${lg}_${key}`].has(id));
    switch(g.type){
      case "F":
        if(/#3 Seed|Wild Card #3/.test(names)) return `${lg}_WC1`;
        if(/Wild Card #[12]/.test(names)) return `${lg}_WC2`;
        return champs.has(g.home.id) ? `${lg}_WC1` : `${lg}_WC2`;
      case "D":
        if(/4\/5|#1 Seed/.test(names) || has("WC2")) return `${lg}_DS1`;
        if(/3\/6|#2 Seed/.test(names) || has("WC1")) return `${lg}_DS2`;
        return null;
      case "L": return `${lg}_CS`;
      default: return null;
    }
  }

  function groupPostseason(games, champs){
    const wildCard = { AL_WC1: new Set(), AL_WC2: new Set(), NL_WC1: new Set(), NL_WC2: new Set() };
    const bySeries = {};
    const add = (sid, g) => { if(sid) (bySeries[sid] = bySeries[sid] || []).push(g); };
    // The wild card round first: the division round is told apart by who came out of it.
    for(const g of games.filter(g => g.type === "F")){
      const sid = seriesOf(g, wildCard, champs);
      add(sid, g);
      if(sid) [g.away.id, g.home.id].forEach(id => id && wildCard[sid].add(id));
    }
    for(const g of games.filter(g => g.type !== "F")) add(seriesOf(g, wildCard, champs), g);
    return { bySeries, wildCard };
  }

  /* The official field, once MLB has named all twelve clubs: the wild card
     hosts are the 3 and 4 seeds (every wild card game is at the higher seed),
     their opponents the 6 and 5, and the 1 and 2 seeds are the division
     series clubs that played no wild card game. Null until all twelve are in. */
  function officialField(grouped, records){
    const teams = {};
    const seat = (id, league, seed) => { if(id) teams[id] = { league, seed, w: records[id].w, l: records[id].l }; };
    for(const lg of ["AL", "NL"]){
      const series = key => grouped.bySeries[`${lg}_${key}`] || [];
      for(const [key, hi, lo] of [["WC1", 3, 6], ["WC2", 4, 5]]){
        const g = series(key)[0];
        if(g){ seat(g.home.id, lg, hi); seat(g.away.id, lg, lo); }
      }
      const inWildCard = id => grouped.wildCard[`${lg}_WC1`].has(id) || grouped.wildCard[`${lg}_WC2`].has(id);
      for(const [key, seed] of [["DS1", 1], ["DS2", 2]]){
        const host = series(key).flatMap(g => [g.away.id, g.home.id]).find(id => id && !inWildCard(id));
        seat(host, lg, seed);
      }
    }
    const complete = ["AL", "NL"].every(lg =>
      [1, 2, 3, 4, 5, 6].every(s => Object.values(teams).some(t => t.league === lg && t.seed === s)));
    return complete && Object.keys(teams).length === 12 ? teams : null;
  }

  /* Walk the bracket in order -- each round's clubs are the winners of the
     one before -- counting finals for each series, and log every game as it
     went: a `game` entry, or a `clinch` for the one that ended the series.
     The bracket is fixed, not reseeded: 1 draws the 4/5 winner, 2 the 3/6. */
  function buildSeries(teams, bySeries, today){
    const seed = {};
    Object.entries(teams).forEach(([id, t]) => { seed[`${t.league}${t.seed}`] = id; });
    const series = {}, winner = {}, log = [];

    const play = (sid, round, a, b) => {
      const games = (bySeries[sid] || []).slice();
      const rec = { winsA: 0, winsB: 0 };
      const need = WINS_TO_TAKE[round];
      const finals = games.filter(g => g.state === "final" && real(g) && a && b &&
        [a, b].includes(g.away.id) && [a, b].includes(g.home.id)).sort(byEnd);
      for(const g of finals){
        if(winner[sid]) break;
        const won = g.away.score > g.home.score ? g.away.id : g.home.id;
        if(won === a) rec.winsA++; else rec.winsB++;
        const lost = won === a ? b : a;
        const w = won === a ? rec.winsA : rec.winsB, l = won === a ? rec.winsB : rec.winsA;
        if(w >= need){
          winner[sid] = won;
          log.push({ at: g.end, kind: "clinch", series: sid, team: won, over: lost, score: [w, l] });
        } else {
          log.push({ at: g.end, kind: "game", series: sid, won, game: g.number, score: [w, l] });
        }
      }
      if(!winner[sid]){
        const next = games.filter(g => (g.state === "pre" || g.state === "live") && g.date >= today)
          .sort((x, y) => (x.number - y.number) || byStart(x, y))[0];
        if(next) rec.next = { at: next.start, date: next.date, tbd: next.tbd, game: next.number };
      }
      series[sid] = rec;
    };

    for(const lg of ["AL", "NL"]){
      play(`${lg}_WC1`, "WC", seed[`${lg}3`], seed[`${lg}6`]);
      play(`${lg}_WC2`, "WC", seed[`${lg}4`], seed[`${lg}5`]);
      play(`${lg}_DS1`, "DS", seed[`${lg}1`], winner[`${lg}_WC2`]);
      play(`${lg}_DS2`, "DS", seed[`${lg}2`], winner[`${lg}_WC1`]);
      play(`${lg}_CS`, "CS", winner[`${lg}_DS1`], winner[`${lg}_DS2`]);
    }
    play("WS", "WS", winner.AL_CS, winner.NL_CS);
    log.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
    return { series, log };
  }

  /* ---------- the whole snapshot ---------- */
  function buildSnapshot(raw, { season, now = Date.now() }){
    const games = raw.schedule ? scheduleGames(raw.schedule) : [];
    const post = scheduleGames(raw.postseason);
    const records = {}, champs = new Set();
    standingsRows(raw.standings).forEach(({ id, r }) => {
      records[id] = { w: r.wins, l: r.losses };
      if(r.divisionChamp || (r.divisionRank === "1" && r.divisionLeader)) champs.add(id);
    });

    const grouped = groupPostseason(post, champs);
    const official = officialField(grouped, records);
    const teams = official || projectedField(raw.standings);
    const { series, log } = buildSeries(teams, grouped.bySeries, easternDay(now).date);

    return {
      version: 1,
      season,
      asOf: new Date(now).toISOString(),
      projected: !official,
      teams,
      series,
      log,
      standings: buildStandings(raw.standings, season, games),
      slate: raw.schedule ? buildSlate(games, now) : null
    };
  }

  /* How long the page should wait before asking again, in ms, or null for
     never. Only baseball moves this data, so the page watches closely while
     a game is on and otherwise sleeps until the next one:
     - a game live, or a first pitch within fifteen minutes: thirty seconds.
       A start time that has passed with no first pitch is a delay, and a
       rain delay mid-game still reads as live, so both keep the fast rate.
     - otherwise, until fifteen minutes before the next first pitch -- but
       never more than an hour, because the schedule itself changes with no
       game on: a rainout is rescheduled, a postseason start time is set.
       A first pitch MLB hasn't set yet (`tbd`) is no time to wake for.
     - a season with nothing left to play (no slate): never. */
  function pollDelay(snapshot, now = Date.now()){
    const slate = snapshot && snapshot.slate;
    if(!slate) return null;
    const games = [slate.today, slate.nextDay].filter(Boolean).flatMap(d => d.games);
    if(games.some(g => g.state === "live")) return POLL_LIVE_MS;
    const starts = games.filter(g => g.state === "pre" && !g.tbd).map(g => Date.parse(g.start));
    const wake = Math.min(...starts) - POLL_LEAD_MS - now;
    return Math.min(Math.max(wake, POLL_LIVE_MS), POLL_CHECK_MS);
  }

  return { MLB_API, MLB_TEAM, mlbRequests, fetchSnapshot, buildSnapshot, pollDelay,
    easternDay, addDays, POLL_LIVE_MS, POLL_CHECK_MS };
})();

if(typeof module !== "undefined" && module.exports) module.exports = MLBSnapshot;
