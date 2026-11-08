import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
const source = new URL("../packs/decal-pack/src/", import.meta.url).pathname;
const proof = JSON.parse(readFileSync(new URL("./fixtures/conditional-guidance.json", import.meta.url), "utf8"));
test("conditional guide bodies retain reviewed pre-split safeguards", () => {
  for (const [path, hash] of Object.entries(proof)) assert.equal(createHash("sha256").update(readFileSync(join(source, path))).digest("hex"), hash, path);
});
test("all four provider skill entries resolve only installed operation guides", () => {
  for (const id of ["decal-task", "decal-work", "decal-bug", "decal-incident"]) {
    const text = readFileSync(join(source, `skills/agents/${id}/SKILL.md`), "utf8");
    const paths = [...text.matchAll(/`(contracts\/its-guides\/[^`]+\.md)`/g)].map(m => m[1]);
    assert.ok(paths.length >= 3, id);
    for (const path of paths) assert.ok(existsSync(join(source, path)) && proof[path], path);
    assert.ok(text.length < 10000, id);
    assert.match(text, /Missing guidance blocks|Missing guidance holds/);
    assert.match(text, /Native bypass/);
  }
});
test("short policy routes to complete policy without adding approval or tickets", () => {
  const entry = readFileSync(join(source, "contracts/its-entry-guidance.md"), "utf8");
  assert.ok(entry.length < 700);
  assert.match(entry, /등록 불필요 → 기존 기록 재사용 → 새 기록 필요/);
  assert.match(entry, /contracts\/its-tracking-policy\.md/);
  assert.match(entry, /등록 면제는 권한 면제가 아닙니다/);
});
