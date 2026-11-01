#!/usr/bin/env node
import { lstat, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, fail, loadProfile, safeFile } from "../v9/version-profile.mjs";
import { acquireLock, git, gitBoundary, planDigest, validatePlan } from "../v9/transaction.mjs";
import { parseStrictJson } from "../v9/strict-json.mjs";
import { canonicalTicketId, resolveTicketPath } from "../v9/ticket-path.mjs";
import { cli as profileLifecycle, normalizeReleaseContext, transitionWorkItem } from "../v11/work-item-lifecycle.mjs";
import { verifyContract } from "./verify-contract.mjs";

const REQUEST_SCHEMAS = ["zuz.its.work-item-lifecycle-request/v1", "zuz.its.work-item-lifecycle-request/v2"];
const REQUEST_FIELDS = ["schema", "kind", "id", "target", "expectedSourceRevision", "timestamp", "summary", "evidence", "reason", "note", "duplicateOf"];

function validateRequest(request) {
  if (!request || !REQUEST_SCHEMAS.includes(request.schema)) fail("invalid_lifecycle_request");
  const allowed = new Set(REQUEST_FIELDS);
  if (request.schema === REQUEST_SCHEMAS[1]) {
    allowed.add("releaseStage");
    allowed.add("releaseStageSource");
    if (!Object.hasOwn(request, "releaseStage") || !Object.hasOwn(request, "releaseStageSource")) fail("release_context_required");
  }
  if (Object.keys(request).some((key) => !allowed.has(key))) fail("invalid_lifecycle_request");
  normalizeReleaseContext(request);
  return request;
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (args.has(key)) fail("duplicate_argument");
    if (["--dry-run", "--write"].includes(key)) args.set(key, true);
    else if (["--root", "--request", "--approved-plan-digest"].includes(key) && argv[index + 1] && !argv[index + 1].startsWith("--")) args.set(key, argv[++index]);
    else fail("usage_error");
  }
  if (!args.get("--root") || !args.get("--request") || Boolean(args.get("--write")) === Boolean(args.get("--dry-run"))) fail("usage_error");
  return args;
}

/** Only a missing file takes the path without a profile. An unusable profile stays an error. */
async function profileExists(root) {
  try {
    await loadProfile(root);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function planWithoutProfile(root, { expectedSourceRevision, ...request }) {
  const { kind, id, target } = request;
  if (!["work", "bug"].includes(kind)) fail("invalid_record_identity");
  const baseHead = await gitBoundary(root);
  const resolved = await resolveTicketPath(root, kind, id);
  const source = await readFile(resolved.target, "utf8");
  if (digest(source) !== expectedSourceRevision) fail("stale_source_revision");
  const result = transitionWorkItem(source, { ...request, id: resolved.id });
  const context = result.releaseContext.mode === "legacy"
    ? "legacy"
    : `${result.releaseContext.source}-${result.releaseContext.effectiveStage.replace("_", "-")}`;
  const plan = {
    root,
    baseHead,
    recordId: canonicalTicketId(kind, id),
    operation: `${kind}-transition-${context}-without-profile`,
    message: `chore(its): ${canonicalTicketId(kind, id)} ${target}`,
    reads: [],
    entries: [{ path: resolved.relative, source, next: result.next, before: digest(source), after: digest(result.next) }],
  };
  await validatePlan(plan);
  return { plan, from: result.from, to: result.to, releaseContext: result.releaseContext };
}

async function replaceRecord(root, relative, content) {
  const target = await safeFile(root, relative);
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", (await lstat(target)).mode & 0o777);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally { await handle.close(); }
  try { await rename(temporary, target); }
  catch (error) { await unlink(temporary).catch(() => {}); throw error; }
}

async function commitRecord(plan, approvedDigest) {
  if (approvedDigest !== planDigest(plan)) fail("approval_digest_mismatch");
  const release = await acquireLock(plan.root);
  try {
    await validatePlan(plan);
    const [entry] = plan.entries;
    await replaceRecord(plan.root, entry.path, entry.next);
    try {
      await git(plan.root, ["commit", "--only", "-m", plan.message, "-m", `Zuz-ITS-Transition: ${approvedDigest}`, "--", entry.path]);
    } catch (error) {
      if (digest(await readFile(await safeFile(plan.root, entry.path), "utf8")) === entry.after) {
        await replaceRecord(plan.root, entry.path, entry.source);
      }
      throw Object.assign(new Error("transition_commit_failed"), { code: "transition_commit_failed", cause: error });
    }
    return { state: "committed", transitionCommit: (await git(plan.root, ["rev-parse", "HEAD"])).trim(), intentDigest: approvedDigest };
  } finally { await release(); }
}

export async function cli(argv) {
  const args = parseArgs(argv);
  await verifyContract();
  const root = path.resolve(args.get("--root"));
  if (await profileExists(root)) return profileLifecycle(argv);
  const file = path.resolve(args.get("--request"));
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail("unsafe_request_file");
  const request = validateRequest(parseStrictJson(await readFile(file, "utf8")));
  const { plan, from, to, releaseContext } = await planWithoutProfile(root, request);
  if (args.get("--dry-run")) return {
    status: "preview",
    root: plan.root,
    baseHead: plan.baseHead,
    approvalDigest: planDigest(plan),
    from,
    to,
    releaseContext,
    writeSet: plan.entries.map(({ path: target, before, after }) => ({ path: target, before, after })),
    settlementProfile: "not-required-for-this-transition",
  };
  return { ...await commitRecord(plan, args.get("--approved-plan-digest")), from, to, releaseContext };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(`${JSON.stringify(await cli(process.argv.slice(2)))}\n`); }
  catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "rejected", code: error.code ?? "lifecycle_failed" })}\n`);
    process.exitCode = 2;
  }
}
