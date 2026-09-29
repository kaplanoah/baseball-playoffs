// Checks a pull request's title against the files it changes, which arrive one per line on stdin.
// Usage: gh pr diff <number> --name-only | node worker/check-pr-title.mjs "<title>"
import { readFileSync } from "node:fs";
import { findTitleProblem } from "./release.mjs";

const title = process.argv[2] ?? "";
const changedFiles = readFileSync(0, "utf8").split("\n").filter(Boolean);
const problem = findTitleProblem(title, changedFiles);
if (problem) {
  console.log(`::error::${problem}`);
  process.exit(1);
}
console.log(`Title OK: ${title}`);
