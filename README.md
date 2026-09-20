# MLB Postseason

A personal postseason tracker: the full 12-team bracket, your ranking of who you
want to win the World Series, and last-title context for all 30 clubs. A
scheduled job keeps the scores current.

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

- **Schedule:** `0 0-5,23 * 9-10 *` — hourly from 7pm to 1am ET, September and
  October. Check the season's real dates first with
  `/api/v1/schedule/postseason?season=<YEAR>` and adjust the months if that
  year's World Series runs into November. The window is deliberately narrow,
  since each run costs tokens whether or not anything changed:
  - **Hours** cover when games *finish*, which is the only thing being
    recorded. A result landing up to an hour late costs nothing, and a missed
    run self-corrects — each run syncs to MLB's current series record rather
    than incrementing, so the next one catches up.
  - **Months** are coarse because cron ANDs day-of-month with month, so a
    "Sept 15 → Oct 31" window can't be written as one expression. September
    runs before the postseason are near-free: the prompt refreshes the
    projected field once a day and exits immediately on every run after that.
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
  teams: { "<TEAM_ID>": { league: "AL"|"NL", seed: 1-6, w: n, l: n }, ... },
                                   // 12 entries; w/l are final regular-season
                                   // win and loss totals
  series: {
    "<SERIES_ID>": {
      winsA: n, winsB: n,
      next: { at: "<ISO timestamp>", date: "YYYY-MM-DD", tbd: true|false, game: n }
    }, ...
  },
  ranking: [ "<TEAM_ID>", ... ],   // the user's preference order — NEVER
                                   // overwrite or reorder it; only append team
                                   // ids new to the field and drop ids that
                                   // left it
  projected: true|false,           // true = teams/seeds are your projection
                                   // from standings, not the official bracket
  projectedAsOf: "YYYY-MM-DD"
}

COST — this runs unattended several times a day, so bail out early rather than
doing work that changes nothing:

- If `projected` is true and `projectedAsOf` is already today's date, the field
  has been refreshed today already. End the run immediately, without calling the
  MLB API.
- If `projected` is false and there are no MLB postseason games today, end the
  run immediately after that one schedule check.

WRITING — read this before any write:

- Use "update" with ONLY the fields you are changing. Never "set" the whole
  document. The page writes `ranking` from the user's browser; a full-document
  write from here sends your copy of `ranking` back over theirs and silently
  undoes their reordering.
- Pass `if_version` from your "get" on every write. If it fails because the
  version moved, re-read and redo — do not force it.
- `ranking` is the USER'S FIELD. Do not include it in a write at all unless the
  set of teams in the field actually changed. When it did: keep every surviving
  id in its existing relative order, drop ids no longer in the field, and append
  ids new to the field at the end. Never reorder, never regenerate it, never
  sort it by seed.
- When you write `series` or `teams`, send that whole object with every entry
  you know about, preserving existing win counts — a nested merge would
  otherwise leave stale entries behind.
- `w` and `l` are the final regular-season win and loss totals. The page needs
  them for one thing: World Series home field goes to the pennant winner with
  the better regular-season record, and seeds don't compare across leagues.
  Always include them when you write `teams`, and never drop them.

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

In /api/v1/schedule/postseason, map a game to a SERIES_ID from its
seriesDescription plus its placeholder team names: a Wild Card game hosted at
"<LG> #3 Seed" is LG_WC1 and one hosted at "<LG> Wild Card #1" is LG_WC2; a
Division Series game whose away side is "<LG> 4/5 Winner" is LG_DS1 and
"<LG> 3/6 Winner" is LG_DS2.

EACH RUN, after the early-exit checks above:

1. If `projected` is true or missing, or `teams` is empty: fetch
   /api/v1/standings?leagueId=103,104&season=<YEAR>&standingsTypes=regularSeason
   and check /api/v1/schedule/postseason?season=<YEAR> for whether real team
   names have replaced placeholder seed labels (e.g. "AL Wild Card #3") yet.
   - If the official bracket is NOT set yet: compute the current projected field
     from standings — per league, the 3 division leaders (divisionRank 1) seeded
     1-3 by win%, and the top 3 by wildCardRank seeded 4-6 by win%. Compare
     those 12 team ids against the doc's current `teams`. If the SET of ids is
     unchanged, refresh each team's `w`/`l` from the same standings response if
     they moved, write `projectedAsOf` (today), and stop — reseeding within the
     same 12 is not worth disturbing the doc. If the set did change, update
     `teams` with seeds and current `w`/`l`, reset `series` to {}, adjust
     `ranking` under the rules above, keep `projected: true`, and set
     `projectedAsOf` to today.
   - If the official bracket IS now set: write the 12 real teams with their
     seeds and their final regular-season `w`/`l` from standings, reset `series`
     to {} only if the set of teams is actually changing, set `projected: false`,
     remove `projectedAsOf`, and adjust `ranking` under the rules above.

2. Refresh each undecided series' `next` from
   /api/v1/schedule/postseason?season=<YEAR>: its earliest game today or later,
   as { at: <that game's gameDate>, date: <its officialDate>,
   tbd: <its status.startTimeTBD>, game: <its seriesGameNumber> }. Drop `next`
   from a series once it's decided. Only write if something actually changed —
   game times firm up gradually, so don't rewrite identical values.

3. If `projected` is false: check today's schedule for games that are "Final"
   and belong to an undecided SERIES_ID matchup. Update `series` so winsA/winsB
   match MLB's current series record for that matchup whenever it's ahead of the
   doc. Only act on a confirmed "Final" — never guess or project a result. Write
   only the `series` field.

4. If nothing changed, end the run without writing.

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
| `teams.js` | The 30 clubs: league, last title, official colors |
| `bracket.js` | Bracket rules as pure functions — seeding, advancement, elimination |
| `app.js` | Rendering, the artifact store, drag-to-rank, manual setup fallback |

`bracket.js` never touches the DOM or storage, so the postseason rules can be
read and changed in one place.

Card geometry is shared between `styles.css` and the `LAY` constants in
`app.js`: a bracket card is 90px tall, with its top row centered 41px down, the
divider between its two teams at 57px, and its bottom row at 73px. The connector
lines are computed from those numbers, so changing a card's padding or font size
means updating both.

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
| `projected` | routine | `true` while the field is a projection from standings |
| `projectedAsOf` | routine | Date of the last projection refresh; doubles as the routine's once-a-day guard |

`ranking` is yours alone — the routine only appends teams that join the field or
drops ones that leave it. Series scores are read-only in the UI because the
routine owns them.

Every bracket card puts the home team on the bottom. Within a league that's
the higher seed, which hosts every round; the World Series goes to whichever
pennant winner had the better regular-season record, which is what `w` and `l`
are there for. A matchup with an empty side keeps its structural order until
both teams are known.

`next.at` is a placeholder until `tbd` turns false, so the page reads `date`
rather than the timestamp while a time is unset — converting a placeholder
through local time can land on the wrong calendar day in western timezones.

Last World Series wins stay current on their own: `lastTitle` in `app.js` takes
the later of the seeded year in `teams.js` and the champion of any season this
tool has tracked, so a title won while the tracker is running supersedes the
static table without anyone editing it.

Nothing here needs credentials: MLB's Stats API is public, and writes to the
artifact store are authorized by the routine running under your own account.
