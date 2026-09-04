#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  planTaskRegistrationBatch,
  registerTaskBatch,
} from "./registration-batch.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) args.set(key, true);
  else {
    args.set(key, value);
    index += 1;
  }
}

function output(status, code, extra = {}) {
  process.stdout.write(`${JSON.stringify({
    schema: "decal.task-work-bug.task-registration-batch/v6",
    status,
    code,
    ...extra,
  })}\n`);
}

try {
  const root = path.resolve(String(args.get("--root") || ""));
  const intentPath = args.get("--intent");
  const dryRun = args.has("--dry-run");
  const write = args.has("--write");
  if (!intentPath || dryRun === write) throw Object.assign(new Error("usage_error"), { code: "usage_error" });
  const intent = JSON.parse(await readFile(path.resolve(String(intentPath)), "utf8"));
  if (dryRun) {
    const plan = await planTaskRegistrationBatch(root, intent);
    output("planned", "accepted", {
      intentDigest: plan.intentDigest,
      baseHead: plan.baseHead,
      assigned: plan.assigned,
      writeSet: plan.writeSet,
      authorization: "approval authorizes the exact semantic intent through one registration commit; it does not authorize push, merge, deploy, or lifecycle completion",
    });
  } else {
    const receipt = await registerTaskBatch({
      root,
      intent,
      approvedDigest: args.get("--approved-digest"),
    });
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  }
} catch (error) {
  output("rejected", error.code || "registration_failed");
  process.exitCode = 2;
}
