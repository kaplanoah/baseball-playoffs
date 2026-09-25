# MLB Postseason

A personal postseason tracker: the full 12-team bracket, your ranking of who you
want to win the World Series, division and wild card standings, and last-title
context for all 30 clubs. It keeps itself current: scores, innings, series
records and standings update on the page while you watch, with no reload.

You end up with a private page on claude.ai that you can open on any device.

## How it stays current

The page builds everything MLB decides from three responses of MLB's public
Stats API (standings, the postseason schedule, and the games around today),
through `js/snapshot.js`. No model runs, so there is no token cost:

```
page ──fetch──▶ statsapi.mlb.com                  (if the artifact may reach it)
page ──mcp────▶ MLB Live connector ──▶ statsapi   (otherwise: a Cloudflare Worker)
```

- **When:** every 30 seconds while a game is on or about to start, otherwise
  asleep until 15 minutes before the next first pitch, with a look at the
  schedule at least hourly in case it changed. A game past its start time
  with no first pitch counts as on (that's a delay). Nothing runs while the
  tab is hidden or closed, and a check that fell due runs the moment you come
  back. A finished season isn't polled at all.
- **Cost:** a Worker request and about a millisecond of CPU per poll, well
  inside Cloudflare's free tier (100,000 requests a day; a page left open all
  evening makes a few hundred). MLB's API is free and needs no key.
- **Not open:** nothing updates, and nothing needs to. The page catches up
  the moment it opens.

This replaced a scheduled Claude run that did the same work twelve times a
day, at hundreds of thousands of tokens a run, with updates up to an hour old.

## Setup

You need a claude.ai plan that can add custom connectors (Pro, Max, Team or
Enterprise) and a free Cloudflare account. It takes about ten minutes, most
of it clicking through Cloudflare once.

Paste this into Claude Code:

```
Set up the MLB postseason tracker from
https://github.com/kaplanoah/baseball-playoffs for me. Clone it (branch main),
read the "Setup, for Claude" section of its README, and do everything in it.
```

