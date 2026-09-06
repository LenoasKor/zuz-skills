import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, mkdir, readFile, readdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { git, executePlan, planDigest, acquireLock } from "../packs/decal-pack/src/contracts/task-work-bug/v8/transaction.mjs";
import { planTaskLifecycle } from "../packs/decal-pack/src/contracts/task-work-bug/v8/task-lifecycle.mjs";
import { assertCriteria, transitionTaskDocument, metadata } from "../packs/decal-pack/src/contracts/task-work-bug/v8/task-policy.mjs";

const run = promisify(execFile);
const contracts = fileURLToPath(new URL("../packs/decal-pack/src/contracts/", import.meta.url));
test("malformed lifecycle details are rejected before filesystem access", async () => {
  for (const details of [null, [], "wrong"]) await assert.rejects(planTaskLifecycle({ root: "/not-a-project", taskId: "1", details }), { code: "invalid_lifecycle_details" });
});

test("registration and lifecycle race serialize or reject stale plan without losing records", async () => {
  const { root, task } = await fixture();
  const { plan } = await planTaskLifecycle({ root, taskId: "1", target: "in_progress" });
  const intent = JSON.parse(await readFile(path.join(root, "registration.json"), "utf8"));
  intent.intentId = "second-concurrent-registration";
  intent.tasks[0].slug = "second_task";
  intent.tasks[0].title = "Second task";
  await writeFile(path.join(root, "second.json"), JSON.stringify(intent));
  const preview = await node(root, "v7/register-task-batch.mjs", ["--intent", "second.json", "--dry-run"]);
  const unlock = await acquireLock(root);
  let registration, transition;
  try {
    registration = node(root, "v7/register-task-batch.mjs", ["--intent", "second.json", "--write", "--approved-digest", preview.intentDigest]).then(value => ({ value }), error => ({ error }));
    transition = executePlan(plan, planDigest(plan)).then(value => ({ value }), error => ({ error }));
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal((await git(root, ["rev-parse", "HEAD"])).trim(), plan.baseHead);
  } finally { await unlock(); }
  const [registered, transitioned] = await Promise.all([registration, transition]);
  if (registered.error) throw registered.error;
  if (transitioned.error) {
    assert.equal(transitioned.error.code, "stale_head");
    const fresh = await planTaskLifecycle({ root, taskId: "1", target: "in_progress" });
    await executePlan(fresh.plan, planDigest(fresh.plan));
  }
  const index = await readFile(path.join(root, "docs/tasks/index.md"), "utf8");
  assert.match(index, /Second task/);
  assert.equal(metadata(await readFile(path.join(root, task), "utf8"), "상태"), "in_progress");
  assert.equal(JSON.parse(await readFile(path.join(root, "product/package.json"), "utf8")).version, "0.1.9");
  assert.equal((await git(root, ["diff", "--name-only", "--", "docs/tasks"])).trim(), "");
});

test("unrelated category-index whitespace remains dirty and is not committed", async () => {
  const { root } = await fixture();
  const file = path.join(root, "docs/tasks/category_index.md");
  const dirty = await readFile(file, "utf8") + "\n";
  await writeFile(file, dirty);
  await apply(root, { mode: "transition", target: "in_progress" });
  assert.equal(await readFile(file, "utf8"), dirty);
  assert.equal((await git(root, ["diff", "--name-only", "--", "docs/tasks/category_index.md"])).trim(), "docs/tasks/category_index.md");
});
async function node(root, file, args) {
  const env = { ...process.env }; delete env.DECAL_SESSION_ID;
  try {
    const result = await run(process.execPath, [`contracts/task-work-bug/${file}`, "--root", root, ...args], { cwd: root, env });
    return JSON.parse(result.stdout);
  } catch (error) { throw new Error(`${file}: ${error.stdout || error.stderr}`, { cause: error }); }
}

