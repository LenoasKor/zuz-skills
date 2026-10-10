#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { lstat, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { plainFile, sha256, splitCells, validateProject } from "./registry.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (!key.startsWith("--")) continue;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) args.set(key, true);
  else {
    args.set(key, value);
    index += 1;
  }
}

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function revision(indexSource, documentSource) {
  return `sha256:${sha256(`${indexSource.length}\0${indexSource}${documentSource.length}\0${documentSource}`)}`;
}

function updateSummary(source, taskId, from, to) {
  const lines = source.split(/\r?\n/u);
  const heading = lines.findIndex((line) => line.trim() === "## 상태 요약");
  if (heading < 0) return source;
  const update = (status, delta, remove) => {
    for (let index = heading + 1; index < lines.length && !lines[index].startsWith("## "); index += 1) {
      if (!lines[index].startsWith(`| \`${status}\` |`)) continue;
      const cells = splitCells(lines[index]);
      if (cells.length !== 5 || !/^\d+$/u.test(cells[2])) fail("invalid_status_summary");
      const count = Number(cells[2]) + delta;
      if (count < 0) fail("invalid_status_summary");
      const entry = `Task ${taskId}`;
      const entries = cells[3] === "없음" || !cells[3]
        ? []
        : cells[3].split(", ").filter(Boolean);
      if (remove) {
        if (!entries.includes(entry)) fail("invalid_status_summary");
        cells[3] = entries.filter((value) => value !== entry).join(", ") || "없음";
      } else {
        if (entries.includes(entry)) fail("invalid_status_summary");
        cells[3] = [...entries, entry].join(", ");
      }
      cells[2] = String(count);
      lines[index] = `| ${cells.slice(1, -1).join(" | ")} |`;
      return;
    }
    fail("missing_status_summary_row");
  };
  update(from, -1, true);
  update(to, 1, false);
  return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
}

function updateIndex(source, record, to) {
  const lines = source.split(/\r?\n/u);
  const lineIndex = record.line - 1;
  const cells = splitCells(lines[lineIndex]);
  if (cells.length !== 7 || cells[2].replaceAll("`", "") !== record.status) fail("precondition_changed");
  cells[2] = `\`${to}\``;
  lines[lineIndex] = `| ${cells.slice(1, -1).join(" | ")} |`;
  return updateSummary(`${lines.join("\n").replace(/\n+$/u, "")}\n`, record.id, record.status, to);
}

function updateDocument(source, from, to) {
  const marker = `상태: ${from}`;
  const matches = source.split(marker).length - 1;
  if (matches !== 1) fail("document_status_mismatch");
  return source.replace(marker, `상태: ${to}`);
}

async function safeReplace(files, root) {
  const token = randomUUID();
  const backups = new Map();
  const temporaries = [];
  try {
    for (const { target, source } of files) {
      const relative = path.relative(root, target);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("path_escape");
      let current = root;
      for (const component of relative.split(path.sep)) {
        current = path.join(current, component);
        const metadata = await lstat(current);
        if (metadata.isSymbolicLink()) fail("symlink_rejected");
      }
      backups.set(target, await plainFile(target));
      const temporary = `${target}.decal-${token}.tmp`;
      await writeFile(temporary, source, { flag: "wx" });
      temporaries.push(temporary);
    }
    for (let index = 0; index < files.length; index += 1) await rename(temporaries[index], files[index].target);
  } catch (error) {
    for (const temporary of temporaries) await rm(temporary, { force: true });
    for (const [target, source] of backups) await writeFile(target, source);
    throw error;
  }
}

function output(status, code, extra = {}) {
  process.stdout.write(`${JSON.stringify({ schema: "decal.task-work-bug.task-transition/v4", status, code, ...extra })}\n`);
}

try {
  const root = path.resolve(String(args.get("--root") || ""));
  const taskId = Number(args.get("--task"));
  const to = String(args.get("--to") || "");
  const dryRun = args.has("--dry-run");
  const write = args.has("--write");
  if (!Number.isSafeInteger(taskId) || taskId < 1 || dryRun === write) fail("usage_error");
  const allowed = new Map([["planned", new Set(["in_progress"])] ]);
  const project = await validateProject(root);
  const record = project.index.records.find(({ id }) => id === taskId);
  if (!record) fail("task_not_found");
  if (!allowed.get(record.status)?.has(to)) fail("invalid_status_transition");
  const documentPath = path.join(root, "docs/tasks", record.fileName);
  const documentSource = await plainFile(documentPath);
  const sourceRevision = revision(project.indexSource, documentSource);
  if (write && args.get("--expected-source-revision") !== sourceRevision) fail("stale_source_revision");
  const indexSource = updateIndex(project.indexSource, record, to);
  const nextDocumentSource = updateDocument(documentSource, record.status, to);
  const writeSet = [path.relative(root, documentPath), path.relative(root, project.paths.indexPath)];
  if (dryRun) output("planned", "accepted", { taskId, from: record.status, to, sourceRevision, writeSet });
  else {
    await safeReplace([
      { target: documentPath, source: nextDocumentSource },
      { target: project.paths.indexPath, source: indexSource },
    ], root);
    await validateProject(root);
    output("written", "accepted", { taskId, from: record.status, to, previousSourceRevision: sourceRevision, sourceRevision: revision(indexSource, nextDocumentSource), writeSet });
  }
} catch (error) {
  output("rejected", error.code || "transition_failed");
  process.exitCode = 2;
}
