#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { planTaskRegistrationBatch, registerTaskBatch } from "./task-registration-batch.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) args.set(key, true);
  else { args.set(key, value); index += 1; }
}

const output = (status, code, extra = {}) => process.stdout.write(`${JSON.stringify({
  schema: "decal.task-work-bug.task-registration-batch/v7", status, code, ...extra,
})}\n`);

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
      identityPending: true,
      preview: plan.intent.tasks.map(({ localRef, category, title, priority, areas, summary, versionImpact, remoteVersionImpact }) => ({
        localRef, category, title, priority, areas, summary, versionImpact, remoteVersionImpact,
      })),
      writeSet: ["docs/tasks/task_<assigned>_<category>_<assigned>_<slug>.md", "docs/tasks/index.md", "docs/tasks/category_index.md"],
      authorization: "approval includes one exact canonical-default-branch registration commit; it does not include push, merge, deploy, lifecycle completion, or version settlement",
    });
  } else {
    process.stdout.write(`${JSON.stringify(await registerTaskBatch({ root, intent, approvedDigest: args.get("--approved-digest") }))}\n`);
  }
} catch (error) {
  output("rejected", error.code || "registration_failed");
  process.exitCode = 2;
}
