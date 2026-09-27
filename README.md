# MLB Postseason

[![CI](https://img.shields.io/github/actions/workflow/status/kaplanoah/baseball-playoffs/ci.yml?branch=main&label=CI&logo=github&logoColor=white)](https://github.com/kaplanoah/baseball-playoffs/actions/workflows/ci.yml)

A private web page that tracks the MLB postseason. It shows the bracket, your
ranking of who you want to win the World Series, the standings, each team's
previous, current and next game, and scores that update automatically.

A Cloudflare Worker serves the page and saves your ranking. It also reads MLB
on its own, every 30 seconds during games, so the standings and updates stay
current even with the page closed. Saved to an iPhone's home screen, the page
opens full screen like an app.

## Setup (for humans)

Open [Claude Code on the web](https://claude.ai/code), paste this prompt, and
follow Claude's instructions.

```
Set up the MLB postseason tracker from https://github.com/kaplanoah/baseball-playoffs
for me. Clone it (branch main), read the "Setup (for Claude Code)"
section of its README, and guide me through it one step at a time.
```

Claude deploys the page to Cloudflare and gives you its private address. It
takes about ten minutes.

**You'll need** a Claude plan that includes Claude Code on the web and a free
[Cloudflare](https://dash.cloudflare.com/sign-up) account. Claude walks you
through the Cloudflare part.

Running the page doesn't cost anything. It runs on Cloudflare's free tier, and
the scores come from MLB's free public API. Keeping it updated doesn't use
Claude.

## Setup (for Claude Code)

Guide the user one step at a time. Tell them the one thing to do next, wait
until they say it's done, then go on. Don't ask them to make choices you can
make for them. Never ask for the Cloudflare token in the chat.

**1. Get this session ready to deploy.** If `CLOUDFLARE_ACCOUNT_ID` is set
and
`curl -s https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain`
returns `"success":true`, go to step 2. Otherwise start with something like:
"I'll walk you through adding a few things to this cloud environment so I can
deploy the page for you. If you'd rather deploy it yourself from a terminal,
just let me know." Then go through the steps below. If they want to deploy it
themselves, see "If they deploy it themselves" below.

1. Have them sign in at [dash.cloudflare.com](https://dash.cloudflare.com)
   and open **Workers & Pages**. A free account is fine. If it asks for a
   workers.dev subdomain, have them pick one and tell you what it is.
2. Have them create a token at **Manage Account > API Tokens > Create Token**
   with the **Edit Cloudflare Workers** template, scoped to their account.
   Skip IP filtering because cloud sessions don't have a fixed address. A
   one-week expiry is enough. They copy the token but don't paste it into the
   chat.
3. Have them find their **Account ID** in the right-hand column of the
   Workers & Pages overview.
4. In Claude Code, have them open this session's cloud environment (the
   environment menu in the title bar > **Edit**) and set:
   - **API credentials > Add credential**: type Bearer, allowed website
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
   `Continue setting up the MLB postseason tracker: README "Setup (for Claude Code)", step 2.`

**2. Deploy the Worker.** Run `npm ci`, then `npm run deploy:api`. It runs the
tests, deploys `main` exactly as it is on GitHub, checks that the Worker
answers, and prints its address. It refuses uncommitted changes and anything that isn't `main`'s latest commit.
The session's own branch works once it matches `main`. It sets
`NODE_USE_ENV_PROXY=1` so Node sends its requests through the session's
proxy, which adds the token. That needs Node 22.21 or later. The repo's `.claude/settings.json` lets you run that command without
asking and blocks the other ways to deploy.

**3. Give the page its address.** Run `npm run set-app-key`. It gives the
Worker a long random `APP_KEY` secret and prints the page's address,
`https://mlb-live.<subdomain>.workers.dev/<key>/`. The page and its saved
data answer only there. Give the user the address and tell them to keep it
private: anyone who has it can see and change the page. Never pass
`--rotate` unless they ask. It replaces the key, which changes the address.

**4. Check the page.** Have the user open the address. The first visit also
starts the Worker's own updates. Then read `<address>store/live/status` with
`curl`. If `data.error` and `data.write` are empty, it works. If not, `error`
says why the Worker couldn't read MLB, and `write` names the save that failed.

**5. Save it to the home screen.** On an iPhone, have them open the address
in Safari and choose **Share > Add to Home Screen**. It then opens full
screen with its own icon.

Finish by telling the user they can set their ranking on the Ranking tab. If
they made a Cloudflare token only for this setup, tell them they can delete it
now, or remove the environment credential. The page keeps running without it.
To deploy future changes on merge instead, see "Deploying on merge" below.

### If they deploy it themselves

Assume they're comfortable in a terminal. In their own clone of `main` they
run `npx wrangler login`, then `npm run deploy`, which prints the Worker's
address. Then they give it a key with `npx wrangler secret put APP_KEY`,
pasting a long random value such as the output of
`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`.
The page's address is the Worker's address plus `/<key>/`. Then go on from
step 4. They redeploy with `npm run deploy` when the code changes.

Deploying from Cloudflare's dashboard isn't covered here, because the page's
saved data needs the Durable Object binding and migration that
`worker/wrangler.toml` sets up. Cloudflare's tools change over time, so if
something doesn't match, point them to Cloudflare's
[Workers docs](https://developers.cloudflare.com/workers/).

## Making changes

`main` is what's deployed. Work on a branch and open a pull request into
`main`. GitHub lints, checks formatting and types, looks for unused code, and
runs the tests, in Node and in a browser, on every pull request, so merge once
those pass and the pull request has no conflicts with `main`. If the repo has a
`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY` secret, Claude also reviews each
new pull request and comments on bugs, rule breaks, security problems, and
missing tests. Its comments are advice, not a required check. To run the
same checks yourself, run `npm ci` and `npx playwright install chromium` once,
then `npm run check`. `npm run format` fixes formatting.

The Worker carries the page. Every deploy bundles both from the source it
deploys, so there is nothing to rebuild by hand. `npm run build` writes the
bundle to `worker/dist/`, which git ignores, if you want to look at it.

Every deploy checks that the Worker answers afterward. If it doesn't, the
deploy puts the previous version back and fails. An open page picks up a
deploy the next time it loads.

### Deploying on merge

GitHub can deploy the Worker, page included, after each merge once the checks
pass on `main`. In the repo's **Settings > Environments**, create an
environment named `production`, limit its deployment branches to `main`, and
add:

- a secret `CLOUDFLARE_API_TOKEN`: a Cloudflare token made from the **Edit
  Cloudflare Workers** template, with no IP filtering and a long expiry;
- a variable `CLOUDFLARE_ACCOUNT_ID`.

Without the token, merges deploy nothing. Redeploy by hand with
`npm run deploy:api`.

## License

[MIT](LICENSE)

The tab bar icons are from [Phosphor Icons](https://phosphoricons.com), used
under the MIT license, copyright (c) 2023 Phosphor Icons.