async function fixture({ versioned = true, checked = true, branch = "main" } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "its-task-lifecycle-")));
  await cp(contracts, path.join(root, "contracts"), { recursive: true });
  const initial = ["--intent", "contracts/task-work-bug/task-registry-initialization-intent.json"];
  const init = await node(root, "initialize-task-registry.mjs", [...initial, "--dry-run"]);
  await node(root, "initialize-task-registry.mjs", [...initial, "--expected-source-revision", init.sourceRevision, "--write"]);
  await mkdir(path.join(root, ".decal"), { recursive: true });
  await mkdir(path.join(root, "product"));
  await writeFile(path.join(root, "product/package.json"), '{"name":"showcase-fixture","version":"0.1.9"}\n');
  await writeFile(path.join(root, "unrelated.txt"), "original\n");
  await writeFile(path.join(root, ".decal/settlement-profile.json"), JSON.stringify({
    schema: "zuz.its.settlement-profile/v1", engine: "portable", channels: { desktop: versioned ? "showcase" : null, remote: null },
    products: versioned ? [{ id: "showcase", files: [{ path: "product/package.json", format: "json", pointers: ["/version"] }] }] : [],
  }));
  await git(root, ["init", "-b", branch]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await git(root, ["add", "."]); await git(root, ["commit", "-m", "fixture: profile and contracts"]);
  const intent = {
    schema: "decal.task-work-bug.task-registration-batch-intent/v7", intentId: "portable-lifecycle-fixture", commitMessage: "docs: fixture task",
    tasks: [{ localRef: "first", category: "product", slug: "first_task", title: "First task", priority: "P1", areas: ["zuz ITS"], summary: "Fixture",
      versionImpact: versioned ? "desktop-minor" : "none", remoteVersionImpact: "none",
      body: `## Context Budget\n\nFixture only.\n\n## 완료 기준\n\n- [${checked ? "x" : " "}] Actual fixture assertion\n\n## 사용자 메모\n\nPreserve me.\n` }],
  };
  const request = path.join(root, "registration.json");
  await writeFile(request, JSON.stringify(intent));
  const preview = await node(root, "v7/register-task-batch.mjs", ["--intent", request, "--dry-run"]);
  await node(root, "v7/register-task-batch.mjs", ["--intent", request, "--approved-digest", preview.intentDigest, "--write"]);
  const taskFile = (await readdir(path.join(root, "docs/tasks"))).find((name) => name.startsWith("task_"));
  return { root, task: `docs/tasks/${taskFile}` };
}

async function apply(root, request) {
  const requestPath = path.join(root, "lifecycle-request.json");
  await writeFile(requestPath, JSON.stringify({ schema: "zuz.its.task-lifecycle-request/v1", taskId: "1", ...request }));
  const preview = await node(root, "v8/task-lifecycle.mjs", ["--request", requestPath, "--dry-run"]);
  const result = await node(root, "v8/task-lifecycle.mjs", ["--request", requestPath, "--approved-plan-digest", preview.approvalDigest, "--write"]);
  return { preview, result };
}

async function verification(root, targetStatus = "completed") {
  // The fixture just checked the committed document/code used in this test.
  return {
    schema: "zuz.its.completion-verification/v1", outcome: "passed", source: "clean-snapshot",
    verifiedHead: (await git(root, ["rev-parse", "HEAD"])).trim(), verifiedTree: (await git(root, ["rev-parse", "HEAD^{tree}"])).trim(),
    recordId: "1", targetStatus, confirmedBy: "ai", confirmedAt: "2026-09-06T00:00:00Z",
    environment: "Disposable Node and Git fixture", summary: "Fixture assertions passed", evidence: ["node --test portable-settlement-task.test.mjs"],
  };
}

for (const branch of ["main", "master"]) {
  test(`${branch}: registration → start → development → exact completion without Decal`, async () => {
    const { root, task } = await fixture({ branch });
    await writeFile(path.join(root, "unrelated.txt"), "another session\n");
    await apply(root, { mode: "transition", target: "in_progress" });
    await apply(root, { mode: "transition", target: "development_complete" });
    assert.equal(JSON.parse(await readFile(path.join(root, "product/package.json"), "utf8")).version, "0.1.9");
    const { result } = await apply(root, { mode: "complete", details: { verification: await verification(root) } });
    assert.equal(result.state, "committed");
    assert.equal(result.versions.desktop, "0.2.0");
    const source = await readFile(path.join(root, task), "utf8");
    assert.match(source, /상태: completed/); assert.match(source, /Version Applied: 0\.2\.0/);
    assert.match(source, /Preserve me\./); assert.match(source, /Verified Tree:/);
    assert.match(await readFile(path.join(root, "docs/tasks/index.md"), "utf8"), /\| `completed` \| 1 \| Task 1 \|/);
    assert.equal(await readFile(path.join(root, "unrelated.txt"), "utf8"), "another session\n");
    const before = (await git(root, ["rev-parse", "HEAD"])).trim();
    assert.equal((await apply(root, { mode: "complete" })).result.state, "unchanged");
    assert.equal((await git(root, ["rev-parse", "HEAD"])).trim(), before);
  });
}

