import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { draftPlan, executePlan, finalizeSettlement, listDrafts, parkSettlement,
  git, gitBoundary, planDigest } from "../packs/decal-pack/src/contracts/task-work-bug/v20/transaction.mjs";
import { executePlan as legacyExecute } from "../packs/decal-pack/src/contracts/task-work-bug/v9/transaction.mjs";
import { digest } from "../packs/decal-pack/src/contracts/task-work-bug/v9/version-profile.mjs";

const pending = ".decal/settlement-pending-v1.json";
const entry = (p, source, next) => ({ path: p, source, next, before: digest(source), after: digest(next) });
async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "its-draft-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "ITS test"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await mkdir(path.join(root, ".decal"));
  const sources = { "task7.md": "before7\n", "task8.md": "before8\n", "index.md": "before\n", "VERSION": "1.0.0\n",
    "unrelated.txt": "base\n", ".decal/settlement-profile.json": "{}\n", ".gitignore": ".decal/settlement-drafts-v1/\n" };
  for (const [p, s] of Object.entries(sources)) await writeFile(path.join(root, p), s);
  await git(root, ["add", "--", ...Object.keys(sources)]);
  await git(root, ["commit", "-m", "fixture"]);
  const plan = { root, baseHead: await gitBoundary(root), operation: "task-completion", recordId: "7",
    message: "chore(its): complete Task 7", reads: [{ path: ".decal/settlement-profile.json", before: digest("{}\n") }],
    entries: [entry("task7.md", "before7\n", "completed7\n"), entry("index.md", "before\n", "completed7\n"), entry("VERSION", "1.0.0\n", "1.1.0\n")] };
  return { root, plan };
}
async function hook(root, source = "#!/bin/sh\nexit 1\n") {
  const target = path.join(root, ".git/hooks/pre-commit");
  await writeFile(target, source, { mode: 0o755 });
  await chmod(target, 0o755);
  return target;
}
async function legacyInterrupted(root, plan) {
  const target = await hook(root);
  await assert.rejects(legacyExecute(plan, planDigest(plan)));
  await chmod(target, 0o644);
}
async function exactCommit(root, plan) {
  await git(root, ["commit", "--only", "-m", plan.message, "-m", `Zuz-ITS-Settlement: ${planDigest(plan)}`,
    "--", ...plan.entries.filter(e => e.before !== e.after).map(e => e.path)]);
}
async function unrelatedCommit(root) {
  await writeFile(path.join(root, "unrelated.txt"), "another session\n");
  await git(root, ["commit", "--only", "-m", "unrelated work", "--", "unrelated.txt"]);
}
test("drafts leave canonical files/HEAD untouched; another Task settles shared index/version; stale replay rejected", async t => {
  const { root, plan } = await fixture(t);
  assert.equal((await draftPlan(plan, planDigest(plan))).state, "draft");
  assert.equal(await gitBoundary(root), plan.baseHead);
  assert.equal(await readFile(path.join(root, "task7.md"), "utf8"), "before7\n");
  assert.equal(await lstat(path.join(root, pending)).catch(() => null), null);
  const other = { ...plan, recordId: "8", message: "chore(its): complete Task 8", entries: [
    entry("task8.md", "before8\n", "completed8\n"), entry("index.md", "before\n", "completed8\n"), entry("VERSION", "1.0.0\n", "1.1.0\n"),
  ] };
  assert.equal((await executePlan(other, planDigest(other))).state, "committed");
  await assert.rejects(executePlan(plan, planDigest(plan)), { code: "stale_head" });
  assert.equal(await readFile(path.join(root, "VERSION"), "utf8"), "1.1.0\n");
  const replanned = { ...plan, baseHead: await gitBoundary(root), entries: [plan.entries[0],
    entry("index.md", "completed8\n", "completed8\ncompleted7\n"), entry("VERSION", "1.1.0\n", "1.2.0\n")] };
  assert.equal((await executePlan(replanned, planDigest(replanned))).state, "committed");
  assert.equal(await readFile(path.join(root, "index.md"), "utf8"), "completed8\ncompleted7\n");
  assert.equal((await listDrafts(root)).length, 3);
});
test("failed Git hook restores only own files and preserves draft and unrelated dirty work", async t => {
  const { root, plan } = await fixture(t);
  await hook(root);
  await writeFile(path.join(root, "unrelated.txt"), "preserve dirty\n");
  await assert.rejects(executePlan(plan, planDigest(plan)), e => e.requestState === "draft");
  for (const e of plan.entries) assert.equal(await readFile(path.join(root, e.path), "utf8"), e.source);
  assert.equal(await readFile(path.join(root, "unrelated.txt"), "utf8"), "preserve dirty\n");
  assert.equal(await lstat(path.join(root, pending)).catch(() => null), null);
  assert.equal((await listDrafts(root))[0].state, "draft");
  await chmod(path.join(root, ".git/hooks/pre-commit"), 0o644);
  assert.equal((await executePlan(plan, planDigest(plan))).state, "committed");
  assert.equal((await git(root, ["rev-list", "--count", "HEAD"])).trim(), "2");
});
test("same plan concurrent execution cannot apply twice", async t => {
  const { root, plan } = await fixture(t);
  const results = await Promise.allSettled([executePlan(plan, planDigest(plan)), executePlan(plan, planDigest(plan))]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await git(root, ["rev-list", "--count", "HEAD"])).trim(), "2");
});
test("legacy finalization accepts unrelated parent advance and preserves later registry/version and dirty record", async t => {
  const { root, plan } = await fixture(t);
  await legacyInterrupted(root, plan);
  await unrelatedCommit(root);
  await exactCommit(root, plan);
  const settled = await gitBoundary(root);
  await writeFile(path.join(root, "index.md"), "next Task\n");
  await writeFile(path.join(root, "VERSION"), "1.2.0\n");
  await git(root, ["commit", "--only", "-m", "later settlement", "--", "index.md", "VERSION"]);
  await writeFile(path.join(root, "task7.md"), "later independent notes\n");
  assert.equal((await finalizeSettlement(root)).settlementCommit, settled);
  assert.equal(await readFile(path.join(root, "task7.md"), "utf8"), "later independent notes\n");
  assert.equal(await readFile(path.join(root, "VERSION"), "utf8"), "1.2.0\n");
  assert.equal((await finalizeSettlement(root)).state, "none");
});
test("legacy park needs exact digest, survives unrelated HEAD, then independent settlement proceeds", async t => {
  const { root, plan } = await fixture(t);
  await legacyInterrupted(root, plan);
  await unrelatedCommit(root);
  await assert.rejects(parkSettlement(root, digest("wrong")), { code: "invalid_recovery_approval" });
  assert.equal((await parkSettlement(root, planDigest(plan))).state, "draft");
  const other = { ...plan, baseHead: await gitBoundary(root), recordId: "8", message: "Task 8",
    entries: [entry("task8.md", "before8\n", "completed8\n")] };
  assert.equal((await executePlan(other, planDigest(other))).state, "committed");
  assert.equal(await readFile(path.join(root, "task7.md"), "utf8"), "before7\n");
});
test("partial preparing journal parks safely; arbitrary mixed content is never compensated", async t => {
  const { root, plan } = await fixture(t);
  await legacyInterrupted(root, plan);
  const markerPath = path.join(root, pending);
  const marker = JSON.parse(await readFile(markerPath, "utf8"));
  marker.phase = "preparing";
  await writeFile(markerPath, JSON.stringify(marker));
  await writeFile(path.join(root, "VERSION"), "1.0.0\n");
  await writeFile(path.join(root, "index.md"), "other session changed this\n");
  await assert.rejects(parkSettlement(root, planDigest(plan)), { code: "recovery_mixed_state" });
  assert.equal(await readFile(path.join(root, "task7.md"), "utf8"), "completed7\n");
  await writeFile(path.join(root, "index.md"), "completed7\n");
  assert.equal((await parkSettlement(root, planDigest(plan))).state, "draft");
});
test("hook-created mixed content is preserved along with global marker and draft", async t => {
  const { root, plan } = await fixture(t);
  await hook(root, "#!/bin/sh\nprintf 'mixed owner\\n' > task7.md\nexit 1\n");
  await assert.rejects(executePlan(plan, planDigest(plan)), { code: "recovery_mixed_state" });
  assert.equal(await readFile(path.join(root, "task7.md"), "utf8"), "mixed owner\n");
  assert.ok(await lstat(path.join(root, pending)));
});
test("mixed exact commit or missing receipt is never acknowledged", async t => {
  const { root, plan } = await fixture(t);
  await legacyInterrupted(root, plan);
  await writeFile(path.join(root, "unrelated.txt"), "mixed commit\n");
  await git(root, ["commit", "--only", "-m", plan.message, "-m", `Zuz-ITS-Settlement: ${planDigest(plan)}`,
    "--", ...plan.entries.map(e => e.path), "unrelated.txt"]);
  await assert.rejects(finalizeSettlement(root), { code: "commit_write_set_mismatch" });
  assert.ok(await lstat(path.join(root, pending)));
});
test("changed-and-reverted read before exact commit fails freshness", async t => {
  const { root, plan } = await fixture(t);
  await legacyInterrupted(root, plan);
  for (const s of ["changed\n", "{}\n"]) {
    await writeFile(path.join(root, ".decal/settlement-profile.json"), s);
    await git(root, ["commit", "--only", "-m", "changed input", "--", ".decal/settlement-profile.json"]);
  }
  await exactCommit(root, plan);
  await assert.rejects(finalizeSettlement(root), { code: "settlement_inputs_changed" });
});
test("symlink draft directory, unapproved and staged writes fail without canonical mutations", async t => {
  const { root, plan } = await fixture(t);
  await assert.rejects(draftPlan(plan, digest("wrong")), { code: "approval_digest_mismatch" });
  await symlink(root, path.join(root, ".decal/settlement-drafts-v1"));
  await assert.rejects(draftPlan(plan, planDigest(plan)), { code: "unsafe_draft_directory" });
  assert.equal(await readFile(path.join(root, "task7.md"), "utf8"), "before7\n");
  await writeFile(path.join(root, "unrelated.txt"), "staged owner\n");
  await git(root, ["add", "unrelated.txt"]);
  await assert.rejects(executePlan(plan, planDigest(plan)), { code: "staged_changes_present" });
  assert.equal((await git(root, ["diff", "--cached", "--name-only"])).trim(), "unrelated.txt");
});
