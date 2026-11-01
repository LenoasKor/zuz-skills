#!/usr/bin/env node
// Registers ITS records through the number authority found on the local network.
//   pair [--label NAME] [--timeout SECONDS] [--authority HOST:PORT]
//                                             find the authority, show a check code, wait for approval, save the result as pending
//   pair-confirm --sas "123 456"              activate a pending pairing; the code is the one the user saw on the main device's approval card
//   pair-cancel                               throw a pending pairing away
//   register --intent FILE                    register one intent (queued while the authority is unreachable)
//   flush | status | discover | forget
// A project with no pairing registers locally, exactly like the v15 broker. A pending pairing is not a pairing.
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  OUTBOX_SCHEMA, applyBundle, ensurePrivateDirectory, git, knownCommits, projectIdOf, readJson, readJsonMigratingLegacyAcl, validateIntentShape, writePrivateJson,
} from "./authority-storage.mjs";
import { isRegistered, registerLocal, validDigest } from "../v19/lan-broker.mjs";
import { approvalTag, commitment, constantTimeEqual, deriveSession, fail, newKeyPair, open as openSealed, requestAad, responseAad, seal } from "../v19/lan-crypto.mjs";
import { discoverAuthority } from "../v19/lan-discovery.mjs";

const CLIENT_SCHEMA = "decal.its-lan-client/v1";
const TIMEOUT_MS = 20000;
const PENDING_SCHEMA = "decal.its-lan-client-pending/v1";
const CLIENT_FILE = "its-lan-client.json";
const PENDING_FILE = "its-lan-client.pending.json";
const MAX_CONFIRM_ATTEMPTS = 5;
const CONFIRM_TTL_MS = () => { const value = Number(process.env.DECAL_ITS_PAIR_CONFIRM_TTL_MS); return value > 0 ? value : 600000; };
const configPath = (root) => path.join(root, ".decal", CLIENT_FILE);
const pendingPath = (root) => path.join(root, ".decal", PENDING_FILE);
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

const isClientConfig = (value) => value?.schema === CLIENT_SCHEMA && /^[a-f0-9]{64}$/u.test(value.keyHex ?? "") && Boolean(value.deviceId);
const MIGRATION_NOTE = "This device's key file was moved to owner-only permissions. Under its old permissions other accounts may have been able to read the key, and this does not undo that. Revoking this device on the main device and pairing again is the stronger option.";
let migratedLegacyAcl = false;

