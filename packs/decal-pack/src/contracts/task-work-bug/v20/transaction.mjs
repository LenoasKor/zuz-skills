import { lstat, mkdir, open, readFile, readdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  acquireLock, executePlan as applyPublishedPlan, git, gitBoundary, planDigest, validatePlan,
} from "../v9/transaction.mjs";
import { digest, fail, MAX_FILE_BYTES, relativePath, safeFile } from "../v9/version-profile.mjs";
import { parseStrictJson } from "../v9/strict-json.mjs";
import { verifyContract } from "./verify-contract.mjs";

export { git, gitBoundary, planDigest, validatePlan };
const PENDING = ".decal/settlement-pending-v1.json";
const DIRECTORY = ".decal/settlement-drafts-v1";
const SCHEMA = "zuz.its.settlement-draft/v1";
const HASH = /^sha256:[a-f0-9]{64}$/u;
const idOf = (plan) => planDigest(plan).slice(7);
const draftPath = (id) => {
  if (!/^[a-f0-9]{64}$/u.test(id)) fail("invalid_draft_id");
  return `${DIRECTORY}/${id}.json`;
};
async function exists(target) {
  try { return await lstat(target); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
async function plainDirectory(root, create = false) {
  // Checking the profile also checks every ancestor of the private directory.
  await safeFile(root, ".decal/settlement-profile.json");
  const target = path.join(root, DIRECTORY);
  if (create) {
    try { await mkdir(target, { mode: 0o700 }); } catch (error) { if (error.code !== "EEXIST") throw error; }
  }
  const stat = await exists(target);
  if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) fail("unsafe_draft_directory");
  if (create) {
    if ((await git(root, ["ls-files", "-z", "--", `${DIRECTORY}/`])).length) fail("tracked_draft_directory");
    const ignore = path.join(target, ".gitignore");
    if (!await exists(ignore)) {
      const handle = await open(ignore, "wx", 0o600);
      try { await handle.writeFile("*\n"); await handle.sync(); } finally { await handle.close(); }
    }
    if (await readFile(await safeFile(root, `${DIRECTORY}/.gitignore`), "utf8") !== "*\n") fail("unsafe_draft_ignore");
  }
  return stat ? target : null;
}
function serialize(value) {
  const text = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) fail("settlement_journal_too_large");
  return text;
}
async function replaceFile(root, relative, source) {
  const target = await safeFile(root, relative);
  const temporary = `${target}.its-${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", (await lstat(target)).mode & 0o777);
  try { await handle.writeFile(source); await handle.sync(); } finally { await handle.close(); }
  try { await rename(temporary, target); } catch (error) { await unlink(temporary); throw error; }
}
function validateStoredPlan(plan, root, requireContent = true) {
  if (!plan || plan.root !== root || !/^[a-f0-9]{40,64}$/u.test(plan.baseHead)
      || !/^[a-z-]{1,80}$/u.test(plan.operation) || !/^(?:[1-9]\d*|(?:WORK|BUG)-[1-9]\d*)$/u.test(plan.recordId)
      || typeof plan.message !== "string" || !plan.message.trim() || plan.message.length > 160
      || /[\r\n\u0000-\u001f]/u.test(plan.message)
      || !Array.isArray(plan.entries) || !plan.entries.length || plan.entries.length > 512
      || !Array.isArray(plan.reads) || plan.reads.length > 512) fail("invalid_draft_plan");
  const seen = new Set();
  for (const entry of plan.entries) {
    relativePath(entry.path);
    if (/^(?:\.git|\.decal|contracts)(?:\/|$)/u.test(entry.path) || seen.has(entry.path)
        || !HASH.test(entry.before) || !HASH.test(entry.after)) fail("invalid_draft_plan");
    if (requireContent && (typeof entry.source !== "string" || typeof entry.next !== "string"
        || digest(entry.source) !== entry.before || digest(entry.next) !== entry.after)) fail("invalid_draft_plan");
    seen.add(entry.path);
  }
  for (const input of plan.reads) {
    relativePath(input.path);
    if (!HASH.test(input.before) || /^\.git(?:\/|$)/u.test(input.path)) fail("invalid_draft_plan");
  }
}
async function readDraft(root, id) {
  await plainDirectory(root);
  const value = parseStrictJson(await readFile(await safeFile(root, draftPath(id)), "utf8"));
  if (value.schema !== SCHEMA || value.id !== id || !["draft", "committed"].includes(value.state)) fail("invalid_settlement_draft");
  validateStoredPlan(value.plan, root, value.state !== "committed");
  if (idOf(value.plan) !== id) fail("invalid_settlement_draft");
  return value;
}
async function saveDraft(plan) {
  validateStoredPlan(plan, plan.root);
  const value = { schema: SCHEMA, id: idOf(plan), state: "draft", createdAt: new Date().toISOString(), plan };
  const source = serialize(value);
  await plainDirectory(plan.root, true);
  const relative = draftPath(value.id);
  if (await exists(path.join(plan.root, relative))) return readDraft(plan.root, value.id);
  // A new immutable plan is published through a same-directory rename; callers
  // hold the repository lock, so readers never see a partially written draft.
  const temporary = path.join(plan.root, `${relative}.${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(source); await handle.sync(); } finally { await handle.close(); }
  await rename(temporary, path.join(plan.root, relative));
  return value;
}
async function saveReceipt(plan, receipt) {
  const saved = await saveDraft(plan);
  // Completed operations retain a compact receipt, not two copies of the full
  // shared registry forever. Git remains the source for historical validation.
  const compact = { root: plan.root, baseHead: plan.baseHead, operation: plan.operation,
    recordId: plan.recordId, message: plan.message, reads: plan.reads,
    entries: plan.entries.map(({ path, before, after }) => ({ path, before, after })) };
  await replaceFile(plan.root, draftPath(saved.id), serialize({ ...saved, plan: compact, state: "committed", receipt }));
}
function summary(value) {
  return { draftId: value.id, state: value.state, recordId: value.plan.recordId,
    operation: value.plan.operation, baseHead: value.plan.baseHead,
    nextAction: value.state === "committed" ? "verify_receipt" : "replan_from_current_head",
    writeSet: value.plan.entries.map(({ path }) => path) };
}

