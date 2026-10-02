// Gives the Worker the APP_KEY secret that the page and its store answer under.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { checkAppName } from "./apps.mjs";
import { createSecretsClient } from "./worker-secrets.mjs";

const SECRET_NAME = "APP_KEY";

export const createKey = () => randomBytes(24).toString("base64url");

/**
 * @param {object} options
 * @param {string} options.app The app whose Worker gets the key.
 * @param {typeof fetch} [options.fetchImpl]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {typeof console.log} [options.log]
 * @param {boolean} [options.isRotating]
 * @param {() => string} [options.makeKey]
 */
export async function setAppKey({
  app,
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
  isRotating = false,
  makeKey = createKey,
}) {
  const secrets = createSecretsClient({ app, fetchImpl, env, log });
  if ((await secrets.listSecretNames()).includes(SECRET_NAME) && !isRotating)
    throw new Error(
      `The Worker already has an ${SECRET_NAME}. A new one changes the page's address, so the ` +
        "home-screen icon stops working. To do it anyway, add --rotate.",
    );

  const key = makeKey();
  await secrets.putSecret(SECRET_NAME, key);
  const url = `${await secrets.readWorkerUrl()}${key}/`;
  log(`Page address: ${url}`);
  return url;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [named] = process.argv.slice(2).filter((argument) => !argument.startsWith("--"));
  Promise.resolve()
    .then(() =>
      setAppKey({ app: checkAppName(named), isRotating: process.argv.includes("--rotate") }),
    )
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}
