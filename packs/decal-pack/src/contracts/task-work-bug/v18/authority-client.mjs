#!/usr/bin/env node
// Registers ITS records through this project's number authority.
//   init --url URL --key KEY [--device]   point this project (or this device) at the authority
//   register --intent FILE                register one intent; queues it when the authority is unreachable
//   flush                                 retry everything queued
//   status                                show the queue
// Without a client config the device registers locally, exactly like the v15 broker.
import { mkdir, open, readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLIENT_SCHEMA, OUTBOX_SCHEMA, applyBundle, constantTimeEqual, deviceHome, fail, isRegistered, knownCommits, projectIdOf,
  readJson, registerLocal, requestSignature, responseSignature, validateIntentShape, writePrivateJson,
} from "./authority-common.mjs";

const TIMEOUT_MS = 20000;
const outboxDirectory = (root) => path.join(root, ".decal", "its-outbox");
const projectConfigPath = (root) => path.join(root, ".decal", "its-authority.json");
const deviceConfigPath = () => path.join(deviceHome(), "client.json");

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

async function loadClientConfig(root) {
  const config = (await readJson(projectConfigPath(root))) ?? (await readJson(deviceConfigPath()));
  if (!config) return null;
  if (config.schema !== CLIENT_SCHEMA || !/^https?:\/\//u.test(config.url ?? "") || !/^[a-f0-9]{64}$/u.test(config.key ?? "")) fail("invalid_client_config");
  return config;
}

class Unreachable extends Error {}

async function call(config, route, payload) {
  const body = JSON.stringify(payload);
  const time = String(Date.now());
  let response;
  try {
    response = await fetch(new URL(route, config.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-decal-its-time": time,
        "x-decal-its-sig": requestSignature(config.key, "POST", route, time, body),
      },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Unreachable(String(error.cause?.code ?? error.name ?? "unreachable"));
  }
  const text = await response.text();
  if (response.status >= 500) throw new Unreachable(`http_${response.status}`);
  if (response.status === 401) fail("authority_rejected_key");
  const signature = response.headers.get("x-decal-its-sig") ?? "";
  if (!constantTimeEqual(signature, responseSignature(config.key, time, response.status, text))) fail("response_signature_invalid");
  return { status: response.status, payload: JSON.parse(text) };
}

async function saveEntry(root, entry) {
  await mkdir(outboxDirectory(root), { recursive: true });
  await writePrivateJson(path.join(outboxDirectory(root), `${entry.intent.intentId}.json`), entry);
}

async function finishEntry(root, entry, outcome) {
  const done = path.join(outboxDirectory(root), "done");
  await mkdir(done, { recursive: true });
  const source = path.join(outboxDirectory(root), `${entry.intent.intentId}.json`);
  await writePrivateJson(path.join(done, `${entry.intent.intentId}.json`), { ...entry, state: "done", outcome });
  await rm(source, { force: true });
}

/** Several agents may sync into one checkout at once; git allows only one merge at a time. */
async function withSyncLock(root, task) {
  const lock = path.join(root, ".decal", "its-sync.lock");
  await mkdir(path.dirname(lock), { recursive: true });
  const deadline = Date.now() + 60000;
  for (;;) {
    try {
      const handle = await open(lock, "wx");
      await handle.close();
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const age = Date.now() - (await stat(lock).then((value) => value.mtimeMs, () => Date.now()));
      if (age > 120000) await rm(lock, { force: true });
      else if (Date.now() > deadline) fail("sync_lock_timeout");
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  try { return await task(); } finally { await rm(lock, { force: true }); }
}

async function syncCommit(root, config, projectId, entry, bundleBase64) {
  return withSyncLock(root, async () => {
    // undefined: not delivered yet, ask for it. null: the authority says this checkout already has the commit.
    let encoded = bundleBase64;
    if (encoded === undefined) {
      const answer = await call(config, "/v1/sync", { projectId, commit: entry.commit, have: await knownCommits(root) });
      if (answer.status !== 200) fail(answer.payload.code ?? "sync_failed");
      encoded = answer.payload.bundle;
    }
    const bundle = encoded ? Buffer.from(encoded, "base64") : null;
    return applyBundle(root, bundle, entry.commit);
  });
}

/** Sends one queued entry. Returns a result object; never throws for an unreachable authority. */
async function submit(root, config, entry) {
  const projectId = await projectIdOf(root);
  try {
    let bundle;
    if (entry.state !== "registered") {
      const answer = await call(config, "/v1/register", { projectId, intent: entry.intent, have: await knownCommits(root) });
      if (answer.status !== 200) {
        await saveEntry(root, { ...entry, state: "rejected", rejection: answer.payload });
        return { status: "rejected", intentId: entry.intent.intentId, code: answer.payload.code ?? answer.payload.result?.code ?? "rejected", detail: answer.payload.result ?? null };
      }
      entry = { ...entry, state: "registered", commit: answer.payload.result.commit, result: answer.payload.result };
      bundle = answer.payload.bundle;
      await saveEntry(root, entry);
    }
    try {
      const sync = await syncCommit(root, config, projectId, entry, bundle);
      await finishEntry(root, entry, sync);
      return { status: "registered", intentId: entry.intent.intentId, assigned: entry.result.assigned ?? null, commit: entry.commit, sync: sync.status };
    } catch (error) {
      if (error instanceof Unreachable) throw error;
      return { status: "sync_pending", intentId: entry.intent.intentId, assigned: entry.result.assigned ?? null, commit: entry.commit, code: error.code ?? "sync_failed", detail: error.detail ?? null };
    }
  } catch (error) {
    if (error instanceof Unreachable) {
      return { status: entry.state === "registered" ? "sync_pending" : "queued", intentId: entry.intent.intentId, reason: error.message };
    }
    throw error;
  }
}

async function register(root, intentFile) {
  const intent = JSON.parse(await readFile(path.resolve(intentFile), "utf8"));
  validateIntentShape(intent);
  const config = await loadClientConfig(root);
  if (!config) {
    const result = await registerLocal(root, intent);
    return { status: isRegistered(result) ? "registered" : "rejected", mode: "local", result };
  }
  const existing = await readJson(path.join(outboxDirectory(root), `${intent.intentId}.json`));
  const entry = existing ?? { schema: OUTBOX_SCHEMA, intent, state: "pending", createdAt: new Date().toISOString() };
  if (existing && JSON.stringify(existing.intent) !== JSON.stringify(intent)) fail("intent_id_reused_with_different_content", intent.intentId);
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
  const config = await loadClientConfig(root);
  if (!config) fail("authority_not_configured");
  const results = [];
  for (const entry of await pending(root)) {
    if (entry.state === "rejected") continue;
    const result = await submit(root, config, entry);
    results.push(result);
    if (result.status === "queued" || result.status === "sync_pending" && result.reason) break;
  }
  return { status: results.every((item) => item.status === "registered") ? "flushed" : "incomplete", results };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  const root = path.resolve(String(args.get("--root") || "."));
  if (command === "init") {
    const config = { schema: CLIENT_SCHEMA, url: String(args.get("--url") || ""), key: String(args.get("--key") || "") };
    if (!/^https?:\/\//u.test(config.url) || !/^[a-f0-9]{64}$/u.test(config.key)) fail("usage_error", "--url http(s)://… and --key <64 hex>");
    await writePrivateJson(args.has("--device") ? deviceConfigPath() : projectConfigPath(root), config);
    return { status: "configured", scope: args.has("--device") ? "device" : "project", url: config.url };
  }
  if (command === "register") return register(root, String(args.get("--intent") || fail("usage_error", "--intent FILE")));
  if (command === "flush") return flush(root);
  if (command === "status") {
    const config = await loadClientConfig(root);
    return { status: "ok", mode: config ? "authority" : "local", url: config?.url ?? null, queue: (await pending(root)).map((entry) => ({ intentId: entry.intent.intentId, state: entry.state, commit: entry.commit ?? null })) };
  }
  return fail("usage_error", "init | register | flush | status");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = { registered: 0, flushed: 0, configured: 0, ok: 0, queued: 3, sync_pending: 4, incomplete: 3 }[result.status] ?? 2;
  }, (error) => {
    process.stdout.write(`${JSON.stringify({ status: "rejected", code: error.code ?? "client_failed", detail: error.detail ?? undefined })}\n`);
    process.exitCode = 2;
  });
}
