import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const writer = path.join(repositoryRoot, "packs/decal-pack/src/contracts/task-work-bug/v7/register-ticket.mjs");
const taskWriter = path.join(repositoryRoot, "packs/decal-pack/src/contracts/task-work-bug/v7/register-task-batch.mjs");
const { registerTicket, ticketRegistrationIntentDigest } = await import("../packs/decal-pack/src/contracts/task-work-bug/v7/registration.mjs");

const contractRoot = path.join(repositoryRoot, "packs/decal-pack/src/contracts/task-work-bug/v7");
const manifest = JSON.parse(await readFile(path.join(contractRoot, "manifest.json"), "utf8"));
const files = [];
async function collect(directory, prefix = "") {
  for (const name of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    const entry = await lstat(absolute);
    assert.equal(entry.isSymbolicLink(), false, relative);
    if (entry.isDirectory()) await collect(absolute, relative);
    else if (relative !== "manifest.json") files.push(relative);
  }
}
await collect(contractRoot);
assert.deepEqual(files.sort(), Object.keys(manifest.files).sort());
for (const [relative, expected] of Object.entries(manifest.files)) {
  assert.equal(createHash("sha256").update(await readFile(path.join(contractRoot, relative))).digest("hex"), expected, relative);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  const line = result.stdout.trim().split(/\r?\n/u).at(-1);
  let body = null;
  try { body = line ? JSON.parse(line) : null; } catch { body = null; }
  return { ...result, body };
}

function runAsync(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (status) => resolve({ status, stderr, body: JSON.parse(stdout.trim().split(/\r?\n/u).at(-1)) }));
  });
}

async function fixture(defaultBranch = "main") {
  const root = await mkdtemp(path.join(tmpdir(), "decal-its-v7-"));
  await mkdir(path.join(root, "docs/work-items/work"), { recursive: true });
  await mkdir(path.join(root, "docs/work-items/bugs"), { recursive: true });
  await mkdir(path.join(root, "docs/work-items/incidents"), { recursive: true });
  await mkdir(path.join(root, "contracts/task-work-bug/v6"), { recursive: true });
  await cp(
    path.join(repositoryRoot, "packs/decal-pack/src/contracts/task-work-bug/v6/manifest.json"),
    path.join(root, "contracts/task-work-bug/v6/manifest.json"),
  );
  await writeFile(path.join(root, "tracked.txt"), "base\n");
  assert.equal(run("git", ["init", "-b", defaultBranch], root).status, 0);
  assert.equal(run("git", ["config", "user.email", "fixture@decal.test"], root).status, 0);
  assert.equal(run("git", ["config", "user.name", "Decal Fixture"], root).status, 0);
  assert.equal(run("git", ["add", "."], root).status, 0);
  assert.equal(run("git", ["commit", "-m", "fixture"], root).status, 0);
  return root;
}

function intent(kind, suffix) {
  const value = {
    schema: "decal.zuz-its.ticket-registration-intent/v7",
    intentId: `fixture-${kind}-${suffix}`,
    kind,
    title: `${kind} ${suffix}`,
    priority: "P1",
    taskRefs: ["684"],
    versionImpact: "desktop-patch",
    remoteVersionImpact: "none",
    releaseMode: "standalone",
    body: `## ${kind}\n\n원자 등록 ${suffix}\n`,
  };
  if (kind === "incident") value.incident = {
    impact: "degraded",
    affectedServices: ["Remote"],
    classifications: ["provider"],
    occurredAt: "2026-09-05T00:00:00.000Z",
    detectedAt: "2026-09-05T00:01:00.000Z",
    mitigatedAt: null,
    recoveredAt: null,
    resolutionEvidence: [],
  };
  return value;
}

