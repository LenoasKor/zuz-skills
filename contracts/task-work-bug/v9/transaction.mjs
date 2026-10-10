import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, open, readFile, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveCanonicalDefaultBranch } from "../v7/default-branch.mjs";
import { digest, fail, MAX_FILE_BYTES, relativePath, safeFile } from "./version-profile.mjs";
import { parseStrictJson } from "./strict-json.mjs";
import { verifyContract } from "./verify-contract.mjs";

const run = promisify(execFile);
const LOCK = ".decal-slice-completion.lock";
const PENDING = ".decal/settlement-pending-v1.json";
const SCHEMA = "decal.pending-settlement.v1";

export async function git(root, args) {
  return (await run("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })).stdout;
}

async function exists(target) {
  try { return await lstat(target); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function gitBoundary(root) {
  if (Object.hasOwn(process.env, "DECAL_SESSION_ID")) fail("native_authority_required");
  await verifyContract();
  if (path.resolve(root) !== await realpath(root)
      || await realpath((await git(root, ["rev-parse", "--show-toplevel"])).trim()) !== root) fail("noncanonical_root");
  await resolveCanonicalDefaultBranch(root);
  for (const name of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply", "sequencer"]) {
    const target = (await git(root, ["rev-parse", "--git-path", name])).trim();
    if (await exists(path.resolve(root, target))) fail("git_operation_in_progress");
  }
  if ((await git(root, ["diff", "--cached", "--name-only", "-z"])).length) fail("staged_changes_present");
  return (await git(root, ["rev-parse", "HEAD"])).trim();
}

export async function acquireLock(root, timeoutMs = 10000) {
  const target = path.join(root, LOCK);
  const owner = JSON.stringify({ schema: "decal.repository-lock/v1", pid: process.pid, token: randomUUID() });
  const started = Date.now();
  for (;;) {
    try {
      const handle = await open(target, "wx", 0o600);
      try { await handle.writeFile(owner); await handle.sync(); } finally { await handle.close(); }
      return async () => {
        const stat = await exists(target);
        if (!stat || stat.isSymbolicLink() || !stat.isFile()) fail("lock_ownership_lost");
        if (await readFile(target, "utf8") !== owner) fail("lock_ownership_lost");
        await unlink(target);
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const stat = await exists(target);
      if (stat && (stat.isSymbolicLink() || !stat.isFile())) fail("unsafe_repository_lock");
      // Never expire a live lock by wall-clock age or remove an unknown owner's lock.
      if (Date.now() - started >= timeoutMs) fail("repository_lock_timeout");
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
}

async function durableReplace(root, relative, source) {
  const target = await safeFile(root, relative);
  const stat = await lstat(target);
  const temporary = `${target}.its-${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", stat.mode & 0o777);
  try {
    await handle.writeFile(source); await handle.sync();
  } finally { await handle.close(); }
  try { await rename(temporary, target); }
  catch (error) { await unlink(temporary); throw error; }
}

async function writeMarker(root, marker, first = false) {
  const target = path.join(root, PENDING);
  const source = serializeMarker(marker);
  if (!first) return durableReplace(root, PENDING, source);
  // Profile loading has already required a plain .decal parent.
  await safeFile(root, ".decal/settlement-profile.json");
  const handle = await open(target, "wx", 0o600);
  try { await handle.writeFile(source); await handle.sync(); }
  finally { await handle.close(); }
}

function createMarker(plan, approvedDigest) {
  return {
    schema: SCHEMA, owner: "zuz.its.portable/v9", transactionId: randomUUID(),
    operation: plan.operation, recordId: plan.recordId, phase: "preparing", baseHead: plan.baseHead,
    createdAt: new Date().toISOString(), intentDigest: approvedDigest,
    root: plan.root, message: plan.message, reads: plan.reads, entries: plan.entries,
  };
}

function serializeMarker(marker) {
  const source = JSON.stringify(marker, null, 2) + "\n";
  // Account for both before/after content, UTF-8 and JSON escaping. A journal
  // must be readable by the same safeFile boundary used during recovery.
  if (Buffer.byteLength(source) > MAX_FILE_BYTES) fail("settlement_journal_too_large");
  return source;
}

function validateEntries(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 512) fail("invalid_write_set");
  const seen = new Set();
  for (const entry of entries) {
    relativePath(entry.path);
    if (/^(?:\.git|\.decal|contracts)(?:\/|$)/u.test(entry.path)
        || seen.has(entry.path) || !/^sha256:[a-f0-9]{64}$/u.test(entry.before)
        || !/^sha256:[a-f0-9]{64}$/u.test(entry.after)) fail("invalid_write_set");
    seen.add(entry.path);
  }
}

export function planDigest(plan) {
  return digest(JSON.stringify({
    schema: "zuz.its.settlement-plan/v1", root: plan.root, baseHead: plan.baseHead,
    operation: plan.operation, recordId: plan.recordId, message: plan.message,
    reads: plan.reads, entries: plan.entries.map(({ path, before, after }) => ({ path, before, after })),
  }));
}

async function checkInputs(plan) {
  if (await gitBoundary(plan.root) !== plan.baseHead) fail("stale_head");
  for (const input of [...plan.reads, ...plan.entries]) {
    const source = await readFile(await safeFile(plan.root, input.path), "utf8");
    if (digest(source) !== input.before) fail("stale_source", input.path);
    const headSource = await git(plan.root, ["show", `${plan.baseHead}:${input.path}`]);
    if (digest(headSource) !== input.before) fail("target_dirty", input.path);
  }
  for (const journal of [PENDING, ".decal/task-registration-pending-v7.json", ".decal/its-ticket-registration-pending-v1.json"]) {
    if (await exists(path.join(plan.root, journal))) fail("pending_transaction", journal);
  }
}

export async function validatePlan(plan) {
  if (!plan || !/^[a-f0-9]{40,64}$/u.test(plan.baseHead)
      || typeof plan.message !== "string" || !plan.message.trim() || plan.message.length > 160
      || /[\r\n\u0000-\u001f]/u.test(plan.message)
      || typeof plan.operation !== "string" || !/^[a-z-]{1,80}$/u.test(plan.operation)
      || typeof plan.recordId !== "string" || !/^(?:[1-9]\d*|(?:WORK|BUG)-[1-9]\d*)$/u.test(plan.recordId)
      || !Array.isArray(plan.reads)) fail("invalid_plan");
  validateEntries(plan.entries);
  for (const entry of plan.entries) {
    if (typeof entry.source !== "string" || typeof entry.next !== "string"
        || digest(entry.source) !== entry.before || digest(entry.next) !== entry.after) fail("invalid_plan_content");
  }
  serializeMarker(createMarker(plan, planDigest(plan)));
  await checkInputs(plan);
  return { ...plan, approvalDigest: planDigest(plan) };
}

async function verifyCommit(root, marker, commit) {
  const parents = (await git(root, ["show", "-s", "--format=%P", commit])).trim().split(" ");
  if (parents.length !== 1 || parents[0] !== marker.baseHead) fail("unexpected_commit_parent");
  const changed = (await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit])).split("\0").filter(Boolean).sort();
  const expected = marker.entries.filter((entry) => entry.before !== entry.after).map((entry) => entry.path).sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) fail("commit_write_set_mismatch");
  const message = await git(root, ["show", "-s", "--format=%B", commit]);
  if (!message.split("\n").includes(`Zuz-ITS-Settlement: ${marker.intentDigest}`)) fail("receipt_mismatch");
  for (const entry of marker.entries) {
    if (digest(await git(root, ["show", `${commit}:${entry.path}`])) !== entry.after) fail("commit_content_mismatch");
    if (digest(await readFile(await safeFile(root, entry.path), "utf8")) !== entry.after) fail("settlement_state_changed");
  }
}

async function assertReads(root, reads) {
  for (const input of reads) {
    if (digest(await readFile(await safeFile(root, input.path), "utf8")) !== input.before) fail("stale_source", input.path);
  }
}

async function finalizeLocked(root) {
  if (!await exists(path.join(root, PENDING))) return { state: "none" };
  const marker = parseStrictJson(await readFile(await safeFile(root, PENDING), "utf8"));
  if (marker.schema !== SCHEMA || marker.owner !== "zuz.its.portable/v9"
      || marker.phase !== "sealed" || !/^sha256:[a-f0-9]{64}$/u.test(marker.intentDigest)
      || !/^[a-f0-9]{40,64}$/u.test(marker.baseHead) || marker.root !== root
      || !Array.isArray(marker.reads) || !Array.isArray(marker.entries)) fail("manual_recovery_required");
  validateEntries(marker.entries);
  if (planDigest(marker) !== marker.intentDigest) fail("manual_recovery_required");
  const head = await gitBoundary(root);
  if (head === marker.baseHead) fail("settlement_commit_required");
  await git(root, ["merge-base", "--is-ancestor", marker.baseHead, head]);
  const commits = (await git(root, ["rev-list", "--reverse", `${marker.baseHead}..${head}`, "--", ...marker.entries.map((entry) => entry.path)])).trim().split("\n").filter(Boolean);
  if (commits.length !== 1) fail("settlement_history_changed");
  await verifyCommit(root, marker, commits[0]);
  await unlink(await safeFile(root, PENDING));
  return { state: "committed", settlementCommit: commits[0], intentDigest: marker.intentDigest, head };
}

export async function finalizeSettlement(root) {
  await gitBoundary(root);
  const release = await acquireLock(root);
  try { return await finalizeLocked(root); } finally { await release(); }
}

export async function executePlan(plan, approvedDigest) {
  if (approvedDigest !== planDigest(plan)) fail("approval_digest_mismatch");
  await validatePlan(plan);
  const release = await acquireLock(plan.root);
  try {
    await validatePlan(plan);
    const changed = plan.entries.filter((entry) => entry.before !== entry.after);
    if (!changed.length) return { state: "unchanged" };
    const marker = createMarker(plan, approvedDigest);
    await writeMarker(plan.root, marker, true);
    // Once preparing exists, failures preserve the journal and remaining bytes.
    // Do not automatically reset a shared index or overwrite interleaved edits.
    for (const entry of changed) {
      if (await gitBoundary(plan.root) !== plan.baseHead) fail("stale_head");
      if (digest(await readFile(await safeFile(plan.root, entry.path), "utf8")) !== entry.before) fail("stale_source", entry.path);
      await durableReplace(plan.root, entry.path, entry.next);
    }
    await writeMarker(plan.root, { ...marker, phase: "sealed" });
    if (await gitBoundary(plan.root) !== plan.baseHead) fail("stale_head");
    await assertReads(plan.root, plan.reads);
    for (const entry of plan.entries) {
      if (digest(await readFile(await safeFile(plan.root, entry.path), "utf8")) !== entry.after) fail("stale_source", entry.path);
    }
    await git(plan.root, ["commit", "--only", "-m", plan.message, "-m", `Zuz-ITS-Settlement: ${approvedDigest}`, "--", ...changed.map((entry) => entry.path)]);
    return await finalizeLocked(plan.root);
  } finally { await release(); }
}

async function recoveryMarker(root, approvedDigest) {
  const marker = parseStrictJson(await readFile(await safeFile(root, PENDING), "utf8"));
  if (marker.schema !== SCHEMA || marker.owner !== "zuz.its.portable/v9" || marker.root !== root
      || !["preparing", "sealed"].includes(marker.phase) || !Array.isArray(marker.reads)
      || marker.intentDigest !== approvedDigest || planDigest(marker) !== approvedDigest) fail("invalid_recovery_approval");
  validateEntries(marker.entries);
  for (const item of marker.entries) {
    if (typeof item.source !== "string" || typeof item.next !== "string"
        || digest(item.source) !== item.before || digest(item.next) !== item.after) fail("invalid_recovery_content");
  }
  return marker;
}

async function recoverDeadLock(root) {
  const target = path.join(root, LOCK);
  if (!await exists(target)) return;
  const source = await readFile(await safeFile(root, LOCK), "utf8");
  const owner = parseStrictJson(source);
  if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) fail("unsafe_repository_lock");
  try { process.kill(owner.pid, 0); fail("lock_owner_alive"); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
  if (await readFile(await safeFile(root, LOCK), "utf8") !== source) fail("lock_ownership_changed");
  // Called only after an explicit writers-paused assertion, never age-based.
  await unlink(target);
}

export async function recoverSettlement({ root, approvedDigest, action, writersPaused = false }) {
  if (!["resume", "rollback"].includes(action)) fail("invalid_recovery_action");
  await gitBoundary(root);
  await recoveryMarker(root, approvedDigest);
  if (writersPaused) await recoverDeadLock(root);
  const release = await acquireLock(root);
  try {
    const marker = await recoveryMarker(root, approvedDigest);
    if (await gitBoundary(root) !== marker.baseHead) {
      if (action !== "resume") fail("committed_settlement_cannot_rollback");
      return await finalizeLocked(root);
    }
    await assertReads(root, marker.reads);
    for (const item of marker.entries) {
      const current = digest(await readFile(await safeFile(root, item.path), "utf8"));
      if (current !== item.before && current !== item.after) fail("recovery_mixed_state", item.path);
      if (digest(await git(root, ["show", `${marker.baseHead}:${item.path}`])) !== item.before) fail("recovery_base_mismatch");
    }
    // Verify the complete set before touching any file. Every replacement also
    // rechecks its leaf so an interleaved owner is preserved, not reset.
    for (const item of marker.entries) {
      const targetDigest = action === "resume" ? item.after : item.before;
      const current = digest(await readFile(await safeFile(root, item.path), "utf8"));
      if (current !== item.before && current !== item.after) fail("recovery_mixed_state", item.path);
      if (await gitBoundary(root) !== marker.baseHead) fail("stale_head");
      if (current !== targetDigest) await durableReplace(root, item.path, action === "resume" ? item.next : item.source);
    }
    await assertReads(root, marker.reads);
    for (const item of marker.entries) {
      if (digest(await readFile(await safeFile(root, item.path), "utf8")) !== (action === "resume" ? item.after : item.before)) fail("recovery_mixed_state");
    }
    if (action === "rollback") {
      await unlink(await safeFile(root, PENDING));
      return { state: "rolled-back", intentDigest: approvedDigest };
    }
    await writeMarker(root, { ...marker, phase: "sealed" });
    if (await gitBoundary(root) !== marker.baseHead) fail("stale_head");
    const changed = marker.entries.filter((item) => item.before !== item.after).map((item) => item.path);
    await git(root, ["commit", "--only", "-m", marker.message, "-m", `Zuz-ITS-Settlement: ${approvedDigest}`, "--", ...changed]);
    return await finalizeLocked(root);
  } finally { await release(); }
}
