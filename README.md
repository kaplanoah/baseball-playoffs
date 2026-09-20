# MLB Postseason

A personal postseason tracker: the full 12-team bracket, your ranking of who you
want to win the World Series, and last-title context for all 30 clubs. A
scheduled job keeps the scores current, so nothing gets updated by hand.

You end up with a private page that works on your phone, already filled in with
this year's bracket.

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
  "styles.css": "styles.css",
  "teams.js":   "teams.js",
  "bracket.js": "bracket.js",
  "app.js":     "app.js"
}
```

The `db` capability is what gives the page a place to keep state, and the page
reads its siblings by relative path, so all four have to go up with it.

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

- **Schedule:** `0 15-23,0-6 * 9-11 *` — hourly from roughly 11am to 2am ET,
  September through November. Hourly is the platform minimum, and the prompt
  makes off-hours runs exit immediately.
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
````

When you're done, give the user the artifact link and mention that their ranking
is theirs to set on the Ranking tab.

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

`ranking` is yours alone — the routine only appends teams that join the field or
drops ones that leave it. Series scores are read-only in the UI because the
routine owns them.

Nothing here needs credentials: MLB's Stats API is public, and writes to the
artifact store are authorized by the routine running under your own account.
