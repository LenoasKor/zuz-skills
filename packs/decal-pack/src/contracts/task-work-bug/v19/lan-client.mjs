#!/usr/bin/env node
// Registers ITS records through the number authority found on the local network.
//   pair [--label NAME] [--timeout SECONDS]   find the authority, show a check code, wait for approval on the main device
//   register --intent FILE                    register one intent (queued while the authority is unreachable)
//   flush | status | discover | forget
// A project with no pairing registers locally, exactly like the v15 broker.
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OUTBOX_SCHEMA, applyBundle, knownCommits, projectIdOf, readJson, validateIntentShape, writePrivateJson,
} from "../v18/authority-common.mjs";
import { isRegistered, registerLocal, validDigest } from "./lan-broker.mjs";
import { approvalTag, commitment, constantTimeEqual, deriveSession, fail, newKeyPair, open as openSealed, requestAad, responseAad, seal } from "./lan-crypto.mjs";
import { discoverAuthority } from "./lan-discovery.mjs";

const CLIENT_SCHEMA = "decal.its-lan-client/v1";
const TIMEOUT_MS = 20000;
const configPath = (root) => path.join(root, ".decal", "its-lan-client.json");
const outboxDirectory = (root) => path.join(root, ".decal", "its-outbox");

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail("usage_error", key);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) parsed.set(key, true);
    else { parsed.set(key, value); index += 1; }
  }
  return parsed;
}

class Unreachable extends Error {}

async function loadConfig(root) {
  const config = await readJson(configPath(root));
  if (!config) return null;
  if (config.schema !== CLIENT_SCHEMA || !/^[a-f0-9]{64}$/u.test(config.keyHex ?? "") || !config.deviceId) fail("invalid_client_config");
  return config;
}

