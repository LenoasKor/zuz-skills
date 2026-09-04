import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceContractRoot = path.join(repositoryRoot, "packs/decal-pack/src/contracts/task-work-bug");
const contractRoot = path.join(sourceContractRoot, "v6");
const {
  registerTaskBatch,
  recoverTaskRegistrationBatch,
  taskRegistrationBatchIntentDigest,
} = await import("../packs/decal-pack/src/contracts/task-work-bug/v6/registration-batch.mjs");

async function collectFiles(directory, relativeRoot = "") {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, name);
    const relative = relativeRoot ? `${relativeRoot}/${name}` : name;
    const metadata = await lstat(absolute);
    assert.equal(metadata.isSymbolicLink(), false, relative);
    if (metadata.isDirectory()) files.push(...await collectFiles(absolute, relative));
    else files.push(relative);
  }
  return files;
}

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
  const line = result.stdout.trim().split(/\r?\n/u).at(-1);
  let body = null;
  try {
    body = line ? JSON.parse(line) : null;
  } catch {
    body = null;
  }
  return { ...result, body };
}

function runWithInput(command, args, cwd, input) {
  return spawnSync(command, args, { cwd, input, encoding: "utf8" });
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

async function writeRecoveryJournal(root, intentDigest, entries) {
  await mkdir(path.join(root, ".decal"), { recursive: true });
  await writeFile(path.join(root, ".decal/task-registration-pending-v6.json"), `${JSON.stringify({
    schema: "decal.task-work-bug.task-registration-journal/v6",
    phase: "sealed",
    transactionId: "fixture-recovery",
    intentDigest,
    baseHead: run("git", ["rev-parse", "HEAD"], root).stdout.trim(),
    entries,
  }, null, 2)}\n`);
}

function runAsync(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (status) => {
      const line = stdout.trim().split(/\r?\n/u).at(-1);
      resolve({ status, stdout, stderr, body: line ? JSON.parse(line) : null });
    });
  });
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "decal-task-v6-"));
  await cp(sourceContractRoot, path.join(root, "contracts/task-work-bug"), { recursive: true });
  await cp(
    path.join(sourceContractRoot, "v4/fixtures/project/docs"),
    path.join(root, "docs"),
    { recursive: true },
  );
  await writeFile(path.join(root, "tracked-outside.txt"), "base\n");
  assert.equal(run("git", ["init", "-b", "main"], root).status, 0);
  assert.equal(run("git", ["config", "user.email", "fixture@decal.test"], root).status, 0);
  assert.equal(run("git", ["config", "user.name", "Decal Fixture"], root).status, 0);
  assert.equal(run("git", ["add", "."], root).status, 0);
  assert.equal(run("git", ["commit", "-m", "fixture base"], root).status, 0);
  return root;
}

