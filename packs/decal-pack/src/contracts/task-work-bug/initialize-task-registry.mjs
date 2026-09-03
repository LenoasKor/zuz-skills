#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";

import { parseCategories, parseIndex, validatePackage, validateProject } from "./v4/registry.mjs";

const RESULT_SCHEMA = "decal.task-work-bug.task-registry-initialization/v1";
const INTENT_SCHEMA = "decal.task-work-bug.task-registry-initialization-intent/v1";
const WRITE_SET = ["docs/tasks/index.md", "docs/tasks/category_index.md"];

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function sha256(source) {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}

function parseArgs(argv) {
  const args = new Map();
  for (let index = 2; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) args.set(key, true);
    else {
      args.set(key, value);
      index += 1;
    }
  }
  return args;
}

function cleanText(value, code) {
  if (typeof value !== "string" || !value.trim() || /[\r\n|]/u.test(value)) fail(code);
  return value.trim();
}

function validateIntent(value) {
  if (!value || value.schema !== INTENT_SCHEMA) fail("invalid_intent");
  const intentId = cleanText(value.intentId, "invalid_intent");
  if (!Array.isArray(value.categories) || value.categories.length === 0) fail("invalid_categories");
  const seen = new Set();
  const categories = value.categories.map((category) => {
    if (!category || !/^[a-z0-9][a-z0-9-]*$/u.test(category.id ?? "") || seen.has(category.id)) {
      fail("invalid_categories");
    }
    seen.add(category.id);
    return {
      id: category.id,
      label: cleanText(category.label, "invalid_categories"),
      purpose: cleanText(category.purpose, "invalid_categories"),
    };
  });
  return { schema: INTENT_SCHEMA, intentId, categories };
}

async function metadata(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function assertPlainDirectory(target, { allowMissing = false } = {}) {
  const stat = await metadata(target);
  if (!stat && allowMissing) return;
  if (!stat) fail("missing_project_root");
  if (stat.isSymbolicLink()) fail("symlink_rejected");
  if (!stat.isDirectory()) fail("not_a_directory");
}

async function inspectBaseline(root) {
  await assertPlainDirectory(root);
  const canonical = await Promise.all(WRITE_SET.map((relative) => metadata(path.join(root, relative))));
  const legacy = await Promise.all([
    metadata(path.join(root, "docs/slices/index.md")),
    metadata(path.join(root, "docs/slices/category_index.md")),
  ]);
  if ([...canonical, ...legacy].some((stat) => stat?.isSymbolicLink())) fail("symlink_rejected");
  if (legacy.some(Boolean)) fail("legacy_registry_present");
  if (canonical.every(Boolean)) fail("registry_already_initialized");
  if (canonical.some(Boolean)) fail("partial_registry");

  const docs = path.join(root, "docs");
  const tasks = path.join(docs, "tasks");
  await assertPlainDirectory(docs, { allowMissing: true });
  await assertPlainDirectory(tasks, { allowMissing: true });
  if (await metadata(tasks)) {
    const entries = await readdir(tasks);
    if (entries.length > 0) fail("nonempty_task_directory");
  }
}

function renderIndex() {
  return [
    "# Tasks",
    "",
    "## 상태 요약",
    "",
    "| 상태 | 개수 | 비고 |",
    "| --- | ---: | --- |",
    "| `planned` | 0 | 등록된 Task 없음 |",
    "",
    "## Task 목록",
    "",
    "| Task | 상태 | 우선순위 | 관련 영역 | 검증/다음 액션 |",
    "| --- | --- | --- | --- | --- |",
    "",
  ].join("\n");
}

function renderCategories(categories) {
  return [
    "# Task Category Index",
    "",
    "## Category Registry",
    "",
    "| Category ID | Label | Next Index | Purpose |",
    "| --- | --- | ---: | --- |",
    ...categories.map(({ id, label, purpose }) => `| \`${id}\` | ${label} | \`001\` | ${purpose} |`),
    "",
  ].join("\n");
}

function sourceRevision(intent) {
  return sha256(JSON.stringify(intent));
}

async function createExclusive(target, source) {
  const handle = await open(target, "wx", 0o644);
  try {
    await handle.writeFile(source, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function rollbackGenerated(root, generated) {
  for (const [relative, source] of generated.toReversed()) {
    const target = path.join(root, relative);
    try {
      if (await readFile(target, "utf8") !== source) fail("rollback_conflict");
      await rm(target);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function output(status, code, extra = {}) {
  process.stdout.write(`${JSON.stringify({ schema: RESULT_SCHEMA, status, code, ...extra })}\n`);
}

try {
  const args = parseArgs(process.argv);
  const root = path.resolve(String(args.get("--root") || ""));
  const intentPath = args.get("--intent");
  const dryRun = args.has("--dry-run");
  const write = args.has("--write");
  if (typeof intentPath !== "string" || dryRun === write) fail("usage_error");
  const intent = validateIntent(JSON.parse(await readFile(path.resolve(intentPath), "utf8")));
  await validatePackage(root);
  await inspectBaseline(root);
  const revision = sourceRevision(intent);
  const indexSource = renderIndex();
  const categorySource = renderCategories(intent.categories);
  parseIndex(indexSource);
  parseCategories(categorySource);

  if (dryRun) {
    output("planned", "accepted", { sourceRevision: revision, writeSet: WRITE_SET });
  } else {
    if (args.get("--expected-source-revision") !== revision) fail("stale_source_revision");
    await inspectBaseline(root);
    const docs = path.join(root, "docs");
    const tasks = path.join(docs, "tasks");
    await mkdir(tasks, { recursive: true });
    await assertPlainDirectory(docs);
    await assertPlainDirectory(tasks);
    const generated = [];
    try {
      await createExclusive(path.join(root, WRITE_SET[0]), indexSource);
      generated.push([WRITE_SET[0], indexSource]);
      await createExclusive(path.join(root, WRITE_SET[1]), categorySource);
      generated.push([WRITE_SET[1], categorySource]);
      await validateProject(root);
    } catch (error) {
      await rollbackGenerated(root, generated);
      throw error;
    }
    output("written", "accepted", { previousSourceRevision: revision, sourceRevision: sha256(`${indexSource}\0${categorySource}`), writeSet: WRITE_SET });
  }
} catch (error) {
  output("rejected", error.code || "initialization_failed");
  process.exitCode = 2;
}
