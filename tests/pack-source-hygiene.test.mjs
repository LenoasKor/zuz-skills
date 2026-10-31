import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = fileURLToPath(new URL("../packs/decal-pack/src/", import.meta.url));

// Published bytes never change, so these stay as released. New contract numbers must not join the list.
const frozenContractLabels = new Set(["v23"]);
const frozenUnpublishedNotes = new Set(["v22", "v23"]);

const contracts = () => readdirSync(join(source, "contracts/task-work-bug"))
  .filter((name) => /^v[0-9]+$/u.test(name) && existsSync(join(source, "contracts/task-work-bug", name, "contract.json")));

test("relative Markdown links in skill prompts resolve inside the Pack", () => {
  const prompts = join(source, "skills/prompts");
  for (const file of readdirSync(prompts).filter((name) => name.endsWith(".md"))) {
    const text = readFileSync(join(prompts, file), "utf8");
    const skill = file.replace(/\.md$/u, "");
    for (const [, target] of text.matchAll(/\]\(([^)#\s]+\.md)\)/gu)) {
      if (/^[a-z]+:/u.test(target)) continue;
      assert.ok(existsSync(join(prompts, target)) || existsSync(join(prompts, "resources", skill, target)), `${file} -> ${target}`);
    }
  }
});

test("a contract names its own folder version", () => {
  for (const version of contracts()) {
    if (frozenContractLabels.has(version)) continue;
    const contract = JSON.parse(readFileSync(join(source, "contracts/task-work-bug", version, "contract.json"), "utf8"));
    assert.ok([contract.schema, contract.contractId].filter((label) => label?.startsWith("decal.task-work-bug")).every((label) => label.endsWith(`/${version}`)), version);
  }
});

test("a contract README does not claim it is unpublished", () => {
  for (const version of contracts()) {
    if (frozenUnpublishedNotes.has(version)) continue;
    const readme = join(source, "contracts/task-work-bug", version, "README.md");
    if (existsSync(readme)) assert.doesNotMatch(readFileSync(readme, "utf8"), /Not published or installed/u, version);
  }
});
