#!/usr/bin/env node
import path from "node:path";
import { listDrafts, parkSettlement } from "./transaction.mjs";
import { fail } from "../v9/version-profile.mjs";
try {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (args.has(key) || !["--root", "--action", "--approved-plan-digest"].includes(key)
        || !process.argv[i + 1] || process.argv[i + 1].startsWith("--")) fail("usage_error");
    args.set(key, process.argv[++i]);
  }
  if (!args.has("--root") || !["list", "park"].includes(args.get("--action"))) fail("usage_error");
  const root = path.resolve(args.get("--root"));
  const result = args.get("--action") === "list" ? await listDrafts(root)
    : await parkSettlement(root, args.get("--approved-plan-digest"));
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ status: "rejected", code: error.code ?? "draft_operation_failed" }) + "\n");
  process.exitCode = 2;
}