test("Task plus Work/Bug releases in one exact commit with ordered versions", async () => {
  const { root } = await fixture();
  for (const [kind, id] of [["bugs", "BUG-001"], ["work", "WORK-010"], ["work", "WORK-002"]]) {
    await mkdir(path.join(root, "docs/work-items", kind), { recursive: true });
    const source = ["---", `schema: decal.task-work-bug.${kind === "work" ? "work-document" : "bug-card"}`, "schemaVersion: 1", `id: ${id}`, "status: closed",
      "versionImpact: desktop-patch", "remoteVersionImpact: none", "releaseMode: task-batch", 'releaseTaskRef: "1"', "versionApplied: pending-task", "remoteVersionApplied: not-required",
      "taskRefs:", '  - "1"', "completion:", '  summary: "verified"', "  evidence:", '    - "fixture assertions"', "closure:", `  reason: ${kind === "work" ? "completed" : "fixed"}`, "---", "Preserved body.", ""].join("\n");
    await writeFile(path.join(root, `docs/work-items/${kind}/${id}.md`), source);
  }
  await git(root, ["add", "docs/work-items"]); await git(root, ["commit", "-m", "fixture: closed batch"]);
  const { result, preview } = await apply(root, { mode: "test-pass", target: "completed", details: { verification: await verification(root) } });
  assert.deepEqual(result.batch.map((item) => [item.id, item.versionApplied]), [["WORK-002", "0.2.1"], ["WORK-010", "0.2.2"], ["BUG-001", "0.2.3"]]);
  assert.equal(result.versions.desktop, "0.2.3");
  assert.equal(preview.writeSet.length, 6);
  assert.equal(JSON.parse(await readFile(path.join(root, "product/package.json"), "utf8")).version, "0.2.3");
});

test("docs-only and release-ready paths do not bump prematurely", async () => {
  const { root, task } = await fixture({ versioned: false });
  await apply(root, { mode: "test-pass", target: "release_ready", details: { verification: await verification(root, "release_ready") } });
  assert.equal(metadata(await readFile(path.join(root, task), "utf8"), "상태"), "release_ready");
  const done = await apply(root, { mode: "complete", details: { verification: await verification(root) } });
  assert.equal(done.result.versions.desktop, null);
  assert.match(await readFile(path.join(root, task), "utf8"), /Version Applied: not-required/);
  assert.equal(JSON.parse(await readFile(path.join(root, "product/package.json"), "utf8")).version, "0.1.9");
});

test("unchecked criteria, stale verification and wrong record binding cannot close", async () => {
  const { root } = await fixture({ checked: false });
  await assert.rejects(planTaskLifecycle({ root, taskId: "1", target: "development_complete" }), { code: "unchecked_completion_criteria" });
  const second = await fixture();
  const receipt = await verification(second.root);
  await assert.rejects(planTaskLifecycle({ root: second.root, taskId: "1", mode: "test-pass", target: "completed", details: { verification: { ...receipt, recordId: "2" } } }), { code: "verification_binding_mismatch" });
  await git(second.root, ["commit", "--allow-empty", "-m", "new source"]);
  await assert.rejects(planTaskLifecycle({ root: second.root, taskId: "1", mode: "test-pass", target: "completed", details: { verification: receipt } }), { code: "verification_binding_mismatch" });
});

test("blocked/postponed and reopen preserve canonical status restrictions", async () => {
  const { root, task } = await fixture();
  await apply(root, { target: "in_progress" });
  await apply(root, { target: "blocked", details: { reason: "fixture dependency", exitCriteria: "dependency returns" } });
  await assert.rejects(planTaskLifecycle({ root, taskId: "1", target: "planned" }), { code: "invalid_blocked_resume" });
  await apply(root, { target: "in_progress" });
  assert.doesNotMatch(await readFile(path.join(root, task), "utf8"), /^Blocked From:/m);
  await apply(root, { target: "postponed", details: { reason: "later", resumeCriteria: "explicit resume", targetRelease: "future" } });
  await assert.rejects(planTaskLifecycle({ root, taskId: "1", target: "in_progress" }), { code: "invalid_status_transition" });
  await apply(root, { target: "planned" });
  await apply(root, { mode: "test-pass", target: "completed", details: { verification: await verification(root) } });
  await apply(root, { target: "in_progress" });
  assert.match(await readFile(path.join(root, task), "utf8"), /Version Applied: 0\.2\.0/);
  await apply(root, { mode: "test-pass", target: "completed", details: { verification: await verification(root) } });
  assert.equal(JSON.parse(await readFile(path.join(root, "product/package.json"), "utf8")).version, "0.3.0");
});

test("criteria examples and ambiguous metadata cannot authorize completion", () => {
  assert.throws(() => assertCriteria("## 완료 기준\n\n```md\n- [x] example\n```\n"), { code: "unchecked_completion_criteria" });
  assert.throws(() => transitionTaskDocument("# Task 1\n상태: planned\n상태: completed\n## Context Budget\n", "in_progress"), { code: "invalid_task_metadata" });
});
