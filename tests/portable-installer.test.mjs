import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { repositoryRoot } from "../scripts/pack-lib.mjs";

const installer = path.join(repositoryRoot, "scripts/install-decal-pack.mjs");
const revision = "f".repeat(40);
execFileSync(process.execPath, [path.join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", revision]);
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "zuz-pack-fixture-"));
const packagePath = path.join(fixtureRoot, "decal-pack-2.0.1.zuz-pack.json");
await writeFile(packagePath, await readFile(path.join(repositoryRoot, "dist/decal-pack-2.0.1.zuz-pack.json")));
const packageValue = JSON.parse(await readFile(packagePath, "utf8"));

function run(root, mode, approved = null) {
  const args = [installer, "--package", packagePath, "--root", root, "--module", "task-work-bug", "--provider", "codex", "--provider", "claude", mode];
  if (approved) args.push("--approved-manifest-sha256", approved);
  const result = spawnSync(process.execPath, args, { encoding: "utf8" });
  return { ...result, value: JSON.parse(result.stdout) };
}

test("portable installer previews exact ITS paths and preserves unrelated skills", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zuz-pack-install-"));
  try {
    await mkdir(path.join(root, ".claude/skills/deploy"), { recursive: true });
    await writeFile(path.join(root, ".claude/skills/deploy/SKILL.md"), "user deploy skill\n");
    const preview = run(root, "--dry-run");
    assert.equal(preview.status, 0);
    assert.equal(preview.value.status, "planned");
    assert.ok(preview.value.writeSet.includes("contracts/zuz-its/v2/register-incident.mjs"));
    assert.ok(preview.value.writeSet.includes("skills/zuz-its/SKILL.md"));
    assert.ok(preview.value.writeSet.includes(".claude/skills/decal-incident/SKILL.md"));
    assert.equal(preview.value.writeSet.includes(".claude/skills/deploy/SKILL.md"), false);
    const rejected = run(root, "--write", "0".repeat(64));
    assert.equal(rejected.status, 2);
    assert.equal(rejected.value.code, "approval_digest_mismatch");
    const installed = run(root, "--write", packageValue.manifestSha256);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(installed.value.status, "installed");
    assert.equal(await readFile(path.join(root, ".claude/skills/deploy/SKILL.md"), "utf8"), "user deploy skill\n");
    const lock = JSON.parse(await readFile(path.join(root, ".decal/decal-pack.lock.json"), "utf8"));
    assert.equal(lock.packVersion, "2.0.1");
    assert.equal(lock.manifestSha256, packageValue.manifestSha256);
    const repeated = run(root, "--dry-run");
    assert.equal(repeated.value.createCount, 0);
    assert.equal(repeated.value.conflicts.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("portable installer blocks a user-owned target conflict", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zuz-pack-conflict-"));
  try {
    await mkdir(path.join(root, "skills/zuz-its"), { recursive: true });
    await writeFile(path.join(root, "skills/zuz-its/SKILL.md"), "user version\n");
    const preview = run(root, "--dry-run");
    assert.equal(preview.value.status, "blocked");
    assert.deepEqual(preview.value.conflicts, ["skills/zuz-its/SKILL.md"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test.after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});
