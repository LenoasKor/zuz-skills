import { bumpVersion, fail, parseVersion } from "./version-profile.mjs";

const FIELDS = ["versionImpact", "remoteVersionImpact", "releaseMode", "releaseTaskRef", "versionApplied", "remoteVersionApplied"];
const SCHEMAS = { work: "decal.task-work-bug.work-document", bug: "decal.task-work-bug.bug-card" };
// Canonical v1 reasons plus read compatibility for the already-shipped v5 CLI.
// Settlement never rewrites closure.reason or introduces new lifecycle values.
const CLOSURES = {
  work: ["completed", "cancelled", "duplicate", "not_needed", "unnecessary"],
  bug: ["fixed", "duplicate", "cannot_reproduce", "wont_fix", "not_needed", "not-reproducible", "will-not-fix", "unnecessary"],
};

function matter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source);
  if (!match) fail("missing_frontmatter");
  const header = match[1];
  const names = [...header.matchAll(/^([a-zA-Z][a-zA-Z0-9]*):/gmu)].map((entry) => entry[1]);
  if (new Set(names).size !== names.length) fail("ambiguous_frontmatter");
  return { header, prefix: match[0], offset: match[0].indexOf(header) };
}

function scalar(value) {
  const trimmed = value.trim();
  if (trimmed === "null" || trimmed === "~") return null;
  if (trimmed.startsWith('"')) {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "string") fail("unsupported_yaml_scalar");
    return parsed;
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'")) fail("unsupported_yaml_scalar");
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  if (!/^[a-zA-Z0-9._/-]+$/u.test(trimmed)) fail("unsupported_yaml_scalar");
  return trimmed;
}

function field(header, key) {
  const matches = [...header.matchAll(new RegExp(`^${key}:[ \\t]*([^\\r\\n]*)`, "gmu"))];
  if (matches.length !== 1) fail("settlement_metadata_required", key);
  return scalar(matches[0][1]);
}

function block(header, key) {
  return new RegExp(`^${key}:[ \\t]*\\r?\\n((?:[ \\t]+[^\\r\\n]*\\r?\\n?|\\r?\\n)*)`, "mu").exec(header)?.[1] ?? "";
}

function applied(value) {
  if (["pending", "pending-task", "not-required"].includes(value)) return value;
  parseVersion(value); return value;
}

export function parseWorkBug(source, kind, expectedId) {
  if (!Object.hasOwn(SCHEMAS, kind)) fail("unsupported_settlement_kind");
  const { header } = matter(source);
  const id = field(header, "id");
  if (!new RegExp(`^${kind === "work" ? "WORK" : "BUG"}-[0-9]+$`, "u").test(id)
      || /-0+$/u.test(id) || (expectedId && expectedId !== id)) fail("identity_mismatch");
  if (field(header, "schema") !== SCHEMAS[kind] || field(header, "schemaVersion") !== "1") fail("unsupported_record_schema");
  const status = field(header, "status");
  const values = Object.fromEntries(FIELDS.map((key) => [key, field(header, key)]));
  if (!["desktop-patch", "none"].includes(values.versionImpact)
      || !["remote-patch", "none"].includes(values.remoteVersionImpact)
      || !["standalone", "task-batch"].includes(values.releaseMode)) fail("invalid_settlement_metadata");
  const pending = values.releaseMode === "task-batch" ? "pending-task" : "pending";
  for (const channel of ["", "remote"]) {
    const impact = channel ? values.remoteVersionImpact : values.versionImpact;
    const value = applied(channel ? values.remoteVersionApplied : values.versionApplied);
    if (impact === "none" ? value !== "not-required" : (["pending", "pending-task"].includes(value) && value !== pending)) {
      fail("invalid_settlement_metadata");
    }
  }
  let reason = null;
  if (status === "closed") {
    const reasons = [...block(header, "closure").matchAll(/^  reason:[ \t]*([^\r\n]*)/gmu)];
    if (reasons.length !== 1) fail("invalid_closure_reason");
    reason = scalar(reasons[0][1]);
    if (!CLOSURES[kind].includes(reason)) fail("invalid_closure_reason");
    if (reason === "completed" || reason === "fixed") {
      const completion = block(header, "completion");
      if (!/^  summary:[ \t]*\S/mu.test(completion) || !/^    -[ \t]*\S/mu.test(completion)) fail("completion_evidence_required");
      if ((values.versionImpact !== "none" && values.versionApplied === "not-required")
          || (values.remoteVersionImpact !== "none" && values.remoteVersionApplied === "not-required")) fail("invalid_settlement_metadata");
    }
  }
  const refs = [...block(header, "taskRefs").matchAll(/^  -[ \t]*([^\r\n]*)/gmu)].map((entry) => scalar(entry[1]));
  if (values.releaseMode === "standalone" ? values.releaseTaskRef !== null
    : (!/^[1-9]\d*$/u.test(values.releaseTaskRef ?? "") || !refs.includes(values.releaseTaskRef))) fail("invalid_release_task_reference");
  return { kind, id, status, reason, ...values };
}