Claude publishes the page and walks you through the rest: deploying the
connector to your Cloudflare account (or letting Claude deploy it, see
[Deploy](#deploy)) and adding it to claude.ai. The page is private to you and
keeps its own data -- your ranking and what you've dismissed -- so two people
who set this up each get their own.

## Setup, for Claude

**1. Publish the page.** With the Artifact tool, publish `index.html` from
`main` with `icon: "baseball"`, these capabilities:

```
{ "db": {},
  "mcp": { "servers": [ { "server": "MLB Live", "tools": ["get_snapshot"] } ] } }
```

and these supporting files (the page reads its siblings by relative path, so
every one has to go up with it; `js/app.js` boots the page and loads last):

```
files: {
  "styles.css":         "styles.css",
  "js/sortable.min.js": "js/sortable.min.js",
  "js/teams.js":        "js/teams.js",
  "js/bracket.js":      "js/bracket.js",
  "js/bracket-view.js": "js/bracket-view.js",
  "js/ranking.js":      "js/ranking.js",
  "js/updates.js":      "js/updates.js",
  "js/stamp.js":        "js/stamp.js",
  "js/standings.js":    "js/standings.js",
  "js/setup.js":        "js/setup.js",
  "js/snapshot.js":     "js/snapshot.js",
  "js/changes.js":      "js/changes.js",
  "js/live.js":         "js/live.js",
  "js/app.js":          "js/app.js"
}
```

The page seeds itself: the first time it reaches MLB it writes the season,
the standings and the field. There is nothing to write by hand. Until the
connector exists it says so under the title and shows the "Set this year's
playoff field" card; that's expected.

**2. Deploy the connector.** If this session can reach `api.cloudflare.com`
with a credential and has `CLOUDFLARE_ACCOUNT_ID` set, run
`npm run deploy:api` and give the user the URL it prints. Otherwise walk the
user through [Deploy](#deploy): either the one-time environment setup that
lets a new session run `npm run deploy:api`, or deploying it themselves. Never
ask for the token in the chat.

**3. Have the user add it to claude.ai** at
[claude.ai/customize/connectors](https://claude.ai/customize/connectors): a
custom connector named **MLB Live**, exactly (the page asks for it by that
name), with the URL from step 2 and no sign-in.

**4. Check it.** Once they have reopened the page, read collection `live`,
doc `status` with the ArtifactData tool. `source: "connector"` with an empty
`error` and `write` means it works. Otherwise `error` is the connector's
error code (the page explains it in words under the title) and `write` names
a save that failed.

Then give the user the link, and mention that their ranking is theirs to set
on the Ranking tab.

## The live connector

`worker/` is a Cloudflare Worker that speaks just enough of the Model Context
Protocol for claude.ai to add it as a custom connector. It has one read-only
tool, `get_snapshot({ season })`, which returns the same snapshot the page
would build itself. It is stateless, keeps no data, holds no secrets, and has
no dependencies: `npm run build` concatenates `js/snapshot.js` and
`worker/src/mcp.js` into one file, `worker/dist/worker.mjs`, so the page and
the connector can never disagree about what a snapshot is.

### Deploy

Any of three ways; each deploys the same file, `worker/dist/worker.mjs`, as a
Worker named `mlb-live`, reachable at
`https://mlb-live.<your-subdomain>.workers.dev`. The subdomain is the one you
chose for workers.dev in Cloudflare (Workers & Pages asks the first time).

**Let Claude deploy it (Claude Code cloud sessions).** One-time setup, so a
session can deploy without ever seeing your token:

1. In Cloudflare: Manage Account → API Tokens → Create Token, from the
   **Edit Cloudflare Workers** template, scoped to your account. An account
   token is fine. Leave IP filtering off (cloud sessions have no fixed
   address) and set an expiry if you like.
2. Note your **Account ID** (Workers & Pages overview, right-hand column).
3. In Claude Code, edit the cloud environment (the environment menu in the
   session's title bar → Edit):
   - **API credentials → Add credential**: type Bearer, allowed website
     `api.cloudflare.com`, header `Authorization` with prefix `Bearer` and
     the token as the value. The agent proxy adds it to requests for that
     host; sessions never see it. (Pro and Max plans; see
     [API credentials](https://code.claude.com/docs/en/cloud-environments#add-api-credentials).)
   - **Environment variables**: `CLOUDFLARE_ACCOUNT_ID=<your account id>`.
     Not a secret, and never put the token here: variables are visible to
     anyone using the environment.
   - **Network access → Custom**, allowing `mlb-live.<your-subdomain>.workers.dev`
     so a session can test the deployed Worker.
4. Start a new session in that environment (settings are read when a
   session starts) and ask it to run `npm run deploy:api`.

**From your own terminal:** `npx wrangler login`, then `npm run deploy`.

**From the Cloudflare dashboard:** Workers & Pages → Create → Worker, name it
`mlb-live`, and replace its code with the contents of `worker/dist/worker.mjs`.

To check a deploy, open `https://mlb-live.<your-subdomain>.workers.dev/` in a
browser: it should say "MLB Live connector" (`/mcp` says it takes POST only,
which is also right), and `/snapshot?season=2026` shows a snapshot as JSON.

**Add it to claude.ai** at
[claude.ai/customize/connectors](https://claude.ai/customize/connectors):
add a custom connector named **MLB Live** with the URL
`https://mlb-live.<your-subdomain>.workers.dev/mcp` and no sign-in -- it
serves public data and holds nothing to protect. The first time the page
uses it, claude.ai asks you to allow it for the page. Once it works, you can
delete the Cloudflare token or its environment credential; the Worker keeps
running without them.

**Optional: keep it to yourself.** The data is public, but anyone with the
URL could spend your free-tier requests. Set a secret with
`npx wrangler secret put CONNECTOR_KEY` (or under the Worker's Settings →
Variables in the dashboard), and the endpoint moves to `/mcp/<key>`; use that
URL in claude.ai.

Endpoints: `POST /mcp` (MCP, JSON-RPC over plain JSON responses; no sessions
or streaming, since the one tool is a pure read), `GET /snapshot?season=`
(the same answer over plain HTTP), `GET /` (a one-line hello, only without
a key). Upstream requests go through Cloudflare's cache for 15 seconds, and
concurrent calls for one season share a single set of MLB requests, so
several open views cost MLB no more than one.

## Files

| File | What's in it |
| --- | --- |
| `index.html` | Page markup |
| `styles.css` | All styling (single dark "night broadcast" theme) |
| `js/teams.js` | The 30 clubs: league, last title, official colors |
| `js/bracket.js` | Bracket rules as pure functions — seeding, advancement, elimination |
| `js/bracket-view.js` | The bracket tab: cards, connector geometry, the highest-pick banner |
| `js/ranking.js` | The Ranking tab's cards and drag, and the All Teams table |
| `js/updates.js` | The change log's wording — what moved since you last looked |
| `js/stamp.js` | The stamp's sentences, built from the day's games — pure functions |
| `js/standings.js` | Divisions and the wild card race |
| `js/setup.js` | The manual field-setting modal, for when there's no live data |
| `js/snapshot.js` | MLB's three responses → one snapshot, and when to ask again — pure, shared with the Worker |
| `js/changes.js` | What moved between two tables, as log entries, and the log's merge — pure |
| `js/live.js` | Fetching, scheduling, laying live data over the stored season, writing it back, and the stamp |
| `js/app.js` | The season document, the artifact store, shared helpers, boot |
| `js/sortable.min.js` | SortableJS 1.15.6, vendored, for drag-to-rank |
| `worker/src/mcp.js` | The MLB Live connector's MCP server |
| `worker/build.mjs`, `worker/dist/worker.mjs` | The build, and the one deployable file it writes |
| `worker/deploy.mjs` | `npm run deploy:api`: deploys through Cloudflare's REST API, for sessions that hold the token as an API credential |
| `worker/wrangler.toml` | The Worker's name and settings, for both ways of deploying |
| `tests/` | `npm test`: plain `node --test`, no dependencies, no network |

## Development

```
npm test            # checks the Worker build is current, then runs every test
npm run build       # rebuild worker/dist/worker.mjs after changing snapshot.js or mcp.js
npm run deploy      # build and deploy the Worker with wrangler (needs wrangler login)
npm run deploy:api  # build and deploy through the API (CLOUDFLARE_ACCOUNT_ID, and a token or proxy credential)
```

### Changes and releases

`main` is the source of truth, and what is published is always `main`:

- Make each change on its own branch from the latest `main`, and bring it in
  with a pull request. `npm test` passes before it merges; a change to
  `js/snapshot.js` or `worker/src/mcp.js` includes the rebuilt
  `worker/dist/worker.mjs` (the tests fail if it's stale).
- After merging, publish from `main`: the page (the files under
  [Setup, for Claude](#setup-for-claude), to the existing artifact URL) and,
  when `snapshot.js` or `mcp.js` changed, the Worker (see [Deploy](#deploy)).
  Don't publish from a branch that hasn't merged: the next person to publish
  from `main` would silently undo it.
- Start from `main` again before the next change: pull it rather than
  building on an old branch, so two people's work meets in git and not on
  the page.

The tests run against real MLB responses recorded in `tests/fixtures/`: the
whole 2025 postseason, where every seed and every series result has to come
out right, states in between made by winding it back, and the evening of 24
September 2026 with games in progress. `node tests/fixtures/record.js <season>
<name>` records a new one.

`js/bracket.js`, `js/stamp.js`, `js/snapshot.js` and `js/changes.js` never
touch the DOM or storage, so the postseason rules, the stamp's wording and
the data pipeline can each be read, changed and tested in one place. The view
files are plain scripts sharing one `state` global; `snapshot.js` and
`changes.js` each expose a single namespace (`MLBSnapshot`, `LogChanges`) so
they also load under node and in the Worker.

Card geometry is shared between `styles.css` and the `LAY` constants in
`js/bracket-view.js`: a bracket card is 90px tall, with its top row centered
41px down, the divider between its two teams at 57px, and its bottom row at
73px. The connector lines are computed from those numbers, so changing a
card's padding or font size means updating both. The body's `max-width` is set
by the same numbers — seven columns plus their gaps — so widening a card means
widening that too, or the last column clips.

## Data

Everything MLB decides comes from the latest snapshot; the store keeps your
own choices and a copy of MLB's side. The page writes the copy back (only
when something changed) for three reasons: the next snapshot is compared
against it to find what moved, a view that can't reach MLB still shows the
last known state, and a past season's champion is remembered.

One document per season, at `seasons/<year>`:

```json
{
  "year": 2026,
  "teams": { "TB": { "league": "AL", "seed": 1, "w": 96, "l": 66 }, "...": {} },
  "series": {
    "AL_WC1": {
      "winsA": 1, "winsB": 0,
      "next": { "at": "2026-09-30T19:08:00Z", "date": "2026-09-30", "tbd": false, "game": 2 }
    }
  },
  "projected": false,
  "ranking": ["TB", "MIL", "..."],
  "log": [
    { "at": "2026-09-26T02:14:00Z", "kind": "seed", "team": "SD", "from": 5, "to": 4, "over": "CHC" },
    { "at": "2026-09-29T21:41:00Z", "kind": "game", "series": "AL_WC1", "won": "TEX", "game": 1, "score": [1, 0] }
  ],
  "seenAt": "2026-09-29T13:02:00Z"
}
```

| Field | Owner | Notes |
| --- | --- | --- |
| `teams` | MLB | The field, six per league seeded 1–6: official once MLB's postseason schedule names all twelve clubs, projected from the standings until then. `w`/`l` decide World Series home field, where seeds from two leagues can't be compared |
| `series` | MLB | Win counts per series, counted from finals, plus `next`: the next game's `at`, `date`, `tbd` (MLB hasn't set a time) and `game` number. Dropped once a series is decided |
| `projected` | MLB | `true` while the field is a projection |
| `log` | the page | What changed, oldest first, the newest 50. Postseason games and clinches come straight from MLB's schedule; regular-season moves (a club taking a spot, a seed pass, a clinch, an elimination, the bracket locking) from comparing the stored table with the new one. One entry per piece of news, however many views notice it |
| `ranking` | you | Your preference order, best first. Clubs that leave the field are dropped at render time and new ones go last |
| `seenAt` | you | Set by Dismiss. Everything logged before it is read |
| `updatedAt`, `updatedFor`, `nextAt`, `nextFor`, `slate`, `projectedAsOf` | retired | Written by the old scheduled run. Without live data the page still shows `updatedAt` and `slate` as "Saved <time>" |

A second document, `standings/<year>`, holds all 30 clubs for the Standings
tab: wins and losses, win percentage, games back, wild card games back,
elimination numbers, magic numbers, MLB's clinch marker (`clinch`: x a playoff
spot, w a wild card, y the division, z a bye), and each club's next game and
the one after (`next`, `then`; the Next column moves on to `then` once `next`
has started, so even a saved copy never shows a game already under way),
grouped by division. It stops changing when the season ends, and the page
keeps showing the final table through October.

Each standings table asks one question, so each marks one kind of elimination:
a division table dims the clubs that can no longer win the division, a wild
card table dims the ones that can no longer reach the wild card. A club can be
bright in one and dim in the other, which is the honest answer — the Red Sox
can be out of the AL East and still hold a wild card spot.

`live/status` records where this view's live data came from (`direct` or
`connector`) and the last error code, written only when either changes.

Log entries carry data, not sentences: `{ kind, team, from, to, over }` rather
than "the Padres passed the Cubs." `js/updates.js` writes the wording, so the
log reads the same every time and can be restyled without touching the code
that finds the news. `seenAt` lives in the document rather than in browser
storage, so dismissing on a laptop also clears the log on a phone.

Every bracket card puts the home team on the bottom. Within a league that's
the higher seed, which hosts every round; the World Series goes to whichever
pennant winner had the better regular-season record. A matchup with an empty
side keeps its structural order until both teams are known.

`next.at` is a placeholder until `tbd` turns false, so the page reads `date`
rather than the timestamp while a time is unset — converting a placeholder
through local time can land on the wrong calendar day in western timezones.

Last World Series wins stay current on their own: `lastTitle` in `js/app.js`
takes the later of the seeded year in `js/teams.js` and the champion of any
season this tool has tracked.

Nothing needs credentials: MLB's Stats API is public, and the page writes to
its own store as you.
