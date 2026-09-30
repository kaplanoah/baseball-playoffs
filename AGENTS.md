# AGENTS.md

## Code

- Keep code clean, consistent, reliable, readable, secure, and maintainable.
- Follow best practices. Don't be unique or clever.
- Leave code better than you found it. Don't leave something sub-optimal just because that's how you found it.
- Start function names with a verb naming the action (boolean predicates excepted). No generic names like `call`, `run`, `execute`, or `handle`.
- Make every function do one thing well. Make orchestration a sequence of named steps. Extract and name any non-trivial logic inside blocks or chained conditions.
- Name variables with full words that are reasonable for their types. No opaque abbreviations.
- Default to no comments. Only use a comment for a non-obvious why. Every comment must be evergreen: no history narrative, no call-site lists, no fixture values, nothing that restates the code.
- Use plain ASCII in code, comments, docs, and commit messages: no em dashes, no curly quotes.

## Repo

- Apps: one per league, each in `apps/<app>/` with its own `page/`, `worker/`, and `tests/`, and deployed as its own Worker, named in `apps/<app>/worker/wrangler.toml`. `apps/mlb/` is baseball, Worker `mlb-live`; `apps/wnba/` is the WNBA, Worker `wnba-app`, which reads the league's own feeds (`page/js/snapshot.js` says which) with the browser headers they require, and whose page saves nothing to the store and follows the phone's dark (Walnut) or light (Maple) setting, in its own self-hosted fonts. Paths below are inside an app's folder, except `shared/` and the ones named as the root's.
- Page: `page/`. `page/js/app.js` is the entry module; shared page data lives in `page/js/session.js`.
- Build page markup with the `html` template from `shared/page/html.js` and write it with `setHtml`. Both escape stored and fetched text, and lint rejects any other `innerHTML` write.
- Separate items in a line of facts with `joinWithSeparator` from `shared/page/html.js`; lint rejects a bullet or middle dot typed by hand. Design mockups are one plain HTML artifact page that works on a phone, never a design canvas, and copy the app's existing styles, separators, and colors from its `page/styles.css` instead of inventing new ones.
- Worker: `worker/src/`. It serves the page, its store, and the live snapshot, only under `/<APP_KEY>/`; everything but `robots.txt` is a 404 without the key. An alarm in its Durable Object (`worker/src/season-updater.js`) keeps the current season's saved data up to date from the league; the page only reads it, and saves just the ranking and dismissals. Each update's new entries about ranked clubs go out as Web Push notifications (`worker/src/notifications.js`, `shared/worker/push.js` and `web-push.js`, and `page/sw.js`); the Durable Object makes and keeps the signing key itself, under a key the store's paths can't name. Deploys bundle it with all of the app's `page/`; `npm run build` writes each app's bundle to its `worker/dist/`, which git ignores.
- Shared code: `shared/page/` holds the page modules every app uses (the `html` template, tabs and the tab bar, the settings sheet in `settings-sheet.js`, the release check and reload on return, the store client, notifications), which pages import as `#shared/<module>.js` through their import map and Node through `package.json`'s imports. Its `chrome.css` styles the tab bar and settings sheet; pages link it before their own `styles.css` and theme it with the tokens its top comment lists. The Worker serves all of it under `shared/`. `shared/worker/` holds the Worker's routing under the key (`app-worker.js`), the store's Durable Object (`season-store.js`, which each app's `worker/src/store.js` hands its league: the page fields it saves, how it loads and saves a snapshot, how long to wait, and what to notify), push, and responses. A change there reaches every app, so shared code never imports an app's modules: an app hands it what it needs, as `watchReturns({ isBusy })` does.
- Tooling: the root `worker/` builds, versions, and deploys every app (`apps.mjs`, `build.mjs`, `deploy.mjs`, `deploy-scope.mjs`, `release.mjs`, `set-app-key.mjs`); its tests are in the root `tests/`.
- Tests: each app's `tests/`, with its browser tests in `tests/browser/`. Every change to behavior comes with tests that fail without it, in the same PR.
- Commands: `npm ci` once, then `npm run check`. `npm run format` fixes formatting. Types are checked from JSDoc by `npm run typecheck`; the code stays plain JavaScript. `npm run deadcode` runs knip, which fails on unused files, exports, and dependencies: delete them rather than ignoring them.
- Times show in the viewer's own time zone; only a league's own day is Eastern (MLB's `readEasternDay`, and the WNBA's day for a game without a set time). Tests pass in any `TZ`: a test that asserts a time picks its zone with the root's `tests/time-zone.js` or `test.use({ timezoneId })`.
- The store returns documents frozen, with sorted keys. The page can only `update()` a season's `ranking` and `seenAt`: each field it names is replaced whole, `null` removes one, and a missing season is created. Everything else is written by the Worker.

## Workflow

