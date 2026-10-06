#!/usr/bin/env node
import { lstat, open, readFile, rename, unlink, realpath, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalIncidentId, fail, INCIDENT_FLOW, listValues, output, parseArgs, assertPlainPath, sourceRevision } from "../v3/incident.mjs";
import { acquireLock } from "../../task-work-bug/v9/transaction.mjs";
import { safeFile } from "../../task-work-bug/v9/version-profile.mjs";
import { parseStrictIncident } from "./incident.mjs";
import { verifyContract } from "./verify-contract.mjs";

async function resolveExistingIncident(root, requestedId) {
  const canonicalId = canonicalIncidentId(requestedId);
  const directory = await assertPlainPath(root, "docs/work-items/incidents");
  const records = [];
  const identities = new Set();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!/^INC-[0-9]+\.md$/u.test(entry.name)) continue;
    const relative = `docs/work-items/incidents/${entry.name}`;
    const target = await safeFile(root, relative);
    const record = parseStrictIncident(await readFile(target, "utf8"), entry.name);
    const identity = canonicalIncidentId(record.id);
    if (identities.has(identity)) fail("duplicate_record_identity");
    identities.add(identity);
    if (identity === canonicalId) records.push({ record, relative, canonicalId });
  }
  if (records.length !== 1) fail("incident_not_found");
  return records[0];
}

function replaceBlock(lines, end, key, replacement) {
  const start = lines.findIndex((line, index) => index > 0 && index < end && line.startsWith(`${key}:`));
  if (start < 0) fail("missing_frontmatter_field");
  let stop = start + 1;
  while (stop < end && (/^\s/u.test(lines[stop]) || lines[stop] === "")) stop += 1;
  lines.splice(start, stop - start, ...replacement);
  return end - (stop - start) + replacement.length;
}
const scalar = (value) => value === null || value === undefined ? "null" : JSON.stringify(value);

