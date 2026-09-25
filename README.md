# MLB Postseason

A private page on claude.ai that tracks the MLB postseason. It shows the
bracket, your ranking of who you want to win the World Series, the standings,
and scores that update automatically.

## Setup (for humans)

Open [Claude Code on the web](https://claude.ai/code), paste this prompt, and
follow Claude's instructions.

```
Set up the MLB postseason tracker from https://github.com/kaplanoah/baseball-playoffs
for me. Clone it (branch main), read the "Setup (for Claude Code)"
section of its README, and guide me through it one step at a time.
```

Claude publishes the page and then helps you connect it to live scores. It
takes about ten minutes.

**You'll need** a Claude plan that includes Claude Code on the web and a free
[Cloudflare](https://dash.cloudflare.com/sign-up) account. Claude walks you
through the Cloudflare part.

Running the site doesn't cost anything. Scores come from MLB's free public API
through a connector on Cloudflare's free tier. Keeping the page updated
doesn't use Claude.

## Setup (for Claude Code)

Guide the user one step at a time. Tell them the one thing to do next, wait
until they say it's done, then go on. Don't ask them to make choices you can
make for them. Never ask for the Cloudflare token in the chat.

**1. Publish the page.** Use the Artifact tool to publish `index.html` from
`main` with every file it references, `icon: "baseball"`, and these
capabilities:

```
{ "db": {}, "mcp": { "servers": [ { "server": "MLB Live", "tools": ["get_snapshot"] } ] } }
```

Give the user the link. The page will say the connector is missing until
step 4. That's expected.

**2. Get this session ready to deploy.** If `CLOUDFLARE_ACCOUNT_ID` is set
and
`curl -s https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain`
returns `"success":true`, go to step 3. Otherwise start with something like:
"I'll walk you through adding a few things to this cloud environment so I can
deploy the connector for you. If you'd rather deploy it yourself from a
terminal, just let me know." Then go through the steps below. If they want to
deploy it themselves, see "If they deploy it themselves" below.

1. Have them sign in at [dash.cloudflare.com](https://dash.cloudflare.com)
   and open **Workers & Pages**. A free account is fine. If it asks for a
   workers.dev subdomain, have them pick one and tell you what it is.
2. Have them create a token at **Manage Account → API Tokens → Create Token**
   with the **Edit Cloudflare Workers** template, scoped to their account.
   Skip IP filtering because cloud sessions don't have a fixed address. A
   one-week expiry is enough. They copy the token but don't paste it into the
   chat.
3. Have them find their **Account ID** in the right-hand column of the
   Workers & Pages overview.
4. In Claude Code, have them open this session's cloud environment (the
   environment menu in the title bar → **Edit**) and set:
   - **API credentials → Add credential**: type Bearer, allowed website
     `api.cloudflare.com`, header `Authorization`, prefix `Bearer`, and the
     token as the value. Then **Connect**. Sessions can use it but can't see
     it.
   - **Environment variables**: `CLOUDFLARE_ACCOUNT_ID=<their account id>`.
   - **Network access**: Custom. Add `mlb-live.<their-subdomain>.workers.dev`
     and keep the default package managers.

   Then **Save changes**.
5. Environment settings only apply to new sessions. Start one in the same
   environment on this repo's `main` with this prompt. Use the
   `create_session` tool if you have it. Otherwise have the user start it.
   `Continue setting up the MLB postseason tracker: README "Setup (for Claude Code)", step 3. The page is at <artifact URL>.`

**3. Deploy the connector.** Run `npm run deploy:api`. It runs the tests,
deploys `main` exactly as it is on GitHub, and prints the connector URL,
`https://mlb-live.<subdomain>.workers.dev/mcp`. It refuses uncommitted
changes and anything that isn't `main`'s latest commit. The session's own
branch works once it matches `main`. It sets `NODE_USE_ENV_PROXY=1` so Node
sends its requests through the session's proxy, which adds the token. That
needs Node 22.21 or later. The repo's `.claude/settings.json` lets you run
that command without asking and blocks the other ways to deploy.

Then check that it responds. A POST of a JSON-RPC `initialize` to the
connector URL should return the server info.

**4. Add it to claude.ai.** Have the user open
[claude.ai/customize/connectors](https://claude.ai/customize/connectors) and
add a custom connector named exactly **MLB Live**, with the connector URL and
no sign-in. The page looks for it by that name.

**5. Check the page.** Have the user open the page and allow MLB Live if
asked. Then use the ArtifactData tool to read collection `live`, doc
`status`. If `source` is `"connector"` and `error` and `write` are empty, it
works. If not, the page explains `error` under its title, and `write` names
the save that failed.

Finish by telling the user they can set their ranking on the Ranking tab. If
they made a Cloudflare token, tell them they can delete it now, or remove the
environment credential. The connector keeps running without it.

### If they deploy it themselves

Assume they're comfortable in a terminal. In their own clone of `main` they
run `npx wrangler login` and then `npm run deploy`. It prints the Worker's
address, and the connector URL is that address plus `/mcp`. Then go on from
step 4. They redeploy the same way when the connector's code changes.
Cloudflare's tools change over time, so if something doesn't match, point them
to Cloudflare's [Workers docs](https://developers.cloudflare.com/workers/).

## Making changes

`main` is what's published. Work on a branch, run `npm test`, and merge with a
pull request. After merging, republish the page from `main` to its existing
link. Redeploy the connector if anything in `worker/` or `js/snapshot.js`
changed. Don't publish from a branch that hasn't been merged, because the next
publish from `main` will overwrite it.
