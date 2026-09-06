#!/usr/bin/env node

// Add missing empty summary rows only. Pinned readers/writers and Task records stay unchanged.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { fail, sha256, splitCells, STATUSES, validateProject } from "./v4/registry.mjs";

const schema = "decal.task-work-bug.task-registry-summary-repair/v1";
const relative = "docs/tasks/index.md";
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i];
  if (!key.startsWith("--")) fail("usage_error");
  const value = process.argv[i + 1];
  args.set(key, value && !value.startsWith("--") ? process.argv[++i] : true);
}
const output = (status, code, extra = {}) => process.stdout.write(`${JSON.stringify({ schema, status, code, ...extra })}\n`);

async function plain(root, name) {
  let cursor = root;
  const components = name.split("/");
  for (const [i, component] of components.entries()) {
    if (!component || component === "." || component === "..") fail("unsafe_path");
    cursor = path.join(cursor, component);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) fail("symlink_rejected");
    if (i < components.length - 1 ? !stat.isDirectory() : !stat.isFile()) fail("not_plain_file");
  }
  const handle = await open(cursor, constants.O_RDONLY | (constants.O_NOFOLLOW || 0) | (constants.O_NONBLOCK || 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) fail("not_plain_or_oversized_file");
    return await handle.readFile("utf8");
  } finally { await handle.close(); }
}

async function plan(root) {
  if (sha256(await plain(root, "contracts/task-work-bug/v4/manifest.json")) !== "2a7a88aa8db122db00eb4c2cbea1e40b2770b6418448ac8c455d5ef5cb77fed4") fail("contract_digest_mismatch");
  const indexSource = await plain(root, relative);
  const categorySource = await plain(root, "docs/tasks/category_index.md");
  const project = await validateProject(root);
  if (project.indexSource !== indexSource || project.categorySource !== categorySource) fail("stale_source_revision");
  const documents = [];
  for (const record of project.index.records) documents.push([record.fileName, await plain(root, `docs/tasks/${record.fileName}`)]);
  const newline = indexSource.includes("\r\n") ? "\r\n" : "\n";
  if (indexSource.replaceAll("\r\n", "").includes("\r")) fail("unsupported_line_endings");
  const lines = indexSource.split(newline);
  const headings = lines.flatMap((line, i) => line.trim() === "## 상태 요약" ? [i] : []);
  if (headings.length !== 1) fail("ambiguous_status_summary");
  const start = headings[0] + 1;
  let end = start;
  while (end < lines.length && !lines[end].startsWith("## ")) end += 1;
  const seen = new Set();
  let lastRow = -1;
  for (let i = start; i < end; i += 1) {
    if (!lines[i].startsWith("| `")) continue;
    const cells = splitCells(lines[i]);
    const match = cells[1]?.match(/^`([^`]+)`$/u);
    const status = match?.[1];
    if (cells.length !== 5 || !STATUSES.has(status) || seen.has(status) || !/^\d+$/u.test(cells[2])) fail("invalid_status_summary");
    seen.add(status);
    const actual = project.index.records.filter((record) => record.status === status).map((record) => record.id).sort((a, b) => a - b);
    const listed = [...cells[3].matchAll(/\bTask ([1-9][0-9]*)\b/gu)].map((entry) => Number(entry[1])).sort((a, b) => a - b);
    if (Number(cells[2]) !== actual.length || JSON.stringify(actual) !== JSON.stringify(listed)) fail("status_summary_mismatch");
    lastRow = i;
  }
  if (lastRow < 0) fail("missing_status_summary_table");
  const missing = [...STATUSES].filter((status) => status !== "complete" && !seen.has(status));
  if (project.index.records.some((record) => !seen.has(record.status))) fail("nonempty_missing_summary_requires_review");
  lines.splice(lastRow + 1, 0, ...missing.map((status) => `| \`${status}\` | 0 | 없음 |`));
  const sourceRevision = `sha256:${sha256(JSON.stringify({ root, indexSource, categorySource, documents }))}`;
  return { sourceRevision, before: indexSource, after: lines.join(newline), missing };
}

async function exclusive(file, source) {
  const handle = await open(file, "wx", 0o600);
  try { await handle.writeFile(source); await handle.sync(); } finally { await handle.close(); }
}

try {
  if (typeof args.get("--root") !== "string" || args.has("--dry-run") === args.has("--write")) fail("usage_error");
  const requested = path.resolve(args.get("--root"));
  const stat = await lstat(requested);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("unsafe_project_root");
  const root = await realpath(requested);
  const preview = await plan(root);
  if (args.has("--dry-run")) {
    output("planned", "accepted", { root, sourceRevision: preview.sourceRevision, missingStatuses: preview.missing, writeSet: preview.missing.length ? [relative] : [], before: preview.before, after: preview.after, requiresWritersPaused: true });
  } else {
    // Historical v4 transitions do not acquire the shared lock. Require explicit quiescence too.
    if (!args.has("--writers-paused")) fail("writers_must_be_paused");
    if (args.get("--expected-source-revision") !== preview.sourceRevision) fail("stale_source_revision");
    const token = randomUUID();
    const lock = path.join(root, ".decal-slice-completion.lock");
    const owner = `${JSON.stringify({ schema: "decal.repository-lock/v1", pid: process.pid, token })}\n`;
    await exclusive(lock, owner);
    let retainLock = false;
    const target = path.join(root, relative);
    const recoveryDirectory = path.join(root, "docs/tasks", `.decal-summary-${token}`);
    const backup = path.join(recoveryDirectory, "index.before.md");
    const temporary = path.join(recoveryDirectory, "index.after.tmp");
    let directoryCreated = false;
    let moved = false;
    let tempCreated = false;
    try {
      const current = await plan(root);
      if (current.sourceRevision !== preview.sourceRevision) fail("stale_source_revision");
      if (current.missing.length) {
        await mkdir(recoveryDirectory, { mode: 0o700 });
        directoryCreated = true;
        await exclusive(temporary, current.after);
        tempCreated = true;
        if ((await plan(root)).sourceRevision !== preview.sourceRevision) fail("stale_source_revision");
        // The original inode is kept as a recovery backup. Never clobber a newly created target.
        await rename(target, backup);
        moved = true;
        if (await plain(root, path.relative(root, backup).split(path.sep).join("/")) !== current.before) fail("concurrent_source_change");
        await link(temporary, target);
        if (await plain(root, relative) !== current.after) fail("concurrent_source_change");
        await validateProject(root);
        if (await plain(root, path.relative(root, backup).split(path.sep).join("/")) !== current.before) fail("concurrent_source_change");
      }
      output("written", "accepted", { previousSourceRevision: preview.sourceRevision, sourceRevision: (await plan(root)).sourceRevision, writeSet: current.missing.length ? [relative] : [], backup: moved ? path.relative(root, backup) : null });
    } catch (error) {
      if (moved) {
        retainLock = true;
        // No guessed rollback: concurrent edits and the original inode both remain recoverable.
        output("rejected", "recovery_required", { cause: error.code || "write_failed", backup: path.relative(root, backup), lock: ".decal-slice-completion.lock" });
        process.exitCode = 2;
      } else throw error;
    } finally {
      if (tempCreated) await unlink(temporary);
      if (directoryCreated && !moved) await rmdir(recoveryDirectory);
      if (!retainLock && await readFile(lock, "utf8") === owner) await unlink(lock);
    }
  }
} catch (error) {
  output("rejected", error.code || "summary_repair_failed");
  process.exitCode = 2;
}
