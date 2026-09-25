/* Records a fixture: the MLB responses js/snapshot.js asks for, at this
   moment, exactly as it asks for them. The tests build snapshots from these
   files, so they never touch the network.

     node tests/fixtures/record.js <season> <name>
     node tests/fixtures/record.js 2026 2026-09-24-evening

   Record while something worth testing is happening -- games in progress,
   a series about to clinch -- and write the test against what you saw.

   The two fixtures here were recorded before the standings request asked
   for `clinchIndicator`; it was added to them afterwards from full standings
   responses taken six minutes earlier, with every club's record checked
   identical. */
const fs = require("fs");
const path = require("path");
const S = require("../../js/snapshot.js");

async function record(season, name){
  const now = Date.now();
  const req = S.mlbRequests(season, now);
  const out = { season, now: new Date(now).toISOString(), responses: {} };
  for(const [key, p] of Object.entries(req)){
    if(!p) continue;
    const res = await fetch(S.MLB_API + p);
    if(!res.ok) throw new Error(`${res.status} for ${p}`);
    out.responses[key] = await res.json();
  }
  const file = path.join(__dirname, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(out));
  console.log(`Wrote ${file}`);
}

const [season, name] = process.argv.slice(2);
if(!season || !name){
  console.error("usage: node tests/fixtures/record.js <season> <name>");
  process.exit(1);
}
record(Number(season), name).catch(e => { console.error(e.message); process.exit(1); });
