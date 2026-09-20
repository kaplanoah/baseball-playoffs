# MLB Postseason

A personal postseason tracker: the full 12-team bracket, your own ranking of who
you want to win it all, and last-World-Series-win context for all 30 clubs.
Replaces a spreadsheet that had to be updated by hand.

Two pieces do the work:

- **The page** — a published Claude Artifact. Reads and writes a small JSON
  document store scoped to that artifact, so state follows you across devices
  (phone, browser, anywhere you can open claude.ai).
- **A scheduled routine** — a Claude Code routine that checks MLB's public Stats
  API on a schedule and writes results into that same store. The page never
  fetches anything itself; published artifacts can't reach external APIs.

You rank teams. The routine does everything else.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Page markup only |
| `styles.css` | All styling (single dark "night broadcast" theme) |
| `teams.js` | Static data for all 30 clubs: league, last WS win, official colors |
| `bracket.js` | Bracket rules as pure functions — seeding, reseeding, who's eliminated |
| `app.js` | Rendering, the artifact store, drag-to-rank, setup fallback |

`bracket.js` is deliberately free of DOM and storage calls: given a season
document it always returns the same bracket, so the postseason rules can be read
and changed in one place.

## Data shape

One document per season, at `seasons/<year>` in the artifact's store:

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

- `teams` — the 12-team field, 6 per league, seeded 1–6.
- `series` — game wins per series. Side A/B follow the bracket below.
- `ranking` — your preference order, best first. **Only you write this**; the
  routine never reorders it.
- `projected` — `true` while the field is a projection from current standings,
  `false` once MLB's official bracket is locked.

Series IDs, per league (`LG` = `AL` or `NL`):

| ID | Matchup | Length |
| --- | --- | --- |
| `LG_WC1` | seed 3 (A) vs seed 6 (B) | best of 3 |
| `LG_WC2` | seed 4 (A) vs seed 5 (B) | best of 3 |
| `LG_DS1` | seed 1 (A) vs surviving wild card with the worse seed (B) | best of 5 |
| `LG_DS2` | seed 2 (A) vs the other wild card winner (B) | best of 5 |
| `LG_CS` | DS1 winner (A) vs DS2 winner (B) | best of 7 |
| `WS` | AL champion (A) vs NL champion (B) | best of 7 |

## Setup

### 1. Publish the page

Publish `index.html` as a Claude Artifact with the `db` capability declared and
the other files alongside it:

```
capabilities: { "db": {} }
files: { "styles.css": ..., "teams.js": ..., "bracket.js": ..., "app.js": ... }
```

Keep the artifact URL — the routine needs it.

### 2. Allow the MLB API

Routines inherit their cloud environment's network policy, and the default
("Trusted") blocks `statsapi.mlb.com`. In the environment's settings, set
**Network access** to **Custom** and add `statsapi.mlb.com` (or choose **Full**).
Without this every run fails with a 403 from the egress proxy.

### 3. Create the routine

Schedule it hourly during the postseason window only — `0 15-23,0-6 * 9-11 *`
(UTC) covers roughly 11am–2am ET, September through November. Hourly is the
platform minimum; the prompt keeps each off-hours run cheap by exiting early.

Paste this as the routine's prompt, replacing the URL with your artifact's:

```
You are maintaining a published Claude Artifact — a personal MLB postseason
bracket tracker — at this URL:

<YOUR ARTIFACT URL>

It stores its state via the ArtifactData tool (load via ToolSearch for
"ArtifactData" if not in your tool list). The season's state lives in collection
"seasons", doc id "<YEAR>" (a JSON object). Read it first with a "get" call.

The doc shape:
{
  year: <YEAR>,
  teams: { "<TEAM_ID>": { league: "AL"|"NL", seed: 1-6 }, ... },   // 12 entries
  series: { "<SERIES_ID>": { winsA: n, winsB: n }, ... },
  ranking: [ "<TEAM_ID>", ... ],   // user's preference order — NEVER overwrite or
                                   // reorder; only append newly-appearing team ids
                                   // and drop ids no longer in the field
  projected: true|false,           // true = teams/seeds are YOUR projection from
                                   // standings, not the official bracket yet
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
- LG_DS1 = seed 1 (side A) vs [surviving WC winner with the WORSE/higher seed
  number] (side B), best-of-5
- LG_DS2 = seed 2 (side A) vs [the other WC winner] (side B), best-of-5
- LG_CS  = LG_DS1 winner (A) vs LG_DS2 winner (B), best-of-7
- WS     = AL_CS winner (A) vs NL_CS winner (B), best-of-7
A series is decided at 2 wins (best-of-3), 3 (best-of-5), or 4 (best-of-7).

EACH RUN:

1. Call statsapi.mlb.com. If `projected` is true or missing, or `teams` is empty:
   fetch /api/v1/standings?leagueId=103,104&season=<YEAR>&standingsTypes=regularSeason
   and check /api/v1/schedule/postseason?season=<YEAR> for whether real team names
   have replaced placeholder seed labels (e.g. "AL Wild Card #3") yet.
   - If the official bracket is NOT set yet: compute the current projected field
     from standings — per league, the 3 division leaders (divisionRank 1) seeded
     1-3 by win%, and the top 3 by wildCardRank seeded 4-6 by win%. If the 12 team
     ids differ from the doc's current `teams`, overwrite `teams`, reset `series`
     to {}, append newly-appearing ids to the END of `ranking` (never reorder
     existing entries; drop ids no longer in the field), keep `projected: true`,
     and set `projectedAsOf` to today. If unchanged, leave teams/series alone.
   - If the official bracket IS now set: map those 12 real teams/seeds in, reset
     `series` to {} only if `teams` is changing, set `projected: false`, remove
     `projectedAsOf`, and keep `ranking` as above.

2. If `projected` is false: check today's schedule for games that are "Final" and
   correspond to an undecided SERIES_ID matchup. Set winsA/winsB to match MLB's
   actual current series record for that matchup whenever it's ahead of the doc.
   Never guess — only act on confirmed "Final" results.

3. If nothing changed, end quickly without further calls.

4. Always write back the WHOLE doc (read -> modify in memory -> "set" the full
   doc, using `if_version` from the read) so you never clobber fields you didn't
   intend to touch.

Keep each run terse — unattended background maintenance, not a conversation. Only
surface something noteworthy (the projected field changed, the real bracket locked
in, a series got decided, or the API/env access is broken) — otherwise end quietly.
```

Turn on push notifications for the routine if you want an alert when a series is
decided.

## Notes

- Before the field is official, the routine fills in the bracket that *would*
  happen if the season ended today, and refreshes it as standings move.
- Nothing here needs credentials. MLB's Stats API is public and unauthenticated;
  writes to the artifact store are authorized by the routine running under your
  own account.
- Series scores are read-only in the UI on purpose — the routine owns them.
