import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

export const KINDS = {
  work: {
    directory: "work",
    prefix: "WORK",
    schema: "decal.task-work-bug.work-document",
    flow: ["new", "planned", "in_progress", "development_complete", "release_ready", "closed"],
    normalClosure: "completed",
  },
  bug: {
    directory: "bugs",
    prefix: "BUG",
    schema: "decal.task-work-bug.bug-card",
    flow: ["new", "confirmed", "in_progress", "development_complete", "release_ready", "closed"],
    normalClosure: "fixed",
  },
};

export const SCHEMA_VERSION = 1;

export const REQUIRED_FIELDS = [
  "schema",
  "schemaVersion",
  "id",
  "title",
  "status",
  "priority",
  "taskRefs",
  "createdAt",
  "updatedAt",
  "blocked",
  "completion",
  "closure",
];

export function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function sourceRevision(source) {
  return `sha256:${sha256(source)}`;
}

export function parseArgs(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      args.set(key, true);
      continue;
    }
    const previous = args.get(key);
    if (Array.isArray(previous)) previous.push(value);
    else if (typeof previous === "string") args.set(key, [previous, value]);
    else args.set(key, value);
    index += 1;
  }
  return args;
}

export function listValues(args, key) {
  const value = args.get(key);
  if (value === undefined || value === true) return [];
  return Array.isArray(value) ? value : [value];
}

/** Reject any component of `relative` that is a symlink or a non-directory parent. */
export async function assertPlainPath(root, relative) {
  const target = path.resolve(root, relative);
  const inside = path.relative(root, target);
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) fail("path_escape");
  const components = inside.split(path.sep);
  let current = root;
  for (let index = 0; index < components.length; index += 1) {
    current = path.join(current, components[index]);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (metadata.isSymbolicLink()) fail("symlink_rejected");
    const last = index === components.length - 1;
    if (!last && !metadata.isDirectory()) fail("not_a_directory");
    if (last && !metadata.isFile() && !metadata.isDirectory()) fail("not_a_plain_file");
  }
  return target;
}

export async function plainFile(target) {
  const metadata = await lstat(target);
  if (metadata.isSymbolicLink()) fail("symlink_rejected");
  if (!metadata.isFile()) fail("not_a_plain_file");
  return readFile(target, "utf8");
}

export function frontmatter(source) {
  const normalized = source.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  if (lines[0] !== "---") fail("missing_frontmatter");
  const end = lines.indexOf("---", 1);
  if (end < 0) fail("missing_frontmatter");
  return { lines, end, normalized };
}

/** Read a top-level scalar. Nested keys are indented and never match. */
export function topLevelValue(source, key) {
  const match = new RegExp(`^${key}:[ \\t]*([^\\r\\n]*)$`, "m").exec(source);
  if (!match) return null;
  const raw = match[1].trim();
  if (!raw) return null;
  return raw.replace(/^["']|["']$/gu, "");
}

export function recordIdentity(kind, source) {
  const definition = KINDS[kind];
  frontmatter(source);
  const id = topLevelValue(source, "id");
  const schema = topLevelValue(source, "schema");
  const schemaVersion = topLevelValue(source, "schemaVersion");
  const status = topLevelValue(source, "status");
  if (!id || !new RegExp(`^${definition.prefix}-[0-9]{3,}$`, "u").test(id)) fail("invalid_identity");
  if (schema !== definition.schema) fail("unknown_schema");
  if (schemaVersion !== String(SCHEMA_VERSION)) fail("unsupported_schema_version");
  if (!status || !definition.flow.includes(status)) {
    if (status !== "blocked") fail("invalid_status");
  }
  return { id, schema, schemaVersion: Number(schemaVersion), status };
}

export function canonicalRelative(kind, id) {
  return `docs/work-items/${KINDS[kind].directory}/${id}.md`;
}

/** Scan one kind's canonical directory. Malformed records fail closed. */
export async function scanKind(root, kind) {
  const definition = KINDS[kind];
  const relative = `docs/work-items/${definition.directory}`;
  const directory = await assertPlainPath(root, relative);
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return { relative, present: false, records: [], highest: 0 };
    throw error;
  }
  const pattern = new RegExp(`^${definition.prefix}-([0-9]{3,})\\.md$`, "u");
  const records = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const match = pattern.exec(entry.name);
    if (!match) continue;
    if (entry.isSymbolicLink()) fail("symlink_rejected");
    if (!entry.isFile()) fail("not_a_plain_file");
    const source = await plainFile(path.join(directory, entry.name));
    const identity = recordIdentity(kind, source);
    if (identity.id !== `${definition.prefix}-${match[1]}`) fail("identity_filename_mismatch");
    if (records.some((record) => record.id === identity.id)) fail("duplicate_identity");
    records.push({ ...identity, number: Number(match[1]), fileName: entry.name });
  }
  const highest = records.reduce((carry, record) => Math.max(carry, record.number), 0);
  return { relative, present: true, records, highest };
}

export function nextIdentity(kind, highest) {
  const width = Math.max(3, String(highest + 1).length);
  return `${KINDS[kind].prefix}-${String(highest + 1).padStart(width, "0")}`;
}

export function output(schema, payload) {
  process.stdout.write(`${JSON.stringify({ schema, ...payload })}\n`);
}
