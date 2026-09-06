#!/usr/bin/env node
import path from "node:path";
import { recoverSettlement } from "./transaction.mjs";
import { fail } from "./version-profile.mjs";

try {
  const args = new Map();
  for (let i = 2; i < process.argv.length; i += 1) {
    const key = process.argv[i];
    if (args.has(key)) fail("duplicate_argument");
    if (key === "--writers-paused") args.set(key, true);
    else if (["--root", "--approved-plan-digest", "--action"].includes(key) && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")) args.set(key, process.argv[++i]);
    else fail("usage_error");
  }
  if (!args.get("--root") || !args.get("--approved-plan-digest") || !args.get("--action")) fail("usage_error");
  process.stdout.write(JSON.stringify(await recoverSettlement({ root: path.resolve(args.get("--root")), approvedDigest: args.get("--approved-plan-digest"), action: args.get("--action"), writersPaused: args.has("--writers-paused") })) + "\n");
} catch (error) { process.stdout.write(JSON.stringify({ status: "rejected", code: error.code ?? "recovery_failed" }) + "\n"); process.exitCode = 2; }
