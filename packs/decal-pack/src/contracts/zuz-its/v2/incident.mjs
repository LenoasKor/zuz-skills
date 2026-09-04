import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const INCIDENT_SCHEMA = "zuz.its.incident-ticket";
export const INCIDENT_FLOW = ["new", "confirmed", "in_progress", "development_complete", "release_ready", "closed"];
export const INCIDENT_CLASSIFICATIONS = new Set(["security", "regression", "provider", "remote", "os", "external-dependency", "user-reported"]);

export function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function parseArgs(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) args.set(key, true);
    else {
      const previous = args.get(key);
      if (Array.isArray(previous)) previous.push(value);
      else if (typeof previous === "string") args.set(key, [previous, value]);
      else args.set(key, value);
      index += 1;
    }
  }
  return args;
}

export function listValues(args, key) {
  const value = args.get(key);
  return value === undefined || value === true ? [] : Array.isArray(value) ? value : [value];
}

export function output(schema, payload) {
  process.stdout.write(`${JSON.stringify({ schema, ...payload })}\n`);
}

export function sourceRevision(source) {
  const normalized = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const stable = normalized.endsWith("\n") ? normalized : `${normalized}\n`;
  return `sha256:${createHash("sha256").update(stable).digest("hex")}`;
}

export async function assertPlainPath(root, relative) {
  const target = path.resolve(root, relative);
  const inside = path.relative(root, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) fail("path_escape");
  let current = root;
  for (const component of inside.split(path.sep)) {
    current = path.join(current, component);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) fail("symlink_rejected");
      if (current !== target && !metadata.isDirectory()) fail("not_a_directory");
      if (current === target && !metadata.isFile() && !metadata.isDirectory()) fail("not_a_plain_file");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return target;
}

function scalar(source, key) {
  const match = new RegExp(`^${key}:[ \\t]*([^\\r\\n]*)$`, "mu").exec(source);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw || raw === "null") return null;
  try { return JSON.parse(raw); } catch { return raw.replace(/^['"]|['"]$/gu, ""); }
}

function sequence(source, key) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `${key}:` || line === `${key}: []`);
  if (start < 0) fail("incident_field_invalid");
  if (lines[start].endsWith("[]")) return [];
  const values = [];
  for (let index = start + 1; index < lines.length && /^  - /u.test(lines[index]); index += 1) {
    const raw = lines[index].slice(4).trim();
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    if (typeof value !== "string" || !value.trim() || values.includes(value.trim())) fail("incident_field_invalid");
    values.push(value.trim());
  }
  return values;
}

