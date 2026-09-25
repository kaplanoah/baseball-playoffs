# MLB Postseason

A private page on claude.ai that tracks the MLB postseason: the full bracket,
your ranking of who you want to win it all, division and wild card standings,
and what changed since you last looked. Scores and standings update on the
page by themselves while it's open, every 30 seconds during games.

It costs nothing to run: the page gets its data from MLB's free public API
through a small connector you deploy once to your own free Cloudflare account.
No scheduled jobs, no tokens spent.

## Setup

You need a claude.ai plan that can add custom connectors (Pro or Max) and a
free Cloudflare account. Paste this into Claude Code on the web
([claude.ai/code](https://claude.ai/code)):

```
Set up the MLB postseason tracker from https://github.com/kaplanoah/baseball-playoffs
for me. Clone it (branch main), read the "Setup, for Claude" section of its
README, and guide me through it one step at a time.
```

Claude publishes your page and walks you through the rest. It takes about ten
minutes, most of it in Cloudflare's dashboard.

## Setup, for Claude

Guide the user one step at a time: say what to do, wait until they say it's
done, then go on. Never ask for the Cloudflare token in the chat.

**1. Publish the page.** With the Artifact tool, publish `index.html` from
`main`, with every file it references, `icon: "baseball"`, and these
capabilities:

```
{ "db": {}, "mcp": { "servers": [ { "server": "MLB Live", "tools": ["get_snapshot"] } ] } }
```

Give the user the link. It will say the connector is missing until step 4;
that's expected.

**2. Check whether this session can already deploy.** If `CLOUDFLARE_ACCOUNT_ID`
is set and
`curl -s https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain`
returns `"success":true`, skip to step 3. Otherwise walk the user through this:

1. Sign in at [dash.cloudflare.com](https://dash.cloudflare.com) (a free
   account is fine). Open **Workers & Pages**; if it asks for a workers.dev
   subdomain, have them choose one and tell you what it is.
2. Create a token: **Manage Account → API Tokens → Create Token**, template
   **Edit Cloudflare Workers**, scoped to their account. No IP filtering (cloud
   sessions have no fixed address); an expiry of a week is plenty. They copy
   the token but keep it to themselves.
3. Find the **Account ID**: Workers & Pages overview, right-hand column.
4. In Claude Code, open this session's cloud environment (the environment
   menu in the title bar → **Edit**) and set:
   - **API credentials → Add credential**: type Bearer, allowed website
     `api.cloudflare.com`, header `Authorization`, prefix `Bearer`, and the
     token as the value, then **Connect**. Sessions use it without seeing it.
   - **Environment variables**: `CLOUDFLARE_ACCOUNT_ID=<their account id>`.
   - **Network access**: Custom, adding `mlb-live.<their-subdomain>.workers.dev`,
     with the default package managers still included.

   Then **Save changes**.
5. Environment settings reach new sessions only. Start one in the same
   environment on this repo's `main` (with the `create_session` tool if you
   have it; otherwise have the user start it) with this prompt:
   `Continue setting up the MLB postseason tracker: README "Setup, for Claude", step 3. The page is at <artifact URL>.`

**3. Deploy the connector.** Run `npm test`, then `npm run deploy:api`. It
prints the connector URL, `https://mlb-live.<subdomain>.workers.dev/mcp`.
Check it answers: a POST of a JSON-RPC `initialize` to that URL returns the
server info.

**4. Add it to claude.ai.** The user opens
[claude.ai/customize/connectors](https://claude.ai/customize/connectors) and
adds a custom connector named exactly **MLB Live** (the page asks for it by
that name), with the URL from step 3 and no sign-in.

**5. Check the page.** Have the user open the page and allow MLB Live if
asked. Then read collection `live`, doc `status` with the ArtifactData tool:
`source: "connector"` with empty `error` and `write` means it works. Otherwise
the page explains `error` under its title, and `write` names a save that
failed.

Finish by telling the user their ranking is theirs to set on the Ranking tab,
and that they can now delete the Cloudflare token (or the environment
credential): the connector keeps running without it.

### Other ways to deploy

To deploy the connector yourself instead: `npx wrangler login`, then
`npm run deploy`; or paste `worker/dist/worker.mjs` into a new Worker named
`mlb-live` in the Cloudflare dashboard. See Cloudflare's
[Workers docs](https://developers.cloudflare.com/workers/) for either.

## Making changes

`main` is what's published. Work on a branch, run `npm test`, and merge
through a pull request. After merging, republish the page from `main` to its
existing link, and redeploy the connector if anything under `worker/` or
`js/snapshot.js` changed. Never publish from a branch that hasn't merged: the
next publish from `main` would quietly undo it.
