import fs from "node:fs";
import path from "node:path";
import * as MLBSnapshot from "../../page/js/snapshot.js";

async function record(season, name){
  const now = Date.now();
  const req = MLBSnapshot.mlbRequests(season, now);
  const out = { season, now: new Date(now).toISOString(), responses: {} };
  for(const [key, p] of Object.entries(req)){
    if(!p) continue;
    const res = await fetch(MLBSnapshot.MLB_API + p);
    if(!res.ok) throw new Error(`${res.status} for ${p}`);
    out.responses[key] = await res.json();
  }
  const file = path.join(import.meta.dirname, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`Wrote ${file}`);
}

const [season, name] = process.argv.slice(2);
if(!season || !name){
  console.error("usage: node tests/fixtures/record.js <season> <name>");
  process.exit(1);
}
record(Number(season), name).catch(e => { console.error(e.message); process.exit(1); });
