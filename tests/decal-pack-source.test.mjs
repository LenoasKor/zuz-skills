import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot, sha256, stableJson } from "../scripts/pack-lib.mjs";

const sourceDescriptor = JSON.parse(await readFile(join(repositoryRoot, "packs/decal-pack/pack.source.json"), "utf8"));
const artifactPath = (suffix) => join(repositoryRoot, `dist/decal-pack-${sourceDescriptor.packVersion}.${suffix}`);

test("source registry is complete and opt-in", () => {
  const output = execFileSync(process.execPath, [join(repositoryRoot, "scripts/verify-decal-pack-source.mjs")], { encoding: "utf8" });
  assert.match(output, /31 skills across 3 modules/);
});

test("first-party source is Apache-2.0 and public release is unblocked", async () => {
  const descriptor = JSON.parse(await readFile(join(repositoryRoot, "packs/decal-pack/pack.source.json"), "utf8"));
  assert.equal(descriptor.packId, "decal-project-pack");
  assert.deepEqual(descriptor.aliases, ["zuz.decal-pack"]);
  assert.equal(descriptor.firstPartyLicense, "Apache-2.0");
  assert.equal(descriptor.publicReleaseBlocked, false);
  assert.match(await readFile(join(repositoryRoot, "LICENSE"), "utf8"), /Apache License\s+Version 2\.0/);
  assert.match(await readFile(join(repositoryRoot, "packs/decal-pack/src/NOTICE"), "utf8"), /Emil Kowalski/);
});

test("stable JSON and digest are deterministic", () => {
  const first = stableJson({ z: [3, 2, 1], a: { y: true, x: null } });
  const second = stableJson({ a: { x: null, y: true }, z: [3, 2, 1] });
  assert.equal(first, second);
  assert.equal(sha256(first), sha256(second));
});

