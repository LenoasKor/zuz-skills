import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, readFile, readdir, rm } from "node:fs/promises";
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

test("legacy Task Work Bug v1 through v6 contract bytes remain pinned", async () => {
  const expectedManifestDigests = {
    v1: "62bcab47e97221ee715725c9981090a4428b1079997ad9124aec890984f9cb67",
    v2: "e7a7a73a079976c0f528629ecbef8a267bad70b1d81a8211aa156d56bb96585c",
    v3: "438c36cede469a65e2e9f239200e485452bdc5111351879198779e5b139e6fc0",
    v4: "2a7a88aa8db122db00eb4c2cbea1e40b2770b6418448ac8c455d5ef5cb77fed4",
    v5: "993f14fbf05591edb4aebd40778b09c1d6f83cae9222183798b575ecf6909983",
    v6: "6d5176a773e03724b36e1be333a533ae223988d56a1f924f43ba0def8529db5e",
  };
  async function collect(directory, prefix = "") {
    const output = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = join(directory, entry.name);
      const metadata = await lstat(absolute);
      assert.equal(metadata.isSymbolicLink(), false, relative);
      if (entry.isDirectory()) output.push(...await collect(absolute, relative));
      else output.push(relative);
    }
    return output;
  }
  for (const [version, expectedManifestDigest] of Object.entries(expectedManifestDigests)) {
    const contractRoot = join(repositoryRoot, "packs/decal-pack/src/contracts/task-work-bug", version);
    const manifestBytes = await readFile(join(contractRoot, "manifest.json"));
    assert.equal(sha256(manifestBytes), expectedManifestDigest, `${version}/manifest.json`);
    const manifest = JSON.parse(manifestBytes.toString("utf8"));
    assert.deepEqual((await collect(contractRoot)).filter((relative) => relative !== "manifest.json").sort(), Object.keys(manifest.files).sort(), version);
    for (const [relative, expected] of Object.entries(manifest.files)) {
      assert.equal(sha256(await readFile(join(contractRoot, relative))), expected, `${version}/${relative}`);
    }
  }
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
    const fixtureValue = JSON.parse(await readFile(join(repositoryRoot, "packs/decal-pack/src", fixture.sourcePath), "utf8"));
    assert.equal(fixtureValue.requiredCases.some((requiredCase) => requiredCase.includes("registration-v6")), false, fixture.id);
    assert.equal(fixtureValue.requiredCases.some((requiredCase) => requiredCase.includes("ticket-registration-v7")), true, fixture.id);
    assert.equal(fixtureValue.requiredCases.includes("ticket-registration-v7-supports-unambiguous-main-and-master"), true, fixture.id);
    assert.equal(fixtureValue.requiredCases.includes("pack-installation-plan-is-canonical-digest-approved-and-recomputed"), true, fixture.id);
    assert.equal(fixtureValue.requiredCases.includes("managed-pack-update-preserves-conflicts-and-obsolete-files"), true, fixture.id);
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
  assert.equal(packageValue.compatibility.portableSettlement, "task-work-bug/v8");
  const settlement = packageValue.executionPolicies.portableSettlement;
  assert.equal(settlement.automaticProfileInstallation, false);
  assert.equal(settlement.nativeFallback, false);
  assert.equal(settlement.repositoryEngine, "preserve-and-delegate");
  assert.equal(settlement.profile, ".decal/settlement-profile.json");
  for (const key of ["manifestValidator", "taskLifecycle", "workItemLifecycle", "standaloneSettlement", "finalizer", "recovery"]) {
    assert.ok(packageValue.files.some((file) => file.sourcePath === settlement[key] && file.moduleId === "task-work-bug"), key);
  }
  assert.equal(packageValue.compatibility.minimumHosts.decal, "0.406.0");
  assert.ok(packageValue.files.some((file) => file.sourcePath === "contracts/task-work-bug/v7/register-task-batch.mjs"));
  assert.ok(packageValue.files.some((file) => file.sourcePath === "contracts/task-work-bug/v7/register-ticket.mjs"));
  assert.equal(packageValue.executionPolicies.repositoryAuthority.crossProjectAccess, "explicit-current-user-approval");
  assert.deepEqual(packageValue.executionPolicies.repositoryAuthority.approvalBinding, ["repository-root", "operation-scope", "current-task"]);
  assert.equal(packageValue.executionPolicies.settlementCommit.externalHost, "explicit-settlement-request-authorizes-exact-settlement-commit");
  assert.equal(packageValue.executionPolicies.settlementCommit.finalizerRequired, true);
  assert.equal(packageValue.executionPolicies.settlementCommit.pushIncluded, false);
  assert.equal(packageValue.executionPolicies.taskRegistryInitialization.mode, "explicit-only");
  assert.equal(packageValue.executionPolicies.taskRegistryInitialization.writer, "contracts/task-work-bug/initialize-task-registry.mjs");
  assert.equal(packageValue.executionPolicies.taskRegistryInitialization.summaryRepairWriter, "contracts/task-work-bug/repair-task-registry-summary.mjs");
  assert.ok(packageValue.files.some((file) => file.sourcePath === "contracts/task-work-bug/repair-task-registry-summary.mjs"));
  assert.equal(packageValue.executionPolicies.taskRegistryInitialization.automaticInstall, false);
  assert.deepEqual(packageValue.executionPolicies.packInstallation.modes, ["initial-pack-bootstrap", "update"]);
  assert.equal(packageValue.executionPolicies.packInstallation.approvalArgument, "--approved-plan-digest");
  assert.equal(packageValue.executionPolicies.packInstallation.modifiedFiles, "preserve-and-block-entire-write");
  assert.equal(packageValue.executionPolicies.packInstallation.obsoleteManagedFiles, "report-and-preserve");
  const decalAcceptance = JSON.parse(await readFile(join(repositoryRoot, "packs/decal-pack/src/consumer-acceptance/v1/decal-bundled-v1.json"), "utf8"));
  assert.equal(decalAcceptance.requiredCases.includes("decal-native-canonical-branch-parity-requires-0.406.0"), true);
  const expectedSkillVersions = {
    "decal-task": "1.9.1",
    "decal-work": "1.6.1",
    "decal-bug": "1.6.1",
    "decal-incident": "1.1.2",
    "zuz-its": "1.1.2",
    "decal-slice": "0.4.8",
    "decal-slice-maintenance": "0.7.2",
    "decal-slice-smoke": "0.5.1",
    "decal-commit-ready": "0.9.1",
  };
  for (const [id, version] of Object.entries(expectedSkillVersions)) {
    assert.equal(packageValue.skills.find((skill) => skill.id === id)?.version, version, id);
  }
  const packPolicy = JSON.parse(await readFile(join(repositoryRoot, "packs/decal-pack/src/project-skill-pack-policy.json"), "utf8"));
  assert.equal(packPolicy.minimumCompatible["decal-slice-maintenance"], "0.7.1");

  for (const id of ["decal-task", "decal-work", "decal-bug"]) {
    const file = packageValue.files.find((candidate) => candidate.sourcePath === `skills/agents/${id}/SKILL.md`);
    assert.ok(file, id);
    const content = Buffer.from(file.contentBase64, "base64").toString("utf8");
    assert.match(content, /## Repository authority boundary/);
    assert.match(content, /explicit current-user approval/);
    assert.match(content, /exact settlement write-set/);
    if (id === "decal-task") {
      assert.match(content, /version: "1\.9\.1"/);
      assert.match(content, /task-work-bug\/v7\/register-task-batch\.mjs/);
    }
  }
});

