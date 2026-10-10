#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fail, loadProfile } from "../v9/version-profile.mjs";
import { executePlan, gitBoundary, planDigest } from "../v9/transaction.mjs";
import { parseWorkBug } from "../v9/work-bug-policy.mjs";
import { resolveTicketPath } from "../v9/ticket-path.mjs";
import { planWorkItemSettlement as planPerTicket } from "../v9/settle-work-item.mjs";
import { readSettlementMode } from "./settlement-mode.mjs";

// Per-ticket projects settle one closed record through the published v9 planner. In release mode
// a closed record is not settled on its own: it keeps `pending` and ships with release-settle.mjs.
export async function planWorkItemSettlement({ root, kind, id }) {
  const settlement = await readSettlementMode(root);
  if (settlement.mode === "per-ticket") {
    const planned = await planPerTicket({ root, kind, id });
    if (settlement.read) planned.plan.reads.push(settlement.read);
    return planned;
  }
  if (!["work", "bug"].includes(kind)) fail("unsupported_settlement_kind");
  await gitBoundary(root);
  const loaded = await loadProfile(root);
  if (loaded.profile.engine !== "portable") fail("repository_settlement_required");
  const resolved = await resolveTicketPath(root, kind, id);
  const record = parseWorkBug(await readFile(resolved.target, "utf8"), kind, resolved.id);
  if (record.status !== "closed") fail("closed_record_required");
  return { plan: null, record, deferredToRelease: true };
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
  if (result.deferredToRelease) {
    return { schema: "zuz.its.settlement-result/v1", status: "deferred_to_release", record: result.record, writeSet: [] };
  }
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
