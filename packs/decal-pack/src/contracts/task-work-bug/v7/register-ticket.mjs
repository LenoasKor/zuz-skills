#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { planTicketRegistration, registerTicket, ticketRegistrationResultSchema } from "./registration.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) args.set(key, true);
  else { args.set(key, value); index += 1; }
}

const output = (status, code, extra = {}) => process.stdout.write(`${JSON.stringify({ schema: ticketRegistrationResultSchema, status, code, ...extra })}\n`);

try {
  const root = path.resolve(String(args.get("--root") || ""));
  const intentPath = args.get("--intent");
  const dryRun = args.has("--dry-run");
  const write = args.has("--write");
  if (!intentPath || dryRun === write) throw Object.assign(new Error("usage_error"), { code: "usage_error" });
  const intent = JSON.parse(await readFile(path.resolve(String(intentPath)), "utf8"));
  if (dryRun) {
    const plan = await planTicketRegistration(root, intent);
    output("planned", "accepted", {
      intentDigest: plan.intentDigest,
      identityPending: true,
      preview: plan.preview,
      writeSet: plan.writeSet,
      authorization: "approval includes one exact main registration commit; it does not include push, merge, deploy, lifecycle completion, or version settlement",
    });
  } else {
    process.stdout.write(`${JSON.stringify(await registerTicket({ root, intent, approvedDigest: args.get("--approved-digest") }))}\n`);
  }
} catch (error) {
  output("rejected", error.code || "registration_failed");
  process.exitCode = 2;
}
