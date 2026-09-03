import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { repositoryRoot, sha256, stableJson } from "../scripts/pack-lib.mjs";

test("source registry is complete and opt-in", () => {
  const output = execFileSync(process.execPath, [join(repositoryRoot, "scripts/verify-decal-pack-source.mjs")], { encoding: "utf8" });
  assert.match(output, /29 skills across 3 modules/);
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
  const manifestPath = join(repositoryRoot, "dist/decal-pack-1.3.3.manifest.json");
  const packagePath = join(repositoryRoot, "dist/decal-pack-1.3.3.zuz-pack.json");
  const firstManifest = await readFile(manifestPath);
  const firstPackage = await readFile(packagePath);
  execFileSync(process.execPath, args, { stdio: "pipe" });
  assert.deepEqual(await readFile(manifestPath), firstManifest);
  assert.deepEqual(await readFile(packagePath), firstPackage);
});

test("signed manifest binds every consumer acceptance ID to fixture bytes", async () => {
  const revision = "b".repeat(40);
  execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", revision], { stdio: "pipe" });
  const manifest = JSON.parse(await readFile(join(repositoryRoot, "dist/decal-pack-1.3.3.manifest.json"), "utf8"));
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
  const packageValue = JSON.parse(await readFile(join(repositoryRoot, "dist/decal-pack-1.3.3.zuz-pack.json"), "utf8"));
  const promptSkills = packageValue.skills.filter((skill) => skill.kind === "prompt");
  for (const skill of promptSkills) {
    const generated = packageValue.files.find((file) => file.sourcePath === `generated/skills/${skill.id}/SKILL.md`);
    assert.ok(generated, skill.id);
    assert.deepEqual(generated.installTargets.map((target) => target.provider), ["codex", "claude", "gemini", "acp"]);
    const content = Buffer.from(generated.contentBase64, "base64").toString("utf8");
    assert.match(content, new RegExp(`^---\\nname: ${skill.id}\\ndescription: `));
  }
});

test.after(async () => {
  await rm(join(repositoryRoot, "dist"), { recursive: true, force: true });
});