export function updateWorkBugApplied(source, versionApplied, remoteVersionApplied) {
  const { header, offset } = matter(source);
  let next = header;
  for (const [key, value] of Object.entries({ versionApplied, remoteVersionApplied })) {
    field(header, key);
    applied(value);
    next = next.replace(new RegExp(`^(${key}:[ \\t]*)[^\\r\\n]*`, "mu"), (_, prefix) => prefix + value);
  }
  return source.slice(0, offset) + next + source.slice(offset + header.length);
}

function settleOne(record, versions, pending) {
  if (record.status !== "closed") fail("closed_record_required", record.id);
  const release = record.kind === "work" ? record.reason === "completed" : record.reason === "fixed";
  const result = { id: record.id, versionApplied: record.versionApplied, remoteVersionApplied: record.remoteVersionApplied };
  for (const channel of ["desktop", "remote"]) {
    const impact = channel === "desktop" ? record.versionImpact : record.remoteVersionImpact;
    const key = channel === "desktop" ? "versionApplied" : "remoteVersionApplied";
    if (!release || impact === "none") { result[key] = "not-required"; continue; }
    if (record[key] !== pending) {
      if (pending === "pending-task") fail("already_settled_batch", record.id);
      continue;
    }
    if (versions[channel] === null) fail("product_configuration_required", channel);
    versions[channel] = bumpVersion(versions[channel], "patch");
    result[key] = versions[channel];
  }
  return result;
}

export function planStandalone(record, baseVersions) {
  if (record.releaseMode !== "standalone") fail("task_batch_settlement_required");
  const versions = { ...baseVersions };
  return { record: settleOne(record, versions, "pending"), versions };
}

export function planTaskBatch(records, { taskId, impacts, baseVersions }) {
  if (!/^[1-9]\d*$/u.test(String(taskId))) fail("invalid_task_identity");
  const ordered = [...records].sort((a, b) => {
    const group = (a.kind === "work" ? 0 : 1) - (b.kind === "work" ? 0 : 1);
    const aId = BigInt(a.id.split("-")[1]); const bId = BigInt(b.id.split("-")[1]);
    return group || (aId < bId ? -1 : aId > bId ? 1 : 0);
  });
  if (new Set(ordered.map((record) => record.id)).size !== ordered.length) fail("duplicate_record_identity");
  const versions = { ...baseVersions };
  const taskApplied = {};
  for (const channel of ["desktop", "remote"]) {
    if (!["minor", "none"].includes(impacts[channel])) fail("invalid_task_impact");
    if (impacts[channel] === "minor") {
      if (versions[channel] === null) fail("product_configuration_required", channel);
      versions[channel] = bumpVersion(versions[channel], "minor");
      taskApplied[channel] = versions[channel];
    } else taskApplied[channel] = "not-required";
  }
  const results = ordered.map((record) => {
    if (record.releaseMode !== "task-batch" || record.releaseTaskRef !== String(taskId)) fail("invalid_release_task_reference");
    if ((record.versionImpact !== "none" && impacts.desktop !== "minor")
        || (record.remoteVersionImpact !== "none" && impacts.remote !== "minor")) fail("task_impact_mismatch");
    return settleOne(record, versions, "pending-task");
  });
  return { versions, taskApplied, records: results };
}
