import test from "node:test";
import assert from "node:assert/strict";
import * as WebPush from "../worker/src/web-push.js";
import { createBrowserKeys, readPushMessage } from "./push-reader.js";

const decode = WebPush.decodeBase64Url;
const encode = WebPush.encodeBase64Url;

// The inputs of RFC 8291's worked example (Appendix A), and the body the http_ece package
// makes from them.
const EXAMPLE = {
  plaintext: "When I grow up, I want to be a watermelon",
  senderPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  senderPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  browserPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
  body: "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

test("the RFC's example inputs encrypt to the body another implementation makes", async () => {
  const senderPublic = decode(EXAMPLE.senderPublic);
  const body = await WebPush.encryptPayload({
    payload: new TextEncoder().encode(EXAMPLE.plaintext),
    p256dh: EXAMPLE.browserPublic,
    auth: EXAMPLE.auth,
    salt: decode(EXAMPLE.salt),
    localKey: {
      kty: "EC",
      crv: "P-256",
      d: EXAMPLE.senderPrivate,
      x: encode(senderPublic.slice(1, 33)),
      y: encode(senderPublic.slice(33, 65)),
    },
  });
  assert.equal(encode(body), EXAMPLE.body);
});

test("a message with a fresh key and salt decrypts on the browser's side", async () => {
  const keys = await createBrowserKeys();
  const message = { title: "Dodgers took Game 2", body: "Lead the NLDS 2\u20130" };
  const body = await WebPush.encryptPayload({
    payload: new TextEncoder().encode(JSON.stringify(message)),
    p256dh: keys.p256dh,
    auth: keys.auth,
  });
  assert.deepEqual(await readPushMessage(body, keys), message);
});

test("the VAPID token names the push service, expires, and verifies with the sent key", async () => {
  const signingKey = await WebPush.createSigningKey();
  const now = Date.parse("2026-10-01T00:00:00Z");
  const authorization = await WebPush.createVapidAuthorization({
    endpoint: "https://web.push.apple.com/QGuQyavXutnMH",
    signingKey,
    subject: "https://mlb-live.example.workers.dev",
    now,
  });
  const [, token, key] = authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(key, WebPush.readApplicationServerKey(signingKey));
  assert.equal(decode(key).length, 65);

  const [header, claims, signature] = token.split(".");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(decode(header))), {
    typ: "JWT",
    alg: "ES256",
  });
  assert.deepEqual(JSON.parse(new TextDecoder().decode(decode(claims))), {
    aud: "https://web.push.apple.com",
    exp: now / 1000 + 12 * 60 * 60,
    sub: "https://mlb-live.example.workers.dev",
  });
  const publicKey = await crypto.subtle.importKey(
    "raw",
    decode(key),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const isValid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    decode(signature),
    new TextEncoder().encode(`${header}.${claims}`),
  );
  assert.ok(isValid);
});

test("a push goes to the endpoint encrypted, with the push service's headers", async () => {
  const keys = await createBrowserKeys();
  const sent = [];
  const status = await WebPush.sendPush({
    subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys },
    message: { title: "Hello" },
    signingKey: await WebPush.createSigningKey(),
    subject: "https://mlb-live.example.workers.dev",
    now: Date.now(),
    fetchImpl: async (url, init) => {
      sent.push({ url, init });
      return new Response(null, { status: 201 });
    },
  });
  assert.equal(status, 201);
  const [{ url, init }] = sent;
  assert.equal(url, "https://fcm.googleapis.com/fcm/send/abc");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["content-encoding"], "aes128gcm");
  assert.equal(init.headers.ttl, "21600");
  assert.match(init.headers.authorization, /^vapid t=.+, k=.+$/);
  assert.deepEqual(await readPushMessage(init.body, keys), { title: "Hello" });
});
