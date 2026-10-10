#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { assertPlainPath, canonicalRelative, fail, nextIncidentId, output, parseIncident, scanIncidents, sourceRevision } from "./incident.mjs";

const RESULT_SCHEMA = "zuz.its.incident-registration/v1";
const INTENT_SCHEMA = "zuz.its.incident-registration-intent/v1";

function yamlScalar(value) { return value === null || value === undefined ? "null" : JSON.stringify(value); }
function yamlSequence(key, values) { return values.length ? [key + ":", ...values.map((value) => `  - ${yamlScalar(value)}`)] : [`${key}: []`]; }

function validateIntent(value) {
  if (!value || value.schema !== INTENT_SCHEMA) fail("invalid_intent");
  for (const key of ["intentId", "title", "priority", "impact", "occurredAt", "detectedAt", "body", "versionImpact", "remoteVersionImpact", "releaseMode"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) fail("invalid_intent");
  }
  if (!/^P[0-3]$/u.test(value.priority) || !["critical", "major", "minor", "degraded"].includes(value.impact)) fail("invalid_intent");
  for (const key of ["taskRefs", "affectedServices", "classifications"]) if (!Array.isArray(value[key])) fail("invalid_intent");
  if (value.taskRefs.some((ref) => !/^[1-9][0-9]*$/u.test(String(ref))) || value.affectedServices.length === 0) fail("invalid_intent");
  if (!value.body.trimStart().startsWith("## 장애 영향")) fail("invalid_body");
  if (!["desktop-patch", "none"].includes(value.versionImpact) || !["remote-patch", "none"].includes(value.remoteVersionImpact) || !["standalone", "task-batch"].includes(value.releaseMode)) fail("invalid_settlement");
  if (value.releaseMode === "task-batch" && !value.taskRefs.map(String).includes(String(value.releaseTaskRef ?? ""))) fail("invalid_release_task_ref");
  if (value.releaseMode === "standalone" && value.releaseTaskRef != null) fail("invalid_release_task_ref");
  return value;
}

function render(intent, id, timestamp) {
  const pending = intent.releaseMode === "task-batch" ? "pending-task" : "pending";
  const applied = (impact) => impact === "none" ? "not-required" : pending;
  return [
    "---",
    "schema: zuz.its.incident-ticket",
    "schemaVersion: 1",
    `id: ${id}`,
    `title: ${yamlScalar(intent.title.trim())}`,
    "issueKind: incident",
    "status: new",
    `priority: ${intent.priority}`,
    ...yamlSequence("taskRefs", intent.taskRefs.map(String)),
    `nextAction: ${yamlScalar(intent.nextAction ?? null)}`,
    `impact: ${intent.impact}`,
    ...yamlSequence("affectedServices", intent.affectedServices),
    ...yamlSequence("classifications", intent.classifications),
    `occurredAt: ${yamlScalar(intent.occurredAt)}`,
    `detectedAt: ${yamlScalar(intent.detectedAt)}`,
    "mitigatedAt: null",
    "recoveredAt: null",
    "resolutionEvidence: []",
    `versionImpact: ${intent.versionImpact}`,
    `remoteVersionImpact: ${intent.remoteVersionImpact}`,
    `releaseMode: ${intent.releaseMode}`,
    `releaseTaskRef: ${yamlScalar(intent.releaseTaskRef ?? null)}`,
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
  ].join("\n");
}

async function atomicCreate(target, source) {
  const temporary = `${target}.decal-${randomUUID()}.tmp`;
  try { await writeFile(temporary, source, { flag: "wx" }); await rename(temporary, target); }
  catch (error) { await rm(temporary, { force: true }); throw error; }
}

try {
  const args = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    const value = process.argv[index + 1];
    if (!key.startsWith("--")) continue;
    if (!value || value.startsWith("--")) args.set(key, true); else { args.set(key, value); index += 1; }
  }
  const root = path.resolve(String(args.get("--root") || ""));
  const intentPath = args.get("--intent");
  const dryRun = args.has("--dry-run");
  const write = args.has("--write");
  if (typeof intentPath !== "string" || dryRun === write) fail("usage_error");
  const intent = validateIntent(JSON.parse(await readFile(path.resolve(intentPath), "utf8")));
  const scan = await scanIncidents(root);
  const revision = sourceRevision(`incident\0${scan.records.map((record) => `${record.id}:${record.status}`).join(",")}`);
  if (write && args.get("--expected-source-revision") !== revision) fail("stale_source_revision");
  const id = nextIncidentId(scan.highest);
  const relative = canonicalRelative(id);
  const target = await assertPlainPath(root, relative);
  try { await lstat(target); fail("target_overlap"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const record = render(intent, id, new Date().toISOString());
  parseIncident(record, `${id}.md`);
  if (dryRun) output(RESULT_SCHEMA, { status: "planned", code: "accepted", sourceRevision: revision, assigned: { id, path: relative }, writeSet: [relative] });
  else {
    await mkdir(path.dirname(target), { recursive: true });
    await atomicCreate(target, record);
    const verified = await scanIncidents(root);
    if (!verified.records.some((entry) => entry.id === id)) fail("post_write_validation_failed");
    output(RESULT_SCHEMA, { status: "written", code: "accepted", assigned: { id, path: relative }, writeSet: [relative] });
  }
} catch (error) {
  output(RESULT_SCHEMA, { status: "rejected", code: error.code || "registration_failed" });
  process.exitCode = 2;
}