const root = await fixture();
try {
  await writeFile(path.join(root, "unrelated.txt"), "preserve\n");
  await writeFile(path.join(root, "tracked.txt"), "dirty preserved\n");
  const workIntent = intent("work", "first");
  const workPath = path.join(root, "work-intent.json");
  await writeFile(workPath, `${JSON.stringify(workIntent)}\n`);
  const preview = run(process.execPath, [writer, "--root", root, "--intent", workPath, "--dry-run"], root);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(preview.body.identityPending, true);
  assert.equal(Object.hasOwn(preview.body, "assigned"), false);
  assert.match(preview.body.writeSet[0], /<assigned>/u);

  const written = run(process.execPath, [writer, "--root", root, "--intent", workPath, "--approved-digest", preview.body.intentDigest, "--write"], root);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.body.assigned.id, "WORK-001");
  assert.equal(await readFile(path.join(root, "unrelated.txt"), "utf8"), "preserve\n");
  assert.equal(await readFile(path.join(root, "tracked.txt"), "utf8"), "dirty preserved\n");
  assert.deepEqual(run("git", ["diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD"], root).stdout.trim().split(/\r?\n/u), written.body.writeSet);

  const replay = run(process.execPath, [writer, "--root", root, "--intent", workPath, "--approved-digest", preview.body.intentDigest, "--write"], root);
  assert.equal(replay.body.status, "replayed");
  assert.equal(replay.body.commit, written.body.commit);

  const concurrent = Array.from({ length: 8 }, (_, index) => intent("bug", `parallel-${index}`));
  const paths = [];
  for (const [index, value] of concurrent.entries()) {
    const target = path.join(root, `bug-${index}.json`);
    await writeFile(target, `${JSON.stringify(value)}\n`);
    paths.push(target);
  }
  const results = await Promise.all(paths.map((target, index) => runAsync([
    writer, "--root", root, "--intent", target,
    "--approved-digest", ticketRegistrationIntentDigest(concurrent[index]), "--write",
  ], root)));
  assert.equal(results.every((result) => result.status === 0), true, JSON.stringify(results));
  assert.deepEqual(results.map((result) => result.body.assigned.id).sort(), Array.from({ length: 8 }, (_, index) => `BUG-00${index + 1}`));

  for (const kind of ["incident", "work"]) {
    const value = intent(kind, `mixed-${kind}`);
    const result = await registerTicket({ root, intent: value, approvedDigest: ticketRegistrationIntentDigest(value) });
    assert.match(result.assigned.id, kind === "incident" ? /^INC-001$/u : /^WORK-002$/u);
  }

  const rollback = intent("work", "rollback");
  await assert.rejects(
    registerTicket({ root, intent: rollback, approvedDigest: ticketRegistrationIntentDigest(rollback), testFailAt: "after_write" }),
    (error) => error?.code === "injected_failure",
  );
  assert.equal(run("git", ["status", "--short", "docs/work-items/work"], root).stdout.trim(), "");
  assert.equal(await readFile(path.join(root, ".decal/its-ticket-registration-pending-v1.json"), "utf8").catch(() => null), null);

  assert.equal(run("git", ["switch", "-q", "-c", "feature"], root).status, 0);
  const branchIntent = intent("work", "branch");
  await assert.rejects(
    registerTicket({ root, intent: branchIntent, approvedDigest: ticketRegistrationIntentDigest(branchIntent) }),
    (error) => error?.code === "main_branch_required",
  );
  assert.equal(run("git", ["switch", "-q", "main"], root).status, 0);

  const stagedIntent = intent("work", "staged");
  await writeFile(path.join(root, "staged.txt"), "blocked\n");
  assert.equal(run("git", ["add", "staged.txt"], root).status, 0);
  await assert.rejects(
    registerTicket({ root, intent: stagedIntent, approvedDigest: ticketRegistrationIntentDigest(stagedIntent) }),
    (error) => error?.code === "staged_changes_present",
  );
  assert.equal(run("git", ["restore", "--staged", "staged.txt"], root).status, 0);

  const unsafeRoot = await fixture();
  try {
    await rm(path.join(unsafeRoot, "docs/work-items/work"), { recursive: true });
    await symlink(path.join(unsafeRoot, "docs/work-items/bugs"), path.join(unsafeRoot, "docs/work-items/work"));
    const unsafe = intent("work", "symlink");
    await assert.rejects(
      registerTicket({ root: unsafeRoot, intent: unsafe, approvedDigest: ticketRegistrationIntentDigest(unsafe) }),
      (error) => error?.code === "symlink_rejected",
    );
  } finally {
    await rm(unsafeRoot, { recursive: true, force: true });
  }

  const partialLockRoot = await fixture();
  try {
    const partialLock = path.join(partialLockRoot, ".decal-slice-completion.lock");
    await writeFile(partialLock, '{"schema":"decal.repository-lock/v1",');
    const releasePartialLock = setTimeout(() => { void rm(partialLock, { force: true }); }, 80);
    const partialLockIntent = intent("bug", "partial-lock");
    const partialLockResult = await registerTicket({
      root: partialLockRoot,
      intent: partialLockIntent,
      approvedDigest: ticketRegistrationIntentDigest(partialLockIntent),
    });
    clearTimeout(releasePartialLock);
    assert.equal(partialLockResult.status, "committed");
    assert.equal(partialLockResult.assigned.id, "BUG-001");
  } finally {
    await rm(partialLockRoot, { recursive: true, force: true });
  }
} finally {
  await rm(root, { recursive: true, force: true });
}

