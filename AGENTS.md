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
- Worker: `worker/`. It serves the page, its store, and the live snapshot, only under `/<APP_KEY>/`; everything but `robots.txt` is a 404 without the key. Deploys bundle it with all of `page/`; `npm run build` writes that bundle to `worker/dist/`, which git ignores.
- Tests: `tests/`.
- Commands: `npm ci` once, then `npm run check`. `npm run format` fixes formatting. Types are checked from JSDoc by `npm run typecheck`; the code stays plain JavaScript. `npm run deadcode` runs knip, which fails on unused files, exports, and dependencies: delete them rather than ignoring them.
- Times show in the viewer's own time zone; only MLB's day (`easternDay`) is Eastern. Tests pass in any `TZ`: a test that asserts a time picks its zone with `tests/time-zone.js` or `test.use({ timezoneId })`.
- The store returns documents frozen, with sorted keys. `update()` merges, so to remove a key, set it to `null`.

## Workflow

- `main` is the source of truth. Work on a branch, open a PR, and squash-merge only once CI is green and the PR has no merge conflicts with `main`. Never push to another session's branch.
- The Review workflow has Claude comment on each new PR. Fix each finding or reply saying why not; its comments are advice, not a required check.
- Don't spend time curating commit history. Squash merges make it irrelevant.
- Refer to PRs by number, not branch.
- Merges to `main` deploy the Worker: CI runs `npm run deploy:api` once every check passes. To redeploy by hand, use `npm run deploy:api` and no other way.
- `npm run set-app-key` gives the Worker its `APP_KEY` and prints the page's address. `--rotate` replaces the key, which changes the address; do that only when the user asks.
- The repo is public. Never commit secrets, keys, account IDs, real Worker addresses or subdomains, or personal data; use placeholders in tests and docs.
- The Cloudflare token lives only in the cloud environment's API credentials and the repo's `production` GitHub environment. Never ask for it in chat or put it in environment variables, code, or commits.
- Keep scratch work (design playgrounds, test harnesses) out of git, and never point tests at the real page.
- Ask when unsure.

## Writing

README and anything user-facing: be clear, direct, and concise.