const writerRelative = "contracts/task-work-bug/v6/register-task-batch.mjs";
const intentRelative = "contracts/task-work-bug/v6/fixtures/task-batch-intent.json";
const manifest = JSON.parse(await readFile(path.join(contractRoot, "manifest.json"), "utf8"));
assert.equal(manifest.schema, "decal.task-work-bug.fixture-manifest/v6");
assert.deepEqual(
  (await collectFiles(contractRoot)).filter((relative) => relative !== "manifest.json"),
  Object.keys(manifest.files).sort(),
);
for (const [relative, expected] of Object.entries(manifest.files)) {
  assert.equal(createHash("sha256").update(await readFile(path.join(contractRoot, relative))).digest("hex"), expected, relative);
}
const root = await fixture();
try {
  const writer = path.join(root, writerRelative);
  const intent = path.join(root, intentRelative);
  await writeFile(path.join(root, "unrelated.txt"), "preserve me\n");
  await writeFile(path.join(root, "tracked-outside.txt"), "dirty but preserved\n");
  const preview = run(process.execPath, [writer, "--root", root, "--intent", intent, "--dry-run"], root);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.body.status, "planned");
  assert.match(preview.body.intentDigest, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(preview.body.assigned.map(({ taskId, categoryIndex }) => ({ taskId, categoryIndex })), [
    { taskId: 2, categoryIndex: 2 },
    { taskId: 3, categoryIndex: 3 },
  ]);
  const rejected = run(process.execPath, [
    writer, "--root", root, "--intent", intent,
    "--approved-digest", `sha256:${"0".repeat(64)}`, "--write",
  ], root);
  assert.equal(rejected.status, 2);
  assert.equal(rejected.body.code, "approval_digest_mismatch");
  const written = run(process.execPath, [
    writer, "--root", root, "--intent", intent,
    "--approved-digest", preview.body.intentDigest, "--write",
  ], root);
  assert.equal(written.status, 0, `${written.stderr}\n${JSON.stringify(written.body)}`);
  assert.equal(written.body.status, "committed");
  assert.equal(await readFile(path.join(root, "unrelated.txt"), "utf8"), "preserve me\n");
  assert.equal(await readFile(path.join(root, "tracked-outside.txt"), "utf8"), "dirty but preserved\n");
  assert.match(
    await readFile(path.join(root, written.body.assigned[1].path), "utf8"),
    /^Depends On: \[2\]$/mu,
  );
  const committedPaths = run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], root)
    .stdout.trim().split(/\r?\n/u).sort();
  assert.deepEqual(committedPaths, [...written.body.writeSet].sort());
  const replay = run(process.execPath, [
    writer, "--root", root, "--intent", intent,
    "--approved-digest", preview.body.intentDigest, "--write",
  ], root);
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(replay.body.status, "replayed");
  assert.equal(replay.body.commit, written.body.commit);
  assert.equal(run("git", ["rev-list", "--count", "HEAD"], root).stdout.trim(), "2");

  await writeFile(path.join(root, "staged.txt"), "blocked\n");
  assert.equal(run("git", ["add", "staged.txt"], root).status, 0);
  const changedIntent = JSON.parse(await readFile(intent, "utf8"));
  changedIntent.intentId = "fixture-staged-rejection";
  changedIntent.tasks = [changedIntent.tasks[0]];
  const changedIntentPath = path.join(root, "changed-intent.json");
  await writeFile(changedIntentPath, `${JSON.stringify(changedIntent, null, 2)}\n`);
  const changedPreview = run(process.execPath, [writer, "--root", root, "--intent", changedIntentPath, "--dry-run"], root);
  const stagedRejected = run(process.execPath, [
    writer, "--root", root, "--intent", changedIntentPath,
    "--approved-digest", changedPreview.body.intentDigest, "--write",
  ], root);
  assert.equal(stagedRejected.status, 2);
  assert.equal(stagedRejected.body.code, "staged_changes_present");
  assert.equal(run("git", ["restore", "--staged", "staged.txt"], root).status, 0);

  const baseIntent = JSON.parse(await readFile(intent, "utf8"));
  const concurrentIntents = ["alpha", "beta"].map((suffix) => ({
    ...baseIntent,
    intentId: `fixture-concurrent-${suffix}`,
    commitMessage: `docs(tasks): register concurrent ${suffix}`,
    tasks: [{
      ...baseIntent.tasks[0],
      localRef: suffix,
      slug: `concurrent_${suffix}`,
      title: `Concurrent ${suffix}`,
    }],
  }));
  const concurrentPaths = [];
  const concurrentPreviews = [];
  for (const [index, concurrentIntent] of concurrentIntents.entries()) {
    const target = path.join(root, `concurrent-${index}.json`);
    await writeFile(target, `${JSON.stringify(concurrentIntent, null, 2)}\n`);
    concurrentPaths.push(target);
    concurrentPreviews.push(run(process.execPath, [writer, "--root", root, "--intent", target, "--dry-run"], root));
  }
  assert.deepEqual(concurrentPreviews.map((previewResult) => previewResult.body.assigned[0].taskId), [4, 4]);
  const concurrentResults = await Promise.all(concurrentPaths.map((target, index) => runAsync(process.execPath, [
    writer, "--root", root, "--intent", target,
    "--approved-digest", concurrentPreviews[index].body.intentDigest, "--write",
  ], root)));
  assert.equal(concurrentResults.every((result) => result.status === 0), true, JSON.stringify(concurrentResults));
  assert.deepEqual(
    concurrentResults.map((result) => result.body.assigned[0].taskId).sort((left, right) => left - right),
    [4, 5],
  );

  const rollbackIntent = {
    ...baseIntent,
    intentId: "fixture-rollback",
    commitMessage: "docs(tasks): must roll back",
    tasks: [{
      ...baseIntent.tasks[0],
      localRef: "rollback",
      slug: "rollback_fixture",
      title: "Rollback fixture",
    }],
  };
  const indexBeforeRollback = await readFile(path.join(root, "docs/tasks/index.md"), "utf8");
  const categoryBeforeRollback = await readFile(path.join(root, "docs/tasks/category_index.md"), "utf8");
  await assert.rejects(
    registerTaskBatch({
      root,
      intent: rollbackIntent,
      approvedDigest: taskRegistrationBatchIntentDigest(rollbackIntent),
      testFailAt: "after_write",
    }),
    (error) => error?.code === "injected_failure",
  );
  assert.equal(await readFile(path.join(root, "docs/tasks/index.md"), "utf8"), indexBeforeRollback);
  assert.equal(await readFile(path.join(root, "docs/tasks/category_index.md"), "utf8"), categoryBeforeRollback);
  assert.equal(run("git", ["status", "--short", "docs/tasks"], root).stdout.trim(), "");
  await assert.rejects(readFile(path.join(root, "docs/tasks/task_6_product_006_rollback_fixture.md")));

  const headChangeIntent = {
    ...baseIntent,
    intentId: "fixture-head-change",
    commitMessage: "docs(tasks): reject changed head",
    tasks: [{
      ...baseIntent.tasks[0],
      localRef: "head-change",
      slug: "head_change_fixture",
      title: "Head change fixture",
    }],
  };
  const headBeforeChange = run("git", ["rev-parse", "HEAD"], root).stdout.trim();
  await assert.rejects(
    registerTaskBatch({
      root,
      intent: headChangeIntent,
      approvedDigest: taskRegistrationBatchIntentDigest(headChangeIntent),
      testFailAt: "after_write_and_advance_head",
    }),
    (error) => error?.code === "head_changed",
  );
  assert.notEqual(run("git", ["rev-parse", "HEAD"], root).stdout.trim(), headBeforeChange);
  assert.equal(run("git", ["status", "--short", "docs/tasks"], root).stdout.trim(), "");
  await assert.rejects(readFile(path.join(root, "docs/tasks/task_6_product_006_head_change_fixture.md")));

  const committedRecoveryIntent = {
    ...baseIntent,
    intentId: "fixture-committed-recovery",
    commitMessage: "docs(tasks): recover committed transaction",
    tasks: [{
      ...baseIntent.tasks[0],
      localRef: "committed-recovery",
      slug: "committed_recovery_fixture",
      title: "Committed recovery fixture",
    }],
  };
  const committedRecoveryDigest = taskRegistrationBatchIntentDigest(committedRecoveryIntent);
  await assert.rejects(
    registerTaskBatch({
      root,
      intent: committedRecoveryIntent,
      approvedDigest: committedRecoveryDigest,
      testFailAt: "after_commit",
    }),
    (error) => error?.code === "injected_failure",
  );
  assert.equal((await lstat(path.join(root, ".decal/task-registration-pending-v6.json"))).isFile(), true);
  const recoveredCommit = await registerTaskBatch({
    root,
    intent: committedRecoveryIntent,
    approvedDigest: committedRecoveryDigest,
  });
  assert.equal(recoveredCommit.status, "replayed");
  await assert.rejects(lstat(path.join(root, ".decal/task-registration-pending-v6.json")), (error) => error?.code === "ENOENT");
} finally {
  await rm(root, { recursive: true, force: true });
}

