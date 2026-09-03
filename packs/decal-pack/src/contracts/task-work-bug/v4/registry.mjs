import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

export const HEADER = "| Task | 상태 | 우선순위 | 관련 영역 | 검증/다음 액션 |";
export const CONTRACT_ID = "decal.task-work-bug/v4";
export const STATUSES = new Set([
  "backlog", "planned", "in_progress", "blocked", "postponed",
  "development_complete", "release_ready", "completed", "complete",
  "maintained", "archived", "deprecated",
]);

const PREDECESSOR_MANIFESTS = new Map([
  ["v1", "62bcab47e97221ee715725c9981090a4428b1079997ad9124aec890984f9cb67"],
  ["v2", "e7a7a73a079976c0f528629ecbef8a267bad70b1d81a8211aa156d56bb96585c"],
  ["v3", "438c36cede469a65e2e9f239200e485452bdc5111351879198779e5b139e6fc0"],
]);
const HISTORICAL_READ_ONLY_MANIFESTS = new Map([
  ["v1", new Set(["7159993a26963c8fefb946c020d05f4a658ddafd89a0843ca163bfe159eb0497"])],
  ["v2", new Set(["d855f9dfeb999204d5101c985b701e255f8c8deb831c2c4a22356c30b6f62eb5"])],
]);

export function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

export function fail(code, line = null) {
  const error = new Error(code);
  error.code = code;
  error.line = line;
  throw error;
}

export async function plainFile(file) {
  const metadata = await lstat(file);
  if (metadata.isSymbolicLink()) fail("symlink_rejected");
  if (!metadata.isFile()) fail("not_plain_file");
  return readFile(file, "utf8");
}

export function splitCells(line) {
  const cells = [];
  let cell = "";
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === "\\" && line[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (line[index] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += line[index];
    }
  }
  cells.push(cell.trim());
  return cells;
}

export function parseIndex(source) {
  const lines = source.split(/\r?\n/u);
  const headerLine = lines.findIndex((line) => line.trimStart().startsWith("| Task | 상태 |"));
  if (headerLine < 0) fail("missing_header");
  if (lines[headerLine].trim() !== HEADER) fail("missing_columns", headerLine + 1);
  const records = [];
  const ids = new Set();
  let tableEnd = lines.length;
  for (let offset = headerLine + 2; offset < lines.length; offset += 1) {
    const line = lines[offset];
    if (line.startsWith("## ")) {
      tableEnd = offset;
      break;
    }
    if (!line.trim()) continue;
    if (!line.startsWith("|")) fail("unexpected_registry_content", offset + 1);
    if (!line.startsWith("| [")) continue;
    const cells = splitCells(line);
    if (cells.length < 7) fail("missing_columns", offset + 1);
    if (cells.length > 7) fail("extra_columns", offset + 1);
    const match = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(cells[1]);
    if (!match) fail("invalid_link_target", offset + 1);
    const separator = match[1].indexOf(" ");
    if (separator < 0) fail("non_numeric_task_id", offset + 1);
    const rawId = match[1].slice(0, separator);
    if (!/^\d+$/u.test(rawId)) fail("non_numeric_task_id", offset + 1);
    const id = Number(rawId);
    if (!Number.isSafeInteger(id) || id < 1 || !match[1].slice(separator + 1).trim()) fail("invalid_task_id", offset + 1);
    const fileName = match[2];
    if (fileName.includes("/") || fileName.includes("\\") || fileName.includes("..") || !fileName.endsWith(".md")) fail("invalid_link_target", offset + 1);
    if (/^(?:task|slice)_([^_]+)_/u.exec(fileName)?.[1] !== rawId) fail("filename_id_mismatch", offset + 1);
    const status = cells[2].replaceAll("`", "");
    const priority = cells[3].replaceAll("`", "");
    if (!STATUSES.has(status)) fail("invalid_status", offset + 1);
    if (!/^P[0-3](?:\s|$)/u.test(priority)) fail("invalid_priority", offset + 1);
    if (!cells[4] || !cells[5]) fail("missing_columns", offset + 1);
    if (ids.has(id)) fail("duplicate_task_id", offset + 1);
    ids.add(id);
    records.push({ id, rawId, label: match[1], fileName, status, priority, areas: cells[4], summary: cells[5], line: offset + 1 });
  }
  while (tableEnd > headerLine + 2 && !lines[tableEnd - 1].trim()) tableEnd -= 1;
  return { lines, headerLine, tableEnd, records };
}

