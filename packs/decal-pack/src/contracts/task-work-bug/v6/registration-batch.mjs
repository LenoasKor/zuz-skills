import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  parseCategories,
  parseIndex,
  plainFile,
  splitCells,
  validateProject,
} from "../v4/registry.mjs";

const execFileAsync = promisify(execFile);
const LOCK_FILE = ".decal-slice-completion.lock";
const JOURNAL_DIRECTORY = ".decal";
const JOURNAL_FILE = "task-registration-pending-v6.json";
const ABSENT_DIGEST = "absent";
const INTENT_SCHEMA = "decal.task-work-bug.task-registration-batch-intent/v6";
const RESULT_SCHEMA = "decal.task-work-bug.task-registration-batch/v6";
const PREDECESSOR_MANIFEST_SHA256 = "993f14fbf05591edb4aebd40778b09c1d6f83cae9222183798b575ecf6909983";

function fail(code, detail = null) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  throw error;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function canonicalJson(value) {
  return JSON.stringify(stableValue(value));
}

async function git(root, args, options = {}) {
  const result = await execFileAsync("git", ["-C", root, ...args], {
    encoding: options.encoding ?? "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.stdout;
}

async function lstatOrNull(target) {
  try {
    return await lstat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function validateV6Package(root) {
  const packageRoot = path.join(root, "contracts/task-work-bug/v6");
  const predecessor = await plainFile(path.join(root, "contracts/task-work-bug/v5/manifest.json"));
  if (sha256(predecessor) !== `sha256:${PREDECESSOR_MANIFEST_SHA256}`) fail("contract_digest_mismatch");
  const manifest = JSON.parse(await plainFile(path.join(packageRoot, "manifest.json")));
  if (manifest?.schema !== "decal.task-work-bug.fixture-manifest/v6" || !manifest.files) {
    fail("contract_digest_mismatch");
  }
  for (const [relative, expected] of Object.entries(manifest.files)) {
    if (sha256(await plainFile(path.join(packageRoot, relative))) !== `sha256:${expected}`) {
      fail("contract_digest_mismatch", relative);
    }
  }
}

async function assertPlainParentChain(root, target) {
  const relative = path.relative(root, target);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("path_escape", relative);
  }
  let current = root;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    const metadata = await lstatOrNull(current);
    if (metadata?.isSymbolicLink()) fail("symlink_rejected", relative);
  }
}

async function currentFileState(target) {
  const metadata = await lstatOrNull(target);
  if (!metadata) return { digest: ABSENT_DIGEST, source: null };
  if (metadata.isSymbolicLink()) fail("symlink_rejected", target);
  if (!metadata.isFile()) fail("not_plain_file", target);
  const source = await readFile(target, "utf8");
  return { digest: sha256(source), source };
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function acquireRepositoryLock(root, { timeoutMs = 30_000, retryMs = 40 } = {}) {
  const target = path.join(root, LOCK_FILE);
  const startedAt = Date.now();
  const owner = `${JSON.stringify({ schema: "decal.repository-lock/v1", pid: process.pid, token: randomUUID() })}\n`;
  while (true) {
    try {
      const handle = await open(target, "wx", 0o600);
      await handle.writeFile(owner, "utf8");
      await handle.close();
      return async () => {
        const current = await readFile(target, "utf8").catch(() => null);
        if (current === owner) await unlink(target);
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const metadata = await lstatOrNull(target);
      if (metadata?.isSymbolicLink() || (metadata && !metadata.isFile())) fail("unsafe_repository_lock");
      let ownerPid = null;
      try {
        ownerPid = JSON.parse(await readFile(target, "utf8")).pid;
      } catch {
        fail("unsafe_repository_lock");
      }
      if (Number.isSafeInteger(ownerPid) && ownerPid > 0) {
        try {
          process.kill(ownerPid, 0);
        } catch (presenceError) {
          if (presenceError?.code === "ESRCH") {
            await unlink(target);
            continue;
          }
        }
      }
      if (Date.now() - startedAt >= timeoutMs) fail("repository_lock_timeout");
      await sleep(retryMs);
    }
  }
}

function normalizeDependency(value) {
  if (Number.isSafeInteger(value) && value > 0) return { taskId: value };
  if (value && typeof value === "object" && /^[a-z][a-z0-9_-]{0,63}$/u.test(value.localRef ?? "")) {
    return { localRef: value.localRef };
  }
  fail("invalid_dependency");
}

export function normalizeTaskRegistrationBatchIntent(value) {
  if (!value || value.schema !== INTENT_SCHEMA) fail("invalid_intent");
  if (!/^[a-z0-9][a-z0-9-]{2,127}$/u.test(value.intentId ?? "")) fail("invalid_intent_id");
  if (!Array.isArray(value.tasks) || value.tasks.length < 1 || value.tasks.length > 32) fail("invalid_task_count");
  const localRefs = new Set();
  const tasks = value.tasks.map((task) => {
    if (!task || typeof task !== "object") fail("invalid_task_intent");
    for (const key of ["localRef", "category", "slug", "title", "priority", "summary", "body", "versionImpact", "remoteVersionImpact"]) {
      if (typeof task[key] !== "string" || !task[key].trim()) fail("invalid_task_intent", key);
    }
    if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(task.localRef)) fail("invalid_local_ref");
    if (localRefs.has(task.localRef)) fail("duplicate_local_ref");
    localRefs.add(task.localRef);
    if (!/^[a-z0-9][a-z0-9-]*$/u.test(task.category)) fail("invalid_category");
    if (!/^[a-z0-9][a-z0-9_]*$/u.test(task.slug)) fail("invalid_slug");
    if (!/^P[0-3](?:\s|$)/u.test(task.priority)) fail("invalid_priority");
    if (!Array.isArray(task.areas) || task.areas.length < 1 || task.areas.some((area) => typeof area !== "string" || !area.trim())) {
      fail("invalid_areas");
    }
    if (!task.body.trimStart().startsWith("## Context Budget")) fail("invalid_body");
    if (task.createdVersion !== undefined && !/^\d+\.\d+\.\d+$/u.test(task.createdVersion)) {
      fail("invalid_created_version");
    }
    return {
      localRef: task.localRef,
      category: task.category,
      slug: task.slug,
      title: task.title.trim(),
      priority: task.priority.trim(),
      areas: task.areas.map((area) => area.trim()),
      summary: task.summary.trim(),
      versionImpact: task.versionImpact.trim(),
      remoteVersionImpact: task.remoteVersionImpact.trim(),
      ...(task.createdVersion ? { createdVersion: task.createdVersion } : {}),
      dependsOn: (task.dependsOn ?? []).map(normalizeDependency),
      body: task.body.trim(),
    };
  });
  for (const task of tasks) {
    for (const dependency of task.dependsOn) {
      if (dependency.localRef && !localRefs.has(dependency.localRef)) fail("missing_local_ref");
      if (dependency.localRef === task.localRef) fail("self_dependency");
    }
  }
  const commitMessage = typeof value.commitMessage === "string" && value.commitMessage.trim()
    ? value.commitMessage.trim()
    : "docs(tasks): register approved task batch";
  if (commitMessage.length > 160 || /[\r\n\u0000-\u001f\u007f]/u.test(commitMessage)) {
    fail("invalid_commit_message");
  }
  return {
    schema: INTENT_SCHEMA,
    intentId: value.intentId,
    commitMessage,
    tasks,
  };
}

export function taskRegistrationBatchIntentDigest(intent) {
  return sha256(canonicalJson(normalizeTaskRegistrationBatchIntent(intent)));
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
  const heading = lines.findIndex((line) => line.trim() === "## 상태 요약");
  if (heading < 0) return source;
  for (let index = heading + 1; index < lines.length && !lines[index].startsWith("## "); index += 1) {
    if (!lines[index].startsWith("| `planned` |")) continue;
    const cells = splitCells(lines[index]);
    if (cells.length !== 5 || !/^\d+$/u.test(cells[2])) fail("invalid_status_summary");
    cells[2] = String(Number(cells[2]) + 1);
    cells[3] = cells[3] && cells[3] !== "없음" ? `${cells[3]}, Task ${taskId}` : `Task ${taskId}`;
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

function renderTask(intent, batchIntentId, taskId, categoryLabel, categoryIndex, dependencies) {
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
  if (dependencies.length > 0) lines.push("", `Depends On: [${dependencies.join(", ")}]`);
  lines.push("", `Registration Intent: ${batchIntentId}:${intent.localRef}`, "", intent.body, "");
  return lines.join("\n");
}

export async function planTaskRegistrationBatch(root, rawIntent) {
  const intent = normalizeTaskRegistrationBatchIntent(rawIntent);
  await validateV6Package(root);
  const project = await validateProject(root);
  const baseHead = String(await git(root, ["rev-parse", "HEAD"])).trim();
  const nextByCategory = new Map(
    [...project.categories.categories.entries()].map(([id, value]) => [id, value.nextIndex]),
  );
  let nextTaskId = Math.max(...project.index.records.map(({ id }) => id), 0) + 1;
  const existingTaskIds = new Set(project.index.records.map(({ id }) => id));
  const identityByLocalRef = new Map();
  for (const task of intent.tasks) {
    const category = project.categories.categories.get(task.category);
    if (!category) fail("unknown_category", task.category);
    const categoryIndex = nextByCategory.get(task.category);
    identityByLocalRef.set(task.localRef, { taskId: nextTaskId, categoryIndex, categoryLabel: category.label });
    nextTaskId += 1;
    nextByCategory.set(task.category, categoryIndex + 1);
  }
  let indexSource = project.indexSource;
  let categorySource = project.categorySource;
  const assigned = [];
  const files = [];
  for (const task of intent.tasks) {
    const identity = identityByLocalRef.get(task.localRef);
    const dependencyIds = task.dependsOn.map((dependency) => (
      dependency.taskId ?? identityByLocalRef.get(dependency.localRef)?.taskId
    ));
    if (task.dependsOn.some((dependency) => dependency.taskId && !existingTaskIds.has(dependency.taskId))) {
      fail("missing_task_dependency", task.localRef);
    }
    const fileName = `task_${identity.taskId}_${task.category.replaceAll("-", "_")}_${String(identity.categoryIndex).padStart(3, "0")}_${task.slug}.md`;
    const relative = `docs/tasks/${fileName}`;
    const target = path.join(root, ...relative.split("/"));
    if (await lstatOrNull(target)) fail("target_overlap", relative);
    const source = renderTask(task, intent.intentId, identity.taskId, identity.categoryLabel, identity.categoryIndex, dependencyIds);
    categorySource = updateCategory(categorySource, task.category, identity.categoryIndex);
    const row = `| [${identity.taskId} ${identity.categoryLabel} ${String(identity.categoryIndex).padStart(3, "0")} — ${task.title}](${fileName}) | \`planned\` | \`${task.priority}\` | ${task.areas.join(", ")} | ${task.summary} |`;
    indexSource = insertIndexRow(indexSource, row, task.createdVersion, identity.taskId);
    files.push({ relative, target, source, mustBeAbsent: true });
    assigned.push({
      localRef: task.localRef,
      taskId: identity.taskId,
      category: task.category,
      categoryIndex: identity.categoryIndex,
      path: relative,
      status: "planned",
      dependsOn: dependencyIds,
    });
  }
  files.push(
    { relative: "docs/tasks/index.md", target: project.paths.indexPath, source: indexSource, mustBeAbsent: false },
    { relative: "docs/tasks/category_index.md", target: project.paths.categoryPath, source: categorySource, mustBeAbsent: false },
  );
  return {
    intent,
    intentDigest: sha256(canonicalJson(intent)),
    baseHead,
    assigned,
    files,
    writeSet: files.map(({ relative }) => relative),
  };
}

async function assertGitBoundary(root) {
  const canonicalRoot = String(await git(root, ["rev-parse", "--show-toplevel"])).trim();
  if (await realpath(canonicalRoot) !== await realpath(root)) fail("invalid_repository_root");
  const branch = String(await git(root, ["branch", "--show-current"])).trim();
  if (branch !== "main") fail("main_branch_required", branch || "detached");
  const unmerged = String(await git(root, ["diff", "--name-only", "--diff-filter=U"])).trim();
  if (unmerged) fail("unmerged_paths_present");
  const staged = String(await git(root, ["diff", "--cached", "--name-only"])).trim();
  if (staged) fail("staged_changes_present");
  const gitDirectory = path.resolve(root, String(await git(root, ["rev-parse", "--git-dir"])).trim());
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"]) {
    if (await lstatOrNull(path.join(gitDirectory, marker))) fail("git_operation_in_progress", marker);
  }
}

async function assertHeadUnchanged(root, expected) {
  const current = String(await git(root, ["rev-parse", "HEAD"])).trim();
  if (current !== expected) fail("head_changed");
}

function journalPath(root) {
  return path.join(root, JOURNAL_DIRECTORY, JOURNAL_FILE);
}

async function writeJournal(root, journal) {
  const directory = path.join(root, JOURNAL_DIRECTORY);
  const metadata = await lstatOrNull(directory);
  if (metadata?.isSymbolicLink() || (metadata && !metadata.isDirectory())) fail("unsafe_journal_directory");
  if (!metadata) await mkdir(directory, { mode: 0o700 });
  const target = journalPath(root);
  const targetMetadata = await lstatOrNull(target);
  if (targetMetadata?.isSymbolicLink() || (targetMetadata && !targetMetadata.isFile())) fail("unsafe_journal");
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await rename(temporary, target);
}

async function readJournal(root) {
  const target = journalPath(root);
  const metadata = await lstatOrNull(target);
  if (!metadata) return null;
  if (metadata.isSymbolicLink() || !metadata.isFile()) fail("unsafe_journal");
  const journal = JSON.parse(await readFile(target, "utf8"));
  if (journal?.schema !== "decal.task-work-bug.task-registration-journal/v6" || !Array.isArray(journal.entries)) {
    fail("invalid_journal");
  }
  return journal;
}

async function restoreEntries(root, entries) {
  for (const entry of entries) {
    const target = path.join(root, ...entry.path.split("/"));
    await assertPlainParentChain(root, target);
    if (entry.before === null) await rm(target, { force: true });
    else await writeFile(target, Buffer.from(entry.before, "base64").toString("utf8"));
  }
}

async function commitForIntent(root, digest) {
  const commits = String(await git(root, [
    "log", "HEAD", "--format=%H", "--fixed-strings", "--grep", `Decal-Task-Registration-Intent: ${digest}`,
  ])).trim().split(/\r?\n/u).filter(Boolean);
  return commits[0] ?? null;
}

async function receiptFromCommit(root, digest, commit) {
  const changed = String(await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit]))
    .trim().split(/\r?\n/u).filter(Boolean);
  const taskPaths = changed.filter((entry) => /^docs\/tasks\/task_\d+_.+\.md$/u.test(entry));
  const assigned = [];
  for (const relative of taskPaths) {
    const source = String(await git(root, ["show", `${commit}:${relative}`]));
    const identity = /^# Task (\d+) · .*? · (\d+) — /mu.exec(source);
    const localRef = new RegExp(`^Registration Intent: [^:]+:([^\\s]+)$`, "mu").exec(source)?.[1];
    if (!identity || !localRef) fail("invalid_replay_commit");
    assigned.push({ localRef, taskId: Number(identity[1]), categoryIndex: Number(identity[2]), path: relative, status: "planned" });
  }
  if (assigned.length === 0 || !changed.includes("docs/tasks/index.md") || !changed.includes("docs/tasks/category_index.md")) {
    fail("invalid_replay_commit");
  }
  return { schema: RESULT_SCHEMA, status: "replayed", code: "accepted", intentDigest: digest, commit, assigned, writeSet: changed };
}

export async function recoverTaskRegistrationBatch(root) {
  const journal = await readJournal(root);
  if (!journal) return { state: "none" };
  const states = await Promise.all(journal.entries.map(async (entry) => (
    await currentFileState(path.join(root, ...entry.path.split("/")))
  )));
  const allBefore = states.every((state, index) => state.digest === journal.entries[index].beforeDigest);
  if (allBefore) {
    await unlink(journalPath(root));
    return { state: "cleaned" };
  }
  const allAfter = states.every((state, index) => state.digest === journal.entries[index].afterDigest);
  if (!allAfter) fail("recovery_mixed_state");
  const commit = await commitForIntent(root, journal.intentDigest);
  if (commit) {
    await unlink(journalPath(root));
    return { state: "committed", receipt: await receiptFromCommit(root, journal.intentDigest, commit) };
  }
  await restoreEntries(root, journal.entries);
  await unlink(journalPath(root));
  return { state: "rolled_back" };
}

async function atomicWritePlan(root, entries) {
  const token = randomUUID();
  const temporaries = [];
  try {
    for (const entry of entries) {
      await assertPlainParentChain(root, entry.target);
      const current = await currentFileState(entry.target);
      if (entry.mustBeAbsent && current.source !== null) fail("target_overlap", entry.relative);
      if (current.digest !== entry.beforeDigest) fail("precondition_changed", entry.relative);
      const temporary = `${entry.target}.decal-${token}.tmp`;
      await writeFile(temporary, entry.source, { flag: "wx" });
      temporaries.push(temporary);
    }
    for (let index = 0; index < entries.length; index += 1) await rename(temporaries[index], entries[index].target);
  } catch (error) {
    for (const temporary of temporaries) await rm(temporary, { force: true });
    throw error;
  }
}

async function verifyExactCommit(root, commit, plan) {
  const changed = String(await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", commit]))
    .trim().split(/\r?\n/u).filter(Boolean).sort();
  const expected = [...plan.writeSet].sort();
  if (changed.length !== expected.length || changed.some((entry, index) => entry !== expected[index])) {
    fail("commit_write_set_mismatch");
  }
  for (const entry of plan.files) {
    const committed = await git(root, ["show", `${commit}:${entry.relative}`], { encoding: "buffer" });
    if (sha256(committed) !== sha256(entry.source)) fail("commit_content_mismatch", entry.relative);
    const working = await currentFileState(entry.target);
    if (working.digest !== sha256(entry.source)) fail("working_tree_changed", entry.relative);
  }
}

export async function registerTaskBatch({ root, intent: rawIntent, approvedDigest, testFailAt = null }) {
  const intent = normalizeTaskRegistrationBatchIntent(rawIntent);
  const intentDigest = sha256(canonicalJson(intent));
  if (approvedDigest !== intentDigest) fail("approval_digest_mismatch");
  const release = await acquireRepositoryLock(root);
  try {
    const recovered = await recoverTaskRegistrationBatch(root);
    if (recovered.receipt?.intentDigest === intentDigest) return recovered.receipt;
    await assertGitBoundary(root);
    const replayCommit = await commitForIntent(root, intentDigest);
    if (replayCommit) return receiptFromCommit(root, intentDigest, replayCommit);
    const plan = await planTaskRegistrationBatch(root, intent);
    if (plan.intentDigest !== approvedDigest) fail("approval_digest_mismatch");
    const entries = [];
    for (const file of plan.files) {
      const before = await currentFileState(file.target);
      entries.push({
        ...file,
        beforeDigest: before.digest,
        afterDigest: sha256(file.source),
        before: before.source === null ? null : Buffer.from(before.source).toString("base64"),
      });
    }
    const journal = {
      schema: "decal.task-work-bug.task-registration-journal/v6",
      phase: "preparing",
      transactionId: randomUUID(),
      intentDigest,
      baseHead: plan.baseHead,
      entries: entries.map(({ relative, before, beforeDigest, afterDigest }) => ({
        path: relative, before, beforeDigest, afterDigest,
      })),
    };
    await writeJournal(root, journal);
    try {
      await atomicWritePlan(root, entries);
      await validateProject(root);
      await writeJournal(root, { ...journal, phase: "sealed" });
      if (testFailAt === "after_write") fail("injected_failure");
      if (testFailAt === "after_write_and_advance_head") {
        await git(root, ["commit", "--allow-empty", "-m", "test: advance head during task registration"]);
      }
      await assertHeadUnchanged(root, plan.baseHead);
      await git(root, ["add", "--", ...plan.writeSet]);
      const staged = String(await git(root, ["diff", "--cached", "--name-only"])).trim().split(/\r?\n/u).filter(Boolean).sort();
      const expected = [...plan.writeSet].sort();
      if (staged.length !== expected.length || staged.some((entry, index) => entry !== expected[index])) {
        fail("staged_write_set_mismatch");
      }
      await git(root, [
        "commit", "--only", "-m", intent.commitMessage,
        "-m", `Decal-Task-Registration-Intent: ${intentDigest}`,
        "--", ...plan.writeSet,
      ]);
      if (testFailAt === "after_commit") fail("injected_failure");
      const commit = String(await git(root, ["rev-parse", "HEAD"])).trim();
      await verifyExactCommit(root, commit, plan);
      await unlink(journalPath(root));
      return {
        schema: RESULT_SCHEMA,
        status: "committed",
        code: "accepted",
        intentDigest,
        baseHead: plan.baseHead,
        commit,
        assigned: plan.assigned,
        writeSet: plan.writeSet,
      };
    } catch (error) {
      const committed = await commitForIntent(root, intentDigest).catch(() => null);
      if (committed) throw error;
      await git(root, ["restore", "--staged", "--", ...plan.writeSet]).catch(() => undefined);
      await recoverTaskRegistrationBatch(root);
      throw error;
    }
  } finally {
    await release();
  }
}

export const taskRegistrationBatchResultSchema = RESULT_SCHEMA;