console.log("Task·Work·Bug v7 canonical-default-branch atomic ticket registration verification passed.");

const masterRoot = await fixture("master");
try {
  const masterIntent = intent("work", "master-default");
  const masterIntentPath = path.join(masterRoot, "master-intent.json");
  await writeFile(masterIntentPath, `${JSON.stringify(masterIntent)}\n`);
  const preview = run(process.execPath, [writer, "--root", masterRoot, "--intent", masterIntentPath, "--dry-run"], masterRoot);
  assert.equal(preview.status, 0, preview.stderr);
  const written = run(process.execPath, [
    writer, "--root", masterRoot, "--intent", masterIntentPath,
    "--approved-digest", preview.body.intentDigest, "--write",
  ], masterRoot);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.body.assigned.id, "WORK-001");
} finally {
  await rm(masterRoot, { recursive: true, force: true });
}

const originDefaultRoot = await fixture();
try {
  assert.equal(run("git", ["branch", "master"], originDefaultRoot).status, 0);
  assert.equal(run("git", ["update-ref", "refs/remotes/origin/master", "HEAD"], originDefaultRoot).status, 0);
  assert.equal(run("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"], originDefaultRoot).status, 0);
  assert.equal(run("git", ["switch", "-q", "master"], originDefaultRoot).status, 0);
  const originIntent = intent("bug", "origin-master");
  const originIntentPath = path.join(originDefaultRoot, "origin-intent.json");
  await writeFile(originIntentPath, `${JSON.stringify(originIntent)}\n`);
  const preview = run(process.execPath, [writer, "--root", originDefaultRoot, "--intent", originIntentPath, "--dry-run"], originDefaultRoot);
  assert.equal(preview.status, 0, preview.stderr);
  const written = run(process.execPath, [
    writer, "--root", originDefaultRoot, "--intent", originIntentPath,
    "--approved-digest", preview.body.intentDigest, "--write",
  ], originDefaultRoot);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.body.assigned.id, "BUG-001");
} finally {
  await rm(originDefaultRoot, { recursive: true, force: true });
}

const unsupportedOriginRoot = await fixture();
try {
  assert.equal(run("git", ["update-ref", "refs/remotes/origin/trunk", "HEAD"], unsupportedOriginRoot).status, 0);
  assert.equal(run("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/trunk"], unsupportedOriginRoot).status, 0);
  const unsupportedIntent = intent("work", "unsupported-origin");
  const unsupportedIntentPath = path.join(unsupportedOriginRoot, "unsupported-origin.json");
  await writeFile(unsupportedIntentPath, `${JSON.stringify(unsupportedIntent)}\n`);
  const rejected = run(process.execPath, [writer, "--root", unsupportedOriginRoot, "--intent", unsupportedIntentPath, "--dry-run"], unsupportedOriginRoot);
  assert.equal(rejected.status, 2);
  assert.equal(rejected.body.code, "main_branch_required");
} finally {
  await rm(unsupportedOriginRoot, { recursive: true, force: true });
}

for (const [label, prepare] of [
  ["ambiguous", async (boundaryRoot) => { assert.equal(run("git", ["branch", "master"], boundaryRoot).status, 0); }],
  ["detached", async (boundaryRoot) => { assert.equal(run("git", ["checkout", "--detach", "-q"], boundaryRoot).status, 0); }],
  ["non-symbolic-origin", async (boundaryRoot) => {
    assert.equal(run("git", ["update-ref", "refs/remotes/origin/HEAD", "HEAD"], boundaryRoot).status, 0);
  }],
  ["dangling-origin", async (boundaryRoot) => {
    assert.equal(run("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"], boundaryRoot).status, 0);
  }],
  ["missing-local-origin", async (boundaryRoot) => {
    assert.equal(run("git", ["update-ref", "refs/remotes/origin/master", "HEAD"], boundaryRoot).status, 0);
    assert.equal(run("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/master"], boundaryRoot).status, 0);
  }],
]) {
  const boundaryRoot = await fixture();
  try {
    await prepare(boundaryRoot);
    const boundaryIntent = intent("work", label);
    const boundaryIntentPath = path.join(boundaryRoot, `${label}.json`);
    await writeFile(boundaryIntentPath, `${JSON.stringify(boundaryIntent)}\n`);
    const rejected = run(process.execPath, [writer, "--root", boundaryRoot, "--intent", boundaryIntentPath, "--dry-run"], boundaryRoot);
    assert.equal(rejected.status, 2, label);
    assert.equal(rejected.body.code, "main_branch_required", label);
  } finally {
    await rm(boundaryRoot, { recursive: true, force: true });
  }
}