async function loadConfig(root) {
  const { value: config, migrated } = await readJsonMigratingLegacyAcl(configPath(root), isClientConfig);
  if (migrated) migratedLegacyAcl = true;
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

// ---- keeping the device key out of Git
const keyPathsOf = () => [`.decal/${CLIENT_FILE}`, `.decal/${PENDING_FILE}`];

async function assertKeyPathsUntracked(root) {
  const tracked = (await git(root, ["ls-files", "--cached", "--", ...keyPathsOf()])).split("\n").filter(Boolean);
  if (tracked.length > 0) fail("client_key_tracked", `${tracked.join(", ")} is tracked by Git. Remove it from the index (git rm --cached) and rotate the key if it was ever committed.`);
}

/** Adds the exact key paths to the repository's local exclude file, which is shared by its worktrees and never committed. */
export async function ensureExcluded(root) {
  const excludeFile = path.resolve(root, (await git(root, ["rev-parse", "--git-path", "info/exclude"])).trim());
  const prefix = (await git(root, ["rev-parse", "--show-prefix"])).replace(/\r?\n$/u, "").replace(/[\\*?[]/gu, "\\$&");
  const current = await readFile(excludeFile, "utf8").catch((error) => { if (error.code === "ENOENT") return ""; throw error; });
  const lines = new Set(current.split(/\r?\n/u));
  const missing = keyPathsOf().map((item) => `/${prefix}${item}`).filter((line) => !lines.has(line));
  if (missing.length > 0) {
    await mkdir(path.dirname(excludeFile), { recursive: true });
    await appendFile(excludeFile, `${current && !current.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`);
  }
  for (const item of keyPathsOf()) {
    // A tracked .gitignore may re-include the path; that outranks the exclude file, so say so instead of trusting the line.
    await git(root, ["check-ignore", "-q", "--", item]).catch(() => fail("client_key_not_excluded", `${item} is still visible to Git; a .gitignore rule may re-include it.`));
  }
}

/** A pairing made by an older contract gets the same exclude entry the first time it is used. It must not block registration. */
const protectExistingKey = (root) => assertKeyPathsUntracked(root).then(() => ensureExcluded(root)).catch(() => {});

// ---- choosing the authority
function rejected(code, extra) {
  const error = new Error(code);
  error.code = code;
  error.extra = extra;
  return error;
}

/** Answers are unauthenticated and any device can send one, so one is never preferred over another. */
export function chooseAuthority(answers, explicit = null) {
  const listed = answers.map((item) => ({ authority: `${item.address}:${item.port}`, label: item.label }));
  if (explicit !== null) {
    const match = answers.find((item) => `${item.address}:${item.port}` === explicit);
    if (!match) throw rejected("authority_not_answered", { requested: explicit, answers: listed, next: "--authority must name an address and port that answered discovery." });
    return match;
  }
  if (answers.length === 0) fail("authority_not_found");
  if (answers.length > 1) {
    throw rejected("authority_ambiguous", {
      answers: listed,
      next: "More than one device answered. Labels are self-declared and prove nothing. Ask the user which address is the main device, then run pair again with --authority HOST:PORT. One main device with two network interfaces also appears here.",
    });
  }
  return answers[0];
}

async function pair(root, label, timeoutSeconds, explicit = null) {
  const projectId = await projectIdOf(root);
  await assertKeyPathsUntracked(root);
  const authority = chooseAuthority(await discoverAuthority(projectId, { timeoutMs: 2000 }), explicit);
  const keys = newKeyPair();
  const nonce = randomBytes(16);
  const requested = await postPlain(authority.address, authority.port, "/v1/pair/request", { projectId, label, commit: commitment(keys.publicRaw, nonce) });
  if (requested.status !== 200) fail(requested.payload.code ?? "pair_request_failed");
  const { requestId } = requested.payload;
  const serverPublic = Buffer.from(requested.payload.serverPublic, "base64");
  const revealed = await postPlain(authority.address, authority.port, "/v1/pair/reveal", { requestId, clientPublic: keys.publicRaw.toString("base64"), nonce: nonce.toString("base64") });
  if (revealed.status !== 200) fail(revealed.payload.code ?? "pair_reveal_failed");
  const session = deriveSession({ privateKey: keys.privateKey, peerPublicRaw: serverPublic, requestId, clientPublicRaw: keys.publicRaw, serverPublicRaw: serverPublic });
  process.stdout.write(`${JSON.stringify({ status: "pending", sas: session.sas, authority: authority.label, address: authority.address, port: authority.port })}\n`);
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    await sleep(700);
    const answer = await postPlain(authority.address, authority.port, "/v1/pair/status", { requestId });
    const state = answer.payload.state;
    if (state === "denied" || state === "expired") return { status: state };
    if (state === "approved") {
      if (!constantTimeEqual(answer.payload.confirm, approvalTag(session.keyHex, requestId, answer.payload.deviceId))) fail("confirmation_mismatch");
      if (!/^[A-Za-z0-9_-]{1,128}$/u.test(String(answer.payload.deviceId ?? ""))) fail("invalid_device_id");
      await ensureExcluded(root);
      const expiresAt = new Date(Date.now() + CONFIRM_TTL_MS()).toISOString();
      await writePrivateJson(pendingPath(root), {
        schema: PENDING_SCHEMA, projectId, deviceId: answer.payload.deviceId, keyHex: session.keyHex, host: authority.address, port: authority.port,
        label, authorityLabel: authority.label, sas: session.sas, attempts: 0, expiresAt,
      });
      return {
        status: "awaiting_local_confirmation", sas: session.sas, authority: authority.label, address: authority.address, port: authority.port, expiresAt,
        next: "Not paired yet. An approved answer proves nothing by itself: any device on the network can send one. Ask the user whether the main device showed an approval card with this same code. Only then run pair-confirm --sas with the code the user reports. If no card appeared or the code differs, run pair-cancel.",
      };
    }
  }
  return { status: "expired" };
}

async function readPending(root) {
  const value = await readJson(pendingPath(root));
  if (!value) return null;
  if (value.schema !== PENDING_SCHEMA || !/^[a-f0-9]{64}$/u.test(value.keyHex ?? "") || !value.deviceId || !/^\d{3} \d{3}$/u.test(value.sas ?? "")
      || !Number.isFinite(Date.parse(value.expiresAt))) fail("invalid_pending_pairing");
  return value;
}

/** The pending pairing that can still be confirmed. An expired one is removed, and with it the key it held. */
async function livePending(root) {
  const value = await readPending(root);
  if (!value) return null;
  if (Date.parse(value.expiresAt) > Date.now()) return value;
  await rm(pendingPath(root), { force: true });
  return null;
}

async function confirmPairing(root, code) {
  if (typeof code !== "string") fail("usage_error", '--sas "123 456"');
  const digits = code.replace(/\s/gu, "");
  if (!/^\d{6}$/u.test(digits)) fail("usage_error", '--sas "123 456"');
  const value = await readPending(root);
  if (!value) fail("no_pending_pairing");
  if (Date.parse(value.expiresAt) <= Date.now()) {
    await rm(pendingPath(root), { force: true });
    fail("pending_pairing_expired", "Pair again. If the main device approved the old request, revoke that device there.");
  }
  if (value.projectId !== await projectIdOf(root)) fail("pending_project_mismatch");
  if (!constantTimeEqual(digits, value.sas.replace(" ", ""))) {
    const attempts = Number(value.attempts ?? 0) + 1;
    if (attempts >= MAX_CONFIRM_ATTEMPTS) {
      await rm(pendingPath(root), { force: true });
      fail("check_code_attempts_exhausted", "Pending pairing removed. Pair again.");
    }
    await writePrivateJson(pendingPath(root), { ...value, attempts });
    fail("check_code_mismatch", "A code that differs from the main device's card can mean another device answered. Run pair-cancel unless this was a typing error.");
  }
  await assertKeyPathsUntracked(root);
  await ensureExcluded(root);
  await writePrivateJson(configPath(root), {
    schema: CLIENT_SCHEMA, projectId: value.projectId, deviceId: value.deviceId, keyHex: value.keyHex, host: value.host, port: value.port,
    label: value.label, authorityLabel: value.authorityLabel, pairedAt: new Date().toISOString(),
  });
  await rm(pendingPath(root), { force: true });
  return { status: "paired", authority: value.authorityLabel, address: value.host, port: value.port };
}

// ---- registration queue (same outbox as v18)
async function saveEntry(root, entry) {
  await writePrivateJson(path.join(outboxDirectory(root), `${entry.intent.intentId}.json`), entry);
}
async function finishEntry(root, entry, outcome) {
  const done = path.join(outboxDirectory(root), "done");
  await writePrivateJson(path.join(done, `${entry.intent.intentId}.json`), { ...entry, state: "done", outcome });
  await rm(path.join(outboxDirectory(root), `${entry.intent.intentId}.json`), { force: true });
}
async function withSyncLock(root, task) {
  const lock = path.join(root, ".decal", "its-sync.lock");
  await ensurePrivateDirectory(path.dirname(lock));
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
    if (await livePending(root)) fail("pairing_awaiting_local_confirmation", "An authority answered this project and the pairing is not confirmed, so a local number could collide. Confirm it with pair-confirm or remove it with pair-cancel.");
    const result = await registerLocal(root, intent, { approvedDigest });
    return { status: isRegistered(result) ? "registered" : "rejected", mode: "local", result };
  }
  await protectExistingKey(root);
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
  await protectExistingKey(root);
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
  if (command === "pair") {
    const explicit = args.has("--authority") ? args.get("--authority") : null;
    if (explicit === true) fail("usage_error", "--authority HOST:PORT");
    return pair(root, String(args.get("--label") || os.hostname()).slice(0, 40), Number(args.get("--timeout") || 120), explicit);
  }
  if (command === "pair-confirm") return confirmPairing(root, args.get("--sas"));
  if (command === "pair-cancel") { await rm(pendingPath(root), { force: true }); return { status: "ok" }; }
  if (command === "register") return register(root, String(args.get("--intent") || fail("usage_error", "--intent FILE")), args.get("--approved-digest") ? String(args.get("--approved-digest")) : null);
  if (command === "flush") return flush(root);
  if (command === "forget") { await rm(configPath(root), { force: true }); await rm(pendingPath(root), { force: true }); return { status: "ok" }; }
  if (command === "status") {
    const config = await loadConfig(root);
    const waiting = await livePending(root);
    const tracked = (await git(root, ["ls-files", "--cached", "--", ...keyPathsOf()])).trim() !== "";
    return { status: "ok", mode: config ? "authority" : "local", authority: config ? { label: config.authorityLabel, host: config.host, port: config.port } : null,
      pendingPairing: waiting ? { authority: waiting.authorityLabel, address: waiting.host, port: waiting.port, sas: waiting.sas, expiresAt: waiting.expiresAt } : null, keyTrackedByGit: tracked, queue: (await pending(root)).map((entry) => ({ intentId: entry.intent.intentId, state: entry.state, commit: entry.commit ?? null })) };
  }
  return fail("usage_error", "pair | pair-confirm | pair-cancel | register | flush | status | discover | forget");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const migrationReport = () => (migratedLegacyAcl ? { migrated: true, migrationNote: MIGRATION_NOTE } : {});
  main().then((result) => {
    process.stdout.write(`${JSON.stringify({ ...result, ...migrationReport() })}\n`);
    process.exitCode = { registered: 0, flushed: 0, paired: 0, ok: 0, queued: 3, sync_pending: 4, incomplete: 3, awaiting_local_confirmation: 5 }[result.status] ?? 2;
  }, (error) => {
    process.stdout.write(`${JSON.stringify({ status: "rejected", code: error.code ?? "client_failed", detail: error.detail ?? undefined, ...error.extra, ...migrationReport() })}\n`);
    process.exitCode = 2;
  });
}
