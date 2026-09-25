// Gives the Worker the APP_KEY secret that the page and its store answer under.
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createCloudflareCaller,
  findWorkersApi,
  readAccount,
  readWorkerConfig,
} from "./deploy.mjs";

const SECRET_NAME = "APP_KEY";

export const createKey = () => randomBytes(24).toString("base64url");

export async function setAppKey({
  fetchImpl = fetch,
  env = process.env,
  log = console.log,
  isRotating = false,
  makeKey = createKey,
} = {}) {
  const base = findWorkersApi(readAccount(env));
  const { name } = readWorkerConfig();
  const callCloudflare = createCloudflareCaller({ fetchImpl, env, log });
  const secretsUrl = `${base}/scripts/${name}/secrets`;

  const secrets = await callCloudflare("secrets", secretsUrl, { method: "GET" });
  if (secrets.some((secret) => secret.name === SECRET_NAME) && !isRotating)
    throw new Error(
      `The Worker already has an ${SECRET_NAME}. A new one changes the page's address, so the ` +
        "home-screen icon stops working. To do it anyway, add --rotate.",
    );

  const key = makeKey();
  await callCloudflare(SECRET_NAME, secretsUrl, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: SECRET_NAME, text: key, type: "secret_text" }),
  });
  const { subdomain } = await callCloudflare("subdomain", `${base}/subdomain`, { method: "GET" });
  const url = `https://${name}.${subdomain}.workers.dev/${key}/`;
  log(`Page address: ${url}`);
  return url;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setAppKey({ isRotating: process.argv.includes("--rotate") }).catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}
