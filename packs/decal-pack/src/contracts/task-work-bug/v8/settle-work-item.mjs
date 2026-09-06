#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, fail, loadProfile, planProductVersions, PROFILE_PATH, safeFile } from "./version-profile.mjs";
import { executePlan, git, gitBoundary, planDigest, validatePlan } from "./transaction.mjs";
import { parseWorkBug, planStandalone, updateWorkBugApplied } from "./work-bug-policy.mjs";

export async function planWorkItemSettlement({ root, kind, id }) {
  const directory = kind === "work" ? "work" : kind === "bug" ? "bugs" : fail("unsupported_settlement_kind");
  if (!new RegExp(`^${kind === "work" ? "WORK" : "BUG"}-[0-9]{3,}$`, "u").test(id)) fail("invalid_record_identity");
  const baseHead = await gitBoundary(root);
  const loaded = await loadProfile(root);
  if (loaded.profile.engine !== "portable") fail("repository_settlement_required");
  const relative = `docs/work-items/${directory}/${id}.md`;
  const source = await readFile(await safeFile(root, relative), "utf8");
  const record = parseWorkBug(source, kind, id);
  if (record.status !== "closed") fail("closed_record_required");
  if (record.releaseMode !== "standalone") fail("task_batch_settlement_required");
  const release = kind === "work" ? record.reason === "completed" : record.reason === "fixed";
  const impacts = {
    desktop: release && record.versionImpact !== "none" && record.versionApplied === "pending" ? "patch" : "none",
    remote: release && record.remoteVersionImpact !== "none" && record.remoteVersionApplied === "pending" ? "patch" : "none",
  };
  const productPlan = await planProductVersions(root, loaded.profile, impacts);
  const result = planStandalone(record, {
    desktop: productPlan.versions.desktop?.before ?? null,
    remote: productPlan.versions.remote?.before ?? null,
  });
  const next = updateWorkBugApplied(source, result.record.versionApplied, result.record.remoteVersionApplied);
  const plan = {
    root, baseHead, operation: `${kind}-settlement`, recordId: id, message: `chore(its): settle ${id}`,
    reads: [{ path: PROFILE_PATH, before: loaded.revision }],
    entries: [{ path: relative, source, next, before: digest(source), after: digest(next) }, ...productPlan.writes],
  };
  // Even an already-settled record must be committed, not a local forged bypass.
  if (digest(await git(root, ["show", `${baseHead}:${relative}`])) !== digest(source)) fail("target_dirty", relative);
  await validatePlan(plan);
  return { plan, versions: productPlan.versions, record: result.record, alreadySettled: plan.entries.every((entry) => entry.before === entry.after) };
}

export async function cli(argv) {
  const args = new Map();
  const flags = new Set(["--dry-run", "--write"]);
  const values = new Set(["--root", "--kind", "--id", "--approved-plan-digest"]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (args.has(key)) fail("duplicate_argument");
    if (flags.has(key)) args.set(key, true);
    else if (values.has(key) && typeof argv[index + 1] === "string" && !argv[index + 1].startsWith("--")) args.set(key, argv[++index]);
    else fail("usage_error");
  }
  if (!args.get("--root") || !args.get("--kind") || !args.get("--id")
      || Boolean(args.get("--dry-run")) === Boolean(args.get("--write"))) fail("usage_error");
  const result = await planWorkItemSettlement({ root: path.resolve(args.get("--root")), kind: args.get("--kind"), id: args.get("--id") });
  const approvalDigest = planDigest(result.plan);
  if (args.get("--dry-run")) {
    return { schema: "zuz.its.settlement-result/v1", status: "preview", approvalDigest, root: result.plan.root,
      baseHead: result.plan.baseHead, record: result.record, versions: result.versions, alreadySettled: result.alreadySettled,
      writeSet: result.plan.entries.filter((entry) => entry.before !== entry.after).map(({ path, before, after }) => ({ path, before, after })) };
  }
  return { schema: "zuz.its.settlement-result/v1", ...await executePlan(result.plan, args.get("--approved-plan-digest")), record: result.record };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await cli(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stdout.write(JSON.stringify({ status: "rejected", code: error.code ?? "settlement_failed" }) + "\n"); process.exitCode = 2; }
}
