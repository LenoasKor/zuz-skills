#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseCategories, parseIndex, plainFile, sha256, splitCells, validateProject } from "./registry.mjs";

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

function validateIntent(value) {
  if (!value || value.schema !== "decal.task-work-bug.task-registration-intent/v4") fail("invalid_intent");
  for (const key of ["intentId", "category", "slug", "title", "priority", "summary", "body", "versionImpact", "remoteVersionImpact"]) {
    if (typeof value[key] !== "string" || !value[key].trim()) fail("invalid_intent");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(value.category)) fail("invalid_category");
  if (!/^[a-z0-9][a-z0-9_]*$/u.test(value.slug)) fail("invalid_slug");
  if (!/^P[0-3](?:\s|$)/u.test(value.priority)) fail("invalid_priority");
  if (!Array.isArray(value.areas) || value.areas.length === 0 || value.areas.some((area) => typeof area !== "string" || !area.trim())) fail("invalid_areas");
  if (!value.body.trimStart().startsWith("## Context Budget")) fail("invalid_body");
  if (value.createdVersion !== undefined && (typeof value.createdVersion !== "string" || !/^\d+\.\d+\.\d+$/u.test(value.createdVersion))) fail("invalid_created_version");
  return value;
}

function sourceRevision(indexSource, categorySource) {
  return `sha256:${sha256(`${indexSource.length}\0${indexSource}${categorySource.length}\0${categorySource}`)}`;
}

function updateCategory(source, category, expected) {
  const parsed = parseCategories(source);
  const record = parsed.categories.get(category);
  if (!record || record.nextIndex !== expected) fail("category_precondition_changed");
  const cells = splitCells(parsed.lines[record.line]);
  cells[3] = `\`${String(expected + 1).padStart(3, "0")}\``;
  parsed.lines[record.line] = `| ${cells.slice(1, -1).join(" | ")} |`;
  return `${parsed.lines.join("\n").replace(/\n+$/u, "")}\n`;
}

function updateOptionalSummary(source, taskId) {
  const lines = source.split(/\r?\n/u);
  const summaryHeading = lines.findIndex((line) => line.trim() === "## 상태 요약");
  if (summaryHeading < 0) return source;
  for (let index = summaryHeading + 1; index < lines.length && !lines[index].startsWith("## "); index += 1) {
    if (!lines[index].startsWith("| `planned` |")) continue;
    const cells = splitCells(lines[index]);
    if (cells.length !== 5 || !/^\d+$/u.test(cells[2])) fail("invalid_status_summary");
    cells[2] = String(Number(cells[2]) + 1);
    cells[3] = cells[3] ? `${cells[3]}, Task ${taskId}` : `Task ${taskId}`;
    lines[index] = `| ${cells.slice(1, -1).join(" | ")} |`;
    return `${lines.join("\n").replace(/\n+$/u, "")}\n`;
  }
  fail("missing_planned_summary");
}

function insertIndexRow(source, row, createdVersion, taskId) {
  let next = updateOptionalSummary(source, taskId);
  if (createdVersion) {
    const lines = next.split(/\r?\n/u);
    const taskHeading = lines.findIndex((line) => line.trim() === "## Task 목록" || line.trim() === "## Tasks");
    const createdHeading = lines.findIndex((line) => line.trim() === "## Task 생성 버전 기록");
    if (createdHeading >= 0 && taskHeading > createdHeading) {
      let insertAt = taskHeading;
      while (insertAt > createdHeading && lines[insertAt - 1] === "") insertAt -= 1;
      lines.splice(insertAt, 0, `| ${taskId} | \`${createdVersion}\` |`, "");
      next = `${lines.join("\n").replace(/\n+$/u, "")}\n`;
    }
  }
  const parsed = parseIndex(next);
  parsed.lines.splice(parsed.tableEnd, 0, row);
  return `${parsed.lines.join("\n").replace(/\n+$/u, "")}\n`;
}

