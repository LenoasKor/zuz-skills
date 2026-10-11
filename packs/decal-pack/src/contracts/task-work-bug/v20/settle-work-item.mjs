#!/usr/bin/env node
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "../v9/version-profile.mjs";
import { parseStrictJson } from "../v9/strict-json.mjs";
import { planWorkItemSettlement } from "../v17/settle-work-item.mjs";
import { draftPlan, executePlan, planDigest } from "./transaction.mjs";
import { verifyContract } from "./verify-contract.mjs";
export { planWorkItemSettlement };

export async function cli(argv) {
  await verifyContract();
  const args = new Map();
  const flags = new Set(["--dry-run", "--draft", "--write"]);
  const values = new Set(["--root", "--kind", "--id", "--approved-plan-digest"]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (args.has(key)) fail("duplicate_argument");
    if (flags.has(key)) args.set(key, true);
    else if (values.has(key) && typeof argv[index + 1] === "string" && !argv[index + 1].startsWith("--")) args.set(key, argv[++index]);
    else fail("usage_error");
  }
  if (!args.get("--root") || !args.get("--kind") || !args.get("--id")
      || ["--dry-run", "--draft", "--write"].filter(key => args.get(key)).length !== 1) fail("usage_error");
  const result = await planWorkItemSettlement({ root: path.resolve(args.get("--root")), kind: args.get("--kind"), id: args.get("--id") });
  if (result.deferredToRelease) {
    return { schema: "zuz.its.settlement-result/v1", status: "deferred_to_release", record: result.record, writeSet: [] };
  }
  const approvalDigest = planDigest(result.plan);
  if (args.get("--dry-run")) {
    return { schema: "zuz.its.settlement-result/v1", status: "preview", approvalDigest, root: result.plan.root,
      baseHead: result.plan.baseHead, record: result.record, versions: result.versions, alreadySettled: result.alreadySettled,
      writeSet: result.plan.entries.filter((entry) => entry.before !== entry.after).map(({ path, before, after }) => ({ path, before, after })) };
  }
  return { schema: "zuz.its.settlement-result/v1", ...await (args.get("--draft") ? draftPlan : executePlan)(result.plan, args.get("--approved-plan-digest")), record: result.record };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await cli(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stdout.write(JSON.stringify({ status: "rejected", draftId: error.draftId, requestState: error.requestState, code: error.code ?? "settlement_failed" }) + "\n"); process.exitCode = 2; }
}
