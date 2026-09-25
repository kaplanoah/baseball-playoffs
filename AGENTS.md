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

- Page: `index.html`, `styles.css`, and `js/`. Scripts share one global scope and run in the order `index.html` loads them.
- Connector: `worker/`, built with `js/snapshot.js` into `worker/dist/`.
- Tests: `tests/`.
- Commands: `npm ci` once, then `npm run check`. `npm run format` fixes formatting. `npm run build` after changing `js/snapshot.js` or `worker/src/`.
- The artifact store returns documents frozen, with sorted keys. `update()` merges, so to remove a key, set it to `null`.

## Workflow

- `main` is the source of truth. Work on a branch, open a PR, and squash-merge once CI is green. Never push to another session's branch.
- Don't spend time curating commit history. Squash merges make it irrelevant.
- Refer to PRs by number, not branch.
- After a merge, republish the page from `main` to its existing link. If `worker/` or `js/snapshot.js` changed, redeploy the connector with `npm run deploy:api` and no other way. Never publish from an unmerged branch.
- The Cloudflare token lives only in the cloud environment's API credentials. Never ask for it in chat or put it in environment variables, code, or commits.
- Keep scratch work (design playgrounds, test harnesses) out of git, and never publish tests to the real page.
- Ask when unsure.

## Writing

README and anything user-facing: be clear, direct, and concise.
