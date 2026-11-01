// A project that declares the version impacts its build can read has other Task values refused at the stable entry.
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseVersionPolicy } from "../packs/decal-pack/src/contracts/task-work-bug/v27/task-version-policy.mjs";

const contracts = fileURLToPath(new URL("../packs/decal-pack/src/contracts", import.meta.url));
const base = await realpath(await mkdtemp(path.join(tmpdir(), "its-version-policy-")));
after(() => rm(base, { recursive: true, force: true }));
const env = { ...process.env, GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
delete env.DECAL_SESSION_ID;

const run = (file, args, cwd) => {
  const result = spawnSync(file, args, { cwd, env, encoding: "utf8" });
  let body = null;
  try { body = JSON.parse(result.stdout.trim().split("\n").at(-1)); } catch { /* not json */ }
  return { ...result, body };
};
const git = (cwd, ...args) => { const result = run("git", args, cwd); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };

const DECAL_POLICY = {
  schema: "decal.its-version-policy/v1",
  task: { versionImpact: ["desktop-minor", "none"], remoteVersionImpact: ["remote-minor", "none"] },
};
const POLICY_PATH = "config/its-version-policy.json";

let projects = 0;
async function makeProject(policy) {
  const root = path.join(base, `project-${projects += 1}`);
  await mkdir(path.join(root, "config"), { recursive: true });
  await cp(contracts, path.join(root, "contracts"), { recursive: true });
  await cp(path.join(contracts, "task-work-bug/v4/fixtures/project/docs"), path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, ".gitignore"), ".decal/\n.decal-slice-completion.lock\n*.intent.json\n");
  if (policy !== undefined) await writeFile(path.join(root, POLICY_PATH), typeof policy === "string" ? policy : JSON.stringify(policy));
  git(root, "init", "-q", "-b", "main");
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  return root;
}

const context = "## 사용자 요약\n\n```zuz-its-context\n" + JSON.stringify({ schemaVersion: 1, reason: "시험", goal: "시험", completion: "시험", nextAction: "시험" }) + "\n```\n";
const taskIntent = (id, versionImpact, remoteVersionImpact = "none") => ({
  schema: "decal.task-work-bug.task-registration-batch-intent/v7", intentId: id, commitMessage: `docs(tasks): ${id}`,
  tasks: [{ localRef: "t", category: "product", slug: id.replaceAll("-", "_"), title: id, priority: "P1", areas: ["ITS"], summary: "시험", versionImpact, remoteVersionImpact, body: `## Context Budget\n\n- 시험\n\n${context}` }],
});
const ticketIntent = (kind, id) => ({
  schema: "decal.zuz-its.ticket-registration-intent/v9", intentId: id, kind, title: id, priority: "P1", taskRefs: ["1"],
  versionImpact: "desktop-patch", remoteVersionImpact: "remote-patch", releaseMode: "standalone", body: context,
});
async function entry(root, kind, intent, ...rest) {
  const file = path.join(base, `${intent.intentId}-${path.basename(root)}.intent.json`);
  await writeFile(file, JSON.stringify(intent));
  const script = path.join(root, "contracts/task-work-bug/its-register.mjs");
  return run(process.execPath, [script, "--kind", kind, "--root", root, "--intent", file, ...rest], root);
}
function assertRefused(result, field, value) {
  assert.equal(result.status, 2, result.stdout);
  assert.equal(result.body.status, "rejected");
  assert.equal(result.body.code, "unreadable_task_version_impact");
  assert.equal(result.body.policy, POLICY_PATH);
  assert.deepEqual(result.body.violations.map((item) => [item.localRef, item.field, item.value]), [["t", field, value]]);
  assert.match(result.body.next, /Nothing was registered/u);
}