function nestedScalar(source, parent, key) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `${parent}:`);
  if (start < 0) return null;
  const line = lines.slice(start + 1).find((entry) => !entry.startsWith("  ") || entry.startsWith(`  ${key}:`));
  if (!line?.startsWith(`  ${key}:`)) return null;
  const raw = line.slice(key.length + 3).trim();
  if (!raw || raw === "null") return null;
  try { return JSON.parse(raw); } catch { return raw.replace(/^['"]|['"]$/gu, ""); }
}

function timestamp(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(value);
}

export function parseIncident(source, fileName = null) {
  if (!source.startsWith("---\n") || !source.includes("\n---\n")) fail("frontmatter_invalid");
  if (scalar(source, "schema") !== INCIDENT_SCHEMA || scalar(source, "schemaVersion") !== 1) fail("unsupported_schema");
  const id = scalar(source, "id");
  if (typeof id !== "string" || !/^INC-[0-9]{3,}$/u.test(id) || (fileName && fileName !== `${id}.md`)) fail("identity_invalid");
  const title = scalar(source, "title");
  const status = scalar(source, "status");
  const priority = scalar(source, "priority");
  const impact = scalar(source, "impact");
  if (typeof title !== "string" || !title.trim() || ![...INCIDENT_FLOW, "blocked"].includes(status) || !/^P[0-3]$/u.test(priority)) fail("required_field_invalid");
  if (scalar(source, "issueKind") !== "incident" || !["critical", "major", "minor", "degraded"].includes(impact)) fail("incident_kind_invalid");
  const taskRefs = sequence(source, "taskRefs");
  if (taskRefs.some((value) => !/^[1-9][0-9]*$/u.test(value))) fail("task_refs_invalid");
  const affectedServices = sequence(source, "affectedServices");
  if (affectedServices.length === 0) fail("affected_services_missing");
  const classifications = sequence(source, "classifications");
  if (classifications.some((value) => !INCIDENT_CLASSIFICATIONS.has(value))) fail("classification_invalid");
  const occurredAt = scalar(source, "occurredAt");
  const detectedAt = scalar(source, "detectedAt");
  const mitigatedAt = scalar(source, "mitigatedAt");
  const recoveredAt = scalar(source, "recoveredAt");
  if (![occurredAt, detectedAt, mitigatedAt, recoveredAt].filter(Boolean).every(timestamp)) fail("incident_timestamp_invalid");
  if (detectedAt < occurredAt || (mitigatedAt && mitigatedAt < detectedAt) || (recoveredAt && recoveredAt < (mitigatedAt ?? detectedAt))) fail("incident_timestamp_order_invalid");
  const resolutionEvidence = sequence(source, "resolutionEvidence");
  if (["development_complete", "release_ready"].includes(status) && (!recoveredAt || resolutionEvidence.length === 0)) fail("incident_recovery_missing");
  const createdAt = scalar(source, "createdAt");
  const updatedAt = scalar(source, "updatedAt");
  if (!timestamp(createdAt) || !timestamp(updatedAt) || updatedAt < createdAt) fail("timestamp_invalid");
  const blockedFrom = nestedScalar(source, "blocked", "from");
  if ((status === "blocked") !== Boolean(blockedFrom)) fail("blocked_invalid");
  if (status === "blocked" && (!INCIDENT_FLOW.slice(1, -1).includes(blockedFrom) || !nestedScalar(source, "blocked", "reason") || !nestedScalar(source, "blocked", "exitCriteria") || !timestamp(nestedScalar(source, "blocked", "blockedAt")))) fail("blocked_invalid");
  const completionSummary = nestedScalar(source, "completion", "summary");
  if (["development_complete", "release_ready"].includes(status) && !completionSummary) fail("completion_missing");
  const closureReason = nestedScalar(source, "closure", "reason");
  if ((status === "closed") !== Boolean(closureReason)) fail("closure_invalid");
  if (status === "closed" && !["resolved", "duplicate", "cannot_reproduce", "wont_fix", "not_needed"].includes(closureReason)) fail("closure_invalid");
  if (status === "closed" && closureReason === "resolved" && (!recoveredAt || resolutionEvidence.length === 0 || !completionSummary)) fail("incident_recovery_missing");
  return { id, title, status, priority, taskRefs, impact, affectedServices, classifications, occurredAt, detectedAt, mitigatedAt, recoveredAt, resolutionEvidence, revision: sourceRevision(source) };
}

export function canonicalRelative(id) {
  return `docs/work-items/incidents/${id}.md`;
}

export async function scanIncidents(root) {
  const relative = "docs/work-items/incidents";
  const directory = await assertPlainPath(root, relative);
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return { records: [], highest: 0n }; throw error; }
  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!/^INC-[0-9]{3,}\.md$/u.test(entry.name)) continue;
    if (entry.isSymbolicLink() || !entry.isFile()) fail("symlink_or_nested_rejected");
    const source = await readFile(path.join(directory, entry.name), "utf8");
    records.push(parseIncident(source, entry.name));
  }
  const highest = records.reduce((value, record) => {
    const candidate = BigInt(record.id.slice(4));
    return candidate > value ? candidate : value;
  }, 0n);
  return { records, highest };
}

export function nextIncidentId(highest) {
  const next = BigInt(highest) + 1n;
  return `INC-${String(next).padStart(3, "0")}`;
}
