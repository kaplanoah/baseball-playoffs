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

- **Schedule:** three Routines, together a clock grid:
  - `15 16,23,0-6 * 9-11 *` — noon ET, then hourly 7pm to 2am
  - `30 2,3,4,5 * 9-11 *` and `45 2,3,4,5 * 9-11 *` — 10pm to 2am only

  Seventeen fires a day rather than twenty-four, concentrated where games end.
  Two quirks of the scheduler shape this. A cron minute of `0` is **not**
  honoured: minute-`0` schedules get spread across the hour (this one sat at
  `:08` for weeks). Nor is a minute honoured when the hours are written as a
  range — `30 2-5` fired at `:35`, while `30 2,3,4,5` fires at `:30`. So every
  expression here uses a non-zero minute and an explicit hour list.

  Cron cannot be conditional, so this is the outer envelope; the *instructions*
  decide what each run actually does:
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
  - **A run cannot schedule extra runs.** Verified, not assumed: a run was
    told to call `create_trigger` with exact arguments, the run succeeded, and
    no trigger was created. Routine-fired sessions are built without connector
    (`mcp__*`) tools, and every scheduling tool is one. A Routine created from
    the claude.ai Routines UI may be able to carry those connectors — untested.
    Until then the grid above is the whole schedule, and each run picks its
    `nextAt` from that fixed list rather than promising a time that cannot
    happen.
  - **Quiet runs must be cheap.** The grid cannot know whether baseball is on,
    so most runs have nothing to do. The instructions require a quiet run to
    make one filtered schedule call, write the stamp, and stop — no standings,
    no postseason endpoint, no second look.
  - **Every run leaves a record** at `routine/lastrun`: what it fetched,
    whether it filtered, how many turns it took, and anything that failed. A
    run's final message goes nowhere anyone reads, so this is the only way a
    fault surfaces.
  - **Keep each run small.** Cost is dominated by context re-read on every
    turn, not by the number of runs: the MLB payloads are ~53k tokens if they
    land raw. The instructions require filtering every response down to the
    handful of fields actually used.
- **Environment:** the one from step 2.
- **Fresh session per run**, with push notifications on, so a decided series
  reaches the user's phone.
- **Prompt:** not the instructions themselves — just this bootstrap, with the
  artifact URL filled in:

  ```
  You maintain a published Claude Artifact — a personal MLB postseason bracket
  tracker — at this URL:

  <ARTIFACT URL>

  YOUR INSTRUCTIONS ARE NOT IN THIS MESSAGE. They live in the artifact's own
  database, so that this schedule, the follow-up checks it schedules, and the
  project's README all read one copy rather than three that drift apart.

  Fetch them first, before anything else:

  - Load the ArtifactData tool (ToolSearch for "ArtifactData" if it is not
    already in your tool list).
  - Read collection "routine", doc id "prompt", from the artifact URL above.
  - Its `text` field holds your full instructions. Follow them exactly, as
    though they had been given to you here directly. They tell you what to
    fetch, what to write, and when to schedule your next check.

  If that read fails, or the document is missing or empty, do NOT improvise a
  run from memory and do NOT write anything to the artifact: a half-guessed
  write is worse than a skipped hour. Say plainly that the instructions could
  not be read, name the error, and stop.
  ```

**5. Store the instructions.** Write the block below, with the artifact URL and
year filled in, to collection `routine`, doc id `prompt`, as a single field
named `text`. That is the copy every run reads — the schedule's own runs and
the one-shot follow-ups they create. Changing how the routine behaves later
means editing this document, not the Routine.

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

COST — a run is expensive, so two rules govern everything below: run rarely,
and keep each run small. Rarely is handled by the schedule, which fires nine
times a day at the hours baseball is actually on. Small is up to you, and it
is mostly about how much text you let into your context:

