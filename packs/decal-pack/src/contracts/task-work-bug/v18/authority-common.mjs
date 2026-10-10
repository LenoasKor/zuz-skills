import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const CONFIG_SCHEMA = "decal.its-authority-config/v1";
export const CLIENT_SCHEMA = "decal.its-authority-client/v1";
export const OUTBOX_SCHEMA = "decal.its-authority-outbox/v1";
export const TASK_BATCH_INTENT = "decal.task-work-bug.task-registration-batch-intent/v7";
export const TICKET_INTENT_PREFIX = "decal.zuz-its.ticket-registration-intent/";
export const MAX_BODY_BYTES = 1024 * 1024;
export const MAX_SKEW_MS = 5 * 60 * 1000;
const BROKER_VERSIONS = ["v15", "v10"];

export function fail(code, detail = null) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  if (detail) error.detail = detail;
  throw error;
}

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const newKey = () => randomBytes(32).toString("hex");

export function hmac(key, text) {
  return createHmac("sha256", Buffer.from(key, "hex")).update(text).digest("hex");
}

export function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export const requestSignature = (key, method, route, time, body) =>
  hmac(key, `${method}\n${route}\n${time}\n${sha256(body)}`);
export const responseSignature = (key, time, status, body) =>
  hmac(key, `${time}\n${status}\n${sha256(body)}`);

export function deviceHome() {
  return process.env.DECAL_ITS_HOME || path.join(os.homedir(), ".decal", "its-authority");
}

export async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writePrivateJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

export async function git(root, args, options = {}) {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding: options.encoding ?? "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return result.stdout;
}

/** A project's identity is the same in every clone: its root commit(s). */
export async function projectIdOf(root) {
  const roots = (await git(root, ["rev-list", "--max-parents=0", "HEAD"])).split("\n").filter(Boolean).sort();
  if (roots.length === 0) fail("project_identity_unavailable");
  return sha256(roots.join(",")).slice(0, 32);
}

export function intentKind(intent) {
  if (intent?.schema === TASK_BATCH_INTENT) return "task-batch";
  if (typeof intent?.schema === "string" && intent.schema.startsWith(TICKET_INTENT_PREFIX)) return "ticket";
  return fail("unsupported_intent_schema");
}

export function validateIntentShape(intent) {
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) fail("invalid_intent");
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/u.test(String(intent.intentId ?? ""))) fail("invalid_intent_id");
  return intentKind(intent);
}

async function brokerScript(root, kind) {
  const file = kind === "task-batch" ? "register-task-batch.mjs" : "register-ticket.mjs";
  for (const version of BROKER_VERSIONS) {
    const script = path.join(root, "contracts", "task-work-bug", version, file);
    try {
      await access(script);
      return script;
    } catch { /* try next */ }
  }
  return fail("broker_unavailable", file);
}

async function runBroker(script, args, cwd) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, ...args], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
    return JSON.parse(stdout.trim().split("\n").pop());
  } catch (error) {
    const line = String(error.stdout ?? "").trim().split("\n").pop();
    if (line) {
      try { return JSON.parse(line); } catch { /* fall through */ }
    }
    return fail("broker_failed", String(error.message).slice(0, 300));
  }
}

/**
 * Registers one intent through the project's own canonical-main broker.
 * The dry-run digest binds exactly the intent that is then written.
 */
export async function registerLocal(root, intent) {
  const kind = validateIntentShape(intent);
  const script = await brokerScript(root, kind);
  const directory = await mkdtemp(path.join(os.tmpdir(), "decal-its-intent-"));
  try {
    const intentPath = path.join(directory, "intent.json");
    await writeFile(intentPath, JSON.stringify(intent), { mode: 0o600 });
    const plan = await runBroker(script, ["--root", root, "--intent", intentPath, "--dry-run"], root);
    if (plan.status !== "planned" || plan.code !== "accepted") return plan;
    return await runBroker(script, ["--root", root, "--intent", intentPath, "--approved-digest", plan.intentDigest, "--write"], root);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export const isRegistered = (result) => ["committed", "replayed"].includes(result?.status) && typeof result.commit === "string";

/** Commits the client already has, so the authority can send only what is new. */
export async function knownCommits(root, limit = 64) {
  return (await git(root, ["rev-list", `-${limit}`, "HEAD"])).split("\n").filter(Boolean);
}

/** Builds a git bundle holding just the registration commit and its unseen ancestors; null when the client already has it. */
export async function buildBundle(root, commit, have) {
  if (!/^[a-f0-9]{40}$/u.test(commit)) fail("invalid_commit");
  await git(root, ["cat-file", "-e", `${commit}^{commit}`]).catch(() => fail("unknown_commit"));
  const known = [];
  for (const sha of have) {
    if (!/^[a-f0-9]{40}$/u.test(sha)) continue;
    if (await git(root, ["cat-file", "-e", `${sha}^{commit}`]).then(() => true, () => false)) known.push(sha);
  }
  if (known.length === 0) fail("client_unrelated_history");
  for (const sha of known) {
    if (await git(root, ["merge-base", "--is-ancestor", commit, sha]).then(() => true, () => false)) return null;
  }
  const ref = `refs/decal/its-sync/${commit.slice(0, 12)}`;
  await git(root, ["update-ref", ref, commit]);
  try {
    return await git(root, ["bundle", "create", "-", ref, ...known.map((sha) => `^${sha}`)], { encoding: "buffer" });
  } finally {
    await git(root, ["update-ref", "-d", ref]).catch(() => {});
  }
}

/** Brings the authority's registration commit into the client's main without touching other work. */
export async function applyBundle(root, bundle, commit) {
  const alreadyThere = await git(root, ["merge-base", "--is-ancestor", commit, "HEAD"]).then(() => true, () => false);
  if (alreadyThere) return { status: "already_synced", commit };
  if (!bundle) fail("bundle_missing");
  const branch = (await git(root, ["branch", "--show-current"])).trim();
  if (branch !== "main" && branch !== "master") fail("client_not_on_default_branch", branch || "detached");
  const directory = await mkdtemp(path.join(os.tmpdir(), "decal-its-bundle-"));
  try {
    const file = path.join(directory, "sync.bundle");
    await writeFile(file, bundle);
    await git(root, ["bundle", "verify", file]).catch((error) => fail("bundle_verify_failed", String(error.message).slice(0, 200)));
    const ref = `refs/decal/its-sync/${commit.slice(0, 12)}`;
    await git(root, ["fetch", "--quiet", file, `${ref}:${ref}`]);
    try {
      const tip = (await git(root, ["rev-parse", ref])).trim();
      if (tip !== commit) fail("bundle_commit_mismatch");
      const fastForward = await git(root, ["merge-base", "--is-ancestor", "HEAD", commit]).then(() => true, () => false);
      try {
        if (fastForward) await git(root, ["merge", "--ff-only", "--quiet", commit]);
        else await git(root, ["merge", "--no-edit", "--quiet", "-m", `merge ITS registration ${commit.slice(0, 12)} from authority`, commit]);
      } catch (error) {
        await git(root, ["merge", "--abort"]).catch(() => {});
        return fail("sync_merge_blocked", String(error.stderr ?? error.message).slice(0, 300));
      }
      return { status: fastForward ? "fast_forwarded" : "merged", commit };
    } finally {
      await git(root, ["update-ref", "-d", ref]).catch(() => {});
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
