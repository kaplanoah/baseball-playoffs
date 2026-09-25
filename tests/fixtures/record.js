import fs from "node:fs";
import path from "node:path";
import * as MLBSnapshot from "../../page/js/snapshot.js";

async function recordFixture(season, name) {
  const now = Date.now();
  const requests = MLBSnapshot.mlbRequests(season, now);
  const fixture = { season, now: new Date(now).toISOString(), responses: {} };
  for (const [key, request] of Object.entries(requests)) {
    if (!request) continue;
    const response = await fetch(MLBSnapshot.MLB_API + request);
    if (!response.ok) throw new Error(`${response.status} for ${request}`);
    fixture.responses[key] = await response.json();
  }
  const file = path.join(import.meta.dirname, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(fixture));
  console.log(`Wrote ${file}`);
}

const [season, name] = process.argv.slice(2);
if (!season || !name) {
  console.error("usage: node tests/fixtures/record.js <season> <name>");
  process.exit(1);
}
recordFixture(Number(season), name).catch((error) => {
  console.error(error.message);
  process.exit(1);
});
