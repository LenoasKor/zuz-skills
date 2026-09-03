#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  KINDS,
  SCHEMA_VERSION,
  assertPlainPath,
  canonicalRelative,
  fail,
  nextIdentity,
  output,
  parseArgs,
  scanKind,
  sourceRevision,
} from "./work-items.mjs";

const RESULT_SCHEMA = "decal.task-work-bug.work-item-registration/v5";
const INTENT_SCHEMA = "decal.task-work-bug.work-item-registration-intent/v5";
const VERSION_IMPACTS = new Set(["desktop-patch", "none"]);
const REMOTE_VERSION_IMPACTS = new Set(["remote-patch", "none"]);
const RELEASE_MODES = new Set(["standalone", "task-batch"]);

function validateIntent(value) {
  if (!value || value.schema !== INTENT_SCHEMA) fail("invalid_intent");
  if (!Object.prototype.hasOwnProperty.call(KINDS, value.kind)) fail("invalid_kind");
  for (const key of ["intentId", "title", "priority", "body", "versionImpact", "remoteVersionImpact", "releaseMode"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) fail("invalid_intent");
  }
  if (!/^P[0-3]$/u.test(value.priority)) fail("invalid_priority");
  if (!VERSION_IMPACTS.has(value.versionImpact)) fail("invalid_version_impact");
  if (!REMOTE_VERSION_IMPACTS.has(value.remoteVersionImpact)) fail("invalid_remote_version_impact");
  if (!RELEASE_MODES.has(value.releaseMode)) fail("invalid_release_mode");
  if (!Array.isArray(value.taskRefs) || value.taskRefs.some((ref) => !/^[1-9][0-9]*$/u.test(String(ref)))) {
    fail("invalid_task_refs");
  }
  if (value.releaseMode === "task-batch" && !/^[1-9][0-9]*$/u.test(String(value.releaseTaskRef ?? ""))) {
    fail("invalid_release_task_ref");
  }
  if (value.releaseMode === "standalone" && value.releaseTaskRef !== undefined && value.releaseTaskRef !== null) {
    fail("invalid_release_task_ref");
  }
  if (value.nextAction !== undefined && (typeof value.nextAction !== "string" || !value.nextAction.trim())) {
    fail("invalid_next_action");
  }
  if (!value.body.trimStart().startsWith("## ")) fail("invalid_body");
  return value;
}

function yamlScalar(value) {
  return value === null || value === undefined ? "null" : JSON.stringify(value);
}

function renderRecord(intent, id, timestamp) {
  const applied = (impact) => {
    if (impact === "none") return "not-required";
    return intent.releaseMode === "task-batch" ? "pending-task" : "pending";
  };
  const lines = [
    "---",
    `schema: ${KINDS[intent.kind].schema}`,
    `schemaVersion: ${SCHEMA_VERSION}`,
    `id: ${id}`,
    `title: ${intent.title}`,
    `status: new`,
    `priority: ${intent.priority}`,
    "taskRefs:",
    ...intent.taskRefs.map((ref) => `  - ${yamlScalar(String(ref))}`),
  ];
  if (intent.taskRefs.length === 0) lines.splice(lines.length - 1, 1, "taskRefs: []");
  if (intent.nextAction) lines.push(`nextAction: ${yamlScalar(intent.nextAction)}`);
  lines.push(
    `versionImpact: ${intent.versionImpact}`,
    `remoteVersionImpact: ${intent.remoteVersionImpact}`,
    `releaseMode: ${intent.releaseMode}`,
    `releaseTaskRef: ${intent.releaseTaskRef ? yamlScalar(String(intent.releaseTaskRef)) : "null"}`,
    `versionApplied: ${applied(intent.versionImpact)}`,
    `remoteVersionApplied: ${applied(intent.remoteVersionImpact)}`,
    `createdAt: ${yamlScalar(timestamp)}`,
    `updatedAt: ${yamlScalar(timestamp)}`,
    "blocked: null",
    "completion: null",
    "closure: null",
    "---",
    "",
    intent.body.trim(),
    "",
  );
  return lines.join("\n");
}

/** Write one record atomically; any failure removes the temporary and leaves the tree untouched. */
async function atomicCreate(target, source) {
  const temporary = `${target}.decal-${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, source, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

try {
  const args = parseArgs(process.argv);
  const root = path.resolve(String(args.get("--root") || ""));
  const intentPath = args.get("--intent");
  const dryRun = args.has("--dry-run");
  const write = args.has("--write");
  if (!intentPath || typeof intentPath !== "string" || dryRun === write) fail("usage_error");

  const intent = validateIntent(JSON.parse(await readFile(path.resolve(intentPath), "utf8")));
  const scan = await scanKind(root, intent.kind);
  const revision = sourceRevision(
    `${intent.kind}\0${scan.records.map((record) => `${record.id}:${record.status}`).join(",")}`,
  );
  if (write && args.get("--expected-source-revision") !== revision) fail("stale_source_revision");

  const id = nextIdentity(intent.kind, scan.highest);
  const relative = canonicalRelative(intent.kind, id);
  const target = await assertPlainPath(root, relative);
  try {
    await lstat(target);
    fail("target_overlap");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const timestamp = new Date().toISOString();
  const record = renderRecord(intent, id, timestamp);
  const assigned = { kind: intent.kind, id, path: relative, status: "new" };

  if (dryRun) {
    output(RESULT_SCHEMA, { status: "planned", code: "accepted", sourceRevision: revision, assigned, writeSet: [relative] });
  } else {
    await mkdir(path.dirname(target), { recursive: true });
    await atomicCreate(target, record);
    const verified = await scanKind(root, intent.kind);
    if (!verified.records.some((entry) => entry.id === id && entry.status === "new")) fail("post_write_validation_failed");
    output(RESULT_SCHEMA, {
      status: "written",
      code: "accepted",
      previousSourceRevision: revision,
      sourceRevision: sourceRevision(
        `${intent.kind}\0${verified.records.map((entry) => `${entry.id}:${entry.status}`).join(",")}`,
      ),
      assigned,
      writeSet: [relative],
    });
  }
} catch (error) {
  output(RESULT_SCHEMA, { status: "rejected", code: error.code || "registration_failed" });
  process.exitCode = 2;
}
