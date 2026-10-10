#!/usr/bin/env node
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest, fail, loadProfile, PROFILE_PATH, safeFile } from "./version-profile.mjs";
import { executePlan, gitBoundary, planDigest, validatePlan } from "./transaction.mjs";
import { parseWorkBug } from "./work-bug-policy.mjs";
import { parseStrictJson } from "./strict-json.mjs";
import { canonicalTicketId, resolveTicketPath } from "./ticket-path.mjs";

const FLOWS = {
  work: ["new", "planned", "in_progress", "development_complete", "release_ready", "closed"],
  bug: ["new", "confirmed", "in_progress", "development_complete", "release_ready", "closed"],
};
const REASONS = {
  work: ["completed", "cancelled", "duplicate", "not_needed"],
  bug: ["fixed", "duplicate", "cannot_reproduce", "wont_fix", "not_needed"],
};
function text(value, code) {
  if (typeof value !== "string" || !value.trim() || value.length > 4000 || /[\u0000-\u001f]/u.test(value)) fail(code);
  return value.trim();
}
function replaceBlock(source, key, block, optional = false) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (!match) fail("missing_frontmatter");
  const offset = match[0].indexOf(match[1]);
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = match[1].split(eol);
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start < 0) {
    if (!optional) fail("missing_frontmatter_field", key);
    lines.push(...block);
  } else {
    let stop = start + 1;
    while (stop < lines.length && /^[ \t]+/u.test(lines[stop])) stop += 1;
    lines.splice(start, stop - start, ...block);
  }
  return source.slice(0, offset) + lines.join(eol) + source.slice(offset + match[1].length);
}

// Retains the existing normal forward CLI, not a new lifecycle policy.
// Blocked/reopen transitions are deliberately not inferred from a target string.
export function transitionWorkItem(source, { kind, id, target, timestamp, summary, evidence, reason, note, duplicateOf }) {
  const record = parseWorkBug(source, kind, id);
  if (typeof timestamp !== "string" || !/^\d{4}-\d\d-\d\dT.*Z$/u.test(timestamp) || !Number.isFinite(Date.parse(timestamp))) fail("invalid_transition_timestamp");
  const flow = FLOWS[kind];
  const current = flow.indexOf(record.status);
  const normalReason = kind === "work" ? "completed" : "fixed";
  const abnormal = target === "closed" && REASONS[kind].includes(reason) && reason !== normalReason;
  if (current < 0 || record.status === "closed" || (!abnormal && flow.indexOf(target) !== current + 1)) fail("unsupported_transition");
  if (target === "development_complete") {
    text(summary, "completion_evidence_required");
    if (!Array.isArray(evidence) || !evidence.length || evidence.length > 100) fail("completion_evidence_required");
    evidence.forEach((item) => text(item, "completion_evidence_required"));
  } else if (summary !== undefined || evidence !== undefined) fail("unexpected_completion_details");
  if (target === "closed") {
    if (!REASONS[kind].includes(reason)) fail("invalid_closure_reason");
    if (note !== undefined) text(note, "invalid_closure_note");
    if (reason === "duplicate") {
      if (canonicalTicketId(kind, duplicateOf) === canonicalTicketId(kind, id)) fail("duplicate_reference_required");
    } else if (duplicateOf !== undefined) fail("unexpected_duplicate_reference");
  } else if (reason !== undefined || note !== undefined || duplicateOf !== undefined) fail("unexpected_closure_details");
  let next = replaceBlock(source, "status", [`status: ${target}`]);
  next = replaceBlock(next, "updatedAt", [`updatedAt: ${JSON.stringify(timestamp)}`]);
  if (target === "development_complete") next = replaceBlock(next, "completion", ["completion:", `  summary: ${JSON.stringify(summary.trim())}`, "  evidence:", ...evidence.map((item) => `    - ${JSON.stringify(item.trim())}`), `  completedAt: ${JSON.stringify(timestamp)}`]);
  if (target === "closed") {
    next = replaceBlock(next, "closure", ["closure:", `  reason: ${reason}`, `  note: ${JSON.stringify(note?.trim() ?? null)}`, `  duplicateOf: ${JSON.stringify(duplicateOf ?? null)}`, `  closedAt: ${JSON.stringify(timestamp)}`]);
    next = replaceBlock(next, "nextAction", ["nextAction: null"], true);
  }
  parseWorkBug(next, kind, id); // Normal closure must still contain completion evidence.
  return { next, from: record.status, to: target };
}

export async function planWorkItemTransition({ root, expectedSourceRevision, ...request }) {
  const { kind, id } = request;
  if (!Object.hasOwn(FLOWS, kind)) fail("invalid_record_identity");
  const baseHead = await gitBoundary(root);
  const loaded = await loadProfile(root);
  if (loaded.profile.engine !== "portable") fail("repository_settlement_required");
  const resolved = await resolveTicketPath(root, kind, id);
  const relative = resolved.relative;
  const source = await readFile(resolved.target, "utf8");
  if (digest(source) !== expectedSourceRevision) fail("stale_source_revision");
  const result = transitionWorkItem(source, { ...request, id: resolved.id });
  const plan = { root, baseHead, recordId: canonicalTicketId(kind, id), operation: `${kind}-transition`, message: `chore(its): ${canonicalTicketId(kind, id)} ${request.target}`,
    reads: [{ path: PROFILE_PATH, before: loaded.revision }],
    entries: [{ path: relative, source, next: result.next, before: digest(source), after: digest(result.next) }] };
  await validatePlan(plan);
  return { plan, from: result.from, to: result.to };
}

export async function cli(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (args.has(key)) fail("duplicate_argument");
    if (["--dry-run", "--write"].includes(key)) args.set(key, true);
    else if (["--root", "--request", "--approved-plan-digest"].includes(key) && argv[i + 1] && !argv[i + 1].startsWith("--")) args.set(key, argv[++i]);
    else fail("usage_error");
  }
  if (!args.get("--root") || !args.get("--request") || Boolean(args.get("--write")) === Boolean(args.get("--dry-run"))) fail("usage_error");
  const file = path.resolve(args.get("--request"));
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) fail("unsafe_request_file");
  const request = parseStrictJson(await readFile(file, "utf8"));
  if (!request || request.schema !== "zuz.its.work-item-lifecycle-request/v1" || Object.keys(request).some((key) => !["schema", "kind", "id", "target", "expectedSourceRevision", "timestamp", "summary", "evidence", "reason", "note", "duplicateOf"].includes(key))) fail("invalid_lifecycle_request");
  const { plan, from, to } = await planWorkItemTransition({ ...request, root: path.resolve(args.get("--root")) });
  if (args.get("--dry-run")) return { status: "preview", root: plan.root, baseHead: plan.baseHead, approvalDigest: planDigest(plan), from, to,
    writeSet: plan.entries.map(({ path, before, after }) => ({ path, before, after })) };
  return { ...await executePlan(plan, args.get("--approved-plan-digest")), from, to };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(JSON.stringify(await cli(process.argv.slice(2))) + "\n"); }
  catch (error) { process.stdout.write(JSON.stringify({ status: "rejected", code: error.code ?? "lifecycle_failed" }) + "\n"); process.exitCode = 2; }
}
