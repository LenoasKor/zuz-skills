#!/usr/bin/env node
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "../v9/version-profile.mjs";
import { parseStrictJson } from "../v9/strict-json.mjs";
import { planTaskLifecycle } from "../v17/task-lifecycle.mjs";
import { draftPlan, executePlan, planDigest } from "./transaction.mjs";
import { verifyContract } from "./verify-contract.mjs";
export { planTaskLifecycle };

export async function cli(argv) {
  await verifyContract();
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (args.has(key)) fail("duplicate_argument");
    if (["--dry-run", "--draft", "--write"].includes(key)) args.set(key, true);
    else if (["--root", "--request", "--approved-plan-digest"].includes(key) && argv[i + 1] && !argv[i + 1].startsWith("--")) args.set(key, argv[++i]);
    else fail("usage_error");
  }
  if (!args.get("--root") || !args.get("--request") || ["--dry-run", "--draft", "--write"].filter(key => args.get(key)).length !== 1) fail("usage_error");
  const requestPath = path.resolve(args.get("--request"));
  const stat = await lstat(requestPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail("unsafe_request_file");
  const request = parseStrictJson(await readFile(requestPath, "utf8"));
  if (!request || typeof request !== "object" || Array.isArray(request) || request.schema !== "zuz.its.task-lifecycle-request/v1" || Object.keys(request).some((key) => !["schema", "taskId", "target", "mode", "details"].includes(key))) fail("invalid_lifecycle_request");
  const { plan, result } = await planTaskLifecycle({ ...request, root: path.resolve(args.get("--root")) });
  if (args.get("--dry-run")) return { status: "preview", root: plan.root, baseHead: plan.baseHead, approvalDigest: planDigest(plan), ...result,
    writeSet: plan.entries.filter((item) => item.before !== item.after).map(({ path, before, after }) => ({ path, before, after })) };
  return { ...await (args.get("--draft") ? draftPlan : executePlan)(plan, args.get("--approved-plan-digest")), ...result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await cli(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stdout.write(JSON.stringify({ status: "rejected", draftId: error.draftId, requestState: error.requestState, code: error.code ?? "lifecycle_failed" }) + "\n"); process.exitCode = 2; }
}