export function transitionIncident(source, record, args, canonicalId) {
  const targetStatus = String(args.get("--status") || "");
  if (![...INCIDENT_FLOW, "blocked"].includes(targetStatus)) fail("usage_error");
  const rawHeader = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/u.exec(source);
  if (!rawHeader) fail("frontmatter_invalid");
  const rawBody = source.slice(rawHeader[0].length);
  const headerEol = rawHeader[0].startsWith("---\r\n") ? "\r\n" : "\n";
  const normalized = rawHeader[0].replaceAll("\r\n", "\n");
  if (targetStatus === "blocked") {
    if (record.status === "blocked" || !String(args.get("--blocked-reason") || "").trim() || !String(args.get("--blocked-exit-criteria") || "").trim()) fail("blocked_invalid");
  } else if (record.status === "blocked") {
    const from = /^blocked:\n  from: ([^\n]+)$/mu.exec(normalized)?.[1]?.trim().replace(/^['"]|['"]$/gu, "") ?? null;
    if (targetStatus !== from) fail("invalid_status_transition");
  } else if (INCIDENT_FLOW.indexOf(targetStatus) !== INCIDENT_FLOW.indexOf(record.status) + 1) fail("invalid_status_transition");
  const lines = normalized.split("\n");
  let end = lines.indexOf("---", 1);
  const timestamp = new Date().toISOString();
  end = replaceBlock(lines, end, "status", [`status: ${targetStatus}`]);
  end = replaceBlock(lines, end, "updatedAt", [`updatedAt: ${scalar(timestamp)}`]);
  if (targetStatus === "blocked") {
    end = replaceBlock(lines, end, "blocked", ["blocked:", `  from: ${record.status}`, `  reason: ${scalar(args.get("--blocked-reason"))}`, `  exitCriteria: ${scalar(args.get("--blocked-exit-criteria"))}`, `  blockedAt: ${scalar(timestamp)}`]);
  } else if (record.status === "blocked") end = replaceBlock(lines, end, "blocked", ["blocked: null"]);
  const mitigatedAt = args.get("--mitigated-at");
  const recoveredAt = args.get("--recovered-at");
  const resolutionEvidence = listValues(args, "--resolution-evidence");
  if (typeof mitigatedAt === "string") end = replaceBlock(lines, end, "mitigatedAt", [`mitigatedAt: ${scalar(mitigatedAt)}`]);
  if (typeof recoveredAt === "string") end = replaceBlock(lines, end, "recoveredAt", [`recoveredAt: ${scalar(recoveredAt)}`]);
  if (resolutionEvidence.length) end = replaceBlock(lines, end, "resolutionEvidence", ["resolutionEvidence:", ...resolutionEvidence.map((value) => `  - ${scalar(value)}`)]);
  if (targetStatus === "development_complete") {
    const summary = args.get("--summary");
    const evidence = listValues(args, "--evidence");
    if (typeof summary !== "string" || !evidence.length || typeof recoveredAt !== "string" || !resolutionEvidence.length) fail("completion_evidence_required");
    end = replaceBlock(lines, end, "completion", ["completion:", `  summary: ${scalar(summary)}`, "  evidence:", ...evidence.map((value) => `    - ${scalar(value)}`), `  completedAt: ${scalar(timestamp)}`]);
  }
  if (targetStatus === "closed") {
    const reason = args.get("--reason");
    if (typeof reason !== "string" || !["resolved", "duplicate", "cannot_reproduce", "wont_fix", "not_needed"].includes(reason)) fail("closure_invalid");
    if (reason === "duplicate" && canonicalIncidentId(String(args.get("--duplicate-of") || "")) === canonicalId) fail("duplicate_reference_required");
    replaceBlock(lines, end, "closure", ["closure:", `  reason: ${reason}`, `  note: ${scalar(args.get("--note") ?? null)}`, `  duplicateOf: ${scalar(args.get("--duplicate-of") ?? null)}`, `  closedAt: ${scalar(timestamp)}`]);
  }
  // Only changed header blocks are rendered; body, unknown fields and newline
  // style remain byte-identical, including final blank lines.
  const next = lines.join("\n").replaceAll("\n", headerEol) + rawBody;
  parseStrictIncident(next, `${record.id}.md`);
  return next;
}

export async function transitionIncidentAtRoot(root, args) {
  if (Object.hasOwn(process.env, "DECAL_SESSION_ID")) fail("native_authority_required");
  await verifyContract();
  root = path.resolve(root);
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) fail("noncanonical_root");
  const release = await acquireLock(root);
  let temporary = null;
  try {
    const resolved = await resolveExistingIncident(root, String(args.get("--id") || ""));
    const target = await safeFile(root, resolved.relative);
    const source = await readFile(target, "utf8");
    const record = parseStrictIncident(source, `${resolved.record.id}.md`);
    if (args.get("--expected-source-revision") !== record.revision) fail("stale_source_revision");
    const next = transitionIncident(source, record, args, resolved.canonicalId);
    const originalStat = await lstat(target);
    temporary = `${target}.decal-${randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", originalStat.mode & 0o777);
    try { await handle.chmod(originalStat.mode & 0o777); await handle.writeFile(next); await handle.sync(); } finally { await handle.close(); }
    // Last cooperative precondition check happens after all temp writes/fsync.
    // This is not an OS-level CAS against a noncooperative writer after check.
    const currentResolved = await resolveExistingIncident(root, String(args.get("--id") || ""));
    if (currentResolved.relative !== resolved.relative) fail("stale_source_revision");
    const currentTarget = await safeFile(root, resolved.relative);
    const current = await readFile(currentTarget, "utf8");
    const currentStat = await lstat(currentTarget);
    if (current !== source || sourceRevision(current) !== record.revision || currentStat.dev !== originalStat.dev || currentStat.ino !== originalStat.ino || currentStat.mode !== originalStat.mode) fail("stale_source_revision");
    parseStrictIncident(current, `${record.id}.md`);
    await rename(temporary, currentTarget);
    temporary = null;
    return { status: "written", code: "accepted", id: resolved.canonicalId, previousStatus: record.status, currentStatus: String(args.get("--status")), previousSourceRevision: record.revision, sourceRevision: sourceRevision(next), writeSet: [resolved.relative] };
  } finally {
    try { if (temporary) await unlink(temporary); } finally { await release(); }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv);
    output("zuz.its.incident-transition/v5", await transitionIncidentAtRoot(String(args.get("--root") || ""), args));
  } catch (error) { output("zuz.its.incident-transition/v5", { status: "rejected", code: error.code || "transition_failed" }); process.exitCode = 2; }
}
