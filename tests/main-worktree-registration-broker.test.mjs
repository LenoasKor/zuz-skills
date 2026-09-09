import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { repositoryRoot } from "../scripts/pack-lib.mjs";
import { verifyContract } from "../packs/decal-pack/src/contracts/task-work-bug/v10/verify-contract.mjs";

const sourceRoot = path.join(repositoryRoot, "packs/decal-pack/src");
const ticketWriter = path.join(sourceRoot, "contracts/task-work-bug/v10/register-ticket.mjs");
const taskWriter = path.join(sourceRoot, "contracts/task-work-bug/v10/register-task-batch.mjs");

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  const line = result.stdout.trim().split(/\r?\n/u).at(-1);
  let body = null;
  try { body = line ? JSON.parse(line) : null; } catch { body = null; }
  return { ...result, body };
}

async function repository() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zuz-its-v10-main-")));
  await cp(path.join(sourceRoot, "contracts"), path.join(root, "contracts"), { recursive: true });
  await cp(path.join(sourceRoot, "contracts/task-work-bug/v4/fixtures/project/docs"), path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "tracked.txt"), "base\n");
  assert.equal(run("git", ["init", "-q", "-b", "main"], root).status, 0);
  assert.equal(run("git", ["config", "user.email", "fixture@zuz.dev"], root).status, 0);
  assert.equal(run("git", ["config", "user.name", "zuz ITS fixture"], root).status, 0);
  assert.equal(run("git", ["add", "."], root).status, 0);
  assert.equal(run("git", ["commit", "-qm", "fixture"], root).status, 0);
  return root;
}

function workIntent() {
  return {
    schema: "decal.zuz-its.ticket-registration-intent/v9",
    intentId: "fixture-v10-worktree-work",
    kind: "work",
    title: "Feature worktree registration",
    priority: "P1",
    taskRefs: ["1"],
    versionImpact: "none",
    remoteVersionImpact: "none",
    releaseMode: "standalone",
    body: "## 범위\n\nmain 권한 작업공간에서 등록한다.\n",
  };
}

function taskIntent() {
  return {
    schema: "decal.task-work-bug.task-registration-batch-intent/v7",
    intentId: "fixture-v10-worktree-task",
    commitMessage: "docs(tasks): register v10 broker fixture",
    tasks: [{
      localRef: "task-v10",
      category: "product",
      slug: "v10_main_authority_broker",
      title: "V10 main authority broker",
      priority: "P1",
      areas: ["zuz ITS"],
      summary: "feature worktree를 보존하며 main에서 등록한다.",
      versionImpact: "none",
      remoteVersionImpact: "none",
      dependsOn: [1],
      body: "## Context Budget\n\n- v10 broker\n\n## 완료 기준\n\n- [ ] main 원자 등록\n",
    }],
  };
}

test("v10 contract manifest is valid", async () => {
  assert.equal((await verifyContract()).status, "accepted");
});

test("feature worktree delegates Task and Work registration to the existing main worktree", async () => {
  const mainRoot = await repository();
  const featureRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "zuz-its-v10-feature-")));
  await rm(featureRoot, { recursive: true, force: true });
  try {
    assert.equal(run("git", ["worktree", "add", "-q", "-b", "feature/broker-test", featureRoot], mainRoot).status, 0);
    const featureHead = run("git", ["rev-parse", "HEAD"], featureRoot).stdout.trim();
    await writeFile(path.join(featureRoot, "work-intent.json"), `${JSON.stringify(workIntent())}\n`);
    await writeFile(path.join(featureRoot, "task-intent.json"), `${JSON.stringify(taskIntent())}\n`);
    await writeFile(path.join(mainRoot, "tracked.txt"), "main dirty preserved\n");
    await writeFile(path.join(mainRoot, "untracked.txt"), "main untracked preserved\n");

    const preview = run(process.execPath, [ticketWriter, "--root", featureRoot, "--intent", path.join(featureRoot, "work-intent.json"), "--dry-run"], featureRoot);
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(preview.body.authority.delegated, true);
    assert.equal(preview.body.authority.requestedRoot, featureRoot);
    assert.equal(preview.body.authority.authorityRoot, mainRoot);
    assert.equal(preview.body.authority.callerWorktreePreserved, true);
    const written = run(process.execPath, [ticketWriter, "--root", featureRoot, "--intent", path.join(featureRoot, "work-intent.json"), "--approved-digest", preview.body.intentDigest, "--write"], featureRoot);
    assert.equal(written.status, 0, `${written.stderr}\n${JSON.stringify(written.body)}`);
    assert.equal(written.body.assigned.id, "WORK-1");
    assert.equal(written.body.authority.authorityRoot, mainRoot);

    const taskPreview = run(process.execPath, [taskWriter, "--root", featureRoot, "--intent", path.join(featureRoot, "task-intent.json"), "--dry-run"], featureRoot);
    assert.equal(taskPreview.status, 0, `${taskPreview.stderr}\n${JSON.stringify(taskPreview.body)}`);
    const taskWritten = run(process.execPath, [taskWriter, "--root", featureRoot, "--intent", path.join(featureRoot, "task-intent.json"), "--approved-digest", taskPreview.body.intentDigest, "--write"], featureRoot);
    assert.equal(taskWritten.status, 0, `${taskWritten.stderr}\n${JSON.stringify(taskWritten.body)}`);
    assert.equal(taskWritten.body.assigned[0].taskId, 2);
    assert.equal(taskWritten.body.authority.delegated, true);

    assert.equal(run("git", ["symbolic-ref", "--short", "HEAD"], featureRoot).stdout.trim(), "feature/broker-test");
    assert.equal(run("git", ["rev-parse", "HEAD"], featureRoot).stdout.trim(), featureHead);
    assert.equal(await readFile(path.join(mainRoot, "tracked.txt"), "utf8"), "main dirty preserved\n");
    assert.equal(await readFile(path.join(mainRoot, "untracked.txt"), "utf8"), "main untracked preserved\n");
    assert.equal(run("git", ["log", "-2", "--format=%s"], mainRoot).stdout.trim().split(/\r?\n/u).length, 2);
  } finally {
    run("git", ["worktree", "remove", "--force", featureRoot], mainRoot);
    await rm(mainRoot, { recursive: true, force: true });
    await rm(featureRoot, { recursive: true, force: true });
  }
});

test("v10 fails closed when no canonical main worktree exists", async () => {
  const root = await repository();
  try {
    assert.equal(run("git", ["switch", "-q", "-c", "feature/no-main"], root).status, 0);
    const intentPath = path.join(root, "intent.json");
    await writeFile(intentPath, `${JSON.stringify(workIntent())}\n`);
    const rejected = run(process.execPath, [ticketWriter, "--root", root, "--intent", intentPath, "--dry-run"], root);
    assert.equal(rejected.status, 2);
    assert.equal(rejected.body.code, "main_worktree_required");
    assert.equal(run("git", ["symbolic-ref", "--short", "HEAD"], root).stdout.trim(), "feature/no-main");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