test("a declaring project refuses desktop-patch on dry-run and registers nothing", async () => {
  const root = await makeProject(DECAL_POLICY);
  const head = git(root, "rev-parse", "HEAD");
  const result = await entry(root, "task", taskIntent("refused-task", "desktop-patch"), "--dry-run");
  assertRefused(result, "versionImpact", "desktop-patch");
  assert.deepEqual(result.body.violations[0].allowed, ["desktop-minor", "none"]);
  assert.equal(git(root, "rev-parse", "HEAD"), head);
  assert.equal(git(root, "status", "--porcelain"), "");
});

test("the remote field is checked too, and surrounding spaces do not hide a value", async () => {
  const root = await makeProject(DECAL_POLICY);
  assertRefused(await entry(root, "task", taskIntent("refused-remote", "none", "remote-patch"), "--dry-run"), "remoteVersionImpact", "remote-patch");
  assertRefused(await entry(root, "task", taskIntent("refused-spaced", " desktop-patch "), "--dry-run"), "versionImpact", "desktop-patch");
  const accepted = await entry(root, "task", taskIntent("accepted-spaced", " desktop-minor "), "--dry-run");
  assert.equal(accepted.body.status, "planned", accepted.stdout);
});

test("a write is refused as well, even with a digest in hand", async () => {
  const root = await makeProject(DECAL_POLICY);
  const head = git(root, "rev-parse", "HEAD");
  assertRefused(await entry(root, "task", taskIntent("refused-write", "desktop-patch"), "--approved-digest", `sha256:${"0".repeat(64)}`, "--write"), "versionImpact", "desktop-patch");
  assert.equal(git(root, "rev-parse", "HEAD"), head);
});

test("a declared value registers normally", async () => {
  const root = await makeProject(DECAL_POLICY);
  const intent = taskIntent("declared-value", "desktop-minor", "remote-minor");
  const plan = await entry(root, "task", intent, "--dry-run");
  assert.equal(plan.body.status, "planned", plan.stdout);
  const done = await entry(root, "task", intent, "--approved-digest", plan.body.intentDigest, "--write");
  assert.equal(done.body.status, "committed", done.stdout);
});

test("a project declaring nothing behaves as before", async () => {
  const root = await makeProject();
  const intent = taskIntent("no-policy", "desktop-patch", "remote-patch");
  const plan = await entry(root, "task", intent, "--dry-run");
  assert.equal(plan.body.status, "planned", plan.stdout);
  const table = JSON.parse(await readFile(path.join(root, "contracts/task-work-bug/capabilities.json"), "utf8")).capabilities["register-task-batch"];
  const version = table.platformContracts?.[process.platform] ?? table.contract;
  const intentFile = path.join(base, `${intent.intentId}-${path.basename(root)}.intent.json`);
  const direct = run(process.execPath, [path.join(root, "contracts/task-work-bug", version, "register-task-batch.mjs"), "--root", root, "--intent", intentFile, "--dry-run"], root);
  assert.equal(direct.body.status, "planned", direct.stdout);
  assert.equal(direct.body.intentDigest, plan.body.intentDigest);
  const done = await entry(root, "task", intent, "--approved-digest", plan.body.intentDigest, "--write");
  assert.equal(done.body.status, "committed", done.stdout);
  const document = await readFile(path.join(root, done.body.assigned[0].path), "utf8");
  assert.match(document, /^Version Impact: desktop-patch$/mu);
});

test("Work and Bug keep their patch values in a declaring project", async () => {
  const root = await makeProject(DECAL_POLICY);
  for (const kind of ["work", "bug"]) {
    const intent = ticketIntent(kind, `patch-${kind}`);
    const plan = await entry(root, "ticket", intent, "--dry-run");
    assert.equal(plan.body.status, "planned", `${kind}: ${plan.stdout}`);
    const done = await entry(root, "ticket", intent, "--approved-digest", plan.body.intentDigest, "--write");
    assert.equal(done.body.status, "committed", `${kind}: ${done.stdout}`);
  }
});

