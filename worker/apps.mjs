// Each league's app lives in apps/<name>/: its page, its Worker, and its tests.
import { existsSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APPS_ROOT = new URL("../apps/", import.meta.url);

/** @param {string} app */
export const findAppRoot = (app) => new URL(`${app}/`, APPS_ROOT);

// An app is a folder whose Worker has a wrangler.toml.
export const listApps = () =>
  readdirSync(APPS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((app) => existsSync(new URL("worker/wrangler.toml", findAppRoot(app))))
    .sort();

/**
 * The app a command names, or an error that lists the ones there are.
 * @param {string | undefined} app
 * @param {string[]} apps
 */
export function checkAppName(app, apps = listApps()) {
  if (app && apps.includes(app)) return app;
  const named = app ? `There's no app named ${app}. ` : "Name an app. ";
  throw new Error(`${named}The apps are: ${apps.join(", ")}.`);
}

/** @param {string} app */
export const findPageRoot = (app) => fileURLToPath(new URL("page/", findAppRoot(app)));