- NEVER LET A RAW API RESPONSE INTO YOUR CONTEXT. This is the single biggest
  thing you control. The standings response is 80KB, the five-day schedule
  90KB, the day's schedule with linescores 40KB — together about 53,000
  tokens, and every one of them is re-read on every turn of the run for the
  rest of the run. Pipe each fetch through a filter and print only the handful
  of fields named below, a few hundred tokens instead of tens of thousands:

      curl -sS "<url>" | python3 -c "
      import sys, json
      d = json.load(sys.stdin)
      ...print only what the rules below need...
      "

  Never `curl` an endpoint and let the body land in the transcript, never
  `cat` a saved response, and never read one back with the Read tool. If you
  need a field you did not extract, widen the filter and run it again — that
  is far cheaper than having had the whole body in context all along.
  From the day's schedule you need, per game: start time, status, the two
  clubs, the score, the inning, and — for anything final — `gameInfo`'s
  `firstPitch` and `gameDurationMinutes`, which give you the time it ended.
  From standings, per club: the fields the STANDINGS section below lists,
  and nothing else. Work in as few turns as
  you can: each turn re-reads everything already in context.

- STOP EARLY AND STOP CHEAP. Most runs have nothing to do: the schedule is a
  fixed grid of clock times, and it cannot know whether baseball is on. YOUR
  JOB ON A QUIET RUN IS TO COST ALMOST NOTHING. One filtered call, four stamp
  fields, done — no standings, no postseason endpoint, no second look. A
  quiet run that takes fifteen turns and reads three endpoints has done more
  damage than the stale minute it was trying to prevent.

  So: make the ONE schedule call below, filtered, and read off it whether any
  game today has gone final since `updatedAt`, is in progress, or starts
  within the hour. IF NONE OF THOSE IS TRUE — and on a day with no games at
  all it plainly is not — write the four stamp fields, write your `lastrun`
  record, and END THE RUN. Do not go on to the numbered sections.

