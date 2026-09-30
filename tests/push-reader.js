import { decodeBase64Url, encodeBase64Url } from "../shared/worker/web-push.js";

// A browser's side of Web Push, to read what the Worker sends: its keys, and decryption of an
// aes128gcm body that holds one record.

const ECDH = { name: "ECDH", namedCurve: "P-256" };

export async function createBrowserKeys() {
  const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    privateKey: pair.privateKey,
    p256dh: encodeBase64Url(publicKey),
    auth: encodeBase64Url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

async function deriveHkdf(salt, secret, info, length) {
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

const encodeText = (text) => new TextEncoder().encode(text);

export async function readPushMessage(body, keys) {
  const bytes = new Uint8Array(body);
  const salt = bytes.slice(0, 16);
  const keyLength = bytes[20];
  const senderKey = bytes.slice(21, 21 + keyLength);
  const ciphertext = bytes.slice(21 + keyLength);
  const publicKey = await crypto.subtle.importKey("raw", senderKey, ECDH, false, []);
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, keys.privateKey, 256),
  );
  const browserKey = decodeBase64Url(keys.p256dh);
  const info = new Uint8Array([...encodeText("WebPush: info\0"), ...browserKey, ...senderKey]);
  const inputKey = await deriveHkdf(decodeBase64Url(keys.auth), shared, info, 32);
  const contentKey = await deriveHkdf(
    salt,
    inputKey,
    encodeText("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await deriveHkdf(salt, inputKey, encodeText("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["decrypt"]);
  const record = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce }, aesKey, ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(record.slice(0, record.lastIndexOf(2))));
}
