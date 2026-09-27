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

- Page: `page/`. `page/js/app.js` is the entry module; shared page data lives in `page/js/session.js`.
- Build page markup with the `html` template from `page/js/html.js` and write it with `setHtml`. Both escape stored and fetched text, and lint rejects any other `innerHTML` write.
- Worker: `worker/`. It serves the page, its store, and the live snapshot, only under `/<APP_KEY>/`; everything but `robots.txt` is a 404 without the key. An alarm in its Durable Object (`worker/src/season-updater.js`) keeps the current season's saved data up to date from MLB; the page only reads it, and saves just the ranking, dismissals, and a hand-set field. Each update's new entries about ranked clubs go out as Web Push notifications (`worker/src/notifications.js`, `push.js`, `web-push.js`, and `page/sw.js`); the Durable Object makes and keeps the signing key itself, under a key the store's paths can't name. Deploys bundle it with all of `page/`; `npm run build` writes that bundle to `worker/dist/`, which git ignores.
- Tests: `tests/`. Every change to behavior comes with tests that fail without it, in the same PR.
- Commands: `npm ci` once, then `npm run check`. `npm run format` fixes formatting. Types are checked from JSDoc by `npm run typecheck`; the code stays plain JavaScript. `npm run deadcode` runs knip, which fails on unused files, exports, and dependencies: delete them rather than ignoring them.
- Times show in the viewer's own time zone; only MLB's day (`easternDay`) is Eastern. Tests pass in any `TZ`: a test that asserts a time picks its zone with `tests/time-zone.js` or `test.use({ timezoneId })`.
- The store returns documents frozen, with sorted keys. `update()` merges, so to remove a key, set it to `null`.

## Workflow

- `main` is the source of truth. Every change reaches it through a PR, by the steps in "Shipping a change" below.
- Never push to another session's branch.
- Don't spend time curating commit history. Squash merges make it irrelevant.
- Refer to PRs by number, not branch.
- `npm run set-app-key` gives the Worker its `APP_KEY` and prints the page's address. `--rotate` replaces the key, which changes the address; do that only when the user asks.
- The repo is public. Never commit secrets, keys, account IDs, real Worker addresses or subdomains, or personal data; use placeholders in tests and docs.
- The Cloudflare token lives only in the cloud environment's API credentials and the repo's `production` GitHub environment. Never ask for it in chat or put it in environment variables, code, or commits.
- Keep scratch work (design playgrounds, test harnesses) out of git, and never point tests at the real page.
- Ask when unsure.

### Shipping a change

Follow these steps in order. When a step says to go back to an earlier step, continue in order from there.

1. Fetch `main` and start your branch from it. If the branch's last PR has merged, reset the branch to `origin/main` first.
2. Run `npm run check`. If anything fails, fix it and run `npm run check` again. Repeat until it passes. Never push while it fails.
   - The browser tests run in CI on Chromium's headless shell, which behaves differently from full Chromium; for example, it denies notification permission. If you set `CHROMIUM_PATH`, point it at the headless shell.
3. Commit, push, and open a PR into `main`. If the PR is already open, the push updates it.
4. Wait until every CI job on the PR's latest commit has finished. The `check` job is the one that must pass; it fails whenever any other CI job fails.
5. If a CI job failed, read its log and reproduce the failure locally. Fix it and go back to step 2. If you can't reproduce or fix it, stop and tell the user which job failed and what its log says.
6. The Review workflow posts Claude's comments when a PR opens; it doesn't run again after later pushes. Answer every comment: either fix it and go back to step 2, or reply on the comment saying why not.
   - If the Review job fails without posting any comments, its Claude credential secret is missing or expired. Tell the user, and continue. The Review job never blocks a merge.
7. If GitHub reports merge conflicts with `main`, merge `main` into your branch, resolve the conflicts, and go back to step 2. If resolving a conflict would drop behavior from either side, stop and ask the user which to keep.
8. Squash-merge the PR once all of these are true: `check` passed on the latest commit, the PR has no merge conflicts, and every Review comment is answered. If GitHub refuses the merge, `main` has moved: go back to step 7.
9. Don't deploy. Merging starts CI on `main`, and when CI passes, the Deploy workflow runs `npm run deploy:api`, which deploys the Worker and rolls back if the new version doesn't answer.
10. Wait for the Deploy run for the merge commit to finish, then read its log and do what matches:
    - It says `worker check: ok`: the new version is live. Tell the user.
    - The run was skipped: CI failed on `main`. Read the CI log, fix the failure in a new PR, and start again at step 1.
    - It says "nothing was deployed": the `production` environment has no Cloudflare token. Tell the user.
    - The run failed: tell the user what the log says. If it says "the earlier version is live again", the Worker rolled back and is unchanged.
11. Run `npm run deploy:api` yourself only when step 10 found no successful deploy and the user asks you to. Never deploy any other way.
12. To ship work in several PRs, open each PR only after the one before it has merged, starting again at step 1.

## Writing

README and anything user-facing: be clear, direct, and concise.