- Fetch the day's schedule FIRST, before anything else:
  `/api/v1/schedule?sportId=1&date=<today>&hydrate=linescore,gameInfo` — the
  hydrates cost nothing in context and between them carry everything a stamp
  needs: `linescore` the score and inning of anything in progress, `gameInfo`
  the `firstPitch` and `gameDurationMinutes` of anything already final. Add
  `/api/v1/schedule/postseason?season=<YEAR>` once `projected` is false. Every
  decision below reads from it, and it is the only call a quiet run makes.

  A FINAL GAME'S END TIME IS firstPitch + gameDurationMinutes. That is where
  "final at 9:14" comes from, and the one call above has it for every game on
  the slate at once. NEVER call `/api/v1.1/game/<pk>/feed/live` to find it.
  That endpoint is per-game: a five-final evening becomes five fetches, five
  tool results and five more turns re-reading everything already in context,
  which doubles the cost of the run to learn what you had already been told.
  The same goes for every other per-game endpoint. If you want a field for
  several games, get it from the schedule call or do without it.
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
  The page shows them as two lines — "Last updated 9:20 PM — Yankees 5 Rays 2
  final at 9:14" and "Next update 10:45 PM — Astros @ Mariners first pitch at
  9:40" — so a quiet stretch explains itself.
  - NAME GAMES, not internals. The user reads these to know which baseball
    caused the change and which game the job is waiting on. "Yankees 5 Rays 2
    final" is the shape; "standings refresh" tells them nothing.
  - A scheduled matchup is written AWAY @ HOME, with the "@", the way the
    standings table writes it. Never "at".
  - EVERY GAME CARRIES ITS STATE, and the state carries its clock:
      - finished: "Yankees 5 Rays 2 final at 9:14" — the time it ended.
      - under way: "Rays @ Yankees 2-1 in the 5th" — the inning, and no clock,
        because a game in progress has no useful one.
      - still to come: "Astros @ Mariners first pitch at 9:40".
    A bare "Yankees 5 Rays 2" could be any of the three. Every first pitch
    takes the "at": "first pitch at 9:40", never "first pitch 9:40".
  - ONE GAME, TWO GAMES, OR A SLATE:
      - one: name it.
      - two: name both, comma between. "Rays @ Yankees 2-1 in the 5th, Astros
        @ Mariners 3-0 in the 7th".
      - three or more: call it a slate and name one game out of it.
        "Slate of 8 ended with Mets 3 Braves 2 at 10:28"
        "Slate of 6 under way with Rays @ Yankees 2-1 in the 5th"
        "Slate of 3 starts with Astros @ Mariners first pitch at 9:40"
    COUNT THE WHOLE DAY, NOT THE PART YOU ARE NAMING. "Slate of 14" means
    fourteen games today. One of them going final does not make it one game:
    if the day has three or more, it is a slate, and it stays a slate while
    any of them is still being played.

    THE VERB DESCRIBES THE WHOLE SLATE, NOT THE ONE GAME YOU NAME. A slate
    with games still in progress has NOT ended, however many finals it has
    already produced — saying "ended with" there is simply false:
      - every game finished → "ended with", naming the one that finished LAST.
      - SOME FINISHED, SOME STILL BEING PLAYED → name the newest final, then
        say how much is left, because both are news:
          "Nationals 3 Tigers 1 final at 9:19 — 8 of 14 games still under way"
        This is the common shape on a full evening and the one to reach for
        whenever a final lands while other games are going.

        "UNDER WAY" MEANS IN PROGRESS, NOT "NOT FINAL". Count only the games
        actually being played. An afternoon with 2 final, 1 in progress and
        13 not yet started is NOT "14 of 16 still under way" — thirteen of
        those have not thrown a pitch, and a reader told they are under way
        will go looking for scores that do not exist. When games have still
        to start, that is its own number and worth saying:
          "Orioles 4 Blue Jays 2 final at 4:14 — 1 of 16 games under way, 13 to come"
        Drop either half when it is zero:
          "Orioles 4 Blue Jays 2 final at 4:14 — 13 of 16 games still to come"
          "Nationals 3 Tigers 1 final at 9:19 — 8 of 14 games still under way"

        ALWAYS SAY "GAMES". A bare "8 of 14" makes the reader supply the noun
        and can be read as a score or a series. The count is always "N of
        <the day's total> games", and the total is the whole slate whichever
        state you are counting.
      - nothing final yet, games under way → "under way with".
      - nothing has started → "starts with".
    Never skip a group because the user's own club is in a later one: a game
    under way makes the slate under way even when their club plays tonight.

    WHICH GAME TO NAME. Each shape has its own order of tests. Apply the
    first; only when it leaves a tie does the next one decide, and so on
    down the list:
      - ENDED, or a final while others are still being played:
          1. the LATEST final out
          2. the user's highest-ranked club
          3. a club that still has a chance
      - UNDER WAY:
          1. the user's highest-ranked club
          2. a club that still has a chance
          3. the MOST RECENT first pitch
      - STARTS WITH:
          1. the EARLIEST first pitch
          2. the user's highest-ranked club
          3. a club that still has a chance
    "Highest-ranked" is `ranking` in the season doc: a game counts as the
    better of its two clubs' positions there, and a game with neither club
    in `ranking` loses to any game with one. "Still has a chance" means
    at least one of its two clubs is not yet out: in September, a club is
    out only when the standings doc shows "E" for BOTH `elim` and `wce`
    (read it with a "get" on collection "standings" — it is already
    written, so this costs no MLB call); in the postseason, a club is out
    once it has lost a series. A game whose clubs are both out loses to any
    game with a club still alive. So with Nationals @ Tigers and Blue Jays @
    Orioles both under way, neither in `ranking`, and the Nationals and
    Tigers both "E" in both columns, the slate is "under way with Blue Jays
    @ Orioles". A slate that starts at 1:05 is never described by a 7:40
    game.
  - `updatedAt` is the current time. `updatedFor` names the newest baseball
    there is, and NEVER an absence. In order:
      - anything final since the last run: name it, by the rules above. When
        the result moved a series, say so after a dash: "Brewers 4 Cubs 1
        final at 11:41 — Brewers now lead 2-0".
      - nothing final, but games are on: name them, by the rules above.
      - nothing final and nothing on: name the last final there was. "No games
        since Yankees 5 Rays 2 final at 9:14", or "No games since Orioles 4
        Blue Jays 3 final last night" when it was a previous day. This covers
        the morning as well — before the day's first pitch the newest baseball
        is yesterday's, so name yesterday's game rather than writing "nothing
        final yet today", which is still an absence.
      - September, when the projected field moved: that is the news. "11
        finals; Padres pass the Cubs for the 5 seed".
    Never write what did NOT happen — "no games finished since 7pm" and
    "nothing final yet today" tell them nothing they can use. Every one of
    these reasons names an actual game.
  - WHEN THE NEXT RUN HAPPENS. Your cron, exactly as the Routine stores it:

        15 17,18,20,22,23,0-6 * 9-11 *

    That is UTC, and it is the ONLY source. `nextAt` is the next instant
    matching it: take the UTC time now, find the next hour on that list, set
    the minute to 15. Write it as a UTC ISO timestamp and nothing else. DO
    NOT CONVERT IT TO EASTERN and do not put a clock time in it anywhere.
    The page formats it in the reader's own timezone (`toLocaleTimeString`
    with no locale given), so a time converted by hand here is wrong for
    anyone not sitting where you assumed, and wrong for everyone once
    daylight saving ends.

    QUOTING THE CRON IS THE POINT. A list of Eastern times written out here
    has to be re-edited by hand every time the schedule moves, and twice it
    was not: the page promised 10:30 PM after that Routine had been disabled,
    and promised noon after the noon slot was replaced. Both times it read
    "Update overdue" for hours. There is no list to drift now, because the
    line above IS the cron. If the two ever disagree, the Routine is right
    and this line is the thing to fix.

    Twelve fires a day, placed where the games are: across September and
    October 32% of all first pitches fall between 1pm and 4pm Eastern, and
    the day's opening pitch is 12:10pm at the very earliest, so the first
    slot sits just after the earliest baseball rather than in front of it.
    The page may therefore carry a "Last updated" from last night right
    through the morning. That is correct, not stale — the last thing that
    happened really was last night, and `updatedFor` says which game it was.

    You cannot schedule extra runs. The tools that would do it
    (`create_trigger` and friends) are not available inside a run, so do not
    try, and never promise an instant that is not on the cron above.

    DO NOT DERIVE THE MINUTE FROM WHEN THIS RUN STARTED. A run fired by hand
    starts whenever it was fired, and reading :20 off such a run makes the
    page promise :20 for a check that happens at :15. The minute is always
    15, from the cron, whatever the clock said when you woke up.

  - `nextAt` IS SIMPLY THE NEXT INSTANT ON THE CRON. Every one of them fires
    whether or not there is anything to find, so the next is when the page
    will next be updated, and that is what the line must say. Do not reason
    about which one would be interesting and name that — the page would then
    sit showing a promise it had already broken, because a run will have
    happened before it. A run takes three or four minutes, so the stamp
    appears a little after the time the reader sees; that is expected and
    needs no allowance here.
  - `nextFor` names what that check is for, by the same rules: "Astros @
    Mariners first pitch at 9:40", "Rays @ Yankees first pitch at 1:05,
    Guardians @ Tigers first pitch at 1:08", "Slate of 3 starts with Astros @
    Mariners first pitch at 9:40". LEAVE IT EMPTY when the check is for the
    game `updatedFor` just named — the page shows the time alone rather than
    saying it twice.
  - SAY WHEN THE NEXT SLOT IS ONLY THE CLOCK. The slots are a fixed grid and
    cannot know whether baseball is on, so some of them land where there is
    nothing to find: before the day's first pitch, after the day's last final,
    or on a day with no games at all. Naming a game at such a slot implies the
    check is FOR that game, and "Next update 1:15 PM — Slate of 6 starts with
    Padres @ Giants first pitch at 4:05 PM" reads as though something happens
    at 1:15 when the baseball is three hours off. Open those with
    "routine check" and a comma, then the SAME full context you would have
    written anyway:

      routine check, slate of 6 starts with Padres @ Giants first pitch
        at 4:05 PM
      routine check, Astros @ Mariners first pitch at 9:40
      routine check, nothing left tonight
      routine check, no games today

    LOWERCASE AFTER THE COMMA: it is one sentence now, so "slate of 16", not
    "Slate of 16". Every other rule still holds — the count is the whole day,
    a matchup is AWAY @ HOME, a first pitch takes its "at". DO NOT SHORTEN THE
    CONTEXT because the qualifier sits in front of it. The reason a check is
    routine is exactly that the baseball is somewhere else, so where and when
    that baseball is, is the part worth reading. "routine check, slate at 1:10"
    throws away the count and the matchup and is not an acceptable shortening.

    A slot that WILL catch baseball is not a routine check and takes no
    qualifier: one with a game under way at that time, or with a game that
    will have gone final since this run. Those keep the plain wording above.

    NEVER NAME A FIRST PITCH LATER THAN THE SLOT ITSELF unless you are using
    the routine check form. "Next update 6:15 PM — Blue Jays @ Orioles first
    pitch at 6:35" says the 6:15 check is for a game that will not have
    started when it runs. It cannot be. Ask what the slate will look like AT
    the slot, not what the next thing on the schedule is:
      - games in progress at that time → name those.
      - games that will have gone final since this run → name the newest.
      - neither → routine check, and THEN naming the coming first pitch is
        exactly right, because the qualifier says the baseball is still ahead.
    A 6:15 check on an afternoon whose last game started at 3:45 is for that
    game finishing. The 6:35 game belongs to the 7:15 check.
  - A DAY belongs to the game, never to the check. "final last night" is
    right, because that is when the game was. "Guardians @ Tigers tomorrow"
    is not: the page already prints the day with the check's own time — "Next
    update tomorrow 1:15 PM" — so saying it twice invites the two to disagree.
  - When the season is over, write `nextAt` and `nextFor` as null. There is no
    next check to promise, and the page drops the line entirely.
