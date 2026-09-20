# MLB Postseason

A personal postseason tracker: the full 12-team bracket, your ranking of who you
want to win the World Series, and last-title context for all 30 clubs. A
scheduled job keeps the scores current so nothing has to be updated by hand.

## Set it up

### 1. Publish the page

Publish `index.html` as a Claude Artifact with the `db` capability and the other
files alongside it:

```
capabilities: { "db": {} }
files: { "styles.css": ..., "teams.js": ..., "bracket.js": ..., "app.js": ... }
```

Save the artifact URL — the next two steps need it.

### 2. Let the job reach MLB

Scheduled runs inherit their cloud environment's network policy, and the default
("Trusted") blocks `statsapi.mlb.com`, so every run would fail with a 403 from
the egress proxy. In the environment's settings, set **Network access** to
**Custom** and add `statsapi.mlb.com`, or pick **Full**.

### 3. Create the routine

At [claude.ai/code/routines](https://claude.ai/code/routines), create a routine
on the environment from step 2, scheduled `0 15-23,0-6 * 9-11 *` — hourly from
roughly 11am to 2am ET, September through November. Hourly is the platform
minimum; the prompt makes off-hours runs exit immediately. Turn on push
notifications if you want an alert when a series is decided.

Paste this as the prompt, with your artifact URL in the first line:

```
You are maintaining a published Claude Artifact — a personal MLB postseason
bracket tracker — at this URL:

<YOUR ARTIFACT URL>

It stores its state via the ArtifactData tool (load via ToolSearch for
"ArtifactData" if it isn't in your tool list). The season's state lives in
collection "seasons", doc id "<YEAR>" (a JSON object). Read it first with a
"get" call.

The doc shape:
{
  year: <YEAR>,
  teams: { "<TEAM_ID>": { league: "AL"|"NL", seed: 1-6 }, ... },   // 12 entries
  series: { "<SERIES_ID>": { winsA: n, winsB: n }, ... },
  ranking: [ "<TEAM_ID>", ... ],   // the user's preference order — NEVER
                                   // overwrite or reorder it; only append team
                                   // ids new to the field and drop ids that
                                   // left it
  projected: true|false,           // true = teams/seeds are your projection
                                   // from standings, not the official bracket
  projectedAsOf: "YYYY-MM-DD"
}

TEAM_ID map (MLB team name -> id): ARI Diamondbacks, ATL Braves, BAL Orioles,
BOS Red Sox, CHC Cubs, CWS White Sox, CIN Reds, CLE Guardians, COL Rockies,
DET Tigers, HOU Astros, KC Royals, LAA Angels, LAD Dodgers, MIA Marlins,
MIL Brewers, MIN Twins, NYM Mets, NYY Yankees, ATH Athletics, PHI Phillies,
PIT Pirates, SD Padres, SF Giants, SEA Mariners, STL Cardinals, TB Rays,
TEX Rangers, TOR Blue Jays, WSH Nationals.

SERIES_ID scheme (per league LG = AL or NL):
- LG_WC1 = seed 3 (side A) vs seed 6 (side B), best-of-3
- LG_WC2 = seed 4 (side A) vs seed 5 (side B), best-of-3
- LG_DS1 = seed 1 (side A) vs [surviving wild card with the WORSE/higher seed
  number] (side B), best-of-5
- LG_DS2 = seed 2 (side A) vs [the other wild card winner] (side B), best-of-5
- LG_CS  = LG_DS1 winner (A) vs LG_DS2 winner (B), best-of-7
- WS     = AL_CS winner (A) vs NL_CS winner (B), best-of-7
A series is decided at 2 wins (best-of-3), 3 (best-of-5), or 4 (best-of-7).

EACH RUN:

1. Call statsapi.mlb.com. If `projected` is true or missing, or `teams` is
   empty: fetch
   /api/v1/standings?leagueId=103,104&season=<YEAR>&standingsTypes=regularSeason
   and check /api/v1/schedule/postseason?season=<YEAR> for whether real team
   names have replaced placeholder seed labels (e.g. "AL Wild Card #3") yet.
   - If the official bracket is NOT set yet, compute the current projected field
     from standings: per league, the 3 division leaders (divisionRank 1) seeded
     1-3 by win%, and the top 3 by wildCardRank seeded 4-6 by win%. If those 12
     team ids differ from the doc's current `teams`, overwrite `teams`, reset
     `series` to {}, append ids new to the field to the END of `ranking` (never
     reordering existing entries) while dropping ids that left it, keep
     `projected: true`, and set `projectedAsOf` to today. If nothing differs,
     leave teams and series alone.
   - If the official bracket IS now set, map those 12 real teams and seeds in,
     reset `series` to {} only if `teams` is actually changing, set
     `projected: false`, remove `projectedAsOf`, and handle `ranking` as above.

2. If `projected` is false, check today's schedule for games that are "Final"
   and belong to an undecided SERIES_ID matchup. Set winsA/winsB to match MLB's
   current series record for that matchup whenever it's ahead of the doc. Only
   act on a confirmed "Final" — never guess or project a result.

3. If nothing changed, end the run without further calls.

4. Write back the WHOLE doc (read, modify in memory, then "set" the full doc
   using `if_version` from the read) so fields you didn't intend to touch
   survive.

Keep each run terse — this is unattended maintenance, not a conversation. Speak
up only for something worth knowing: the projected field changed, the real
bracket locked in, a series was decided, or the API or environment access is
broken.
```

Before the field is official, the routine fills in the bracket that would happen
if the season ended today and refreshes it as the standings move.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Page markup |
| `styles.css` | All styling (single dark "night broadcast" theme) |
| `teams.js` | The 30 clubs: league, last title, official colors |
| `bracket.js` | Bracket rules as pure functions — seeding, reseeding, elimination |
| `app.js` | Rendering, the artifact store, drag-to-rank, manual setup fallback |

`bracket.js` never touches the DOM or storage, so the postseason rules can be
read and changed in one place.

Card geometry is shared between `styles.css` and the `LAY` constants in
`app.js`: a bracket card is 106px tall, with its top row centered 48px down, the
divider between its two teams at 67px, and its bottom row at 86px. The connector
lines are computed from those numbers, so changing a card's padding or font size
means updating both.

## Data

One document per season, at `seasons/<year>`:

```json
{
  "year": 2026,
  "teams": { "TB": { "league": "AL", "seed": 1 }, "...": {} },
  "series": { "AL_WC1": { "winsA": 2, "winsB": 0 }, "...": {} },
  "ranking": ["TB", "MIL", "..."],
  "projected": true,
  "projectedAsOf": "2026-09-19"
}
```

`ranking` is yours alone — the routine only ever appends teams that join the
field or drops ones that leave it. Series scores are read-only in the UI because
the routine owns them.

Nothing here needs credentials: MLB's Stats API is public, and writes to the
artifact store are authorized by the routine running under your own account.
