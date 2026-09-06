import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, mkdir, readFile, writeFile, realpath, lstat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { digest } from "../packs/decal-pack/src/contracts/task-work-bug/v8/version-profile.mjs";
import { git, gitBoundary, planDigest, recoverSettlement } from "../packs/decal-pack/src/contracts/task-work-bug/v8/transaction.mjs";

const run = promisify(execFile);
const contracts = fileURLToPath(new URL("../packs/decal-pack/src/contracts/task-work-bug/", import.meta.url));
async function crashedFixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "its-crashed-settlement-")));
  await cp(contracts, path.join(root, "contracts/task-work-bug"), { recursive: true });
  await mkdir(path.join(root, ".decal"));
  await writeFile(path.join(root, ".decal/settlement-profile.json"), "{}\n");
  await writeFile(path.join(root, "record.md"), "before\n");
  await writeFile(path.join(root, "VERSION"), "0.1.2\n");
  await writeFile(path.join(root, "unrelated.txt"), "original\n");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Fixture"]); await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await git(root, ["add", "."]); await git(root, ["commit", "-m", "fixture base"]);
  const plan = {
    root, baseHead: await gitBoundary(root), operation: "task-completion", recordId: "1", message: "chore(its): fixture settlement",
    reads: [{ path: ".decal/settlement-profile.json", before: digest("{}\n") }],
    entries: [{ path: "record.md", source: "before\n", next: "after\n" }, { path: "VERSION", source: "0.1.2\n", next: "0.2.0\n" }]
      .map((item) => ({ ...item, before: digest(item.source), after: digest(item.next) })),
  };
  await writeFile(path.join(root, "plan.json"), JSON.stringify(plan));
  await writeFile(path.join(root, "unrelated.txt"), "other owner\n");
  const injection = "import fs from 'node:fs/promises'; import {syncBuiltinESMExports} from 'node:module'; const rename=fs.rename; fs.rename=async(a,b)=>{await rename(a,b); if(b.endsWith('/record.md')) process.exit(86);}; syncBuiltinESMExports();";
  const script = "import {readFile} from 'node:fs/promises'; import {executePlan,planDigest} from './contracts/task-work-bug/v8/transaction.mjs'; const plan=JSON.parse(await readFile('plan.json','utf8')); await executePlan(plan,planDigest(plan));";
  await assert.rejects(run(process.execPath, ["--import", `data:text/javascript,${encodeURIComponent(injection)}`, "--input-type=module", "-e", script], { cwd: root }), { code: 86 });
  assert.equal(JSON.parse(await readFile(path.join(root, ".decal/settlement-pending-v1.json"), "utf8")).phase, "preparing");
  assert.equal(await readFile(path.join(root, "record.md"), "utf8"), "after\n");
  assert.equal(await readFile(path.join(root, "VERSION"), "utf8"), "0.1.2\n");
  return { root, plan, approvedDigest: planDigest(plan) };
}

for (const action of ["resume", "rollback"]) {
  test(`actual process exit after first write: ${action} preserves outside changes`, async () => {
    const { root, approvedDigest } = await crashedFixture();
    const result = await recoverSettlement({ root, approvedDigest, action, writersPaused: true });
    assert.equal(result.state, action === "resume" ? "committed" : "rolled-back");
    assert.equal(await readFile(path.join(root, "record.md"), "utf8"), action === "resume" ? "after\n" : "before\n");
    assert.equal(await readFile(path.join(root, "VERSION"), "utf8"), action === "resume" ? "0.2.0\n" : "0.1.2\n");
    assert.equal(await readFile(path.join(root, "unrelated.txt"), "utf8"), "other owner\n");
    assert.equal(await lstat(path.join(root, ".decal/settlement-pending-v1.json")).catch(() => null), null);
  });
}

test("mixed edits and forged approval preserve all bytes and recovery evidence", async () => {
  const { root, approvedDigest } = await crashedFixture();
  await assert.rejects(recoverSettlement({ root, approvedDigest: digest("wrong"), action: "rollback", writersPaused: true }), { code: "invalid_recovery_approval" });
  await writeFile(path.join(root, "VERSION"), "another session edit\n");
  await assert.rejects(recoverSettlement({ root, approvedDigest, action: "rollback", writersPaused: true }), { code: "recovery_mixed_state" });
  assert.equal(await readFile(path.join(root, "record.md"), "utf8"), "after\n");
  assert.equal(await readFile(path.join(root, "VERSION"), "utf8"), "another session edit\n");
  assert.equal((await lstat(path.join(root, ".decal/settlement-pending-v1.json"))).isFile(), true);
});

test("writers-paused never removes a live owner's lock", async () => {
  const { root, approvedDigest } = await crashedFixture();
  const lock = path.join(root, ".decal-slice-completion.lock");
  const live = JSON.stringify({ pid: process.pid, token: "live-fixture-owner" });
  await writeFile(lock, live);
  await assert.rejects(recoverSettlement({ root, approvedDigest, action: "resume", writersPaused: true }), { code: "lock_owner_alive" });
  assert.equal(await readFile(lock, "utf8"), live);
});
