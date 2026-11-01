import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const contracts = fileURLToPath(new URL("../packs/decal-pack/src/contracts", import.meta.url));
const base = await realpath(await mkdtemp(path.join(tmpdir(), "its-lifecycle-v28-")));
after(() => rm(base, { recursive: true, force: true }));
const env = { ...process.env, GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" };
delete env.DECAL_SESSION_ID;

const RECORD = "docs/work-items/bugs/BUG-1.md";
const LIFECYCLE = "contracts/task-work-bug/v28/work-item-lifecycle.mjs";
const OLD_LIFECYCLE = "contracts/task-work-bug/v11/work-item-lifecycle.mjs";
const PROFILE = ".decal/settlement-profile.json";
const SOURCE = `---
schema: decal.task-work-bug.bug-card
schemaVersion: 1
id: BUG-1
title: "Fixture"
status: new
priority: P2
taskRefs: []
nextAction: "Fixture"
versionImpact: desktop-patch
remoteVersionImpact: none
releaseMode: standalone
releaseTaskRef: null
versionApplied: pending
remoteVersionApplied: not-required
createdAt: "2026-11-01T00:00:00.000Z"
updatedAt: "2026-11-01T00:00:00.000Z"
blocked: null
completion: null
closure: null
---

Fixture body
`;

const run = (file, args, cwd, extraEnv = {}) => {
  const result = spawnSync(file, args, { cwd, env: { ...env, ...extraEnv }, encoding: "utf8" });
  let body = null;
  try { body = JSON.parse(result.stdout.trim().split("\n").at(-1)); } catch { /* not json */ }
  return { ...result, body };
};
const git = (cwd, ...args) => { const result = run("git", args, cwd); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
const revision = (source) => `sha256:${createHash("sha256").update(source).digest("hex")}`;

let projects = 0;
async function makeProject() {
  const root = path.join(base, `project-${projects += 1}`);
  await mkdir(path.join(root, "docs/work-items/bugs"), { recursive: true });
  await mkdir(path.join(root, ".decal"));
  await cp(contracts, path.join(root, "contracts"), { recursive: true });
  await writeFile(path.join(root, RECORD), SOURCE);
  await writeFile(path.join(root, ".gitignore"), ".decal/\n.decal-slice-completion.lock\n");
  await writeFile(path.join(root, "package.json"), `${JSON.stringify({ version: "1.0.0" })}\n`);
  git(root, "init", "-q", "-b", "main");
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  return root;
}

async function request(root, source, overrides = {}) {
  const file = path.join(root, "..", `request-${path.basename(root)}.json`);
  await writeFile(file, JSON.stringify({
    schema: "zuz.its.work-item-lifecycle-request/v2", kind: "bug", id: "BUG-1", target: "confirmed",
    expectedSourceRevision: revision(source), timestamp: "2026-11-02T00:00:00.000Z",
    releaseStage: null, releaseStageSource: "defaulted", ...overrides,
  }));
  return file;
}
const lifecycle = (root, script, ...args) => run(process.execPath, [script, "--root", root, ...args], root);
const dryRun = async (root, script = LIFECYCLE) => lifecycle(root, script, "--request", await request(root, await readFile(path.join(root, RECORD), "utf8")), "--dry-run");
async function transition(root) {
  const file = await request(root, await readFile(path.join(root, RECORD), "utf8"));
  const preview = lifecycle(root, LIFECYCLE, "--request", file, "--dry-run");
  assert.equal(preview.body?.status, "preview", preview.stdout);
  return lifecycle(root, LIFECYCLE, "--request", file, "--write", "--approved-plan-digest", preview.body.approvalDigest);
}
const portableProfile = (engine = "portable") => JSON.stringify({ schema: "zuz.its.settlement-profile/v1", engine, channels: { desktop: "app", remote: null }, products: [{ id: "app", files: [{ path: "package.json", format: "json", pointers: ["/version"] }] }] });

test("the published v11 lifecycle needs the profile that an install does not create", async () => {
  const root = await makeProject();
  assert.equal((await dryRun(root, OLD_LIFECYCLE)).body.code, "ENOENT");
});

test("without a profile a transition commits exactly its record and creates no profile", async () => {
  const root = await makeProject();
  const before = git(root, "rev-parse", "HEAD");
  const preview = await dryRun(root);
  assert.equal(preview.body.status, "preview");
  assert.equal(preview.body.settlementProfile, "not-required-for-this-transition");
  assert.equal(git(root, "rev-parse", "HEAD"), before);
  assert.equal(await readFile(path.join(root, RECORD), "utf8"), SOURCE);

  const applied = await transition(root);
  assert.equal(applied.body.state, "committed", applied.stdout);
  assert.equal(applied.body.to, "confirmed");
  assert.equal(git(root, "rev-parse", "HEAD~1"), before);
  assert.equal(git(root, "show", "--name-only", "--format=", "HEAD"), RECORD);
  assert.match(git(root, "log", "-1", "--format=%B"), /chore\(its\): BUG-1 confirmed[\s\S]*Zuz-ITS-Transition: sha256:/u);
  assert.equal(git(root, "status", "--short"), "");
  assert.match(await readFile(path.join(root, RECORD), "utf8"), /^status: confirmed$/mu);
  await assert.rejects(readFile(path.join(root, PROFILE)), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(root, ".decal-slice-completion.lock")), { code: "ENOENT" });
});

test("a record can go from new to closed without a profile and keeps its version pending", async () => {
  const root = await makeProject();
  const step = async (target, details = {}) => {
    const file = await request(root, await readFile(path.join(root, RECORD), "utf8"), { target, ...details });
    const preview = lifecycle(root, LIFECYCLE, "--request", file, "--dry-run");
    assert.equal(preview.body.status, "preview", preview.stdout);
    const applied = lifecycle(root, LIFECYCLE, "--request", file, "--write", "--approved-plan-digest", preview.body.approvalDigest);
    assert.equal(applied.body.state, "committed", applied.stdout);
  };
  await step("confirmed");
  await step("in_progress");
  await step("development_complete", { summary: "Fixed", evidence: ["Test passed"] });
  await step("closed", { reason: "fixed" });
  const source = await readFile(path.join(root, RECORD), "utf8");
  assert.match(source, /^status: closed$/mu);
  assert.match(source, /^versionApplied: pending$/mu);
  assert.equal(git(root, "rev-list", "--count", "HEAD"), "5");
});

test("a project without a .decal folder can still move a record", async () => {
  const root = await makeProject();
  await rm(path.join(root, ".decal"), { recursive: true });
  assert.equal((await transition(root)).body.state, "committed");
});

test("the approval digest binds the record and a wrong digest changes nothing", async () => {
  const root = await makeProject();
  const file = await request(root, SOURCE);
  const before = git(root, "rev-parse", "HEAD");
  const rejected = lifecycle(root, LIFECYCLE, "--request", file, "--write", "--approved-plan-digest", `sha256:${"0".repeat(64)}`);
  assert.equal(rejected.body.code, "approval_digest_mismatch");
  assert.equal(git(root, "rev-parse", "HEAD"), before);
  assert.equal(await readFile(path.join(root, RECORD), "utf8"), SOURCE);
});

test("a stale revision, a modified record and a staged change are refused", async () => {
  const stale = await makeProject();
  const staleResult = lifecycle(stale, LIFECYCLE, "--request", await request(stale, "other"), "--dry-run");
  assert.equal(staleResult.body.code, "stale_source_revision");

  const dirty = await makeProject();
  await writeFile(path.join(dirty, RECORD), `${SOURCE}\nlocal edit\n`);
  assert.equal((await dryRun(dirty)).body.code, "target_dirty");

  const staged = await makeProject();
  await writeFile(path.join(staged, "other.txt"), "x");
  git(staged, "add", "other.txt");
  assert.equal((await dryRun(staged)).body.code, "staged_changes_present");
});

test("a pending settlement journal stops the transition", async () => {
  const root = await makeProject();
  await writeFile(path.join(root, ".decal/settlement-pending-v1.json"), "{}");
  assert.equal((await dryRun(root)).body.code, "pending_transaction");
});

test("a refused commit restores the record", { skip: process.platform === "win32" }, async () => {
  const root = await makeProject();
  const hook = path.join(root, ".git/hooks/pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n");
  await chmod(hook, 0o755);
  const before = git(root, "rev-parse", "HEAD");
  const result = await transition(root);
  assert.equal(result.body.code, "transition_commit_failed");
  assert.equal(git(root, "rev-parse", "HEAD"), before);
  assert.equal(await readFile(path.join(root, RECORD), "utf8"), SOURCE);
  assert.equal(git(root, "status", "--short"), "");
  await assert.rejects(readFile(path.join(root, ".decal-slice-completion.lock")), { code: "ENOENT" });
});

test("with a profile the v11 lifecycle runs unchanged", async () => {
  const root = await makeProject();
  await writeFile(path.join(root, PROFILE), portableProfile());
  git(root, "add", "-f", PROFILE);
  git(root, "commit", "-qm", "profile");
  const current = await dryRun(root);
  const old = await dryRun(root, OLD_LIFECYCLE);
  assert.equal(current.body.status, "preview", current.stdout);
  assert.equal(current.body.approvalDigest, old.body.approvalDigest);
  assert.equal(current.body.settlementProfile, undefined);
});

test("a repository engine, a broken profile and a linked profile are refused", async () => {
  const repository = await makeProject();
  await writeFile(path.join(repository, PROFILE), portableProfile("repository"));
  assert.equal((await dryRun(repository)).body.code, "repository_settlement_required");

  const broken = await makeProject();
  await writeFile(path.join(broken, PROFILE), "{");
  const brokenResult = await dryRun(broken);
  assert.equal(brokenResult.body.status, "rejected");
  assert.notEqual(brokenResult.body.code, "ENOENT");

  const linked = await makeProject();
  await symlink(path.join(linked, "README-missing"), path.join(linked, PROFILE));
  assert.equal((await dryRun(linked)).body.code, "unsafe_file");
});

test("a Decal-owned session keeps the Native boundary", async () => {
  const root = await makeProject();
  const result = run(process.execPath, [LIFECYCLE, "--root", root, "--request", await request(root, SOURCE), "--dry-run"], root, { DECAL_SESSION_ID: "session" });
  assert.equal(result.body.code, "native_authority_required");
});

test("a tampered contract is refused", async () => {
  const root = await makeProject();
  await writeFile(path.join(root, LIFECYCLE), `${await readFile(path.join(root, LIFECYCLE), "utf8")}\n`);
  assert.equal((await dryRun(root)).body.status, "rejected");
});