const missingDefaultRoot = await fixture("trunk");
try {
  const missingIntent = intent("work", "missing-default");
  const missingIntentPath = path.join(missingDefaultRoot, "missing-default.json");
  await writeFile(missingIntentPath, `${JSON.stringify(missingIntent)}\n`);
  const rejected = run(process.execPath, [writer, "--root", missingDefaultRoot, "--intent", missingIntentPath, "--dry-run"], missingDefaultRoot);
  assert.equal(rejected.status, 2);
  assert.equal(rejected.body.code, "main_branch_required");
} finally {
  await rm(missingDefaultRoot, { recursive: true, force: true });
}

console.log("Task·Work·Bug v7 canonical main/master branch resolution verification passed.");

const taskRoot = await mkdtemp(path.join(tmpdir(), "decal-its-v7-task-"));
try {
  await cp(path.join(repositoryRoot, "packs/decal-pack/src/contracts"), path.join(taskRoot, "contracts"), { recursive: true });
  await cp(path.join(repositoryRoot, "packs/decal-pack/src/contracts/task-work-bug/v4/fixtures/project/docs"), path.join(taskRoot, "docs"), { recursive: true });
  assert.equal(run("git", ["init", "-b", "master"], taskRoot).status, 0);
  assert.equal(run("git", ["config", "user.email", "fixture@decal.test"], taskRoot).status, 0);
  assert.equal(run("git", ["config", "user.name", "Decal Fixture"], taskRoot).status, 0);
  assert.equal(run("git", ["add", "."], taskRoot).status, 0);
  assert.equal(run("git", ["commit", "-m", "fixture"], taskRoot).status, 0);
  const taskIntent = {
    schema: "decal.task-work-bug.task-registration-batch-intent/v7",
    intentId: "fixture-v7-existing-dependency",
    commitMessage: "docs(tasks): register v7 fixture",
    tasks: [{
      localRef: "task-v7",
      category: "product",
      slug: "v7_existing_dependency",
      title: "V7 existing dependency",
      priority: "P1",
      areas: ["ZUZ ITS"],
      summary: "승인 시 ID를 발급한다.",
      versionImpact: "desktop-minor",
      remoteVersionImpact: "none",
      dependsOn: [1],
      body: "## Context Budget\n\n- v7 계약\n\n## 완료 기준\n\n- [ ] 원자 등록\n",
    }],
  };
  const taskIntentPath = path.join(taskRoot, "task-intent.json");
  await writeFile(taskIntentPath, `${JSON.stringify(taskIntent)}\n`);
  const taskPreview = run(process.execPath, [taskWriter, "--root", taskRoot, "--intent", taskIntentPath, "--dry-run"], taskRoot);
  assert.equal(taskPreview.status, 0, taskPreview.stderr);
  assert.equal(taskPreview.body.identityPending, true);
  assert.equal(Object.hasOwn(taskPreview.body, "assigned"), false);
  const taskWritten = run(process.execPath, [taskWriter, "--root", taskRoot, "--intent", taskIntentPath, "--approved-digest", taskPreview.body.intentDigest, "--write"], taskRoot);
  assert.equal(taskWritten.status, 0, `${taskWritten.stderr}\n${JSON.stringify(taskWritten.body)}`);
  assert.equal(taskWritten.body.assigned[0].taskId, 2);
  assert.match(await readFile(path.join(taskRoot, taskWritten.body.assigned[0].path), "utf8"), /^Depends On: \[1\]$/mu);
} finally {
  await rm(taskRoot, { recursive: true, force: true });
}

console.log("Task v7 delayed identity and existing dependency verification passed.");
