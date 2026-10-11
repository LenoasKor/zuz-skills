#!/usr/bin/env node
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail } from "../v9/version-profile.mjs";
import { parseStrictJson } from "../v9/strict-json.mjs";
import { planReleaseSettlement } from "../v17/release-settle.mjs";
import { draftPlan, executePlan, planDigest } from "./transaction.mjs";
import { verifyContract } from "./verify-contract.mjs";
export { planReleaseSettlement };

export async function cli(argv) {
  await verifyContract();
  const args = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (args.has(key)) fail("duplicate_argument");
    if (["--dry-run", "--draft", "--write"].includes(key)) args.set(key, true);
    else if (["--root", "--approved-plan-digest"].includes(key) && argv[index + 1] && !argv[index + 1].startsWith("--")) args.set(key, argv[++index]);
    else fail("usage_error");
  }
  if (!args.get("--root") || ["--dry-run", "--draft", "--write"].filter(key => args.get(key)).length !== 1) fail("usage_error");
  const result = await planReleaseSettlement({ root: path.resolve(args.get("--root")) });
  const summary = { schema: "zuz.its.release-settlement-result/v1", tasks: result.tasks, items: result.items, versions: result.versions };
  if (!result.plan) return { ...summary, status: "nothing_to_release", writeSet: [] };
  if (args.get("--dry-run")) return { ...summary, status: "preview", approvalDigest: planDigest(result.plan), root: result.plan.root,
    baseHead: result.plan.baseHead, writeSet: result.plan.entries.filter((item) => item.before !== item.after).map(({ path, before, after }) => ({ path, before, after })) };
  return { ...summary, ...await (args.get("--draft") ? draftPlan : executePlan)(result.plan, args.get("--approved-plan-digest")) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await cli(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stdout.write(JSON.stringify({ status: "rejected", draftId: error.draftId, requestState: error.requestState, code: error.code ?? "release_settlement_failed" }) + "\n"); process.exitCode = 2; }
}