export async function draftPlan(plan, approvedDigest) {
  await verifyContract();
  if (approvedDigest !== planDigest(plan)) fail("approval_digest_mismatch");
  const release = await acquireLock(plan.root);
  try {
    await validatePlan(plan);
    if (!changedPaths(plan).length) return { state: "unchanged", canonicalFilesChanged: false };
    return { ...summary(await saveDraft(plan)), state: "draft", canonicalFilesChanged: false };
  } finally { await release(); }
}

export async function listDrafts(root) {
  await verifyContract();
  await gitBoundary(root);
  const directory = await plainDirectory(root);
  if (!directory) return [];
  const files = (await readdir(directory)).filter((name) => /^[a-f0-9]{64}\.json$/u.test(name)).sort();
  if (files.length > 10000) fail("too_many_settlement_drafts");
  const head = await gitBoundary(root);
  return Promise.all(files.map(async (name) => {
    const saved = await readDraft(root, name.slice(0, -5));
    try {
      const receipt = await committedReceipt(root, { ...saved.plan, intentDigest: planDigest(saved.plan) }, head);
      if (receipt) return { ...summary(saved), state: "committed", receipt, nextAction: "none" };
    } catch (error) {
      // One stale draft never blocks inspection of the others. Stored status is
      // merely a cache; only the historical receipt above proves completion.
      if (saved.state === "committed") return { ...summary(saved), state: "receipt_unverified", code: error.code, nextAction: "inspect_history" };
    }
    return { ...summary(saved), state: "draft", nextAction: "replan_from_current_head" };
  }));
}

async function readMarker(root, approvedDigest) {
  const marker = parseStrictJson(await readFile(await safeFile(root, PENDING), "utf8"));
  if (marker.schema !== "decal.pending-settlement.v1" || marker.owner !== "zuz.its.portable/v9"
      || !["preparing", "sealed"].includes(marker.phase)) fail("manual_recovery_required");
  validateStoredPlan(marker, root);
  if (!HASH.test(marker.intentDigest) || planDigest(marker) !== marker.intentDigest
      || (approvedDigest && approvedDigest !== marker.intentDigest)) fail("invalid_recovery_approval");
  return marker;
}
async function unchangedMarker(root, marker) {
  const current = await readMarker(root, marker.intentDigest);
  if (JSON.stringify(current) !== JSON.stringify(marker)) fail("settlement_marker_changed");
}
async function ancestor(root, before, after) {
  try { await git(root, ["merge-base", "--is-ancestor", before, after]); }
  catch { fail("settlement_history_changed"); }
}
const changedPaths = (plan) => plan.entries.filter((entry) => entry.before !== entry.after).map((entry) => entry.path).sort();