test("commit guidance is preserved in shared and every provider entrypoint", async () => {
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", "f".repeat(40)], { stdio: "pipe" });
  const pack = JSON.parse(await readFile(artifactPath("zuz-pack.json"), "utf8"));
  const source = await readFile(join(repositoryRoot, "packs/decal-pack/src/skills/prompts/commit-ready.md"), "utf8");
  const shared = pack.files.find((file) => file.sourcePath === "skills/prompts/commit-ready.md");
  const agent = pack.files.find((file) => file.sourcePath === "generated/skills/decal-commit-ready/SKILL.md");
  assert.equal(Buffer.from(shared.contentBase64, "base64").toString("utf8"), source);
  assert.deepEqual(shared.installTargets, [{ provider: "shared", path: "docs/skills/commit-ready.md" }]);
  assert.deepEqual(agent.installTargets.map((target) => target.provider), ["codex", "claude", "gemini", "acp"]);
  const generated = Buffer.from(agent.contentBase64, "base64").toString("utf8");
  const template = source.split("\n").find((line) => line.startsWith("template: ")).slice("template: ".length);
  const body = source.slice(source.indexOf("\n---\n", 4) + 5).trim();
  assert.ok(generated.includes(template), "approval, Native and settlement instructions must be emitted intact");
  assert.ok(generated.includes(body), "human-readable guidance must agree with provider payload");
  assert.equal(agent.sha256, sha256(Buffer.from(agent.contentBase64, "base64")));
});

