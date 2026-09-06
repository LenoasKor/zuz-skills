import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot } from "../scripts/pack-lib.mjs";

export function command(root, file, ...args) {
  const result = spawnSync(process.execPath, [join(root, "contracts/task-work-bug", file), "--root", root, ...args], { encoding: "utf8" });
  return { ...result, value: JSON.parse(result.stdout.trim().split("\n").at(-1)) };
}

export async function fixture(legacy = false) {
  const root = await mkdtemp(join(tmpdir(), "decal-bug162-"));
  await cp(join(repositoryRoot, "packs/decal-pack/src/contracts"), join(root, "contracts"), { recursive: true });
  const intent = join(root, "contracts/task-work-bug/task-registry-initialization-intent.json");
  const plan = command(root, "initialize-task-registry.mjs", "--intent", intent, "--dry-run");
  assert.equal(plan.status, 0, JSON.stringify(plan.value));
  const init = command(root, "initialize-task-registry.mjs", "--intent", intent, "--expected-source-revision", plan.value.sourceRevision, "--write");
  assert.equal(init.status, 0, JSON.stringify(init.value));
  if (legacy) {
    const file = join(root, "docs/tasks/index.md");
    const source = await readFile(file, "utf8");
    await writeFile(file, source.replace(/^\| `([^`]+)` \|.*\n/gm, (line, status) => status === "planned" ? line.replace("없음", "등록된 Task 없음") : ""));
  }
  for (const args of [["init", "-b", "main"], ["config", "user.email", "fixture@decal.test"], ["config", "user.name", "Fixture"], ["add", "."], ["commit", "-m", "fixture"]]) {
    assert.equal(spawnSync("git", args, { cwd: root, encoding: "utf8" }).status, 0);
  }
  const registration = {
    schema: "decal.task-work-bug.task-registration-batch-intent/v7", intentId: "bug162-first-task", commitMessage: "docs: fixture task",
    tasks: [{ localRef: "first", category: "product", slug: "first_task", title: "First task", priority: "P1", areas: ["zuz ITS"], summary: "Fixture", versionImpact: "desktop-minor", remoteVersionImpact: "none", body: "## Context Budget\n\n- Fixture only\n\n## 완료 기준\n\n- [ ] Fixture\n" }],
  };
  const request = join(root, "registration.json");
  await writeFile(request, JSON.stringify(registration));
  const preview = command(root, "v7/register-task-batch.mjs", "--intent", request, "--dry-run");
  assert.equal(preview.status, 0, JSON.stringify(preview.value));
  const registered = command(root, "v7/register-task-batch.mjs", "--intent", request, "--approved-digest", preview.value.intentDigest, "--write");
  assert.equal(registered.status, 0, JSON.stringify(registered.value));
  return root;
}

test("BUG-162: official initialization and v7 registration permit first v4 transition", async () => {
  const root = await fixture();
  try {
    const preview = command(root, "v4/transition-task.mjs", "--task", "1", "--to", "in_progress", "--dry-run");
    assert.equal(preview.status, 0, JSON.stringify(preview.value));
    const result = command(root, "v4/transition-task.mjs", "--task", "1", "--to", "in_progress", "--expected-source-revision", preview.value.sourceRevision, "--write");
    assert.equal(result.status, 0, JSON.stringify(result.value));
    assert.match(await readFile(join(root, "docs/tasks/index.md"), "utf8"), /\| `in_progress` \| 1 \| Task 1 \|/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

const repairFile = "repair-task-registry-summary.mjs";
const repair = (root, ...args) => command(root, repairFile, ...args);

test("legacy initialized registry repair preserves records and annotations, then permits transition", async () => {
  const root = await fixture(true);
  try {
    assert.equal(command(root, "v4/transition-task.mjs", "--task", "1", "--to", "in_progress", "--dry-run").value.code, "missing_status_summary_row");
    const index = join(root, "docs/tasks/index.md");
    await writeFile(index, `${await readFile(index, "utf8")}\n## 사용자 메모\n\n그대로 유지합니다.\n`);
    const before = await readFile(index, "utf8");
    const taskFile = (await readdir(join(root, "docs/tasks"))).find((file) => file.startsWith("task_"));
    const taskBefore = await readFile(join(root, "docs/tasks", taskFile), "utf8");
    const categoryBefore = await readFile(join(root, "docs/tasks/category_index.md"), "utf8");
    const preview = repair(root, "--dry-run");
    assert.equal(preview.status, 0, JSON.stringify(preview.value));
    assert.ok(preview.value.missingStatuses.includes("in_progress"));
    assert.equal(await readFile(index, "utf8"), before);
    assert.equal(repair(root, "--expected-source-revision", preview.value.sourceRevision, "--write").value.code, "writers_must_be_paused");
    const result = repair(root, "--expected-source-revision", preview.value.sourceRevision, "--writers-paused", "--write");
    assert.equal(result.status, 0, JSON.stringify(result.value));
    assert.equal(await readFile(join(root, result.value.backup), "utf8"), before);
    assert.equal(await readFile(join(root, "docs/tasks", taskFile), "utf8"), taskBefore);
    assert.equal(await readFile(join(root, "docs/tasks/category_index.md"), "utf8"), categoryBefore);
    assert.equal(await readFile(index, "utf8"), preview.value.after);
    assert.ok(preview.value.after.endsWith("## 사용자 메모\n\n그대로 유지합니다.\n"));
    const retry = repair(root, "--dry-run");
    assert.deepEqual(retry.value.writeSet, []);
    const noOp = repair(root, "--expected-source-revision", retry.value.sourceRevision, "--writers-paused", "--write");
    assert.equal(noOp.status, 0);
    assert.deepEqual(noOp.value.writeSet, []);
    assert.equal(noOp.value.backup, null);
    const start = command(root, "v4/transition-task.mjs", "--task", "1", "--to", "in_progress", "--dry-run");
    assert.equal(start.status, 0, JSON.stringify(start.value));
    assert.equal(command(root, "v4/transition-task.mjs", "--task", "1", "--to", "in_progress", "--expected-source-revision", start.value.sourceRevision, "--write").status, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repair rejects stale index, category or Task bytes and an occupied shared lock", async () => {
  const root = await fixture(true);
  try {
    const task = (await readdir(join(root, "docs/tasks"))).find((file) => file.startsWith("task_"));
    const index = join(root, "docs/tasks/index.md");
    for (const file of [index, join(root, "docs/tasks/category_index.md"), join(root, "docs/tasks", task)]) {
      const before = await readFile(file, "utf8");
      const plan = repair(root, "--dry-run");
      const changed = `${before}\n## User edit\n`;
      await writeFile(file, changed);
      assert.equal(repair(root, "--expected-source-revision", plan.value.sourceRevision, "--writers-paused", "--write").value.code, "stale_source_revision");
      assert.equal(await readFile(file, "utf8"), changed);
      await writeFile(file, before);
    }
    const plan = repair(root, "--dry-run");
    const lock = join(root, ".decal-slice-completion.lock");
    await writeFile(lock, "other owner\n");
    assert.equal(repair(root, "--expected-source-revision", plan.value.sourceRevision, "--writers-paused", "--write").value.code, "EEXIST");
    assert.equal(await readFile(lock, "utf8"), "other owner\n");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repair rejects duplicate, inconsistent or unknown summary rows and symlinks", async () => {
  const root = await fixture(true);
  try {
    const index = join(root, "docs/tasks/index.md");
    const original = await readFile(index, "utf8");
    const row = original.split("\n").find((line) => line.startsWith("| `planned` |"));
    for (const changed of [original.replace(row, `${row}\n${row}`), original.replace("| `planned` | 1 |", "| `planned` | 99 |"), original.replace(row, `${row}\n| \`future_status\` | 0 | 없음 |`)]) {
      await writeFile(index, changed);
      assert.equal(repair(root, "--dry-run").status, 2);
      assert.equal(await readFile(index, "utf8"), changed);
    }
    await writeFile(index, original);
    const outside = join(root, "outside.md");
    await writeFile(outside, original);
    await rm(index);
    await symlink(outside, index);
    assert.equal(repair(root, "--dry-run").value.code, "symlink_rejected");
    assert.equal(await readFile(outside, "utf8"), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("concurrent replacement is never overwritten and retains recovery backup and lock", async () => {
  const root = await fixture(true);
  try {
    const preview = repair(root, "--dry-run");
    const index = join(root, "docs/tasks/index.md");
    const before = await readFile(index, "utf8");
    const injection = `import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; const original=fs.rename; fs.rename=async(a,b)=>{await original(a,b); if(a.endsWith('/docs/tasks/index.md'))await fs.writeFile(a,'concurrent user bytes\\n',{flag:'wx'});}; syncBuiltinESMExports();`;
    const result = spawnSync(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(injection)}`, join(root, "contracts/task-work-bug", repairFile), "--root", root, "--expected-source-revision", preview.value.sourceRevision, "--writers-paused", "--write"], { encoding: "utf8" });
    const body = JSON.parse(result.stdout);
    assert.equal(body.code, "recovery_required");
    assert.equal(await readFile(index, "utf8"), "concurrent user bytes\n");
    assert.equal(await readFile(join(root, body.backup), "utf8"), before);
    assert.equal((await lstat(join(root, body.lock))).isFile(), true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("repair rejects modified pinned contracts and symlinked parent directories", async () => {
  const root = await fixture(true);
  try {
    const manifest = join(root, "contracts/task-work-bug/v4/manifest.json");
    const before = await readFile(manifest, "utf8");
    await writeFile(manifest, before.replace("fixture-manifest/v4", "fixture-manifest/v99"));
    assert.equal(repair(root, "--dry-run").status, 2);
    await writeFile(manifest, before);
    await rename(join(root, "docs/tasks"), join(root, "saved-tasks"));
    await symlink(join(root, "saved-tasks"), join(root, "docs/tasks"));
    assert.equal(repair(root, "--dry-run").value.code, "symlink_rejected");
  } finally { await rm(root, { recursive: true, force: true }); }
});