test("a broken declaration refuses instead of allowing everything, and never blocks Work or Bug", async () => {
  const root = await makeProject("{ not json");
  const task = await entry(root, "task", taskIntent("broken-policy", "desktop-minor"), "--dry-run");
  assert.equal(task.status, 2);
  assert.equal(task.body.code, "invalid_version_policy");
  assert.equal(task.body.reason, "not_json");
  const work = await entry(root, "ticket", ticketIntent("work", "broken-policy-work"), "--dry-run");
  assert.equal(work.body.status, "planned", work.stdout);
});

test("declaration shapes are read strictly", () => {
  const schema = DECAL_POLICY.schema;
  for (const [source, reason] of [
    ["{", "not_json"],
    ["[]", "unknown_schema"],
    [JSON.stringify({ schema: "other/v1", task: {} }), "unknown_schema"],
    [JSON.stringify({ schema, task: { versionImpact: ["none"] }, extra: 1 }), "unknown_key"],
    [JSON.stringify({ schema }), "task_section_required"],
    [JSON.stringify({ schema, task: {} }), "task_section_keys"],
    [JSON.stringify({ schema, task: { impact: ["none"] } }), "task_section_keys"],
    [JSON.stringify({ schema, task: { versionImpact: [] } }), "task_section_values"],
    [JSON.stringify({ schema, task: { versionImpact: ["a b"] } }), "task_section_values"],
    [JSON.stringify({ schema, task: { versionImpact: "none" } }), "task_section_values"],
  ]) assert.equal(parseVersionPolicy(source).reason, reason, source);
  assert.deepEqual(parseVersionPolicy(JSON.stringify({ schema, task: { versionImpact: ["none"] } })).policy, { versionImpact: ["none"] });
});

test("a list left out of the declaration leaves that field unchecked", async () => {
  const root = await makeProject({ schema: DECAL_POLICY.schema, task: { versionImpact: ["none"] } });
  const plan = await entry(root, "task", taskIntent("partial-policy", "none", "anything-goes"), "--dry-run");
  assert.equal(plan.body.status, "planned", plan.stdout);
});

test("a feature worktree without the file still follows the canonical main's declaration", async () => {
  const root = await makeProject();
  git(root, "branch", "older");
  const worktree = path.join(base, "older-worktree");
  git(root, "worktree", "add", "-q", worktree, "older");
  await writeFile(path.join(root, POLICY_PATH), JSON.stringify(DECAL_POLICY));
  git(root, "add", POLICY_PATH);
  git(root, "commit", "-qm", "declare");
  assertRefused(await entry(worktree, "task", taskIntent("older-worktree", "desktop-patch"), "--dry-run"), "versionImpact", "desktop-patch");
});

test("a paired project is refused before it reaches the number authority", async () => {
  const root = await makeProject(DECAL_POLICY);
  await mkdir(path.join(root, ".decal"), { recursive: true });
  await writeFile(path.join(root, ".decal/its-lan-client.json"), "{}");
  assertRefused(await entry(root, "task", taskIntent("paired-project", "desktop-patch"), "--approved-digest", `sha256:${"0".repeat(64)}`, "--write"), "versionImpact", "desktop-patch");
});

test("an older capability table skips the check, and a tampered v27 stops the entry", async () => {
  const older = await makeProject(DECAL_POLICY);
  const tableFile = path.join(older, "contracts/task-work-bug/capabilities.json");
  const table = JSON.parse(await readFile(tableFile, "utf8"));
  delete table.capabilities["check-task-version-policy"];
  await writeFile(tableFile, JSON.stringify(table));
  const plan = await entry(older, "task", taskIntent("older-table", "desktop-patch"), "--dry-run");
  assert.equal(plan.body.status, "planned", plan.stdout);

  const tampered = await makeProject(DECAL_POLICY);
  await appendFile(path.join(tampered, "contracts/task-work-bug/v27/task-version-policy.mjs"), "// changed\n");
  const stopped = await entry(tampered, "task", taskIntent("tampered", "none"), "--dry-run");
  assert.equal(stopped.status, 2);
  assert.equal(stopped.body.code, "authoring_update_required");
  assert.equal(stopped.body.contract, "v27");
});
