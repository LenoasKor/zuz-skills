#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  KINDS,
  assertPlainPath,
  canonicalRelative,
  fail,
  frontmatter,
  listValues,
  output,
  parseArgs,
  plainFile,
  recordIdentity,
  sourceRevision,
  topLevelValue,
} from "./work-items.mjs";

const RESULT_SCHEMA = "decal.task-work-bug.work-item-transition/v5";
const CLOSURE_REASONS = new Set(["completed", "fixed", "cancelled", "duplicate", "not-reproducible", "will-not-fix", "unnecessary"]);

function yamlScalar(value) {
  return value === null || value === undefined ? "null" : JSON.stringify(value);
}

function replaceTopLevelBlock(lines, end, key, replacement) {
  const start = lines.findIndex((line, index) => index > 0 && index < end && line.startsWith(`${key}:`));
  if (start < 0) fail("missing_frontmatter_field");
  let stop = start + 1;
  while (stop < end && (/^\s/u.test(lines[stop]) || lines[stop] === "")) stop += 1;
  lines.splice(start, stop - start, ...replacement);
  return end - (stop - start) + replacement.length;
}

function completionBlock(summary, evidence, timestamp) {
  return [
    "completion:",
    `  summary: ${yamlScalar(summary)}`,
    "  evidence:",
    ...evidence.map((item) => `    - ${yamlScalar(item)}`),
    `  completedAt: ${yamlScalar(timestamp)}`,
  ];
}

function closureBlock(reason, note, duplicateOf, timestamp) {
  return [
    "closure:",
    `  reason: ${reason}`,
    `  note: ${yamlScalar(note)}`,
    `  duplicateOf: ${yamlScalar(duplicateOf)}`,
    `  closedAt: ${yamlScalar(timestamp)}`,
  ];
}

try {
  const args = parseArgs(process.argv);
  const root = path.resolve(String(args.get("--root") || ""));
  const kind = String(args.get("--kind") || "");
  const id = String(args.get("--id") || "");
  const targetStatus = String(args.get("--status") || "");
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind) || !id || !targetStatus) fail("usage_error");

  const definition = KINDS[kind];
  if (!new RegExp(`^${definition.prefix}-[0-9]{3,}$`, "u").test(id)) fail("invalid_identity");

  const relative = canonicalRelative(kind, id);
  const target = await assertPlainPath(root, relative);
  const source = await plainFile(target);
  const identity = recordIdentity(kind, source);
  const revision = sourceRevision(source);
  const expected = args.get("--expected-source-revision");
  if (typeof expected !== "string" || expected !== revision) fail("stale_source_revision");

  const currentIndex = definition.flow.indexOf(identity.status);
  const targetIndex = definition.flow.indexOf(targetStatus);
  if (currentIndex < 0) fail("unsupported_source_status");
  if (targetIndex !== currentIndex + 1) fail("unsupported_transition");

  const summary = args.get("--summary");
  const evidence = listValues(args, "--evidence");
  const reason = args.get("--reason");
  if (targetStatus === "development_complete" && (typeof summary !== "string" || evidence.length === 0)) {
    fail("completion_evidence_required");
  }
  if (targetStatus === "closed") {
    if (typeof reason !== "string" || !CLOSURE_REASONS.has(reason)) fail("invalid_closure_reason");
    if (reason === "duplicate" && typeof args.get("--duplicate-of") !== "string") fail("duplicate_reference_required");
  }

  const { lines, end } = frontmatter(source);
  let frontmatterEnd = end;
  const timestamp = new Date().toISOString();
  frontmatterEnd = replaceTopLevelBlock(lines, frontmatterEnd, "status", [`status: ${targetStatus}`]);
  frontmatterEnd = replaceTopLevelBlock(lines, frontmatterEnd, "updatedAt", [`updatedAt: ${yamlScalar(timestamp)}`]);
  if (targetStatus === "development_complete") {
    frontmatterEnd = replaceTopLevelBlock(lines, frontmatterEnd, "completion", completionBlock(summary, evidence, timestamp));
  }
  if (targetStatus === "closed") {
    const note = typeof args.get("--note") === "string" ? args.get("--note") : null;
    const duplicateOf = typeof args.get("--duplicate-of") === "string" ? args.get("--duplicate-of") : null;
    replaceTopLevelBlock(lines, frontmatterEnd, "closure", closureBlock(reason, note, duplicateOf, timestamp));
  }
  const next = `${lines.join("\n").replace(/\n+$/u, "")}\n`;

  const temporary = `${target}.decal-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, next, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }

  const verified = await plainFile(target);
  if (topLevelValue(verified, "status") !== targetStatus) fail("post_write_validation_failed");
  output(RESULT_SCHEMA, {
    status: "written",
    code: "accepted",
    kind,
    id,
    previousStatus: identity.status,
    currentStatus: targetStatus,
    previousSourceRevision: revision,
    sourceRevision: sourceRevision(verified),
    writeSet: [relative],
  });
} catch (error) {
  output(RESULT_SCHEMA, { status: "rejected", code: error.code || "transition_failed" });
  process.exitCode = 2;
}