async function postPlain(host, port, route, payload) {
  let response;
  try {
    response = await fetch(`http://${host}:${port}${route}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Unreachable(String(error.cause?.code ?? error.name ?? "unreachable"));
  }
  return { status: response.status, payload: await response.json() };
}

async function postSealedOnce(config, host, port, route, payload) {
  const time = String(Date.now());
  const envelope = { d: config.deviceId, t: time, ...seal(config.keyHex, requestAad("POST", route, config.deviceId, time), JSON.stringify(payload)) };
  let response;
  try {
    response = await fetch(`http://${host}:${port}${route}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(envelope), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Unreachable(String(error.cause?.code ?? error.name ?? "unreachable"));
  }
  const text = await response.text();
  if (response.status >= 500) throw new Unreachable(`http_${response.status}`);
  if (response.status === 401) fail("authority_rejected_device");
  if (response.status === 429) fail("authority_throttled");
  if (response.status === 400 || response.status === 413) fail(JSON.parse(text).code ?? "bad_request");
  const opened = openSealed(config.keyHex, responseAad(time, response.status), JSON.parse(text));
  return { status: response.status, payload: JSON.parse(opened.toString("utf8")) };
}

/** Sealed call; when the authority moved (new IP or port) the client finds it again and retries once. */
async function call(root, config, route, payload) {
  try {
    return await postSealedOnce(config, config.host, config.port, route, payload);
  } catch (error) {
    if (!(error instanceof Unreachable)) throw error;
    const candidates = await discoverAuthority(config.projectId);
    for (const candidate of candidates) {
      if (candidate.address === config.host && candidate.port === config.port) continue;
      try {
        const answer = await postSealedOnce(config, candidate.address, candidate.port, route, payload);
        Object.assign(config, { host: candidate.address, port: candidate.port });
        await writePrivateJson(configPath(root), config);
        return answer;
      } catch (inner) {
        if (!(inner instanceof Unreachable) && inner.code !== "decryption_failed" && inner.code !== "authority_rejected_device") throw inner;
      }
    }
    throw error;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function pair(root, label, timeoutSeconds) {
  const projectId = await projectIdOf(root);
  const [authority] = await discoverAuthority(projectId, { timeoutMs: 2000 });
  if (!authority) fail("authority_not_found");
  const keys = newKeyPair();
  const nonce = randomBytes(16);
  const requested = await postPlain(authority.address, authority.port, "/v1/pair/request", { projectId, label, commit: commitment(keys.publicRaw, nonce) });
  if (requested.status !== 200) fail(requested.payload.code ?? "pair_request_failed");
  const { requestId } = requested.payload;
  const serverPublic = Buffer.from(requested.payload.serverPublic, "base64");
  const revealed = await postPlain(authority.address, authority.port, "/v1/pair/reveal", { requestId, clientPublic: keys.publicRaw.toString("base64"), nonce: nonce.toString("base64") });
  if (revealed.status !== 200) fail(revealed.payload.code ?? "pair_reveal_failed");
  const session = deriveSession({ privateKey: keys.privateKey, peerPublicRaw: serverPublic, requestId, clientPublicRaw: keys.publicRaw, serverPublicRaw: serverPublic });
  process.stdout.write(`${JSON.stringify({ status: "pending", sas: session.sas, authority: authority.label })}\n`);
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    await sleep(700);
    const answer = await postPlain(authority.address, authority.port, "/v1/pair/status", { requestId });
    const state = answer.payload.state;
    if (state === "denied" || state === "expired") return { status: state };
    if (state === "approved") {
      if (!constantTimeEqual(answer.payload.confirm, approvalTag(session.keyHex, requestId, answer.payload.deviceId))) fail("confirmation_mismatch");
      await writePrivateJson(configPath(root), {
        schema: CLIENT_SCHEMA, projectId, deviceId: answer.payload.deviceId, keyHex: session.keyHex, host: authority.address, port: authority.port,
        label, authorityLabel: authority.label, pairedAt: new Date().toISOString(),
      });
      return { status: "paired", authority: authority.label };
    }
  }
  return { status: "expired" };
}

// ---- registration queue (same outbox as v18)
async function saveEntry(root, entry) {
  await mkdir(outboxDirectory(root), { recursive: true });
  await writePrivateJson(path.join(outboxDirectory(root), `${entry.intent.intentId}.json`), entry);
}
async function finishEntry(root, entry, outcome) {
  const done = path.join(outboxDirectory(root), "done");
  await mkdir(done, { recursive: true });
  await writePrivateJson(path.join(done, `${entry.intent.intentId}.json`), { ...entry, state: "done", outcome });
  await rm(path.join(outboxDirectory(root), `${entry.intent.intentId}.json`), { force: true });
}
async function withSyncLock(root, task) {
  const lock = path.join(root, ".decal", "its-sync.lock");
  await mkdir(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + 60000;
  for (;;) {
    try { await (await open(lock, "wx")).close(); break; } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const age = Date.now() - (await stat(lock).then((value) => value.mtimeMs, () => Date.now()));
      if (age > 120000) await rm(lock, { force: true });
      else if (Date.now() > deadline) fail("sync_lock_timeout");
      else await sleep(100);
    }
  }
  try { return await task(); } finally { await rm(lock, { force: true }); }
}
async function syncCommit(root, config, entry, encoded) {
  return withSyncLock(root, async () => {
    let data = encoded;
    if (data === undefined) {
      const answer = await call(root, config, "/v1/sync", { projectId: config.projectId, commit: entry.commit, have: await knownCommits(root) });
      if (answer.status !== 200) fail(answer.payload.code ?? "sync_failed");
      data = answer.payload.bundle;
    }
    return applyBundle(root, data ? Buffer.from(data, "base64") : null, entry.commit);
  });
}
async function submit(root, config, entry) {
  try {
    let bundle;
    if (entry.state !== "registered") {
      const answer = await call(root, config, "/v1/register", { projectId: config.projectId, intent: entry.intent, approvedDigest: entry.approvedDigest ?? null, have: await knownCommits(root) });
      if (answer.status !== 200) {
        await saveEntry(root, { ...entry, state: "rejected", rejection: answer.payload });
        return { status: "rejected", intentId: entry.intent.intentId, code: answer.payload.code ?? answer.payload.result?.code ?? "rejected", detail: answer.payload.result ?? null };
      }
      entry = { ...entry, state: "registered", commit: answer.payload.result.commit, result: answer.payload.result };
      bundle = answer.payload.bundle;
      await saveEntry(root, entry);
    }
    try {
      const sync = await syncCommit(root, config, entry, bundle);
      await finishEntry(root, entry, sync);
      return { status: "registered", intentId: entry.intent.intentId, assigned: entry.result.assigned ?? null, commit: entry.commit, sync: sync.status, receipt: entry.result };
    } catch (error) {
      if (error instanceof Unreachable) throw error;
      return { status: "sync_pending", intentId: entry.intent.intentId, assigned: entry.result.assigned ?? null, commit: entry.commit, code: error.code ?? "sync_failed", detail: error.detail ?? null };
    }
  } catch (error) {
    if (error instanceof Unreachable) return { status: entry.state === "registered" ? "sync_pending" : "queued", intentId: entry.intent.intentId, reason: error.message };
    throw error;
  }
}
async function register(root, intentFile, approvedDigest = null) {
  const intent = JSON.parse(await readFile(path.resolve(intentFile), "utf8"));
  validateIntentShape(intent);
  if (approvedDigest !== null && !validDigest(approvedDigest)) fail("invalid_approved_digest");
  const config = await loadConfig(root);
  if (!config) {
    const result = await registerLocal(root, intent, { approvedDigest });
    return { status: isRegistered(result) ? "registered" : "rejected", mode: "local", result };
  }
  const existing = await readJson(path.join(outboxDirectory(root), `${intent.intentId}.json`));
  const fresh = { schema: OUTBOX_SCHEMA, intent, approvedDigest, state: "pending", createdAt: new Date().toISOString() };
  // A rejected attempt is replaced by the new one; a request that is already registered must keep its commit.
  if (existing && existing.state !== "rejected" && JSON.stringify(existing.intent) !== JSON.stringify(intent)) fail("intent_id_reused_with_different_content", intent.intentId);
  let entry = !existing || existing.state === "rejected" ? fresh : existing;
  if (entry.state === "pending" && approvedDigest !== null) entry = { ...entry, approvedDigest };
  await saveEntry(root, entry);
  return { mode: "authority", ...(await submit(root, config, entry)) };
}
async function pending(root) {
  let names = [];
  try { names = (await readdir(outboxDirectory(root))).filter((name) => name.endsWith(".json")); } catch { /* none */ }
  const entries = [];
  for (const name of names) entries.push(await readJson(path.join(outboxDirectory(root), name)));
  return entries.filter(Boolean).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}
async function flush(root) {
  const config = await loadConfig(root);
  if (!config) fail("not_paired");
  const results = [];
  for (const entry of await pending(root)) {
    if (entry.state === "rejected") continue;
    const result = await submit(root, config, entry);
    results.push(result);
    if (result.status === "queued" || (result.status === "sync_pending" && result.reason)) break;
  }
  return { status: results.every((item) => item.status === "registered") ? "flushed" : "incomplete", results };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const root = path.resolve(String(args.get("--root") || "."));
  if (command === "discover") return { status: "ok", authorities: await discoverAuthority(await projectIdOf(root)) };
  if (command === "pair") return pair(root, String(args.get("--label") || os.hostname()).slice(0, 40), Number(args.get("--timeout") || 120));
  if (command === "register") return register(root, String(args.get("--intent") || fail("usage_error", "--intent FILE")), args.get("--approved-digest") ? String(args.get("--approved-digest")) : null);
  if (command === "flush") return flush(root);
  if (command === "forget") { await rm(configPath(root), { force: true }); return { status: "ok" }; }
  if (command === "status") {
    const config = await loadConfig(root);
    return { status: "ok", mode: config ? "authority" : "local", authority: config ? { label: config.authorityLabel, host: config.host, port: config.port } : null, queue: (await pending(root)).map((entry) => ({ intentId: entry.intent.intentId, state: entry.state, commit: entry.commit ?? null })) };
  }
  return fail("usage_error", "pair | register | flush | status | discover | forget");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = { registered: 0, flushed: 0, paired: 0, ok: 0, queued: 3, sync_pending: 4, incomplete: 3 }[result.status] ?? 2;
  }, (error) => {
    process.stdout.write(`${JSON.stringify({ status: "rejected", code: error.code ?? "client_failed", detail: error.detail ?? undefined })}\n`);
    process.exitCode = 2;
  });
}
