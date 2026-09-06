import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, realpath, lstat, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { digest } from "../packs/decal-pack/src/contracts/task-work-bug/v8/version-profile.mjs";
import {
  executePlan, finalizeSettlement, git, gitBoundary, planDigest, validatePlan,
} from "../packs/decal-pack/src/contracts/task-work-bug/v8/transaction.mjs";

async function fixture(branch = "main") {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "its-settlement-transaction-")));
  await git(root, ["init", "-b", branch]);
  await git(root, ["config", "user.name", "ITS fixture"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await mkdir(path.join(root, ".decal"));
  const sources = { "record.md": "before\n", "VERSION": "0.1.2\n", "unrelated.txt": "original\n", ".decal/settlement-profile.json": "{}\n" };
  for (const [relative, source] of Object.entries(sources)) await writeFile(path.join(root, relative), source);
  await git(root, ["add", "--", ...Object.keys(sources)]);
  await git(root, ["commit", "-m", "fixture: seed"]);
  const baseHead = await gitBoundary(root);
  const plan = {
    root, baseHead, operation: "task-completion", recordId: "1", message: "chore(its): settle task 1",
    reads: [{ path: ".decal/settlement-profile.json", before: digest(sources[".decal/settlement-profile.json"]) }],
    entries: [
      { path: "record.md", source: sources["record.md"], next: "after\n" },
      { path: "VERSION", source: sources.VERSION, next: "0.2.0\n" },
    ].map((entry) => ({ ...entry, before: digest(entry.source), after: digest(entry.next) })),
  };
  return { root, plan };
}

for (const branch of ["main", "master"]) {
  test(`${branch}: exact commit and finalize preserve unrelated dirty files`, async () => {
    const { root, plan } = await fixture(branch);
    await writeFile(path.join(root, "unrelated.txt"), "another session\n");
    const preview = await validatePlan(plan);
    assert.equal(preview.approvalDigest, planDigest(plan));
    assert.equal(await readFile(path.join(root, "record.md"), "utf8"), "before\n");
    const result = await executePlan(plan, preview.approvalDigest);
    assert.equal(result.state, "committed");
    assert.deepEqual((await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", result.settlementCommit])).trim().split("\n").sort(), ["VERSION", "record.md"]);
    assert.equal(await readFile(path.join(root, "unrelated.txt"), "utf8"), "another session\n");
    assert.equal((await git(root, ["status", "--porcelain"])).trim(), "M unrelated.txt");
    assert.deepEqual(await finalizeSettlement(root), { state: "none" });
    assert.equal((await git(root, ["rev-list", "--count", "HEAD"])).trim(), "2");
  });
}

test("unapproved digest or altered source cannot write", async () => {
  const { root, plan } = await fixture();
  await assert.rejects(executePlan(plan, digest("forged")), { code: "approval_digest_mismatch" });
  await writeFile(path.join(root, "record.md"), "newer owner\n");
  await assert.rejects(executePlan(plan, planDigest(plan)), { code: "stale_source" });
  assert.equal(await readFile(path.join(root, "record.md"), "utf8"), "newer owner\n");
  assert.equal(await readFile(path.join(root, "VERSION"), "utf8"), "0.1.2\n");
});

test("staged work is not included or unstaged", async () => {
  const { root, plan } = await fixture();
  await writeFile(path.join(root, "unrelated.txt"), "staged owner\n");
  await git(root, ["add", "unrelated.txt"]);
  await assert.rejects(executePlan(plan, planDigest(plan)), { code: "staged_changes_present" });
  assert.equal((await git(root, ["diff", "--cached", "--name-only"])).trim(), "unrelated.txt");
});

test("HEAD movement and worktree branch invalidate settlement plans", async () => {
  const { root, plan } = await fixture();
  await git(root, ["commit", "--allow-empty", "-m", "another checkpoint"]);
  await assert.rejects(executePlan(plan, planDigest(plan)), { code: "stale_head" });
  await git(root, ["switch", "-c", "codex/fixture"]);
  await assert.rejects(validatePlan(plan), { code: "main_branch_required" });
});

test("two simultaneous writes do not bump twice", async () => {
  const { root, plan } = await fixture();
  const results = await Promise.allSettled([executePlan(plan, planDigest(plan)), executePlan(plan, planDigest(plan))]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await git(root, ["rev-list", "--count", "HEAD"])).trim(), "2");
  assert.equal(await readFile(path.join(root, "VERSION"), "utf8"), "0.2.0\n");
});

test("pending foreign settlement and symlink lock remain untouched", async () => {
  const { root, plan } = await fixture();
  const marker = path.join(root, ".decal/settlement-pending-v1.json");
  await writeFile(marker, '{"owner":"someone else"}\n');
  await assert.rejects(executePlan(plan, planDigest(plan)), { code: "pending_transaction" });
  assert.equal(await readFile(marker, "utf8"), '{"owner":"someone else"}\n');
  const second = await fixture();
  await symlink(path.join(second.root, "unrelated.txt"), path.join(second.root, ".decal-slice-completion.lock"));
  await assert.rejects(executePlan(second.plan, planDigest(second.plan)), { code: "unsafe_repository_lock" });
  assert.equal(await readFile(path.join(second.root, "unrelated.txt"), "utf8"), "original\n");
});

test("failed commit leaves sealed recovery evidence, no reset", async () => {
  const { root, plan } = await fixture();
  const hook = path.join(root, ".git/hooks/pre-commit");
  await writeFile(hook, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
  await assert.rejects(executePlan(plan, planDigest(plan)));
  const pending = JSON.parse(await readFile(path.join(root, ".decal/settlement-pending-v1.json"), "utf8"));
  assert.equal(pending.phase, "sealed");
  assert.equal(pending.intentDigest, planDigest(plan));
  assert.equal(await readFile(path.join(root, "record.md"), "utf8"), "after\n");
  assert.equal(await readFile(path.join(root, "VERSION"), "utf8"), "0.2.0\n");
  assert.equal(await lstat(path.join(root, ".decal-slice-completion.lock")).catch(() => null), null);
  await assert.rejects(finalizeSettlement(root), { code: "settlement_commit_required" });
  // Simulate the user-approved exact commit after the local hook is repaired.
  await writeFile(hook, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await git(root, ["commit", "--only", "-m", plan.message, "-m", `Zuz-ITS-Settlement: ${planDigest(plan)}`, "--", "record.md", "VERSION"]);
  assert.equal((await finalizeSettlement(root)).state, "committed");
});