const recoveryRoot = await fixture();
try {
  const indexPath = "docs/tasks/index.md";
  const categoryPath = "docs/tasks/category_index.md";
  const indexBefore = await readFile(path.join(recoveryRoot, indexPath), "utf8");
  const categoryBefore = await readFile(path.join(recoveryRoot, categoryPath), "utf8");
  const indexAfter = `${indexBefore}\n<!-- recovery after -->\n`;
  const categoryAfter = `${categoryBefore}\n<!-- recovery after -->\n`;
  const beforeEntry = {
    path: indexPath,
    before: Buffer.from(indexBefore).toString("base64"),
    beforeDigest: digest(indexBefore),
    afterDigest: digest(indexAfter),
  };
  await writeRecoveryJournal(recoveryRoot, `sha256:${"1".repeat(64)}`, [beforeEntry]);
  assert.deepEqual(await recoverTaskRegistrationBatch(recoveryRoot), { state: "cleaned" });

  await writeFile(path.join(recoveryRoot, indexPath), indexAfter);
  await writeRecoveryJournal(recoveryRoot, `sha256:${"2".repeat(64)}`, [beforeEntry]);
  assert.deepEqual(await recoverTaskRegistrationBatch(recoveryRoot), { state: "rolled_back" });
  assert.equal(await readFile(path.join(recoveryRoot, indexPath), "utf8"), indexBefore);

  await writeFile(path.join(recoveryRoot, indexPath), indexAfter);
  await writeRecoveryJournal(recoveryRoot, `sha256:${"3".repeat(64)}`, [
    beforeEntry,
    {
      path: categoryPath,
      before: Buffer.from(categoryBefore).toString("base64"),
      beforeDigest: digest(categoryBefore),
      afterDigest: digest(categoryAfter),
    },
  ]);
  await assert.rejects(
    recoverTaskRegistrationBatch(recoveryRoot),
    (error) => error?.code === "recovery_mixed_state",
  );
  assert.equal((await lstat(path.join(recoveryRoot, ".decal/task-registration-pending-v6.json"))).isFile(), true);
} finally {
  await rm(recoveryRoot, { recursive: true, force: true });
}

