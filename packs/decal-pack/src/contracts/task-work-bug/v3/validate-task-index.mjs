#!/usr/bin/env node

import { readFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const HEADER = "| Task | 상태 | 우선순위 | 관련 영역 | 검증/다음 액션 |";
const REQUIRED_PREDECESSOR_MANIFESTS = new Map([
  ["v1", "62bcab47e97221ee715725c9981090a4428b1079997ad9124aec890984f9cb67"],
  ["v2", "e7a7a73a079976c0f528629ecbef8a267bad70b1d81a8211aa156d56bb96585c"],
]);
const HISTORICAL_READ_ONLY_V2_MANIFESTS = new Set([
  "d855f9dfeb999204d5101c985b701e255f8c8deb831c2c4a22356c30b6f62eb5",
]);
const STATUSES = new Set([
  "backlog", "planned", "in_progress", "blocked", "postponed",
  "development_complete", "release_ready", "completed", "complete",
  "maintained", "archived", "deprecated",
]);

function result(status, code, line = null, taskCount = 0) {
  return { schema: "decal.task-work-bug.registry-validation/v3", status, code, line, taskCount };
}

function splitCells(line) {
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

function reject(code, line) {
  const error = new Error(code);
  error.code = code;
  error.line = line;
  throw error;
}

function validateSource(source) {
  const lines = source.split(/\r?\n/u);
  const headerLine = lines.findIndex((line) => line.trimStart().startsWith("| Task | 상태 |"));
  if (headerLine < 0) reject("missing_header", null);
  if (lines[headerLine].trim() !== HEADER) reject("missing_columns", headerLine + 1);
  const ids = new Set();
  let taskCount = 0;
  for (let offset = headerLine + 2; offset < lines.length; offset += 1) {
    const line = lines[offset];
    if (!line.startsWith("|")) break;
    if (!line.startsWith("| [")) continue;
    const cells = splitCells(line);
    if (cells.length < 7) reject("missing_columns", offset + 1);
    if (cells.length > 7) reject("extra_columns", offset + 1);
    const match = /^\[([^\]]+)\]\(([^)]+)\)$/u.exec(cells[1]);
    if (!match) reject("invalid_link_target", offset + 1);
    const separator = match[1].indexOf(" ");
    if (separator < 0) reject("non_numeric_task_id", offset + 1);
    const id = match[1].slice(0, separator);
    if (!/^\d+$/u.test(id)) reject("non_numeric_task_id", offset + 1);
    if (!/[1-9]/u.test(id) || !match[1].slice(separator + 1).trim()) reject("invalid_task_id", offset + 1);
    const document = match[2];
    if (document.includes("/") || document.includes("\\") || document.includes("..") || !document.endsWith(".md")) {
      reject("invalid_link_target", offset + 1);
    }
    const filenameId = /^(?:task|slice)_([^_]+)_/u.exec(document)?.[1];
    if (filenameId !== id) reject("filename_id_mismatch", offset + 1);
    if (!STATUSES.has(cells[2].replaceAll("`", ""))) reject("invalid_status", offset + 1);
    if (!/^P[0-3](?:\s|`|$)/u.test(cells[3].replace(/^`/u, ""))) reject("invalid_priority", offset + 1);
    if (!cells[4] || !cells[5]) reject("missing_columns", offset + 1);
    if (ids.has(id)) reject("duplicate_task_id", offset + 1);
    ids.add(id);
    taskCount += 1;
  }
  return taskCount;
}

async function plainFile(file) {
  const metadata = await lstat(file);
  if (metadata.isSymbolicLink() || !metadata.isFile()) throw Object.assign(new Error("contract_symlink_rejected"), { code: "contract_symlink_rejected" });
  return readFile(file, "utf8");
}

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

async function validateContractPackage(root, mode) {
  const v1Source = await plainFile(path.join(root, "contracts/task-work-bug/v1/manifest.json"));
  const v2Source = await plainFile(path.join(root, "contracts/task-work-bug/v2/manifest.json"));
  const currentChain = sha256(v1Source) === REQUIRED_PREDECESSOR_MANIFESTS.get("v1")
    && sha256(v2Source) === REQUIRED_PREDECESSOR_MANIFESTS.get("v2");
  const historicalReadOnlyChain = mode === "consumer-read-only"
    && HISTORICAL_READ_ONLY_V2_MANIFESTS.has(sha256(v2Source));
  if (!currentChain && !historicalReadOnlyChain) {
    reject("contract_digest_mismatch", null);
  }
  const v3Root = path.join(root, "contracts/task-work-bug/v3");
  const manifest = JSON.parse(await plainFile(path.join(v3Root, "manifest.json")));
  if (manifest.schema !== "decal.task-work-bug.fixture-manifest/v3" || !manifest.files) {
    reject("contract_digest_mismatch", null);
  }
  for (const [relativePath, expectedDigest] of Object.entries(manifest.files)) {
    if (sha256(await plainFile(path.join(v3Root, relativePath))) !== expectedDigest) {
      reject("contract_digest_mismatch", null);
    }
  }
}

async function main() {
  const rootFlag = process.argv.indexOf("--root");
  if (rootFlag < 0 || !process.argv[rootFlag + 1]) {
    process.stderr.write("usage: validate-task-index.mjs --root <project-root>\n");
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(process.argv[rootFlag + 1]);
  const modeFlag = process.argv.indexOf("--mode");
  const mode = modeFlag < 0 ? "writer" : process.argv[modeFlag + 1];
  if (!new Set(["writer", "consumer-read-only"]).has(mode)) {
    process.stderr.write("--mode must be writer or consumer-read-only\n");
    process.exitCode = 1;
    return;
  }
  try {
    await validateContractPackage(root, mode);
    const canonical = path.join(root, "docs/tasks/index.md");
    const legacy = path.join(root, "docs/slices/index.md");
    const candidates = [];
    for (const candidate of [canonical, legacy]) {
      try {
        await lstat(candidate);
        candidates.push(candidate);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (candidates.length > 1) reject("ambiguous_registry", null);
    if (candidates.length === 0) reject("missing_registry_file", null);
    const category = candidates[0] === canonical
      ? path.join(root, "docs/tasks/category_index.md")
      : path.join(root, "docs/slices/category_index.md");
    await plainFile(category);
    const taskCount = validateSource(await plainFile(candidates[0]));
    process.stdout.write(`${JSON.stringify(result("accepted", "accepted", null, taskCount))}\n`);
  } catch (error) {
    const code = error.code === "ENOENT" ? "contract_unavailable" : (error.code || "registry_read_error");
    process.stdout.write(`${JSON.stringify(result("malformed", code, error.line ?? null))}\n`);
    process.exitCode = 2;
  }
}

await main();
