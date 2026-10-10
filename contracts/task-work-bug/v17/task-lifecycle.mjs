#!/usr/bin/env node
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseIndex, validateProject } from "../v4/registry.mjs";
import { digest, fail, loadProfile, parseVersion, PROFILE_PATH, safeFile } from "../v9/version-profile.mjs";
import { executePlan, git, gitBoundary, planDigest, validatePlan } from "../v9/transaction.mjs";
import { appendVerification, assertCriteria, canonicalStatus, metadata, replaceMetadata, TASK_FLOW, transitionTaskDocument, updateTaskIndex, validateVerification } from "../v9/task-policy.mjs";
import { planTaskLifecycle as planPerTicket } from "../v9/task-lifecycle.mjs";
import { parseStrictJson } from "../v9/strict-json.mjs";
import { readSettlementMode } from "./settlement-mode.mjs";

const entry = (relative, source, next) => ({ path: relative, source, next, before: digest(source), after: digest(next) });
const CHANNELS = [["Version Impact", "Version Applied", "desktop-minor"], ["Remote Version Impact", "Remote Version Applied", "remote-minor"]];

// Per-ticket projects run the published v9 planner unchanged. Release projects complete a Task
// without touching version sources: its applied versions stay `pending` (task-batch items keep
// `pending-task`) until release-settle.mjs applies one release version to everything shipped.
export async function planTaskLifecycle(input) {
  const details = input?.details;
  if (!input || typeof input !== "object"
      || (details !== undefined && (!details || typeof details !== "object" || Array.isArray(details)))) fail("invalid_lifecycle_details");
  const settlement = await readSettlementMode(input.root);
  if (settlement.mode === "per-ticket") {
    const planned = await planPerTicket(input);
    if (settlement.read) planned.plan.reads.push(settlement.read);
    return planned;
  }
  return planReleaseMode(input, settlement.read);
}

async function planReleaseMode({ root, taskId, target, mode = "transition", details = {} }, modeRead) {
  if (!details || typeof details !== "object" || Array.isArray(details)) fail("invalid_lifecycle_details");
  if (!/^[1-9]\d*$/u.test(String(taskId)) || !Number.isSafeInteger(Number(taskId))) fail("invalid_task_identity");
  taskId = String(taskId);
  if (!["transition", "complete", "test-pass"].includes(mode)) fail("invalid_lifecycle_mode");
  if (mode === "complete") target = "completed";
  if (mode === "test-pass" && !["release_ready", "completed"].includes(target)) fail("invalid_lifecycle_target");
  if (mode === "transition" && ["release_ready", "completed"].includes(target)) fail("completion_command_required");
  const baseHead = await gitBoundary(root);
  const loaded = await loadProfile(root);
  if (loaded.profile.engine !== "portable") fail("repository_settlement_required");
  await safeFile(root, "docs/tasks/index.md");
  await safeFile(root, "docs/tasks/category_index.md");
  const project = await validateProject(root);
  const record = project.index.records.find((item) => item.rawId === taskId);
  if (!record) fail("task_not_found");
  const relative = `docs/tasks/${record.fileName}`;
  const source = await readFile(await safeFile(root, relative), "utf8");
  const from = canonicalStatus(metadata(source, "상태"));
  if (canonicalStatus(record.status) !== from) fail("document_status_mismatch");
  if (from === "completed") {
    for (const [impactKey, appliedKey, expected] of CHANNELS) {
      const impact = metadata(source, impactKey);
      const applied = metadata(source, appliedKey);
      if (impact === "none") {
        if (applied !== "not-required") fail("invalid_completed_settlement");
      } else {
        if (impact !== expected || ["pending-task", "not-required"].includes(applied)) fail("invalid_completed_settlement");
        if (applied !== "pending") parseVersion(applied);
      }
    }
  }
  const reads = [{ path: PROFILE_PATH, before: loaded.revision }, modeRead];
  const result = { from, to: target, batch: [], versions: {}, alreadyApplied: from === target, deferredToRelease: false };
  let next = source;
  let indexNext = project.indexSource;
  if (from !== target) {
    if (mode === "complete" && !["development_complete", "release_ready"].includes(from)) fail("development_complete_required");
    if (mode === "test-pass" && (!TASK_FLOW.includes(from) || from === "completed")) fail("invalid_test_pass_source");
    if (["release_ready", "completed"].includes(target)) {
      assertCriteria(source);
      validateVerification(details.verification, {
        head: baseHead, tree: (await git(root, ["rev-parse", "HEAD^{tree}"])).trim(), recordId: taskId, target,
      });
    }
    next = transitionTaskDocument(source, target, details, { testPass: mode === "test-pass" });
    if (target === "completed") {
      for (const [impactKey, appliedKey, expected] of CHANNELS) {
        const impact = metadata(source, impactKey);
        if (![expected, "none"].includes(impact)) fail("invalid_task_impact");
        // A reopened Task that already shipped keeps its released version.
        const applied = metadata(source, appliedKey);
        const keep = impact !== "none" && applied !== "pending" && !["pending-task", "not-required"].includes(applied);
        if (keep) parseVersion(applied);
        next = replaceMetadata(next, appliedKey, impact === "none" ? "not-required" : keep ? applied : "pending");
      }
      result.deferredToRelease = true;
    }
    if (["release_ready", "completed"].includes(target)) next = appendVerification(next, details.verification, from);
    indexNext = updateTaskIndex(project.indexSource, taskId, target);
  }
  const nextRecord = parseIndex(indexNext).records.find((item) => item.rawId === taskId);
  if (canonicalStatus(nextRecord?.status) !== canonicalStatus(metadata(next, "상태"))) fail("post_write_validation_failed");
  const plan = {
    root, baseHead, recordId: taskId, operation: target === "completed" ? "task-completion" : "task-transition",
    message: `chore(its): Task ${taskId} ${target}`, reads,
    entries: [entry(relative, source, next), entry("docs/tasks/index.md", project.indexSource, indexNext)],
  };
  await validatePlan(plan);
  return { plan, result };
}

export async function cli(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (args.has(key)) fail("duplicate_argument");
    if (["--dry-run", "--write"].includes(key)) args.set(key, true);
    else if (["--root", "--request", "--approved-plan-digest"].includes(key) && argv[i + 1] && !argv[i + 1].startsWith("--")) args.set(key, argv[++i]);
    else fail("usage_error");
  }
  if (!args.get("--root") || !args.get("--request") || Boolean(args.get("--write")) === Boolean(args.get("--dry-run"))) fail("usage_error");
  const requestPath = path.resolve(args.get("--request"));
  const stat = await lstat(requestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail("unsafe_request_file");
  const request = parseStrictJson(await readFile(requestPath, "utf8"));
  if (!request || typeof request !== "object" || Array.isArray(request) || request.schema !== "zuz.its.task-lifecycle-request/v1" || Object.keys(request).some((key) => !["schema", "taskId", "target", "mode", "details"].includes(key))) fail("invalid_lifecycle_request");
  const { plan, result } = await planTaskLifecycle({ ...request, root: path.resolve(args.get("--root")) });
  if (args.get("--dry-run")) return { status: "preview", root: plan.root, baseHead: plan.baseHead, approvalDigest: planDigest(plan), ...result,
    writeSet: plan.entries.filter((item) => item.before !== item.after).map(({ path, before, after }) => ({ path, before, after })) };
  return { ...await executePlan(plan, args.get("--approved-plan-digest")), ...result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await cli(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stdout.write(JSON.stringify({ status: "rejected", code: error.code ?? "lifecycle_failed" }) + "\n"); process.exitCode = 2; }
}
