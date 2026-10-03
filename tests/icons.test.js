import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { IconStyle, icons } from "@phosphor-icons/core";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PAGE_FOLDERS = [
  "shared/page",
  ...readdirSync(join(ROOT, "apps")).map((app) => `apps/${app}/page`),
];

/** @param {string} folder */
const listPageFiles = (folder) =>
  readdirSync(join(ROOT, folder), { recursive: true, encoding: "utf8" })
    .filter((path) => /\.(js|html)$/.test(path))
    .map((path) => `${folder}/${path}`);

/** @param {string} name @param {string} style */
function readPhosphorIcon(name, style) {
  const fileName = style === IconStyle.REGULAR ? name : `${name}-${style}`;
  return readFileSync(
    fileURLToPath(import.meta.resolve(`@phosphor-icons/core/assets/${style}/${fileName}.svg`)),
    "utf8",
  );
}

/** @param {string} markup */
const readPaths = (markup) =>
  [...markup.matchAll(/\sd="([^"]*)"/g)].map((match) => match[1].replace(/\s+/g, " ").trim());

const PHOSPHOR_PATHS = new Set(
  icons.flatMap((icon) =>
    Object.values(IconStyle).flatMap((style) => readPaths(readPhosphorIcon(icon.name, style))),
  ),
);

// An SVG without a viewBox of its own, like the bracket's lines that a script draws in, or with
// one that comes from data, like the scoreboard's digits, is a drawing, not an icon.
/** @param {string} svg */
const isDrawing = (svg) => !/viewBox="/.test(svg) || /viewBox="[^"]*\$\{/.test(svg);

/** @param {string} svg */
function describeIconProblem(svg) {
  if (/<(circle|rect|line|polyline|polygon|ellipse)\b/.test(svg)) return "draws a shape of its own";
  const paths = readPaths(svg);
  if (!paths.length) return "has no path";
  if (paths.some((path) => !PHOSPHOR_PATHS.has(path))) return "has a path Phosphor doesn't";
  return null;
}

test("every icon on the pages is a Phosphor icon, copied path for path", () => {
  const problems = PAGE_FOLDERS.flatMap(listPageFiles).flatMap((file) =>
    [...readFileSync(join(ROOT, file), "utf8").matchAll(/<svg\b[\s\S]*?<\/svg>/g)]
      .map((match) => match[0])
      .filter((svg) => !isDrawing(svg))
      .map((svg) => ({ file, problem: describeIconProblem(svg), start: svg.slice(0, 60) }))
      .filter(({ problem }) => problem),
  );
  assert.deepEqual(problems, []);
});