const overlapRoot = await fixture();
try {
  const intent = JSON.parse(await readFile(path.join(overlapRoot, intentRelative), "utf8"));
  const writer = path.join(overlapRoot, writerRelative);
  const preview = run(process.execPath, [writer, "--root", overlapRoot, "--intent", path.join(overlapRoot, intentRelative), "--dry-run"], overlapRoot);
  await writeFile(path.join(overlapRoot, preview.body.assigned[0].path), "occupied\n");
  const rejected = run(process.execPath, [
    writer, "--root", overlapRoot, "--intent", path.join(overlapRoot, intentRelative),
    "--approved-digest", taskRegistrationBatchIntentDigest(intent), "--write",
  ], overlapRoot);
  assert.equal(rejected.status, 2);
  assert.equal(rejected.body.code, "target_overlap");
  assert.equal(await readFile(path.join(overlapRoot, preview.body.assigned[0].path), "utf8"), "occupied\n");
} finally {
  await rm(overlapRoot, { recursive: true, force: true });
}

const symlinkRoot = await fixture();
try {
  const writer = path.join(symlinkRoot, writerRelative);
  const intent = path.join(symlinkRoot, intentRelative);
  const preview = run(process.execPath, [writer, "--root", symlinkRoot, "--intent", intent, "--dry-run"], symlinkRoot);
  await mkdir(path.join(symlinkRoot, ".decal-target"));
  await symlink(".decal-target", path.join(symlinkRoot, ".decal"));
  const rejected = run(process.execPath, [
    writer, "--root", symlinkRoot, "--intent", intent,
    "--approved-digest", preview.body.intentDigest, "--write",
  ], symlinkRoot);
  assert.equal(rejected.status, 2);
  assert.equal(rejected.body.code, "unsafe_journal_directory");
} finally {
  await rm(symlinkRoot, { recursive: true, force: true });
}

const operationRoot = await fixture();
try {
  const writer = path.join(operationRoot, writerRelative);
  const intent = path.join(operationRoot, intentRelative);
  const preview = run(process.execPath, [writer, "--root", operationRoot, "--intent", intent, "--dry-run"], operationRoot);
  const gitDirectory = path.resolve(operationRoot, run("git", ["rev-parse", "--git-dir"], operationRoot).stdout.trim());
  await writeFile(path.join(gitDirectory, "REVERT_HEAD"), `${run("git", ["rev-parse", "HEAD"], operationRoot).stdout.trim()}\n`);
  const rejected = run(process.execPath, [
    writer, "--root", operationRoot, "--intent", intent,
    "--approved-digest", preview.body.intentDigest, "--write",
  ], operationRoot);
  assert.equal(rejected.status, 2);
  assert.equal(rejected.body.code, "git_operation_in_progress");
  await unlink(path.join(gitDirectory, "REVERT_HEAD"));
} finally {
  await rm(operationRoot, { recursive: true, force: true });
}

const unmergedRoot = await fixture();
try {
  const writer = path.join(unmergedRoot, writerRelative);
  const intent = path.join(unmergedRoot, intentRelative);
  const preview = run(process.execPath, [writer, "--root", unmergedRoot, "--intent", intent, "--dry-run"], unmergedRoot);
  const baseBlob = run("git", ["rev-parse", "HEAD:tracked-outside.txt"], unmergedRoot).stdout.trim();
  const oursBlob = runWithInput("git", ["hash-object", "-w", "--stdin"], unmergedRoot, "ours\n").stdout.trim();
  const theirsBlob = runWithInput("git", ["hash-object", "-w", "--stdin"], unmergedRoot, "theirs\n").stdout.trim();
  const conflict = [
    `100644 ${baseBlob} 1\ttracked-outside.txt`,
    `100644 ${oursBlob} 2\ttracked-outside.txt`,
    `100644 ${theirsBlob} 3\ttracked-outside.txt`,
    "",
  ].join("\n");
  assert.equal(runWithInput("git", ["update-index", "--index-info"], unmergedRoot, conflict).status, 0);
  const rejected = run(process.execPath, [
    writer, "--root", unmergedRoot, "--intent", intent,
    "--approved-digest", preview.body.intentDigest, "--write",
  ], unmergedRoot);
  assert.equal(rejected.status, 2);
  assert.equal(rejected.body.code, "unmerged_paths_present");
} finally {
  await rm(unmergedRoot, { recursive: true, force: true });
}

console.log("Task·Work·Bug v6 atomic batch registration checks passed.");