function renderTask(intent, taskId, categoryLabel, categoryIndex) {
  const remoteApplied = intent.remoteVersionImpact === "none" ? "not-required" : "pending";
  const lines = [
    `# Task ${taskId} · ${categoryLabel} · ${String(categoryIndex).padStart(3, "0")} — ${intent.title}`,
    "", "상태: planned", "", `Task Category: ${intent.category}`, "",
    `Category Index: ${String(categoryIndex).padStart(3, "0")}`, "",
    `Index Priority: ${intent.priority}`, "", `Index Areas: ${intent.areas.join(", ")}`, "",
    `Index Summary: ${intent.summary}`, "", `Version Impact: ${intent.versionImpact}`, "",
    "Version Applied: pending", "", `Remote Version Impact: ${intent.remoteVersionImpact}`, "",
    `Remote Version Applied: ${remoteApplied}`,
  ];
  if (intent.createdVersion) lines.push("", `Created Version: ${intent.createdVersion}`);
  lines.push("", `Registration Intent: ${intent.intentId}`, "", intent.body.trim(), "");
  return lines.join("\n");
}

async function assertSafeTarget(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) fail("path_escape");
  let current = root;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink()) fail("symlink_rejected");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function atomicWrite(files) {
  const token = randomUUID();
  const originals = new Map();
  const temporaries = [];
  try {
    for (const { target, source, mustBeAbsent } of files) {
      await assertSafeTarget(path.dirname(path.dirname(path.dirname(target))), target);
      try {
        originals.set(target, await plainFile(target));
        if (mustBeAbsent) fail("target_overlap");
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        originals.set(target, null);
      }
      const temporary = `${target}.decal-${token}.tmp`;
      await writeFile(temporary, source, { flag: "wx" });
      temporaries.push(temporary);
    }
    for (let index = 0; index < files.length; index += 1) await rename(temporaries[index], files[index].target);
  } catch (error) {
    for (const temporary of temporaries) await rm(temporary, { force: true });
    for (const [target, source] of originals) {
      if (source === null) await rm(target, { force: true });
      else await writeFile(target, source);
    }
    throw error;
  }
}

function output(status, code, extra = {}) {
  process.stdout.write(`${JSON.stringify({ schema: "decal.task-work-bug.task-registration/v4", status, code, ...extra })}\n`);
}

try {
  const root = path.resolve(String(args.get("--root") || ""));
  const intentPath = args.get("--intent");
  const dryRun = args.has("--dry-run");
  const write = args.has("--write");
  if (!intentPath || dryRun === write) fail("usage_error");
  const intent = validateIntent(JSON.parse(await readFile(path.resolve(String(intentPath)), "utf8")));
  const project = await validateProject(root);
  const revision = sourceRevision(project.indexSource, project.categorySource);
  if (write && args.get("--expected-source-revision") !== revision) fail("stale_source_revision");
  const taskId = Math.max(...project.index.records.map(({ id }) => id), 0) + 1;
  const category = project.categories.categories.get(intent.category);
  if (!category) fail("unknown_category");
  const categoryIndex = category.nextIndex;
  const fileName = `task_${taskId}_${intent.category.replaceAll("-", "_")}_${String(categoryIndex).padStart(3, "0")}_${intent.slug}.md`;
  const taskPath = path.join(root, "docs/tasks", fileName);
  try {
    await lstat(taskPath);
    fail("target_overlap");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const taskSource = renderTask(intent, taskId, category.label, categoryIndex);
  const categorySource = updateCategory(project.categorySource, intent.category, categoryIndex);
  const row = `| [${taskId} ${category.label} ${String(categoryIndex).padStart(3, "0")} — ${intent.title}](${fileName}) | \`planned\` | \`${intent.priority}\` | ${intent.areas.join(", ")} | ${intent.summary} |`;
  const indexSource = insertIndexRow(project.indexSource, row, intent.createdVersion, taskId);
  const writeSet = [path.relative(root, taskPath), path.relative(root, project.paths.indexPath), path.relative(root, project.paths.categoryPath)];
  const assigned = { taskId, category: intent.category, categoryIndex, path: writeSet[0], status: "planned" };
  if (dryRun) output("planned", "accepted", { sourceRevision: revision, assigned, writeSet });
  else {
    await atomicWrite([
      { target: taskPath, source: taskSource, mustBeAbsent: true },
      { target: project.paths.indexPath, source: indexSource, mustBeAbsent: false },
      { target: project.paths.categoryPath, source: categorySource, mustBeAbsent: false },
    ]);
    const verified = await validateProject(root);
    if (!verified.index.records.some(({ id, fileName: target }) => id === taskId && target === fileName)) fail("post_write_validation_failed");
    output("written", "accepted", { previousSourceRevision: revision, sourceRevision: sourceRevision(indexSource, categorySource), assigned, writeSet });
  }
} catch (error) {
  output("rejected", error.code || "registration_failed");
  process.exitCode = 2;
}
