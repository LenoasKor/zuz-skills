import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, mkdir, readFile, readdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { git } from "../packs/decal-pack/src/contracts/task-work-bug/v9/transaction.mjs";
import { metadata } from "../packs/decal-pack/src/contracts/task-work-bug/v9/task-policy.mjs";
import { planTaskLifecycle } from "../packs/decal-pack/src/contracts/task-work-bug/v17/task-lifecycle.mjs";
import { readSettlementMode } from "../packs/decal-pack/src/contracts/task-work-bug/v17/settlement-mode.mjs";

const run = promisify(execFile);
const contracts = fileURLToPath(new URL("../packs/decal-pack/src/contracts/", import.meta.url));

async function node(root, file, args) {
  const env = { ...process.env }; delete env.DECAL_SESSION_ID;
  try {
    const result = await run(process.execPath, [`contracts/task-work-bug/${file}`, "--root", root, ...args], { cwd: root, env });
    return JSON.parse(result.stdout);
  } catch (error) { throw new Error(`${file}: ${error.stdout || error.stderr}`, { cause: error }); }
}

async function fixture({ mode = "release" } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "its-release-settlement-")));
  await cp(contracts, path.join(root, "contracts"), { recursive: true });
  const initial = ["--intent", "contracts/task-work-bug/task-registry-initialization-intent.json"];
  const init = await node(root, "initialize-task-registry.mjs", [...initial, "--dry-run"]);
  await node(root, "initialize-task-registry.mjs", [...initial, "--expected-source-revision", init.sourceRevision, "--write"]);
  await mkdir(path.join(root, ".decal"), { recursive: true });
  await mkdir(path.join(root, "product"));
  await writeFile(path.join(root, "product/package.json"), '{"name":"release-fixture","version":"0.1.9"}\n');
  await writeFile(path.join(root, ".decal/settlement-profile.json"), JSON.stringify({
    schema: "zuz.its.settlement-profile/v1", engine: "portable", channels: { desktop: "app", remote: null },
    products: [{ id: "app", files: [{ path: "product/package.json", format: "json", pointers: ["/version"] }] }],
  }));
  if (mode) {
    await mkdir(path.join(root, "config"));
    await writeFile(path.join(root, "config/its-settlement.json"), JSON.stringify({ schema: "decal.its-settlement-mode/v1", mode }, null, 2) + "\n");
  }
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await git(root, ["add", "."]); await git(root, ["commit", "-m", "fixture: profile and contracts"]);
  const intent = {
    schema: "decal.task-work-bug.task-registration-batch-intent/v7", intentId: "release-fixture", commitMessage: "docs: fixture task",
    tasks: [{ localRef: "first", category: "product", slug: "first_task", title: "First task", priority: "P1", areas: ["zuz ITS"], summary: "Fixture",
      versionImpact: "desktop-minor", remoteVersionImpact: "none",
      body: "## Context Budget\n\nFixture only.\n\n## 완료 기준\n\n- [x] Actual fixture assertion\n" }],
  };
  await writeFile(path.join(root, "registration.json"), JSON.stringify(intent));
  const preview = await node(root, "v7/register-task-batch.mjs", ["--intent", "registration.json", "--dry-run"]);
  await node(root, "v7/register-task-batch.mjs", ["--intent", "registration.json", "--approved-digest", preview.intentDigest, "--write"]);
  const taskFile = (await readdir(path.join(root, "docs/tasks"))).find((name) => name.startsWith("task_"));
  return { root, task: `docs/tasks/${taskFile}` };
}

async function closedRecord(root, kind, id, { releaseMode = "standalone", releaseTaskRef = null } = {}) {
  const directory = kind === "work" ? "work" : "bugs";
  await mkdir(path.join(root, "docs/work-items", directory), { recursive: true });
  const pending = releaseMode === "task-batch" ? "pending-task" : "pending";
  const source = ["---", `schema: decal.task-work-bug.${kind === "work" ? "work-document" : "bug-card"}`, "schemaVersion: 1", `id: ${id}`, "status: closed",
    "versionImpact: desktop-patch", "remoteVersionImpact: none", `releaseMode: ${releaseMode}`, `releaseTaskRef: ${releaseTaskRef ? `"${releaseTaskRef}"` : "null"}`,
    `versionApplied: ${pending}`, "remoteVersionApplied: not-required", "taskRefs:", '  - "1"', "completion:", '  summary: "verified"', "  evidence:", '    - "fixture assertions"',
    "closure:", `  reason: ${kind === "work" ? "completed" : "fixed"}`, "---", "Preserved body.", ""].join("\n");
  await writeFile(path.join(root, `docs/work-items/${directory}/${id}.md`), source);
  return `docs/work-items/${directory}/${id}.md`;
}

async function apply(root, script, request) {
  const requestPath = path.join(root, "lifecycle-request.json");
  await writeFile(requestPath, JSON.stringify({ schema: "zuz.its.task-lifecycle-request/v1", taskId: "1", ...request }));
  const preview = await node(root, script, ["--request", requestPath, "--dry-run"]);
  const result = await node(root, script, ["--request", requestPath, "--approved-plan-digest", preview.approvalDigest, "--write"]);
  return { preview, result };
}

async function verification(root, targetStatus = "completed") {
  return {
    schema: "zuz.its.completion-verification/v1", outcome: "passed", source: "clean-snapshot",
    verifiedHead: (await git(root, ["rev-parse", "HEAD"])).trim(), verifiedTree: (await git(root, ["rev-parse", "HEAD^{tree}"])).trim(),
    recordId: "1", targetStatus, confirmedBy: "ai", confirmedAt: "2026-10-10T00:00:00Z",
    environment: "Disposable Node and Git fixture", summary: "Fixture assertions passed", evidence: ["node --test portable-release-settlement.test.mjs"],
  };
}