- When you write `teams`, `series` or `log`, send that whole object or array
  with every entry you know about, preserving existing win counts, records and
  log entries.
- AN "update" MERGES OBJECTS KEY BY KEY, so leaving a key out of what you send
  does NOT remove it. When a club leaves the field, its entry in `teams` must
  be deleted explicitly, in the same write that adds its replacement:
      teams: { ..., "HOU": { league: "AL", seed: 3, w: 78, l: 79 },
               "TEX": { "__delete__": true } }
  Leaving it out is how the Rangers stayed in `teams` beside the Astros, both
  at AL seed 3, and the bracket kept drawing the Rangers. After ANY write to
  `teams`, it must hold exactly 12 entries, six per league with seeds 1-6
  once each. If a read ever shows otherwise, fix it in this run with the
  delete marker; it will not correct itself.

LOGGING — the page shows the user what changed since they last looked, from
`log`, so every change you write gets an entry in the same write:

- APPEND ONLY. Never reword, reorder or remove an entry that is already there.
  `at` is the current time, ISO 8601 in UTC. Keep at most 50 entries: drop from
  the front when a write would exceed that.
- Entries are data, not prose — the page writes the sentence. Use these shapes
  and no others:
  { at, kind: "field", in: "<TEAM_ID>", out: "<TEAM_ID>", via: [...] }
      a team entered the projected field and the one it displaced. Omit either
      side only if the field genuinely gained or lost a team on its own.
  { at, kind: "seed", team: "<TEAM_ID>", from: n, to: n, over: "<TEAM_ID>",
    via: [...] }
      log ONLY teams that moved UP: every move up implies someone moved down,
      and logging both sides says the same thing twice. `over` names the team
      passed when exactly two teams swapped; omit it otherwise.

      `via` ON EITHER OF THOSE SAYS WHY IT HAPPENED, which is the reader's
      first question: did mine win, did theirs lose, or did the two play each
      other? It lists the games behind the move, at most one per club:

          via: [ { team: "<TEAM_ID>", won: true|false, opp: "<TEAM_ID>",
                   score: [<that team's runs>, <the opponent's runs>] }, ... ]

      THAT TEAM'S OWN RUNS ALWAYS COME FIRST, win or lose — the page turns
      the pair round itself when it writes a loss, so "lost to the Dodgers
      4-1" comes from score [1, 4]. Include the club that moved, the club it
      passed, or both, whichever actually played. When the two met each other,
      ONE entry naming the other as `opp` is enough and the page writes "beat
      them 6-2". Omit `via` entirely if you cannot identify the games rather
      than guessing at them. The scores are in the day's schedule you already
      fetched, so this costs no extra request.
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
- ONLY TOUCH THIS DOCUMENT WHEN A GAME HAS GONE FINAL since its own
  `updatedAt`. Nothing in the table moves while games are being played — a
  record, a games-back, a magic number and an elimination number all change
  at the final out and at no other moment. So a run in the middle of a slate
  has nothing to write here, and the way to spend nothing on it is not to
  fetch: skip the standings request AND the five-day schedule request below,
  and leave the document alone. Decide this BEFORE fetching rather than after
  building the table — the cost is in those two requests and in composing
  thirty clubs, so a write you talk yourself out of at the end has already
  been paid for in full.