// Finalization proves a historical commit. It never rewrites the current tree,
// so later valid settlements (including shared registry/version updates) remain
// intact. Parent/input bytes and the complete commit write set are still bound.
async function committedReceipt(root, marker, head) {
  await ancestor(root, marker.baseHead, head);
  const commits = (await git(root, ["rev-list", "--reverse", `${marker.baseHead}..${head}`, "--",
    ...marker.entries.map((entry) => entry.path)])).trim().split("\n").filter(Boolean);
  if (!commits.length) return null;
  const commit = commits[0];
  const parents = (await git(root, ["show", "-s", "--format=%P", commit])).trim().split(/\s+/u);
  if (parents.length !== 1) fail("unexpected_commit_parent");
  await ancestor(root, marker.baseHead, parents[0]);
  const changed = (await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", commit])).split("\0").filter(Boolean).sort();
  if (JSON.stringify(changed) !== JSON.stringify(changedPaths(marker))) fail("commit_write_set_mismatch");
  const message = await git(root, ["show", "-s", "--format=%B", commit]);
  if (!message.split("\n").includes(`Zuz-ITS-Settlement: ${marker.intentDigest}`)) fail("receipt_mismatch");
  // A changed-and-reverted read is also stale: do not infer verification freshness.
  const intervening = await git(root, ["rev-list", `${marker.baseHead}..${parents[0]}`, "--",
    ...marker.entries.map((item) => item.path), ...marker.reads.map((item) => item.path)]);
  if (intervening.trim()) fail("settlement_inputs_changed");
  for (const input of [...marker.reads, ...marker.entries]) {
    if (digest(await git(root, ["show", `${parents[0]}:${input.path}`])) !== input.before) fail("settlement_inputs_changed");
  }
  for (const entry of marker.entries) {
    if (digest(await git(root, ["show", `${commit}:${entry.path}`])) !== entry.after) fail("commit_content_mismatch");
  }
  return { state: "committed", settlementCommit: commit, intentDigest: marker.intentDigest, head };
}

async function finalizeLocked(root, approvedDigest) {
  if (!await exists(path.join(root, PENDING))) return { state: "none" };
  const marker = await readMarker(root, approvedDigest);
  const receipt = await committedReceipt(root, marker, await gitBoundary(root));
  if (!receipt) fail("settlement_commit_required");
  await saveReceipt(marker, receipt);
  await unchangedMarker(root, marker);
  await unlink(await safeFile(root, PENDING));
  return receipt;
}
export async function finalizeSettlement(root) {
  await verifyContract();
  await gitBoundary(root);
  const release = await acquireLock(root);
  try { return await finalizeLocked(root); } finally { await release(); }
}

// Compensation only restores known, uncommitted bytes belonging to this exact
// journal. Unknown edits, staged changes and changed target history stop it.
async function parkLocked(root, approvedDigest) {
  const marker = await readMarker(root, approvedDigest);
  const head = await gitBoundary(root);
  const receipt = await committedReceipt(root, marker, head);
  if (receipt) return finalizeLocked(root, approvedDigest);
  for (const entry of marker.entries) {
    if (digest(await git(root, ["show", `${head}:${entry.path}`])) !== entry.before) fail("recovery_base_mismatch");
    const current = digest(await readFile(await safeFile(root, entry.path), "utf8"));
    if (current !== entry.before && current !== entry.after) fail("recovery_mixed_state", entry.path);
  }
  const saved = await saveDraft(marker);
  for (const entry of marker.entries) {
    if (await gitBoundary(root) !== head) fail("stale_head");
    await unchangedMarker(root, marker);
    const current = digest(await readFile(await safeFile(root, entry.path), "utf8"));
    if (current !== entry.before && current !== entry.after) fail("recovery_mixed_state", entry.path);
    if (current !== entry.before) await replaceFile(root, entry.path, entry.source);
  }
  if (await gitBoundary(root) !== head) fail("stale_head");
  for (const entry of marker.entries) {
    if (digest(await readFile(await safeFile(root, entry.path), "utf8")) !== entry.before) fail("recovery_mixed_state");
  }
  await unchangedMarker(root, marker);
  await unlink(await safeFile(root, PENDING));
  return { ...summary(saved), state: "draft", canonicalFilesChanged: false };
}
export async function parkSettlement(root, approvedDigest) {
  await verifyContract();
  if (!HASH.test(approvedDigest)) fail("invalid_recovery_approval");
  await gitBoundary(root);
  const release = await acquireLock(root);
  try { return await parkLocked(root, approvedDigest); } finally { await release(); }
}

export async function executePlan(plan, approvedDigest) {
  const draft = await draftPlan(plan, approvedDigest);
  if (draft.state === "unchanged") return draft;
  let result;
  try {
    // Keep the published writer's Git hooks, clean exact write set, source/HEAD
    // checks and common lock. Saving a draft grants no permission to bypass them.
    result = await applyPublishedPlan(plan, approvedDigest);
  } catch (error) {
    const release = await acquireLock(plan.root);
    try {
      if (await exists(path.join(plan.root, PENDING))) {
        const recovered = await parkLocked(plan.root, approvedDigest);
        if (recovered.state === "committed") return recovered;
      }
    } catch (recoveryError) {
      recoveryError.cause = error;
      recoveryError.draftId = idOf(plan);
      throw recoveryError;
    } finally { await release(); }
    error.draftId = idOf(plan);
    error.requestState = "draft";
    throw error;
  }
  if (result.state === "committed") {
    const release = await acquireLock(plan.root);
    try { await saveReceipt(plan, result); } finally { await release(); }
  }
  return { ...result, draftId: idOf(plan) };
}
