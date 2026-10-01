// Sets the ACCESS_CODE secret, the code an app's page asks for before it opens, or with --remove,
// stops asking. A new code signs every phone out until it types the new one.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizeCode } from "../shared/worker/access-gate.js";
import { checkAppName, findPageRoot } from "./apps.mjs";
import { createSecretsClient } from "./worker-secrets.mjs";

const SECRET_NAME = "ACCESS_CODE";
const SHORTEST_CODE = 4;

/** @param {string} app */
function checkAppHasGate(app) {
  if (!existsSync(`${findPageRoot(app)}gate.html`))
    throw new Error(`The ${app} page has no gate.html to ask for a code with.`);
}

/** @param {string | undefined} code */
function checkCode(code) {
  if (!code || normalizeCode(code).length < SHORTEST_CODE)
    throw new Error(
      `Name a code of at least ${SHORTEST_CODE} letters or digits. Case, spaces, and hyphens don't count.`,
    );
}

/**
 * @param {object} options
 * @param {string} options.app The app whose page asks for the code.
 * @param {string} [options.code]
 * @param {boolean} [options.isRemoving]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 */
export async function setAccessCode({
  app,
  code,
  isRemoving = false,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
}) {
  const secrets = createSecretsClient({ app, fetchImpl, env, log });
  if (isRemoving) {
    if (!(await secrets.listSecretNames()).includes(SECRET_NAME)) {
      log("The page asks for no code.");
      return;
    }
    await secrets.deleteSecret(SECRET_NAME);
    log("The page opens without a code now.");
    return;
  }
  checkAppHasGate(app);
  checkCode(code);
  await secrets.putSecret(SECRET_NAME, code);
  log("The page asks for the code now. Each phone types it once, and again after a new one.");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [named, code] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  Promise.resolve()
    .then(() =>
      setAccessCode({
        app: checkAppName(named),
        code,
        isRemoving: process.argv.includes("--remove"),
      }),
    )
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
