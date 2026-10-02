import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { renderGameRow } from "../shared/page/game-row.js";
import { html } from "../shared/page/html.js";
import { listNetworkLogos, NETWORK_LOGOS } from "../shared/page/network-logos.js";

/** @param {string[]} names */
const listLogos = (names) =>
  /** @type {import("../shared/page/network-logos.js").NetworkLogo[]} */ (listNetworkLogos(names));

const LOGO_FOLDER = new URL("../shared/page/networks/", import.meta.url);

/** @param {string[]} networks */
function renderNetworksLine(networks) {
  const side = { lines: html`` };
  const row = String(renderGameRow({ away: side, home: side, headline: html``, networks }));
  const start = row.search(/<span class="game-networks"\s*>/);
  return start === -1 ? "" : row.slice(start, row.lastIndexOf("</li>"));
}

test("a channel's logo is found by any name the feeds give it, whatever its case", () => {
  const logos = listNetworkLogos(["NBC", "peacock", "USA Net", "WPIX"]);
  assert.deepEqual(
    logos.map((logo) => typeof logo === "object" && logo.name),
    ["NBC", "Peacock", "USA Network", "PIX11"],
  );
});

test("two names for one channel show its logo once, and a channel with no logo keeps its name", () => {
  const [espn, ...rest] = /** @type {any[]} */ (
    listNetworkLogos(["ESPN", "ESPN App", "Reds.TV", "Rays.TV"])
  );
  assert.equal(espn.name, "ESPN");
  assert.deepEqual(rest, ["Reds.TV", "Rays.TV"]);
});

test("a logo that works on one background has a version for the other", () => {
  const [nbc, espn] = listLogos(["NBC", "ESPN"]);
  assert.deepEqual([nbc.file, nbc.darkFile], ["nbc.svg", "nbc-dark.svg"]);
  assert.deepEqual([espn.file, espn.darkFile], ["espn.svg", undefined]);
});

test("a square badge is drawn taller than a long wordmark, so the two look about the same size", () => {
  const [abc, espn, fox] = listLogos(["ABC", "ESPN", "FOX"]);
  assert.ok(abc.scale > 1 && espn.scale < 1);
  assert.equal(fox.scale, undefined);
  const line = renderNetworksLine(["ABC", "FOX"]);
  assert.match(line, new RegExp(`alt="ABC" style="--logo-scale: ${abc.scale}"`));
  assert.match(line, /alt="FOX" \/>/);
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

test("the line under a game shows each logo, its dark version beside it, and names without one, apart by space alone", () => {
  const line = renderNetworksLine(["NBC", "ESPN", "Reds.TV"]);
  const images = [...line.matchAll(/<img class="([^"]*)" src="([^"]*)" alt="([^"]*)"/g)].map(
    ([, classes, source, alt]) => [classes, source, alt],
  );
  assert.deepEqual(images, [
    ["network-logo for-light", "shared/networks/nbc.svg", "NBC"],
    ["network-logo for-dark", "shared/networks/nbc-dark.svg", "NBC"],
    ["network-logo", "shared/networks/espn.svg", "ESPN"],
  ]);
  assert.match(line, /<span class="network-name">Reds\.TV<\/span>/);
  assert.doesNotMatch(line, /class="sep"/);
});

test("a logo whose weight sits low is nudged up, and one with its weight centered isn't", () => {
  const [nbc, espn] = listLogos(["NBC", "ESPN"]);
  assert.ok(nbc.nudge > 0);
  assert.equal(espn.nudge, undefined);
  assert.match(renderNetworksLine(["NBC"]), /style="--logo-scale: [\d.]+; --logo-nudge: [\d.]+"/);
});

test("a game with nowhere to watch it has no line for it", () => {
  assert.equal(renderNetworksLine([]), "");
});

test("a status sharing its line with channels also shows beside the label, and one without doesn't", () => {
  const side = { lines: html`` };
  const live = String(
    renderGameRow({
      away: side,
      home: side,
      label: html`Semis`,
      headline: html``,
      status: html`Q3 4:12`,
      networks: ["ESPN"],
    }),
  );
  assert.match(
    live,
    /<span class="game-label"\s*>Semis<span class="game-label-status">Q3 4:12<\/span>/,
  );
  assert.match(live, /<span class="game-status">Q3 4:12<\/span>/);
  const final = String(
    renderGameRow({
      away: side,
      home: side,
      label: html`Semis`,
      headline: html``,
      status: html`Final`,
    }),
  );
  assert.doesNotMatch(final, /game-label-status/);
});
