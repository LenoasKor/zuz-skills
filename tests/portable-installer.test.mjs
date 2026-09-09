import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { installPackage } from "../scripts/install-decal-pack.mjs";
import { repositoryRoot, sha256, stableJson } from "../scripts/pack-lib.mjs";

const installer = path.join(repositoryRoot, "scripts/install-decal-pack.mjs");
const revision = "f".repeat(40);
const sourceDescriptor = JSON.parse(await readFile(path.join(repositoryRoot, "packs/decal-pack/pack.source.json"), "utf8"));
execFileSync(process.execPath, [path.join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", revision]);
const fixtureRoot = await mkdtemp(path.join(tmpdir(), "zuz-pack-fixture-"));
const packagePath = path.join(fixtureRoot, `decal-pack-${sourceDescriptor.packVersion}.zuz-pack.json`);
await writeFile(packagePath, await readFile(path.join(repositoryRoot, `dist/decal-pack-${sourceDescriptor.packVersion}.zuz-pack.json`)));
const packageValue = JSON.parse(await readFile(packagePath, "utf8"));

function sealPackage(value) {
  const next = structuredClone(value);
  delete next.manifestSha256;
  const unsigned = {
    ...next,
    files: next.files.map(({ contentBase64: _contentBase64, ...file }) => file),
  };
  return { ...next, manifestSha256: sha256(stableJson(unsigned)) };
}

function oldPackageFixture() {
  const old = structuredClone(packageValue);
  old.packVersion = "2.0.0";
  old.schemaVersion = 1;
  delete old.requiredFiles;
  old.sourceRevision = "e".repeat(40);
  const changed = old.files.find((file) => file.sourcePath === "skills/agents/decal-task/SKILL.md");
  assert.ok(changed);
  const changedBytes = Buffer.from(`${Buffer.from(changed.contentBase64, "base64").toString("utf8")}\n<!-- Pack 2.0.0 fixture -->\n`);
  changed.contentBase64 = changedBytes.toString("base64");
  changed.size = changedBytes.byteLength;
  changed.sha256 = sha256(changedBytes);
  old.files = old.files.filter((file) => file.sourcePath !== "contracts/task-work-bug/v7/fixtures/work-intent.json");
  const obsoleteBytes = Buffer.from("Pack 2.0.0 managed obsolete fixture\n");
  old.files.push({
    sourcePath: "contracts/task-work-bug/obsolete-v200.txt",
    moduleId: "task-work-bug",
    sha256: sha256(obsoleteBytes),
    size: obsoleteBytes.byteLength,
    executable: false,
    installTargets: [{ provider: "shared", path: "contracts/task-work-bug/obsolete-v200.txt" }],
    contentBase64: obsoleteBytes.toString("base64"),
  });
  return sealPackage(old);
}

const oldPackagePath = path.join(fixtureRoot, "decal-pack-2.0.0.zuz-pack.json");
await writeFile(oldPackagePath, `${stableJson(oldPackageFixture())}\n`);

function run(root, mode, approved = null, options = {}) {
  const selectedPackage = options.packagePath ?? packagePath;
  const providers = options.providers ?? ["codex", "claude"];
  const modules = options.modules ?? ["task-work-bug"];
  const invocation = [installer, "--package", selectedPackage, "--root", root];
  for (const moduleId of modules) invocation.push("--module", moduleId);
  for (const provider of providers) invocation.push("--provider", provider);
  invocation.push(mode);
  if (approved) invocation.push("--approved-plan-digest", approved);
  const result = spawnSync(process.execPath, invocation, { encoding: "utf8" });
  return { ...result, value: JSON.parse(result.stdout) };
}

async function installOld(root) {
  const preview = run(root, "--dry-run", null, { packagePath: oldPackagePath });
  assert.equal(preview.status, 0, preview.stderr);
  const installed = run(root, "--write", preview.value.installationPlanDigest, { packagePath: oldPackagePath });
  assert.equal(installed.status, 0, installed.stderr);
  return installed;
}

async function readOrAbsent(target) {
  try {
    return await readFile(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

test("installed Pack carries the runner for all providers and settles a Showcase-shaped product without Decal", async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "zuz-pack-settlement-smoke-")));
  const providers = ["codex", "claude", "gemini", "acp"];
  const modules = ["portable-core", "task-work-bug"];
  const preview = run(root, "--dry-run", null, { providers, modules });
  assert.equal(preview.status, 0);
  assert.ok(preview.value.writeSet.includes("contracts/task-work-bug/v8/manifest.json"));
  assert.equal(preview.value.writeSet.includes(".decal/settlement-profile.json"), false);
  const installed = run(root, "--write", preview.value.installationPlanDigest, { providers, modules });
  assert.equal(installed.status, 0, installed.stdout);
  const skillPaths = ["skills", ".claude/skills", ".gemini/skills", ".agents/skills"];
  for (const id of ["decal-task", "decal-work", "decal-bug", "decal-incident", "zuz-its", "decal-commit-ready", "decal-slice", "decal-slice-maintenance"]) {
    const file = packageValue.files.find((item) => item.sourcePath === `skills/agents/${id}/SKILL.md` || item.sourcePath === `generated/skills/${id}/SKILL.md`);
    const expected = Buffer.from(file.contentBase64, "base64");
    for (const prefix of skillPaths) assert.deepEqual(await readFile(path.join(root, prefix, id, "SKILL.md")), expected, `${prefix}/${id}`);
  }
  const env = { ...process.env }; delete env.DECAL_SESSION_ID;
  const node = (file, args = []) => JSON.parse(execFileSync(process.execPath, [path.join(root, "contracts/task-work-bug/v8", file), ...args], { cwd: root, env, encoding: "utf8" }));
  assert.equal(node("verify-contract.mjs").status, "accepted");
  // No project initialization or release profile is silently installed.
  assert.equal(await readOrAbsent(path.join(root, ".decal/settlement-profile.json")), null);
  await mkdir(path.join(root, ".decal"), { recursive: true });
  await mkdir(path.join(root, "product/src-tauri"), { recursive: true });
  const initial = {
    "product/package.json": '{"name":"showcase-fixture","version":"0.1.2"}\n',
    "product/package-lock.json": '{"version":"0.1.2","packages":{"":{"version":"0.1.2"},"node_modules/dependency":{"version":"9.8.7"}}}\n',
    "product/src-tauri/tauri.conf.json": '{"version":"0.1.2"}\n',
    "product/src-tauri/Cargo.toml": '[package]\nname = "showcase-fixture"\nversion = "0.1.2"\n\n[dependencies]\nserde = "1"\n',
    "product/src-tauri/Cargo.lock": 'version = 3\n\n[[package]]\nname = "showcase-fixture"\nversion = "0.1.2"\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\nsource = "registry+https://example.invalid"\n',
  };
  for (const [file, source] of Object.entries(initial)) await writeFile(path.join(root, file), source);
  await writeFile(path.join(root, ".decal/settlement-profile.json"), JSON.stringify({
    schema: "zuz.its.settlement-profile/v1", engine: "portable", channels: { desktop: "showcase", remote: null }, products: [{ id: "showcase", files: [
      { path: "product/package.json", format: "json", pointers: ["/version"] },
      { path: "product/package-lock.json", format: "json", pointers: ["/version", "/packages//version"] },
      { path: "product/src-tauri/tauri.conf.json", format: "json", pointers: ["/version"] },
      { path: "product/src-tauri/Cargo.toml", format: "cargo-package" },
      { path: "product/src-tauri/Cargo.lock", format: "cargo-lock-package", packageName: "showcase-fixture" },
    ] }],
  }));
  await mkdir(path.join(root, "docs/work-items/work"), { recursive: true });
  await writeFile(path.join(root, "docs/work-items/work/WORK-001.md"), ["---", "schema: decal.task-work-bug.work-document", "schemaVersion: 1", "id: WORK-001", "status: closed",
    "versionImpact: desktop-patch", "remoteVersionImpact: none", "releaseMode: standalone", "releaseTaskRef: null", "versionApplied: pending", "remoteVersionApplied: not-required", "taskRefs: []",
    "completion:", '  summary: "isolated fixture"', "  evidence:", '    - "fixture only"', "closure:", "  reason: completed", "---", ""].join("\n"));
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git(["init", "-b", "main"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  git(["add", "."]); git(["commit", "-m", "fixture: approved project profile and implementation"]);
  const args = ["--root", root, "--kind", "work", "--id", "WORK-001"];
  const settlement = node("settle-work-item.mjs", [...args, "--dry-run"]);
  assert.equal(settlement.writeSet.length, 6);
  assert.equal(node("settle-work-item.mjs", [...args, "--write", "--approved-plan-digest", settlement.approvalDigest]).state, "committed");
  for (const file of Object.keys(initial)) assert.match(await readFile(path.join(root, file), "utf8"), /0\.1\.3/);
  const lock = JSON.parse(await readFile(path.join(root, "product/package-lock.json"), "utf8"));
  assert.equal(lock.packages["node_modules/dependency"].version, "9.8.7");
  assert.equal(await readOrAbsent(path.join(root, ".decal/settlement-pending-v1.json")), null);
  assert.equal(node("settle-work-item.mjs", [...args, "--dry-run"]).alreadySettled, true);
});

test("initial bootstrap binds canonical root, release, selection, and exact files to one approved plan", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zuz-pack-install-"));
  const otherRoot = await mkdtemp(path.join(tmpdir(), "zuz-pack-install-other-"));
  try {
    await mkdir(path.join(root, ".claude/skills/deploy"), { recursive: true });
    await writeFile(path.join(root, ".claude/skills/deploy/SKILL.md"), "user deploy skill\n");
    const preview = run(root, "--dry-run");
    assert.equal(preview.status, 0);
    assert.equal(preview.value.status, "planned");
    assert.equal(preview.value.mode, "initial-pack-bootstrap");
    assert.match(preview.value.installationPlanDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(preview.value.projectRoot, await import("node:fs/promises").then(({ realpath }) => realpath(root)));
    assert.ok(preview.value.plannedFiles.every((file) => /^[0-9a-f]{64}$/u.test(file.sha256)));
    assert.ok(preview.value.writeSet.includes("contracts/zuz-its/v2/register-incident.mjs"));
    assert.ok(preview.value.writeSet.includes("skills/zuz-its/SKILL.md"));
    assert.ok(preview.value.writeSet.includes(".claude/skills/decal-incident/SKILL.md"));
    assert.equal(preview.value.writeSet.includes(".claude/skills/deploy/SKILL.md"), false);
    const otherPreview = run(otherRoot, "--dry-run");
    assert.notEqual(otherPreview.value.installationPlanDigest, preview.value.installationPlanDigest);

    const rejected = run(root, "--write", `sha256:${"0".repeat(64)}`);
    assert.equal(rejected.status, 2);
    assert.equal(rejected.value.code, "approval_plan_digest_mismatch");
    const installed = run(root, "--write", preview.value.installationPlanDigest);
    assert.equal(installed.status, 0, installed.stderr);
    assert.equal(installed.value.status, "installed");
    assert.equal(await readFile(path.join(root, ".claude/skills/deploy/SKILL.md"), "utf8"), "user deploy skill\n");
    const lock = JSON.parse(await readFile(path.join(root, ".decal/decal-pack.lock.json"), "utf8"));
    assert.equal(lock.packVersion, sourceDescriptor.packVersion);
    assert.equal(lock.manifestSha256, packageValue.manifestSha256);
    assert.equal(lock.mode, "initial-pack-bootstrap");
    assert.equal(lock.installationPlanDigest, preview.value.installationPlanDigest);
    assert.equal(lock.previousRelease, null);
    assert.deepEqual(lock.files, preview.value.plannedFiles.map(({ path: filePath, provider, sha256: digest }) => ({ path: filePath, provider, sha256: digest })));
    const repeated = run(root, "--dry-run");
    assert.equal(repeated.value.status, "current");
    assert.equal(repeated.value.createCount, 0);
    assert.equal(repeated.value.updateCount, 0);
    assert.deepEqual(repeated.value.writeSet, []);

    delete lock.packageSha256;
    await writeFile(path.join(root, ".decal/decal-pack.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    const legacyReceipt = run(root, "--dry-run");
    assert.equal(legacyReceipt.status, 0, legacyReceipt.stderr);
    assert.equal(legacyReceipt.value.status, "planned");
    assert.equal(legacyReceipt.value.mode, "update");
    assert.equal(legacyReceipt.value.createCount, 0);
    assert.equal(legacyReceipt.value.updateCount, 0);
    assert.deepEqual(legacyReceipt.value.writeSet, [".decal/decal-pack.lock.json"]);

    lock.packageSha256 = "0".repeat(64);
    await writeFile(path.join(root, ".decal/decal-pack.lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    const mismatchedReceipt = run(root, "--dry-run");
    assert.equal(mismatchedReceipt.status, 0, mismatchedReceipt.stderr);
    assert.equal(mismatchedReceipt.value.status, "planned");
    assert.deepEqual(mismatchedReceipt.value.writeSet, [".decal/decal-pack.lock.json"]);
    const refreshedReceipt = run(root, "--write", mismatchedReceipt.value.installationPlanDigest);
    assert.equal(refreshedReceipt.status, 0, refreshedReceipt.stderr);
    assert.equal(refreshedReceipt.value.status, "updated");
    const refreshedLock = JSON.parse(await readFile(path.join(root, ".decal/decal-pack.lock.json"), "utf8"));
    assert.equal(refreshedLock.packageSha256, sha256(await readFile(packagePath)));
    assert.equal(run(root, "--dry-run").value.status, "current");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(otherRoot, { recursive: true, force: true });
  }
});

test("Pack 2.0.0 lock updates managed bytes to 2.2.1 and preserves obsolete files", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zuz-pack-update-"));
  try {
    await installOld(root);
    const obsolete = path.join(root, "contracts/task-work-bug/obsolete-v200.txt");
    const obsoleteBefore = await readFile(obsolete);
    const preview = run(root, "--dry-run");
    assert.equal(preview.status, 0, preview.stderr);
    assert.equal(preview.value.status, "planned");
    assert.equal(preview.value.mode, "update");
    assert.equal(preview.value.previousRelease.packVersion, "2.0.0");
    assert.ok(preview.value.updateCount >= 2);
    assert.ok(preview.value.createCount >= 1);
    assert.deepEqual(preview.value.obsoleteManagedFiles.map((file) => file.path), ["contracts/task-work-bug/obsolete-v200.txt"]);
    const updated = run(root, "--write", preview.value.installationPlanDigest);
    assert.equal(updated.status, 0, `${updated.stderr}\n${updated.stdout}`);
    assert.equal(updated.value.status, "updated");
    assert.deepEqual(await readFile(obsolete), obsoleteBefore);
    const lock = JSON.parse(await readFile(path.join(root, ".decal/decal-pack.lock.json"), "utf8"));
    assert.equal(lock.packVersion, "2.2.1");
    assert.equal(lock.mode, "update");
    assert.equal(lock.installationPlanDigest, preview.value.installationPlanDigest);
    assert.equal(lock.previousRelease.packVersion, "2.0.0");
    assert.equal(lock.previousRelease.packageSha256, sha256(await readFile(oldPackagePath)));
    assert.equal(lock.files.some((file) => file.path === "contracts/task-work-bug/obsolete-v200.txt"), false);
    assert.equal(lock.obsoleteManagedFiles[0].observedState, "managed");
    const repeated = run(root, "--dry-run");
    assert.equal(repeated.value.status, "current");
    assert.deepEqual(repeated.value.obsoleteManagedFiles.map((file) => file.path), ["contracts/task-work-bug/obsolete-v200.txt"]);
    assert.deepEqual(await readFile(obsolete), obsoleteBefore);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("managed modifications and selection changes fail closed without partial update", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zuz-pack-modified-"));
  try {
    await installOld(root);
    const changedPath = path.join(root, "skills/decal-task/SKILL.md");
    const comparisonPath = path.join(root, ".claude/skills/decal-task/SKILL.md");
    const comparisonBefore = await readFile(comparisonPath);
    const lockBefore = await readFile(path.join(root, ".decal/decal-pack.lock.json"));
    await writeFile(changedPath, "user modified\n");
    const preview = run(root, "--dry-run");
    assert.equal(preview.value.status, "blocked");
    assert.deepEqual(preview.value.conflicts, ["skills/decal-task/SKILL.md"]);
    assert.equal(preview.value.conflictDetails[0].reason, "managed_file_modified");
    const blocked = run(root, "--write", preview.value.installationPlanDigest);
    assert.equal(blocked.status, 2);
    assert.equal(blocked.value.code, "conflict_detected");
    assert.equal(await readFile(changedPath, "utf8"), "user modified\n");
    assert.deepEqual(await readFile(comparisonPath), comparisonBefore);
    assert.deepEqual(await readFile(path.join(root, ".decal/decal-pack.lock.json")), lockBefore);
    const selection = run(root, "--dry-run", null, { providers: ["codex"] });
    assert.equal(selection.status, 2);
    assert.equal(selection.value.code, "selection_change_requires_separate_flow");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("write rejects a stale installation plan before creating Pack state", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zuz-pack-stale-"));
  try {
    const preview = run(root, "--dry-run");
    const first = preview.value.plannedFiles[0];
    await mkdir(path.dirname(path.join(root, first.path)), { recursive: true });
    const source = packageValue.files.find((file) => file.installTargets.some((target) => target.path === first.path));
    await writeFile(path.join(root, first.path), Buffer.from(source.contentBase64, "base64"));
    const rejected = run(root, "--write", preview.value.installationPlanDigest);
    assert.equal(rejected.status, 2);
    assert.equal(rejected.value.code, "approval_plan_digest_mismatch");
    assert.equal(await readOrAbsent(path.join(root, ".decal/decal-pack.lock.json")), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("existing lock must be a plain valid v1 receipt for the same Pack", { skip: process.platform === "win32" }, async () => {
  for (const [label, prepare, code] of [
    ["symlink", async (root) => {
      const external = path.join(root, "external-lock.json");
      await writeFile(external, "{}\n");
      await symlink(external, path.join(root, ".decal/decal-pack.lock.json"));
    }, "symlink_rejected"],
    ["schema", async (root) => writeFile(path.join(root, ".decal/decal-pack.lock.json"), `${JSON.stringify({ schema: "future/v2" })}\n`), "unsupported_installation_lock"],
    ["pack", async (root) => {
      const value = {
        schema: "zuz.decal-pack.installation-lock/v1",
        packId: "other-pack",
        packVersion: "2.0.0",
        sourceRevision: "e".repeat(40),
        manifestSha256: "a".repeat(64),
        modules: ["task-work-bug"],
        providers: ["codex", "claude"],
        files: [],
      };
      await writeFile(path.join(root, ".decal/decal-pack.lock.json"), `${JSON.stringify(value)}\n`);
    }, "unsupported_installation_lock"],
  ]) {
    const root = await mkdtemp(path.join(tmpdir(), `zuz-pack-lock-${label}-`));
    try {
      await mkdir(path.join(root, ".decal"), { recursive: true });
      await prepare(root);
      const result = run(root, "--dry-run");
      assert.equal(result.status, 2, label);
      assert.equal(result.value.code, code, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("update rollback restores every managed file and the previous lock", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "zuz-pack-rollback-"));
  try {
    await installOld(root);
    const preview = run(root, "--dry-run");
    assert.ok(preview.value.createCount > 0);
    assert.ok(preview.value.updateCount > 0);
    assert.ok(preview.value.writeSet.includes(".decal/decal-pack.lock.json"));
    const before = new Map();
    for (const relative of preview.value.writeSet) before.set(relative, await readOrAbsent(path.join(root, relative)));
    await assert.rejects(
      installPackage({
        packagePath,
        rootValue: root,
        modules: ["task-work-bug"],
        providers: ["codex", "claude"],
        approvedPlanDigest: preview.value.installationPlanDigest,
        testFailAt: "after_all_writes",
      }),
      (error) => error?.code === "injected_failure",
    );
    for (const [relative, bytes] of before) assert.deepEqual(await readOrAbsent(path.join(root, relative)), bytes, relative);
    async function assertNoTransactionResidue(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) await assertNoTransactionResidue(target);
        else assert.equal(/\.decal-[^.]+\.(?:tmp|bak)$/u.test(entry.name), false, target);
      }
    }
    await assertNoTransactionResidue(root);
    assert.equal(await readOrAbsent(path.join(root, ".decal/decal-pack.installing.lock")), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ITS-only installs carry mandatory notices for every provider, without core skills", async () => {
  for (const provider of ["codex", "claude", "gemini", "acp"]) {
    const root = await mkdtemp(path.join(tmpdir(), "zuz-pack-notices-"));
    try {
      const options = { modules: ["task-work-bug"], providers: [provider] };
      const preview = run(root, "--dry-run", null, options);
      assert.equal(preview.status, 0, preview.stdout);
      assert.deepEqual(preview.value.modules, ["task-work-bug"]);
      assert.deepEqual(preview.value.plannedFiles.filter((file) => file.required).map((file) => file.path), [
        "docs/skills/vendor/decal-project-pack/LICENSE", "docs/skills/vendor/decal-project-pack/NOTICE",
      ]);
      assert.equal(preview.value.plannedFiles.some((file) => file.path.includes("decal-build")), false);
      const result = run(root, "--write", preview.value.installationPlanDigest, options);
      assert.equal(result.status, 0, result.stdout);
      const receipt = JSON.parse(await readFile(path.join(root, ".decal/decal-pack.lock.json"), "utf8"));
      for (const name of ["LICENSE", "NOTICE"]) {
        const relative = `docs/skills/vendor/decal-project-pack/${name}`;
        const bytes = await readFile(path.join(root, relative));
        assert.equal(receipt.files.find((file) => file.path === relative)?.sha256, sha256(bytes));
      }
      const notice = path.join(root, "docs/skills/vendor/decal-project-pack/NOTICE");
      await writeFile(notice, "User notice edit\n");
      const conflict = run(root, "--dry-run", null, options);
      assert.ok(conflict.value.conflicts.includes("docs/skills/vendor/decal-project-pack/NOTICE"));
      assert.equal(await readFile(notice, "utf8"), "User notice edit\n");
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});

test("schema 2 rejects missing, expanded and legacy-disguised required-file rules", async () => {
  for (const requiredFiles of [[], ["LICENSE"], ["LICENSE", "NOTICE", "extra.md"]]) {
    const invalid = sealPackage({ ...packageValue, requiredFiles });
    const invalidPath = path.join(fixtureRoot, "invalid-notices.json");
    await writeFile(invalidPath, stableJson(invalid));
    const result = run(fixtureRoot, "--dry-run", null, { packagePath: invalidPath });
    assert.notEqual(result.status, 0);
  }
  const invalidPath = path.join(fixtureRoot, "legacy-notices.json");
  await writeFile(invalidPath, stableJson(sealPackage({ ...packageValue, schemaVersion: 1 })));
  assert.notEqual(run(fixtureRoot, "--dry-run", null, { packagePath: invalidPath }).status, 0);
});

test.after(async () => {
  await rm(fixtureRoot, { recursive: true, force: true });
});