export function parseCategories(source) {
  const categories = new Map();
  const lines = source.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const cells = splitCells(lines[index]);
    if (cells.length !== 6) continue;
    const category = /^`([a-z0-9-]+)`$/u.exec(cells[1])?.[1];
    const nextIndex = /^`(\d+)`$/u.exec(cells[3])?.[1];
    if (!category || !nextIndex || !cells[2]) continue;
    if (categories.has(category)) fail("duplicate_category", index + 1);
    categories.set(category, { id: category, label: cells[2], nextIndex: Number(nextIndex), line: index });
  }
  if (categories.size === 0) fail("missing_category_registry");
  return { lines, categories };
}

export async function validateTaskDocuments(root, records) {
  for (const record of records) {
    const source = await plainFile(path.join(root, "docs/tasks", record.fileName));
    if (!/^Task Category:\s*[a-z0-9-]+$/mu.test(source)) continue;
    const heading = new RegExp(`^# (?:Task|Slice) ${record.rawId}(?:\\b|[ .\\u00b7])`, "mu");
    if (!heading.test(source)) fail("document_identity_mismatch", record.line);
    const status = /^상태:\s*(\S+)/mu.exec(source)?.[1];
    if (status !== record.status) fail("document_status_mismatch", record.line);
  }
}

export async function validatePackage(root, mode = "writer") {
  for (const [version, expected] of PREDECESSOR_MANIFESTS) {
    const source = await plainFile(path.join(root, `contracts/task-work-bug/${version}/manifest.json`));
    const digest = sha256(source);
    const historicalReadOnly = mode === "consumer-read-only"
      && HISTORICAL_READ_ONLY_MANIFESTS.get(version)?.has(digest);
    if (digest !== expected && !historicalReadOnly) fail("contract_digest_mismatch");
  }
  const packageRoot = path.join(root, "contracts/task-work-bug/v4");
  const manifest = JSON.parse(await plainFile(path.join(packageRoot, "manifest.json")));
  if (manifest.schema !== "decal.task-work-bug.fixture-manifest/v4" || !manifest.files) fail("contract_digest_mismatch");
  for (const [relative, expected] of Object.entries(manifest.files)) {
    if (sha256(await plainFile(path.join(packageRoot, relative))) !== expected) fail("contract_digest_mismatch");
  }
}

export async function canonicalRegistry(root) {
  const canonical = path.join(root, "docs/tasks/index.md");
  const legacy = path.join(root, "docs/slices/index.md");
  const found = [];
  for (const candidate of [canonical, legacy]) {
    try {
      await lstat(candidate);
      found.push(candidate);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  if (found.length > 1) fail("ambiguous_registry");
  if (found.length === 0) fail("missing_registry_file");
  if (found[0] !== canonical) fail("legacy_registry_read_only");
  return {
    indexPath: canonical,
    categoryPath: path.join(root, "docs/tasks/category_index.md"),
  };
}

export async function validateProject(root, mode = "writer") {
  await validatePackage(root, mode);
  const paths = await canonicalRegistry(root);
  const indexSource = await plainFile(paths.indexPath);
  const categorySource = await plainFile(paths.categoryPath);
  const index = parseIndex(indexSource);
  const categories = parseCategories(categorySource);
  await validateTaskDocuments(root, index.records);
  return { paths, indexSource, categorySource, index, categories };
}