test("ITS and maintenance entrypoints retain scoped external commit approval for every provider", async () => {
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", "f".repeat(40)], { stdio: "pipe" });
  const pack = JSON.parse(await readFile(artifactPath("zuz-pack.json"), "utf8"));
  for (const id of ["decal-task", "decal-work", "decal-bug", "decal-incident", "zuz-its"]) {
    const path = `skills/agents/${id}/SKILL.md`;
    const file = pack.files.find((candidate) => candidate.sourcePath === path);
    const bytes = Buffer.from(file.contentBase64, "base64");
    assert.deepEqual(bytes, await readFile(join(repositoryRoot, "packs/decal-pack/src", path)));
    assert.deepEqual(file.installTargets.map((target) => target.provider), ["codex", "claude", "gemini", "acp"]);
    assert.equal(file.sha256, sha256(bytes));
    const content = bytes.toString("utf8");
    assert.match(content, /existing standing or automatic approval/);
    assert.match(content, /repository, branch, exact files, and intended changes/);
    assert.match(content, /Never self-authorize/);
    assert.match(content, /does not replace Native approval, registration-digest approval, or completion\/settlement gates/);
  }
  for (const [id, name] of [["decal-slice", "slice.md"], ["decal-slice-maintenance", "decal-slice-maintenance.md"]]) {
    const shared = pack.files.find((file) => file.sourcePath === `skills/prompts/${name}`);
    const agent = pack.files.find((file) => file.sourcePath === `generated/skills/${id}/SKILL.md`);
    const source = Buffer.from(shared.contentBase64, "base64").toString("utf8");
    const generated = Buffer.from(agent.contentBase64, "base64").toString("utf8");
    const template = source.split("\n").find((line) => line.startsWith("template: ")).slice(10);
    assert.ok(generated.includes(template));
    assert.deepEqual(agent.installTargets.map((target) => target.provider), ["codex", "claude", "gemini", "acp"]);
    assert.match(template, /기존 사전·자동 승인/);
    assert.match(template, /저장소·브랜치·정확한 대상 파일과 변경 내용/);
    assert.doesNotMatch(source, /커밋은 별도 사용자 승인을 요구|외부 커밋은 정확한 경로의 별도 승인을 요구/);
  }
});

test("Pack 2 adds ZUZ ITS without replacing the legacy Task Work Bug contract", async () => {
  const revision = "e".repeat(40);
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", revision], { stdio: "pipe" });
  const packageValue = JSON.parse(await readFile(artifactPath("zuz-pack.json"), "utf8"));
  assert.equal(packageValue.packVersion, "2.1.1");
  assert.equal(packageValue.schemaVersion, 2);
  assert.deepEqual(packageValue.requiredFiles, ["LICENSE", "NOTICE"]);
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
