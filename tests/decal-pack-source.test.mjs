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

test("public build remains blocked while the first-party license is undecided", () => {
  assert.throws(() => execFileSync(process.execPath, [join(repositoryRoot, "scripts/build-decal-pack.mjs"), "--source-revision", "a".repeat(40)], { stdio: "pipe" }), (error) => error.status === 3);
});

test("stable JSON and digest are deterministic", () => {
  const first = stableJson({ z: [3, 2, 1], a: { y: true, x: null } });
  const second = stableJson({ a: { x: null, y: true }, z: [3, 2, 1] });
  assert.equal(first, second);
  assert.equal(sha256(first), sha256(second));
});

test.after(async () => {
  await rm(join(repositoryRoot, "dist"), { recursive: true, force: true });
});