- When a game HAS gone final since then, rebuild all thirty clubs and write
  once. Still compare against what you read, and skip the write if every
  value is identical anyway.
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

1. STANDINGS AND THE PROJECTED FIELD ride on one fetch, and one question
   decides both: HAS A GAME GONE FINAL since the `standings` document's
   `updatedAt`? If none has, SKIP THIS WHOLE STEP — do not fetch standings,
   do not fetch the five-day schedule. Nothing this step computes can have
   moved, because standings, seeds and the projected field all turn on
   completed games and a slate in the fifth inning has completed none. A
   mid-slate run belongs in step 2 onward, and that is most of the runs in
   an evening.

   If one has, and `projected` is true or missing, or `teams` is empty: fetch
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

5. LEAVE A RECORD OF THIS RUN. Your final message goes nowhere anyone reads,
   so anything worth knowing has to be written down. With "set", to collection
   "routine", doc id "lastrun":

   {
     at:        "<ISO timestamp, now>",
     slot:      "<the scheduled time you believe this run is for, or 'manual'>",
     work:      "early-exit" | "standings" | "series" | "field" | "lock",
     fetched:   [ "<each URL path you called, without the host>" ],
     filtered:  true | false,   // did every response go through a filter
                                // before reaching your context?
     wrote:     [ "<each doc you wrote: seasons, standings, ...>" ],
     turns:     <how many tool calls you made this run, your best count>,
     trouble:   "<one line naming anything that failed, refused, or was
                 missing -- a tool you could not load, an API error, a version
                 conflict. Empty string when the run was clean.>"
   }

   Overwrite it every run; it is a mailbox, not a log. Be accurate about
   `trouble` in particular -- a run that quietly worked around a problem and
   reported nothing is how a fault stays hidden for a week.

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
| `updatedAt` / `updatedFor` | routine | When the routine last ran and the newest baseball it knows of: a final with the time it ended, a game in progress with its inning, or — for three or more at once — the slate and its best game. Written on every run, including quiet ones, and never phrased as an absence |
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
