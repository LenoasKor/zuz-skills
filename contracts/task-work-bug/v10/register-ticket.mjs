#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { planTicketRegistration, registerTicket, ticketRegistrationResultSchema } from "../v9/registration.mjs";
import { authorityReceipt, resolveMainAuthorityRoot } from "./main-authority.mjs";
import { verifyContract } from "./verify-contract.mjs";

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || parsed.has(key)) throw Object.assign(new Error("usage_error"), { code: "usage_error" });
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) parsed.set(key, true);
    else { parsed.set(key, value); index += 1; }
  }
  return parsed;
}

const output = (status, code, extra = {}) => process.stdout.write(`${JSON.stringify({ schema: ticketRegistrationResultSchema, status, code, ...extra })}\n`);

try {
  const args = parseArgs(process.argv.slice(2));
  await verifyContract();
  const requestedRoot = path.resolve(String(args.get("--root") || ""));
  const intentPath = args.get("--intent");
  const dryRun = args.has("--dry-run");
  const write = args.has("--write");
  if (!intentPath || dryRun === write) throw Object.assign(new Error("usage_error"), { code: "usage_error" });
  const intent = JSON.parse(await readFile(path.resolve(String(intentPath)), "utf8"));
  const authority = await resolveMainAuthorityRoot(requestedRoot);
  if (dryRun) {
    const plan = await planTicketRegistration(authority.authorityRoot, intent);
    output("planned", "accepted", {
      intentDigest: plan.intentDigest,
      identityPending: true,
      preview: plan.preview,
      writeSet: plan.writeSet,
      authority: authorityReceipt(authority),
      authorization: "approval includes one exact canonical-default-branch registration commit; it does not include push, merge, deploy, lifecycle completion, or version settlement",
    });
  } else {
    const result = await registerTicket({ root: authority.authorityRoot, intent, approvedDigest: args.get("--approved-digest") });
    process.stdout.write(`${JSON.stringify({ ...result, authority: authorityReceipt(authority) })}\n`);
  }
} catch (error) {
  output("rejected", error.code || "registration_failed", error.detail ? { detail: error.detail } : {});
  process.exitCode = 2;
}
