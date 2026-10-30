import {
  createCipheriv, createDecipheriv, createHash, createHmac, createPublicKey, diffieHellman, generateKeyPairSync,
  hkdfSync, randomBytes, timingSafeEqual,
} from "node:crypto";

const SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");
export const SUITE = "decal-its-lan/v1";

export function fail(code, detail = null) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

export function newKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("x25519");
  return { privateKey, publicRaw: publicKey.export({ type: "spki", format: "der" }).subarray(-32) };
}

export function importPublic(raw) {
  if (!Buffer.isBuffer(raw) || raw.length !== 32) fail("invalid_public_key");
  return createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: "der", type: "spki" });
}

export const sha256Hex = (...parts) => {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest("hex");
};

/** The client commits to its public key before it sees the authority's, so nobody in between can grind a matching code. */
export function commitment(publicRaw, nonce) {
  return sha256Hex(Buffer.from(SUITE), publicRaw, nonce);
}

export function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Both sides call this with the same transcript and get the same device key and the same six-digit check code. */
export function deriveSession({ privateKey, peerPublicRaw, requestId, clientPublicRaw, serverPublicRaw }) {
  const shared = diffieHellman({ privateKey, publicKey: importPublic(peerPublicRaw) });
  if (shared.every((byte) => byte === 0)) fail("invalid_shared_secret");
  const salt = createHash("sha256").update(SUITE).update(requestId).update(clientPublicRaw).update(serverPublicRaw).digest();
  const key = Buffer.from(hkdfSync("sha256", shared, salt, `${SUITE} key`, 32));
  const sasBytes = Buffer.from(hkdfSync("sha256", shared, salt, `${SUITE} check-code`, 4));
  const sas = String(sasBytes.readUInt32BE(0) % 1000000).padStart(6, "0");
  return { keyHex: key.toString("hex"), sas: `${sas.slice(0, 3)} ${sas.slice(3)}` };
}

export function seal(keyHex, aad, plaintext) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), nonce);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { n: nonce.toString("base64"), c: body.toString("base64") };
}

export function open(keyHex, aad, envelope) {
  if (!envelope || typeof envelope.n !== "string" || typeof envelope.c !== "string") fail("invalid_envelope");
  const nonce = Buffer.from(envelope.n, "base64");
  const body = Buffer.from(envelope.c, "base64");
  if (nonce.length !== 12 || body.length < 16) fail("invalid_envelope");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), nonce);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(body.subarray(body.length - 16));
  try {
    return Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  } catch {
    return fail("decryption_failed");
  }
}

export const approvalTag = (keyHex, requestId, deviceId) =>
  createHmac("sha256", Buffer.from(keyHex, "hex")).update(`approved|${requestId}|${deviceId}`).digest("hex");

export const requestAad = (method, route, deviceId, time) => `${method}\n${route}\n${deviceId}\n${time}`;
export const responseAad = (time, status) => `response\n${time}\n${status}`;
