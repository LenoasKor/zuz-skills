#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertPlainPath, canonicalRelative, fail, INCIDENT_FLOW, listValues, output, parseArgs, parseIncident, sourceRevision } from "./incident.mjs";

const RESULT_SCHEMA = "zuz.its.incident-transition/v1";

function yamlScalar(value) { return value === null || value === undefined ? "null" : JSON.stringify(value); }

function frontmatter(source) {
  const lines = source.replaceAll("\r\n", "\n").split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end < 0) fail("frontmatter_invalid");
  return { lines, end };
}

function replaceBlock(lines, end, key, replacement) {
  const start = lines.findIndex((line, index) => index > 0 && index < end && line.startsWith(`${key}:`));
  if (start < 0) fail("missing_frontmatter_field");
  let stop = start + 1;
  while (stop < end && (/^\s/u.test(lines[stop]) || lines[stop] === "")) stop += 1;
  lines.splice(start, stop - start, ...replacement);
  return end - (stop - start) + replacement.length;
}

function currentBlockedFrom(source) {
  return /^blocked:\n  from: ([^\n]+)$/mu.exec(source)?.[1]?.trim().replace(/^['"]|['"]$/gu, "") ?? null;
}

async function atomicReplace(target, source) {
  const temporary = `${target}.decal-${randomUUID()}.tmp`;
  try { await writeFile(temporary, source, { flag: "wx" }); await rename(temporary, target); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

try {
  const args = parseArgs(process.argv);
  const root = path.resolve(String(args.get("--root") || ""));
  const id = String(args.get("--id") || "");
  const targetStatus = String(args.get("--status") || "");
  if (!/^INC-[0-9]{3,}$/u.test(id) || ![...INCIDENT_FLOW, "blocked"].includes(targetStatus)) fail("usage_error");
  const relative = canonicalRelative(id);
  const target = await assertPlainPath(root, relative);
  const source = await (await import("node:fs/promises")).readFile(target, "utf8");
  const record = parseIncident(source, `${id}.md`);
  if (args.get("--expected-source-revision") !== record.revision) fail("stale_source_revision");

  if (targetStatus === "blocked") {
    if (record.status === "blocked" || !String(args.get("--blocked-reason") || "").trim() || !String(args.get("--blocked-exit-criteria") || "").trim()) fail("blocked_invalid");
  } else if (record.status === "blocked") {
    if (targetStatus !== currentBlockedFrom(source)) fail("invalid_status_transition");
  } else {
    const current = INCIDENT_FLOW.indexOf(record.status);
    const next = INCIDENT_FLOW.indexOf(targetStatus);
    if (current < 0 || next !== current + 1) fail("invalid_status_transition");
  }

  const { lines, end } = frontmatter(source);
  let frontmatterEnd = end;
  const timestamp = new Date().toISOString();
  frontmatterEnd = replaceBlock(lines, frontmatterEnd, "status", [`status: ${targetStatus}`]);
  frontmatterEnd = replaceBlock(lines, frontmatterEnd, "updatedAt", [`updatedAt: ${yamlScalar(timestamp)}`]);
  if (targetStatus === "blocked") {
    frontmatterEnd = replaceBlock(lines, frontmatterEnd, "blocked", [
      "blocked:",
      `  from: ${record.status}`,
      `  reason: ${yamlScalar(args.get("--blocked-reason"))}`,
      `  exitCriteria: ${yamlScalar(args.get("--blocked-exit-criteria"))}`,
      `  blockedAt: ${yamlScalar(timestamp)}`,
    ]);
  } else if (record.status === "blocked") frontmatterEnd = replaceBlock(lines, frontmatterEnd, "blocked", ["blocked: null"]);

  const mitigatedAt = args.get("--mitigated-at");
  const recoveredAt = args.get("--recovered-at");
  const resolutionEvidence = listValues(args, "--resolution-evidence");
  if (typeof mitigatedAt === "string") frontmatterEnd = replaceBlock(lines, frontmatterEnd, "mitigatedAt", [`mitigatedAt: ${yamlScalar(mitigatedAt)}`]);
  if (typeof recoveredAt === "string") frontmatterEnd = replaceBlock(lines, frontmatterEnd, "recoveredAt", [`recoveredAt: ${yamlScalar(recoveredAt)}`]);
  if (resolutionEvidence.length > 0) frontmatterEnd = replaceBlock(lines, frontmatterEnd, "resolutionEvidence", ["resolutionEvidence:", ...resolutionEvidence.map((value) => `  - ${yamlScalar(value)}`)]);

  if (targetStatus === "development_complete") {
    const summary = args.get("--summary");
    const evidence = listValues(args, "--evidence");
    if (typeof summary !== "string" || evidence.length === 0 || typeof recoveredAt !== "string" || resolutionEvidence.length === 0) fail("completion_evidence_required");
    frontmatterEnd = replaceBlock(lines, frontmatterEnd, "completion", [
      "completion:", `  summary: ${yamlScalar(summary)}`, "  evidence:", ...evidence.map((value) => `    - ${yamlScalar(value)}`), `  completedAt: ${yamlScalar(timestamp)}`,
    ]);
  }
  if (targetStatus === "closed") {
    const reason = args.get("--reason");
    if (typeof reason !== "string" || !["resolved", "duplicate", "cannot_reproduce", "wont_fix", "not_needed"].includes(reason)) fail("closure_invalid");
    if (reason === "duplicate" && !/^INC-[0-9]{3,}$/u.test(String(args.get("--duplicate-of") || ""))) fail("duplicate_reference_required");
    replaceBlock(lines, frontmatterEnd, "closure", [
      "closure:", `  reason: ${reason}`, `  note: ${yamlScalar(args.get("--note") ?? null)}`, `  duplicateOf: ${yamlScalar(args.get("--duplicate-of") ?? null)}`, `  closedAt: ${yamlScalar(timestamp)}`,
    ]);
  }
  const nextSource = `${lines.join("\n").replace(/\n+$/u, "")}\n`;
  const verified = parseIncident(nextSource, `${id}.md`);
  await atomicReplace(target, nextSource);
  output(RESULT_SCHEMA, { status: "written", code: "accepted", id, previousStatus: record.status, currentStatus: verified.status, previousSourceRevision: record.revision, sourceRevision: sourceRevision(nextSource), writeSet: [relative] });
} catch (error) {
  output(RESULT_SCHEMA, { status: "rejected", code: error.code || "transition_failed" });
  process.exitCode = 2;
}