const version = async (root) => JSON.parse(await readFile(path.join(root, "product/package.json"), "utf8")).version;

test("settlement mode file: missing keeps per-ticket, malformed fails closed", async () => {
  const { root } = await fixture({ mode: null });
  assert.deepEqual(await readSettlementMode(root), { mode: "per-ticket", read: null });
  await mkdir(path.join(root, "config"));
  for (const bad of [{ schema: "decal.its-settlement-mode/v1", mode: "weekly" }, { schema: "decal.its-settlement-mode/v2", mode: "release" },
    { schema: "decal.its-settlement-mode/v1", mode: "release", extra: true }]) {
    await writeFile(path.join(root, "config/its-settlement.json"), JSON.stringify(bad));
    await assert.rejects(readSettlementMode(root), { code: "invalid_settlement_mode" });
  }
});

test("per-ticket projects keep the published v9 completion and bind an explicit mode file", async () => {
  const { root } = await fixture({ mode: "per-ticket" });
  await apply(root, "v17/task-lifecycle.mjs", { mode: "transition", target: "in_progress" });
  const { preview, result } = await apply(root, "v17/task-lifecycle.mjs", { mode: "test-pass", target: "completed", details: { verification: await verification(root) } });
  assert.equal(result.versions.desktop, "0.2.0");
  assert.equal(await version(root), "0.2.0");
  assert.ok(preview.writeSet.some((item) => item.path === "product/package.json"));
});

test("release mode: completion and closure defer, one release applies one version", async () => {
  const { root, task } = await fixture();
  const work = await closedRecord(root, "work", "WORK-002");
  const bug = await closedRecord(root, "bug", "BUG-001");
  const batch = await closedRecord(root, "work", "WORK-003", { releaseMode: "task-batch", releaseTaskRef: "1" });
  await git(root, ["add", "docs/work-items"]); await git(root, ["commit", "-m", "fixture: closed records"]);

  const deferred = await node(root, "v17/settle-work-item.mjs", ["--kind", "work", "--id", "WORK-002", "--write"]);
  assert.equal(deferred.status, "deferred_to_release");
  assert.deepEqual(deferred.writeSet, []);

  // Before the Task completes only the standalone records ship, as a patch.
  const early = await node(root, "v17/release-settle.mjs", ["--dry-run"]);
  assert.deepEqual(early.items, ["BUG-001", "WORK-002"]);
  assert.equal(early.versions.desktop.after, "0.1.10");

  await apply(root, "v17/task-lifecycle.mjs", { mode: "transition", target: "in_progress" });
  const { preview, result } = await apply(root, "v17/task-lifecycle.mjs", { mode: "test-pass", target: "completed", details: { verification: await verification(root) } });
  assert.equal(result.state, "committed");
  assert.equal(result.deferredToRelease, true);
  assert.deepEqual(preview.writeSet.map((item) => item.path).sort(), [task, "docs/tasks/index.md"].sort());
  assert.equal(await version(root), "0.1.9");
  assert.equal(metadata(await readFile(path.join(root, task), "utf8"), "Version Applied"), "pending");
  assert.match(await readFile(path.join(root, batch), "utf8"), /versionApplied: pending-task/);

  await writeFile(path.join(root, "unrelated.txt"), "another session\n");
  const release = await node(root, "v17/release-settle.mjs", ["--dry-run"]);
  assert.equal(release.status, "preview");
  assert.deepEqual(release.tasks, ["1"]);
  assert.deepEqual(release.items, ["BUG-001", "WORK-002", "WORK-003"]);
  assert.equal(release.versions.desktop.after, "0.2.0");
  const applied = await node(root, "v17/release-settle.mjs", ["--approved-plan-digest", release.approvalDigest, "--write"]);
  assert.equal(applied.state, "committed");
  assert.equal(await version(root), "0.2.0");
  assert.equal(metadata(await readFile(path.join(root, task), "utf8"), "Version Applied"), "0.2.0");
  for (const file of [work, bug, batch]) assert.match(await readFile(path.join(root, file), "utf8"), /versionApplied: 0\.2\.0/);
  assert.match((await git(root, ["log", "-1", "--format=%s"])).trim(), /^chore\(its\): release desktop 0\.2\.0$/);
  assert.equal(await readFile(path.join(root, "unrelated.txt"), "utf8"), "another session\n");
  assert.equal((await node(root, "v17/release-settle.mjs", ["--dry-run"])).status, "nothing_to_release");
});

test("release mode rejects stale approval and requires the mode", async () => {
  const { root } = await fixture();
  await closedRecord(root, "bug", "BUG-001");
  await git(root, ["add", "docs/work-items"]); await git(root, ["commit", "-m", "fixture: closed bug"]);
  const release = await node(root, "v17/release-settle.mjs", ["--dry-run"]);
  await git(root, ["commit", "--allow-empty", "-m", "moved on"]);
  await assert.rejects(node(root, "v17/release-settle.mjs", ["--approved-plan-digest", release.approvalDigest, "--write"]), /approval_digest_mismatch|stale_head/);
  const perTicket = await fixture({ mode: "per-ticket" });
  await assert.rejects(node(perTicket.root, "v17/release-settle.mjs", ["--dry-run"]), /release_mode_required/);
  await assert.rejects(planTaskLifecycle({ root: "/not-a-project", taskId: "1", details: null }), { code: "invalid_lifecycle_details" });
});