- `main` is the source of truth. Every change reaches it through a PR, by the steps in "Shipping a change" below.
- Never push to another session's branch.
- Don't spend time curating commit history. Squash merges make it irrelevant.
- Refer to PRs by number, not branch.
- Start every PR title with a type. The squash merge carries it to `main`, where it sets the next version of each app it changes (`worker/release.mjs`); a PR that changes only other apps' folders leaves an app's version alone: `feat:` for something new to see or do (minor), `fix:` for fixes and polish (patch), `refactor:` for code the Worker runs with no visible change (patch), `build:` for dependencies, the build, and the deploy (patch), and `docs:`, `test:`, `ci:`, or `chore:` for changes the deploy skips (no version). Add `!` after the type, as in `feat!:`, for a major change: a new address, lost data, or something that's gone. A PR that mixes kinds takes the biggest bump. CI's `title` job checks it.
- `npm run set-app-key -- <app>` gives that app's Worker its `APP_KEY` and prints the page's address. `--rotate` replaces the key, which changes the address; do that only when the user asks.
- The repo is public. Never commit secrets, keys, account IDs, real Worker addresses or subdomains, or personal data; use placeholders in tests and docs.
- The Cloudflare token lives only in the cloud environment's API credentials and the repo's `production` GitHub environment. Never ask for it in chat or put it in environment variables, code, or commits.
- Keep scratch work (design playgrounds, test harnesses) out of git, and never point tests at the real page.
- When unsure, do what best serves the intent of the work, and confirm with the user. If you genuinely need a decision from the user, give all the context concisely, list the pros and cons of each option, and make a recommendation.

### Shipping a change

Follow these steps in order. When a step says to go back to an earlier step, continue in order from there.

1. Fetch `main` and start your branch from it. If the branch's last PR has merged, reset the branch to `origin/main` first.
2. Run `npm run check`. If anything fails, fix it and run `npm run check` again. Repeat until it passes. Never push while it fails.
   - The browser tests run in CI on Chromium's headless shell, which behaves differently from full Chromium; for example, it denies notification permission. If you set `CHROMIUM_PATH`, point it at the headless shell.
3. Commit, push, and open a PR into `main`. If the PR is already open, the push updates it.
4. Wait until every CI job on the PR's latest commit has finished. The `check` job is the one that must pass; it fails whenever any other CI job fails.
5. If a CI job failed, read its log and reproduce the failure locally. Fix it and go back to step 2. If you can't reproduce or fix it, tell the user which job failed, what its log says, what you tried, and what you recommend.
6. CI's `review` job has Claude review each push to the PR, post its findings as comments on the lines they concern, and update one summary comment that says which commit it reviewed, how many findings it posted, and anything it couldn't check. If the summary names something it couldn't check, tell the user. Answer every finding: either fix it and go back to step 2, or reply on the comment saying why not. The push with a fix is reviewed again.
   - A PR that changes `.github/workflows/ci.yml` isn't reviewed: the review runs only from the workflow as `main` has it, and passes without a summary otherwise. Keep a change to that file in its own small PR, so nothing else goes unreviewed with it.
   - If the `review` job fails without posting any comments, don't try to reproduce it locally or re-run it: it already tried twice, eight minutes each at most. Its log shows each attempt's turns and tool calls. Tell the user what it shows: an invalid or expired Claude credential secret, Claude unreachable, or where a review stalled. `check` can't pass until the job does.
7. If GitHub reports merge conflicts with `main`, merge `main` into your branch, resolve the conflicts, and go back to step 2. If resolving a conflict would drop behavior from either side, resolve it in the way that best serves the spirit of both changes, and confirm with the user. If you genuinely need a decision from the user, give all the context concisely, list the pros and cons of each option, and make a recommendation.
8. Squash-merge the PR once all of these are true: `check` passed on the latest commit, the PR has no merge conflicts, and every review finding is answered. If GitHub refuses the merge, check the PR again: if CI hasn't finished on the latest commit, go back to step 4; if it has merge conflicts, go back to step 7.
9. Don't deploy. Merging starts CI on `main`, and when CI passes, the Deploy workflow runs `npm run deploy:api`, which deploys each app's Worker and rolls back any new version that doesn't answer. An app's deploy is skipped when nothing but docs, tests, tooling, and other apps' folders changed since its live version's commit; `worker/deploy-scope.mjs` lists those files. Each line of the deploy log starts with its app's name, so read step 10's results for each app. When you add a file that can't change the Worker, add it to that list.
10. Wait for the Deploy run for the merge commit to finish, then read its log and do what matches:
    - It says `worker check: ok`: the new version is live. Tell the user.
    - It says "Nothing the Worker runs changed": the merge didn't need a deploy, and the previous version is still live. Tell the user.
    - It says "has moved on": another merge landed first, and its Deploy run covers this one. Read that run's log instead.
    - The run was skipped: CI failed on `main`. Read the CI log, fix the failure in a new PR, and start again at step 1.
    - It says "nothing was deployed": the `production` environment has no Cloudflare token. Tell the user.
    - The run failed: read the log. If it says "the earlier version is live again", the Worker rolled back and is unchanged. Tell the user what failed and recommend a fix.
11. Run `npm run deploy:api` yourself only when step 10 found no successful deploy and the user agrees. Say why the automatic deploy didn't happen and recommend whether to deploy by hand. Never deploy any other way.
12. To ship work in several PRs, open each PR only after the one before it has merged, starting again at step 1.

## Writing

README and anything user-facing: be clear, direct, and concise.