test("the same source revision produces byte-identical Pack artifacts", async () => {
  const revision = "a".repeat(40);
  const args = [join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", revision];
  execFileSync(process.execPath, args, { stdio: "pipe" });
  const manifestPath = artifactPath("manifest.json");
  const packagePath = artifactPath("zuz-pack.json");
  const firstManifest = await readFile(manifestPath);
  const firstPackage = await readFile(packagePath);
  execFileSync(process.execPath, args, { stdio: "pipe" });
  assert.deepEqual(await readFile(manifestPath), firstManifest);
  assert.deepEqual(await readFile(packagePath), firstPackage);
});

test("signed manifest binds every consumer acceptance ID to fixture bytes", async () => {
  const revision = "b".repeat(40);
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", revision], { stdio: "pipe" });
  const manifest = JSON.parse(await readFile(artifactPath("manifest.json"), "utf8"));
  assert.deepEqual(
    manifest.consumerAcceptanceFixtures.map((fixture) => fixture.id),
    manifest.consumerAcceptance,
  );
  for (const fixture of manifest.consumerAcceptanceFixtures) {
    assert.match(fixture.sha256, /^[0-9a-f]{64}$/);
    const file = manifest.files.find((candidate) => candidate.sourcePath === fixture.sourcePath);
    assert.ok(file, fixture.id);
    assert.equal(file.sha256, fixture.sha256);
    assert.equal(file.size, fixture.size);
  }
});

test("every prompt skill is emitted as an Agent Skill for all portable providers", async () => {
  const revision = "c".repeat(40);
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", revision], { stdio: "pipe" });
  const packageValue = JSON.parse(await readFile(artifactPath("zuz-pack.json"), "utf8"));
  const promptSkills = packageValue.skills.filter((skill) => skill.kind === "prompt");
  for (const skill of promptSkills) {
    const generated = packageValue.files.find((file) => file.sourcePath === `generated/skills/${skill.id}/SKILL.md`);
    assert.ok(generated, skill.id);
    assert.deepEqual(generated.installTargets.map((target) => target.provider), ["codex", "claude", "gemini", "acp"]);
    const content = Buffer.from(generated.contentBase64, "base64").toString("utf8");
    assert.match(content, new RegExp(`^---\\nname: ${skill.id}\\ndescription: `));
    assert.match(content, /## Repository authority boundary/);
    assert.match(content, /explicit approval from the current user that names the repository root and allowed operation scope/);
  }
});

test("Pack execution policy binds cross-project approval and settlement commit", async () => {
  const revision = "d".repeat(40);
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", revision], { stdio: "pipe" });
  const packageValue = JSON.parse(await readFile(artifactPath("zuz-pack.json"), "utf8"));
  assert.equal(packageValue.compatibility.portableContract, "task-work-bug/v7");
  assert.ok(packageValue.files.some((file) => file.sourcePath === "contracts/task-work-bug/v7/register-task-batch.mjs"));
  assert.ok(packageValue.files.some((file) => file.sourcePath === "contracts/task-work-bug/v7/register-ticket.mjs"));
  assert.equal(packageValue.executionPolicies.repositoryAuthority.crossProjectAccess, "explicit-current-user-approval");
  assert.deepEqual(packageValue.executionPolicies.repositoryAuthority.approvalBinding, ["repository-root", "operation-scope", "current-task"]);
  assert.equal(packageValue.executionPolicies.settlementCommit.externalHost, "explicit-settlement-request-authorizes-exact-settlement-commit");
  assert.equal(packageValue.executionPolicies.settlementCommit.finalizerRequired, true);
  assert.equal(packageValue.executionPolicies.settlementCommit.pushIncluded, false);
  assert.equal(packageValue.executionPolicies.taskRegistryInitialization.mode, "explicit-only");
  assert.equal(packageValue.executionPolicies.taskRegistryInitialization.writer, "contracts/task-work-bug/initialize-task-registry.mjs");
  assert.equal(packageValue.executionPolicies.taskRegistryInitialization.automaticInstall, false);

  for (const id of ["decal-task", "decal-work", "decal-bug"]) {
    const file = packageValue.files.find((candidate) => candidate.sourcePath === `skills/agents/${id}/SKILL.md`);
    assert.ok(file, id);
    const content = Buffer.from(file.contentBase64, "base64").toString("utf8");
    assert.match(content, /## Repository authority boundary/);
    assert.match(content, /explicit current-user approval/);
    assert.match(content, /exact settlement write-set/);
    if (id === "decal-task") {
      assert.match(content, /version: "1\.7\.0"/);
      assert.match(content, /task-work-bug\/v7\/register-task-batch\.mjs/);
    }
  }
});

test("Pack 2 adds ZUZ ITS without replacing the legacy Task Work Bug contract", async () => {
  const revision = "e".repeat(40);
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", revision], { stdio: "pipe" });
  const packageValue = JSON.parse(await readFile(artifactPath("zuz-pack.json"), "utf8"));
  assert.equal(packageValue.packVersion, "2.0.0");
  assert.equal(packageValue.compatibility.portableContract, "task-work-bug/v7");
  assert.equal(packageValue.compatibility.zuzItsContract, "zuz.its/v2");
  assert.equal(packageValue.files.some((file) => file.sourcePath === "contracts/task-work-bug/v1/manifest.json"), true);
  assert.equal(packageValue.files.some((file) => file.sourcePath === "contracts/task-work-bug/v6/register-task-batch.mjs"), true);
  assert.equal(packageValue.files.some((file) => file.sourcePath === "contracts/task-work-bug/v7/register-ticket.mjs"), true);
  assert.equal(packageValue.files.some((file) => file.sourcePath === "contracts/zuz-its/v1/project.mjs"), true);
  assert.equal(packageValue.files.some((file) => file.sourcePath === "contracts/zuz-its/v2/register-incident.mjs"), true);
  assert.equal(packageValue.skills.some((skill) => skill.id === "zuz-its"), true);
  assert.equal(packageValue.skills.some((skill) => skill.id === "decal-incident"), true);
  const itsSkill = packageValue.files.find((file) => file.sourcePath === "skills/agents/zuz-its/SKILL.md");
  assert.ok(itsSkill);
  const itsSource = Buffer.from(itsSkill.contentBase64, "base64").toString("utf8");
  assert.match(itsSource, /Work \/ 소작업: a lightweight but still formally ticketed execution unit/u);
  assert.match(itsSource, /@incident:INC-###/u);
});

test.after(async () => {
  await rm(join(repositoryRoot, "dist"), { recursive: true, force: true });
});
