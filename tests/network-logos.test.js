import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { renderGameRow } from "../shared/page/game-row.js";
import { html } from "../shared/page/html.js";
import { listNetworkLogos, NETWORK_LOGOS } from "../shared/page/network-logos.js";

const LOGO_FOLDER = new URL("../shared/page/networks/", import.meta.url);

/** @param {string[]} networks */
function renderNetworksLine(networks) {
  const side = { lines: html`` };
  const row = String(renderGameRow({ away: side, home: side, headline: html``, networks }));
  const start = row.search(/<span class="game-networks"\s*>/);
  return start === -1 ? "" : row.slice(start, row.lastIndexOf("</li>"));
}

test("a channel's logo is found by any name the feeds give it, whatever its case", () => {
  const logos = listNetworkLogos(["NBC", "peacock", "USA Net", "KFMB 8.1 (CBS)"]);
  assert.deepEqual(
    logos.map((logo) => typeof logo === "object" && logo.name),
    ["NBC", "Peacock", "USA Network", "CBS 8"],
  );
});

test("two names for one channel show its logo once, and a channel with no logo keeps its name", () => {
  const [espn, ...rest] = listNetworkLogos(["ESPN", "ESPN App", "Reds.TV", "BravesVision"]);
  assert.deepEqual(espn, { name: "ESPN", file: "espn.svg" });
  assert.deepEqual(rest, ["Reds.TV", "BravesVision"]);
});

test("a logo has a version for each background, or says which one it's drawn for", () => {
  const [nbc, fanDuel] = listNetworkLogos(["NBC", "FanDuel Sports Network West"]);
  assert.deepEqual(nbc, { name: "NBC", file: "nbc.svg", darkFile: "nbc-dark.svg" });
  assert.deepEqual(fanDuel, {
    name: "FanDuel Sports Network West",
    file: "fanduel-west.svg",
    drawnFor: "light",
  });
});

test("every logo the table names is in its folder, and every file there is one it names", () => {
  const named = NETWORK_LOGOS.flatMap((logo) => [logo.file, logo.darkFile ?? []].flat()).sort();
  assert.deepEqual(named, readdirSync(LOGO_FOLDER).sort());
});

test("every logo is a PNG or a plain drawing: no scripts, links, or anything it would load", () => {
  const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const file of readdirSync(LOGO_FOLDER)) {
    if (file.endsWith(".png")) {
      assert.deepEqual(
        readFileSync(new URL(file, LOGO_FOLDER)).subarray(0, 8),
        PNG_SIGNATURE,
        file,
      );
      continue;
    }
    const svg = readFileSync(new URL(file, LOGO_FOLDER), "utf8");
    assert.match(svg, /^<svg[^>]*viewBox=/, file);
    assert.doesNotMatch(svg, /<script|\son\w+=|href="(?!#)|url\((?!#)|@import/i, file);
  }
});

test("the line under a game shows each logo, its dark version beside it, and names without one", () => {
  const line = renderNetworksLine(["NBC", "ESPN", "FanDuel Sports Network West", "Reds.TV"]);
  const images = [...line.matchAll(/<img class="([^"]*)" src="([^"]*)" alt="([^"]*)"/g)].map(
    ([, classes, source, alt]) => [classes, source, alt],
  );
  assert.deepEqual(images, [
    ["network-logo for-light", "shared/networks/nbc.svg", "NBC"],
    ["network-logo for-dark", "shared/networks/nbc-dark.svg", "NBC"],
    ["network-logo", "shared/networks/espn.svg", "ESPN"],
    ["network-logo", "shared/networks/fanduel-west.svg", "FanDuel Sports Network West"],
  ]);
  assert.match(line, /<span class="network-chip for-light"><img [^>]*fanduel-west/);
  assert.match(line, /<span class="sep">&bull;<\/span>Reds\.TV<\/span\s*>/);
});

test("a game with nowhere to watch it has no line for it", () => {
  assert.equal(renderNetworksLine([]), "");
});
