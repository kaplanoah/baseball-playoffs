# MLB Postseason

A personal postseason tracker: the full 12-team bracket, your ranking of who you
want to win the World Series, division and wild card standings, and last-title
context for all 30 clubs. A scheduled job keeps the scores current.

You end up with a private page, already filled in with this year's bracket, that
you can open on any device.

## Setup

Paste this into Claude Code:

```
Set up the MLB postseason tracker from
https://github.com/kaplanoah/baseball-playoffs for me. Clone it, read the
"Setup, for Claude" section of its README, and do everything in it.
```

Claude publishes the page, fills in the current bracket, and schedules the job
that keeps it updated. It'll pause once to ask you to allow the MLB API through
your environment's network policy, which is the one part it can't do on your
behalf. The whole thing takes a couple of minutes.

## Setup, for Claude

Work through these in order. Steps 3 and 4 need the artifact URL from step 1.

**1. Publish the page.** Using the Artifact tool, publish `index.html` with
`icon: "baseball"`, `capabilities: {"db": {}}`, and the supporting files:

```
files: {
  "styles.css":         "styles.css",
  "js/sortable.min.js": "js/sortable.min.js",
  "js/teams.js":        "js/teams.js",
  "js/bracket.js":      "js/bracket.js",
  "js/bracket-view.js": "js/bracket-view.js",
  "js/ranking.js":      "js/ranking.js",
  "js/updates.js":      "js/updates.js",
  "js/standings.js":    "js/standings.js",
  "js/setup.js":        "js/setup.js",
  "js/app.js":          "js/app.js"
}
```

The `db` capability is what gives the page a place to keep state, and the page
reads its siblings by relative path, so every one of them has to go up with it.
Load order matters: `js/app.js` boots the page and has to come last.

**2. Get the MLB API unblocked.** Scheduled runs inherit the cloud
environment's network policy, and the default ("Trusted") rejects
`statsapi.mlb.com` with a 403 from the egress proxy. Ask the user to open their
cloud environment's settings, set **Network access** to **Custom**, and add
`statsapi.mlb.com` — or choose **Full**. Wait for them to confirm, then verify
before going on:

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=$(date +%F)"
```

A 200 means you're clear; a 403 means the policy hasn't taken effect yet.

**3. Fill in the bracket.** The page is empty until the season doc exists, so
seed it now rather than leaving the user at a setup screen.

Fetch
`/api/v1/schedule/postseason?season=<YEAR>` and check whether real team names
have replaced placeholder seed labels like "AL Wild Card #3". If they have, use
that official bracket. If they haven't, build the field that would happen if the
season ended today, from
`/api/v1/standings?leagueId=103,104&season=<YEAR>&standingsTypes=regularSeason`:
per league, the three division leaders (`divisionRank` 1) seeded 1–3 by win
percentage, then the top three by `wildCardRank` seeded 4–6.

Write it with the ArtifactData tool to collection `seasons`, doc id `<YEAR>`,
using the team ids and doc shape under [Data](#data) below. Set `ranking` to the
12 ids ordered by seed as a starting point — the user drags it into their real
order — and `projected` to `true` unless the official bracket was already set.

**4. Schedule the routine.** Create it with the `create_trigger` tool (or, if
that isn't available, have the user create it at
[claude.ai/code/routines](https://claude.ai/code/routines)):

- **Schedule:** `0 0-6,16-23 * 9-11 *` — hourly from noon to 2am ET, September
  through November. Cron can only fire on a fixed clock, so the window is the
  outer envelope of when a game could be on; the *schedule* decides what each
  run actually does:
  - **The prompt makes the call.** Every run starts with one call to
    `/api/v1/schedule`, and unless a game has gone final since the last run, a
    game is in progress, or one starts within the hour, it writes the two
    timestamps and stops there. Quiet hours cost one request.
  - **Hours** run from noon ET, an hour before the earliest first pitch, to
    2am ET, past the end of a west coast night game. A missed run self-corrects
    — each run syncs to MLB's current series record rather than incrementing,
    so the next one catches up.
  - **Months** are coarse because cron ANDs day-of-month with month, so a
    "Sept 15 → Nov 5" window can't be written as one expression. The early-exit
    above is what keeps the out-of-season hours cheap.
- **Environment:** the one from step 2.
- **Fresh session per run**, with push notifications on, so a decided series
  reaches the user's phone.
- **Prompt:** the block below, with the artifact URL and year filled in.

````
You are maintaining a published Claude Artifact — a personal MLB postseason
bracket tracker — at this URL:

<ARTIFACT URL>

It stores its state via the ArtifactData tool (load via ToolSearch for
"ArtifactData" if it isn't in your tool list). The season's state lives in
collection "seasons", doc id "<YEAR>" (a JSON object). Read it first with a
"get" call.

The doc shape:
```
{
  year: <YEAR>,
  teams: {
    "<TEAM_ID>": { league: "AL"|"NL", seed: 1-6, w: <wins>, l: <losses> }, ...
  },                               // 12 entries
  series: {
    "<SERIES_ID>": {
      winsA: n, winsB: n,
      next: { at: "<ISO timestamp>", date: "YYYY-MM-DD", tbd: true|false, game: n }
    }, ...
  },
  ranking: [ "<TEAM_ID>", ... ],   // the user's own preference order
  log: [ { at: "<ISO timestamp>", kind: "...", ... }, ... ],
                                   // append-only change log, oldest first
  seenAt: "<ISO timestamp>",       // the user's dismiss marker — never write it
  updatedAt: "<ISO timestamp>",    // when this routine last ran — see below
  updatedFor: "<short phrase>",    // what that run found
  nextAt: "<ISO timestamp>",       // when the next run fires
  nextFor: "<short phrase>",       // what it will be looking at
  projected: true|false,           // true = teams/seeds are your projection
                                   // from standings, not the official bracket
  projectedAsOf: "YYYY-MM-DD"
}
```

`w` and `l` are final regular-season win/loss totals. The page needs them for
one thing: World Series home field goes to the pennant winner with the better
regular-season record, and seeds don't compare across leagues. Always include
them when you write `teams`, and never drop them.

COST — this fires hourly across every hour a game could be on, so what a run
does is decided by the schedule, not by the clock. Most runs should end in
seconds:

- Fetch the day's schedule FIRST, before anything else:
  `/api/v1/schedule?sportId=1&date=<today>&hydrate=linescore` — the hydrate
  costs nothing and carries the score and inning of anything in progress, plus
  `/api/v1/schedule/postseason?season=<YEAR>` once `projected` is false. Every
  decision below reads from it, and it is the only call a quiet run makes.
- Then END THE RUN, writing only the four stamp fields (see WRITING), unless
  one of these is true:
  - a game has gone Final since `updatedAt`,
  - a game is in progress,
  - a game starts within the next hour, or
  - `projected` is true, `projectedAsOf` is not today's date, and at least one
    game has gone final today — the once-a-day projected field refresh.
- A skipped or missed hour costs nothing: every run syncs to MLB's current
  series record rather than incrementing, so the next one catches up.

WRITING — read this before any write:

- Use "update" with ONLY the fields you are changing. Never "set" the whole
  document. The page writes `ranking` and `seenAt` from the user's browser; a
  full-document write from here sends your copies back over theirs and silently
  undoes their reordering.
- Pass `if_version` from your "get" on every write. If it fails because the
  version moved, re-read and redo — do not force it.
- `ranking` is the USER'S FIELD. Do not include it in a write at all unless the
  set of teams in the field actually changed. When it did: keep every surviving
  id in its existing relative order, drop ids no longer in the field, and append
  ids new to the field at the end. Never reorder, never regenerate it, never
  sort it by seed.
- `seenAt` is the user's too. Never write it under any circumstance.
- Write `updatedAt`, `updatedFor`, `nextAt` and `nextFor` on EVERY run,
  including runs that change nothing and runs that stop at an early exit above.
  The page shows them as two lines — "Last updated 9:14 AM — 4 finals, incl.
  Yankees 4 Rays 2" and "Next update 11:00 PM — Astros @ Mariners, 9:40" — so
  a quiet stretch explains itself.
  - NAME GAMES, not internals. The user reads these to know which baseball
    caused the change and which game the job is waiting on. "Yankees 5 Rays 2
    final" is the shape; "standings refresh" tells them nothing.
  - A scheduled matchup is written AWAY @ HOME, with the "@", the way the
    standings table writes it. Never "at".
  - A time inside a reason is always a FIRST PITCH, and only for a game that
    hasn't started: "first pitch 7:08". A game already under way has no useful
    clock left, so it is described by score and inning instead.
  - `updatedAt` is the current time. `updatedFor` names the newest baseball
    there is, and NEVER an absence. In order:
      - something finished since the last run: name it. "Yankees 5 Rays 2
        final", "Mets, Braves and 4 others final", "Brewers 4 Cubs 1 final,
        Brewers lead 2-0" when the result moved a series.
      - nothing finished, but a game is on: name it and where it stands.
        "Rays @ Yankees 2-1, 5th".
      - nothing finished and nothing on: name the last final you know of,
        marked as old. "nothing new since Yankees 5 Rays 2".
      - before the day's first pitch: "nothing final yet today".
    Never write what did NOT happen — "no games finished since 7pm" tells
    them nothing they can use.
  - WHEN SEVERAL GAMES ARE INVOLVED, name one and count the rest. The one to
    name is the game whose club sits highest in the user's `ranking` — it is
    their game, and the doc tells you their order — falling back to the
    earliest first pitch when no club in the field is playing. Then "+3 more"
    for the others: "Rays @ Yankees 2-1, 5th, +3 more", "Yankees 5 Rays 2
    final, +7 more", "Astros @ Mariners, first pitch 9:40, +2 more". A bare
    count ("8 games on") names no baseball and is not enough; the exception
    is a September slate, where "11 finals; Padres pass the Cubs for the 5
    seed" says the thing that actually matters.
  - `nextAt` comes from the schedule, not from the clock: the next hour, on
    the hour, at which there will be something to look at. Your schedule fires
    hourly on the hour, noon to 2am Eastern, September through November, so it
    is always one of those hours — the first one that is:
      - AFTER the next first pitch, never before it and never the same minute.
        A check that lands before a game starts sees nothing: for a 1:05 game
        that means 2:00, not 1:00.
      - the next hour, when a game is already under way — the score and inning
        will have moved.
      - the first qualifying hour on the next day that has games, once today's
        slate is over.
    If the hour you land on falls outside the window, use the first one inside
    it that follows.
  - `nextFor` names the game that check is for, chosen the same way:
    "Rays @ Yankees, first pitch 7:08", "Guardians @ Tigers, first pitch
    1:08", "Astros @ Mariners, first pitch 9:40, +2 more". LEAVE IT EMPTY
    when that check is the same game `updatedFor` just named — the page shows
    the time alone rather than saying it twice.
  - NEVER put a day in a reason. The page prints the day with the time when
    it isn't today — "Next update tomorrow 2:00 PM" — so a reason that also
    says "tomorrow" says it twice, and the two can disagree.
  - When the season is over, write `nextAt` and `nextFor` as null. There is no
    next check to promise, and the page drops the line entirely.
- When you write `teams`, `series` or `log`, send that whole object or array
  with every entry you know about, preserving existing win counts, records and
  log entries — a nested merge would otherwise leave stale entries behind.

LOGGING — the page shows the user what changed since they last looked, from
`log`, so every change you write gets an entry in the same write:

- APPEND ONLY. Never reword, reorder or remove an entry that is already there.
  `at` is the current time, ISO 8601 in UTC. Keep at most 50 entries: drop from
  the front when a write would exceed that.
- Entries are data, not prose — the page writes the sentence. Use these shapes
  and no others:
  { at, kind: "field", in: "<TEAM_ID>", out: "<TEAM_ID>" }
      a team entered the projected field and the one it displaced. Omit either
      side only if the field genuinely gained or lost a team on its own.
  { at, kind: "seed", team: "<TEAM_ID>", from: n, to: n, over: "<TEAM_ID>" }
      log ONLY teams that moved UP: every move up implies someone moved down,
      and logging both sides says the same thing twice. `over` names the team
      passed when exactly two teams swapped; omit it otherwise.
  { at, kind: "game", series: "<SERIES_ID>", won: "<TEAM_ID>", game: n,
    score: [<winner's wins>, <loser's wins>] }
      one completed game. `score` is the series record after it, from the
      perspective of whoever won that game.
  { at, kind: "clinch", series: "<SERIES_ID>", team: "<TEAM_ID>",
    over: "<TEAM_ID>", score: [<winner's wins>, <loser's wins>] }
      the series is decided. Log this INSTEAD of a `game` entry for the
      clinching game, never both.
  { at, kind: "lock" }
      the official bracket replaced your projection. Once per season.
  { at, kind: "note", text: "<one short sentence>" }
      only for something the shapes above can't express.
- Log only what you actually wrote, and write nothing you don't log. Refreshed
  `next` times, refreshed `w`/`l` and the stamp fields are not changes — never
  log those.

STANDINGS — a second document, collection "standings", doc id "<YEAR>", holding
all 30 clubs for the Standings tab. Everything but `next` comes from the
`/api/v1/standings` response you already fetch, so it is nearly free:

```
{
  year: <YEAR>,
  updatedAt: "<ISO timestamp>",    // when you last changed this document
  divisions: {
    "AL East": [ {                 // in divisionRank order, leader first
      id: "<TEAM_ID>",
      w: 95, l: 60,                // wins and losses
      pct: ".613",                 // winningPercentage, as the API gives it
      gb: "-" | "6.0",             // divisionGamesBack
      wcgb: "-" | "+4.0" | "3.0",  // wildCardGamesBack
      elim: "-" | "E" | "4",       // eliminationNumber (division)
      wce: "-" | "E" | "3",        // wildCardEliminationNumber
      magic: "6" | null,           // magicNumber, null unless it has one
      clinched: true|false,        // clinchIndicator is x/y/z/w AND divisionLeader
      lead: true|false,            // divisionLeader
      wcrank: "1" | null,          // wildCardRank, null for division leaders
      next: {                      // this club's next unplayed game, or null
        at: "<ISO timestamp>",     //   that game's gameDate
        opp: "<TEAM_ID>",          //   the other club
        home: true|false,          //   true when this club is hosting
        tbd: true|false            //   its status.startTimeTBD
      }
    }, ... ],
    "AL Central": [...], "AL West": [...],
    "NL East": [...], "NL Central": [...], "NL West": [...]
  }
}
```

- Write it with "set", not "update": it is entirely yours, the page never
  writes it, and a stale club would otherwise linger.
- Only write when a value actually changed. Compare against what you read.
- Once the regular season is over these stop moving. Leave the document alone
  rather than rewriting identical numbers — the page keeps showing the final
  table all postseason.
- `next` needs one more request: `/api/v1/schedule?sportId=1&startDate=<today>
  &endDate=<today + 4 days>`. Take each club's earliest game that isn't Final.
  It's the only extra call in the run, and only while the regular season is on.
- Once every club is out of games, drop `next` entirely rather than leaving
  last week's matchup sitting in the table.
- Do not log standings changes. The update log is for the bracket; standings
  move every day and would bury it.

TEAM_ID map (MLB team name -> id): ARI Diamondbacks, ATL Braves, BAL Orioles,
BOS Red Sox, CHC Cubs, CWS White Sox, CIN Reds, CLE Guardians, COL Rockies,
DET Tigers, HOU Astros, KC Royals, LAA Angels, LAD Dodgers, MIA Marlins,
MIL Brewers, MIN Twins, NYM Mets, NYY Yankees, ATH Athletics, PHI Phillies,
PIT Pirates, SD Padres, SF Giants, SEA Mariners, STL Cardinals, TB Rays,
TEX Rangers, TOR Blue Jays, WSH Nationals.

SERIES_ID scheme (per league LG = AL or NL). The bracket is FIXED, not reseeded:
- LG_WC1 = seed 3 (side A) vs seed 6 (side B), best-of-3
- LG_WC2 = seed 4 (side A) vs seed 5 (side B), best-of-3
- LG_DS1 = seed 1 (side A) vs the LG_WC2 (4/5) winner (side B), best-of-5
- LG_DS2 = seed 2 (side A) vs the LG_WC1 (3/6) winner (side B), best-of-5
- LG_CS  = LG_DS1 winner (A) vs LG_DS2 winner (B), best-of-7
- WS     = AL_CS winner (A) vs NL_CS winner (B), best-of-7
A series is decided at 2 wins (best-of-3), 3 (best-of-5), or 4 (best-of-7).

In `/api/v1/schedule/postseason`, map a game to a SERIES_ID from its
`seriesDescription` plus its placeholder team names: a Wild Card game hosted at
"<LG> #3 Seed" is LG_WC1 and one hosted at "<LG> Wild Card #1" is LG_WC2; a
Division Series game whose away side is "<LG> 4/5 Winner" is LG_DS1 and
"<LG> 3/6 Winner" is LG_DS2.

EACH RUN, after the early-exit checks above:

1. If `projected` is true or missing, or `teams` is empty: fetch
   `/api/v1/standings?leagueId=103,104&season=<YEAR>&standingsTypes=regularSeason`
   and check `/api/v1/schedule/postseason?season=<YEAR>` for whether real team
   names have replaced placeholder seed labels (e.g. "AL Wild Card #3") yet.
   - FIRST, before the branches below and whichever one you end up in: rebuild
     the `standings` document from that same response and write it if any value
     moved. It needs no extra request beyond the schedule call for `next`, and
     a branch that ends in "stop" still does this.
   - If the official bracket is NOT set yet: compute the current projected field
     from standings — per league, the 3 division leaders (divisionRank 1) seeded
     1-3 by win%, and the top 3 by wildCardRank seeded 4-6 by win%. Then compare
     it against the doc's current `teams`:
     - Same 12 ids, same seeds: refresh `w`/`l` if they moved, write
       `projectedAsOf` (today), and stop. Nothing to log.
     - Same 12 ids, seeds moved: write `teams` with the new seeds and current
       `w`/`l`, log a `seed` entry for each team that moved UP, set
       `projectedAsOf` to today. Leave `series` and `ranking` alone.
     - The set of ids changed: write `teams`, reset each series' win counts to
       0, adjust `ranking` under the rules above, keep `projected: true`, set
       `projectedAsOf` to today, and log a `field` entry per team that entered,
       paired with one that left. Log the seed moves of teams that stayed only
       if a team's seed changed for a reason other than the swap.
   - If the official bracket IS now set: write the 12 real teams with their
     seeds and final `w`/`l`, reset win counts only if `teams` is actually
     changing, set `projected: false`, remove `projectedAsOf`, adjust `ranking`
     under the rules above, and log one `lock` entry plus a `field` entry for
     each team the official bracket has that your projection didn't. Don't log
     seed changes here — `lock` covers them.

2. Refresh each undecided series' `next` from
   `/api/v1/schedule/postseason?season=<YEAR>`: its earliest game today or
   later, as `{ at: <that game's gameDate>, date: <its officialDate>,
   tbd: <its status.startTimeTBD>, game: <its seriesGameNumber> }`. Drop `next`
   from a series once it's decided. Only write if something actually changed —
   game times firm up gradually, so don't rewrite identical values, and never
   log a `next` change.

3. If `projected` is false: check today's schedule for games that are "Final"
   and belong to an undecided SERIES_ID matchup. Update `series` so winsA/winsB
   match MLB's current series record for that matchup whenever it's ahead of the
   doc. Only act on a confirmed "Final" — never guess or project a result. Log
   each game you record: a `game` entry, or a `clinch` entry if that game ended
   the series. If the record moved by more than one game (a run was missed),
   log one entry per finished game you can identify from the schedule, oldest
   first.

4. If nothing else changed, still write the four stamp fields before ending
   the run. They are the whole point of a quiet run.

Keep each run terse — this is unattended maintenance, not a conversation. Speak
up only for something worth knowing: the field changed, the real bracket locked
in, a series was decided, or the API or environment access is broken.
````

When you're done, give the user the artifact link and mention that their ranking
is theirs to set on the Ranking tab.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Page markup |
| `styles.css` | All styling (single dark "night broadcast" theme) |
| `js/teams.js` | The 30 clubs: league, last title, official colors |
| `js/bracket.js` | Bracket rules as pure functions — seeding, advancement, elimination |
| `js/bracket-view.js` | The bracket tab: cards, connector geometry, the highest-pick banner |
| `js/ranking.js` | The Ranking tab's cards and drag, and the All Teams table |
| `js/updates.js` | The change log — what moved since you last looked |
| `js/standings.js` | Divisions, the wild card race, and the freshness stamp |
| `js/setup.js` | The manual field-setting modal, for when the routine hasn't |
| `js/app.js` | The season document, the artifact store, shared helpers, boot |
| `js/sortable.min.js` | SortableJS 1.15.6, vendored, for drag-to-rank |

`js/bracket.js` never touches the DOM or storage, so the postseason rules can be
read and changed in one place. The view files are plain scripts sharing one
`state` global; `js/app.js` loads last because it is what boots the page.

Card geometry is shared between `styles.css` and the `LAY` constants in
`js/bracket-view.js`: a bracket card is 90px tall, with its top row centered 41px down, the
divider between its two teams at 57px, and its bottom row at 73px. The connector
lines are computed from those numbers, so changing a card's padding or font size
means updating both. The body's `max-width` is set by the same numbers — seven
columns plus their gaps — so widening a card means widening that too, or the
last column clips.

## Data

One document per season, at `seasons/<year>`:

```json
{
  "year": 2026,
  "teams": { "TB": { "league": "AL", "seed": 1, "w": 94, "l": 68 }, "...": {} },
  "series": {
    "AL_WC1": {
      "winsA": 2, "winsB": 0,
      "next": { "at": "2026-09-29T23:08:00Z", "date": "2026-09-29", "tbd": false, "game": 3 }
    }
  },
  "ranking": ["TB", "MIL", "..."],
  "log": [
    { "at": "2026-09-19T02:14:00Z", "kind": "seed", "team": "SD", "from": 5, "to": 4, "over": "CHC" },
    { "at": "2026-10-01T02:41:00Z", "kind": "game", "series": "AL_WC1", "won": "TEX", "game": 2, "score": [2, 0] }
  ],
  "seenAt": "2026-09-19T13:02:00Z",
  "updatedAt": "2026-09-21T13:14:00Z",
  "projected": true,
  "projectedAsOf": "2026-09-19"
}
```

Fields, and who owns each:

| Field | Written by | Notes |
| --- | --- | --- |
| `teams` | routine | The 12-team field, 6 per league, seeded 1–6 |
| `teams.*.w` / `.l` | routine | Regular-season win and loss totals. Used to decide World Series home field, where seeds from two leagues can't be compared |
| `series` | routine | Win counts per series, plus `next` |
| `series.*.next` | routine | The next scheduled game: `at` (timestamp), `date` (plain calendar date), `tbd` (whether MLB has set a real first pitch), `game` (number within the series). Dropped once the series is decided |
| `ranking` | you | Your preference order, best first |
| `log` | routine | Append-only record of every change it makes, oldest first, capped at 50 |
| `seenAt` | you | Set by Dismiss. Everything logged before it is read |
| `updatedAt` / `updatedFor` | routine | When the routine last ran and the newest baseball it knows of — a final, or the score and inning of a game in progress. Written on every run, including quiet ones, and never phrased as an absence |
| `nextAt` / `nextFor` | routine | When the next check lands and which game it's for. The page prints the day with the time when it isn't today, so `nextFor` never carries one. It's empty when that game is the one `updatedFor` just named, and both are null once the season is over, which drops the line from the page |
| `projected` | routine | `true` while the field is a projection from standings |
| `projectedAsOf` | routine | Date of the last projection refresh; doubles as the routine's once-a-day guard |

`ranking` is yours alone — the routine only appends teams that join the field or
drops ones that leave it. Series scores are read-only in the UI because the
routine owns them.

The update log answers "what happened since I last looked." The routine appends
one entry per change it writes — a game, a clinched series, a team entering the
projected field, a team passing another for a seed — and the page shows the ones
newer than `seenAt`, which Dismiss moves to now. `seenAt` lives in the document
rather than in browser storage, so dismissing on a laptop also clears the log on
a phone.

Entries carry data, not sentences: `{ kind, team, from, to, over }` rather than
"the Padres passed the Cubs." `js/updates.js` writes the wording, so the log reads the
same every time and can be restyled without touching the job that fills it. Each
`kind` and its fields are specified in the routine prompt above.

Every bracket card puts the home team on the bottom. Within a league that's
the higher seed, which hosts every round; the World Series goes to whichever
pennant winner had the better regular-season record, which is what `w` and `l`
are there for. A matchup with an empty side keeps its structural order until
both teams are known.

A second document, `standings/<year>`, holds all 30 clubs for the Standings
tab: wins and losses, win percentage, games back, wild card games back,
elimination numbers, clinch status and each club's next game, grouped by
division. Everything but the next game comes from the standings response the
routine already fetches; the next game costs one more schedule request, and
only while the regular season is on. The table stops changing when the season
ends — the page keeps showing the final standings through October — and `next`
is dropped once nobody has a game left. The routine owns this document
outright; the page only reads it.

Each standings table asks one question, so each marks one kind of elimination:
a division table dims the clubs that can no longer win the division, a wild
card table dims the ones that can no longer reach the wild card. A club can be
bright in one and dim in the other, which is the honest answer — the Red Sox
can be out of the AL East and still hold a wild card spot.

`next.at` is a placeholder until `tbd` turns false, so the page reads `date`
rather than the timestamp while a time is unset — converting a placeholder
through local time can land on the wrong calendar day in western timezones.

Last World Series wins stay current on their own: `lastTitle` in `js/app.js` takes
the later of the seeded year in `js/teams.js` and the champion of any season this
tool has tracked, so a title won while the tracker is running supersedes the
static table without anyone editing it.

Nothing here needs credentials: MLB's Stats API is public, and writes to the
artifact store are authorized by the routine running under your own account.
