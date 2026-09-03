import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { repositoryRoot } from "../scripts/pack-lib.mjs";

const sourceContracts = join(repositoryRoot, "packs/decal-pack/src/contracts/task-work-bug");
const initializer = "contracts/task-work-bug/initialize-task-registry.mjs";
const fixtureIntent = "contracts/task-work-bug/task-registry-initialization-intent.json";

async function project(label) {
  const root = await mkdtemp(join(tmpdir(), `decal-task-registry-${label}-`));
  await mkdir(join(root, "contracts"), { recursive: true });
  await cp(sourceContracts, join(root, "contracts/task-work-bug"), { recursive: true });
  return root;
}

function run(root, ...args) {
  const result = spawnSync(process.execPath, [join(root, initializer), "--root", root, "--intent", join(root, fixtureIntent), ...args], { encoding: "utf8" });
  return { ...result, value: JSON.parse(result.stdout) };
}

test("explicit initializer creates the exact empty Task registry and enables v4 authoring", async () => {
  const root = await project("success");
  try {
    const preview = run(root, "--dry-run");
    assert.equal(preview.status, 0);
    assert.equal(preview.value.status, "planned");
    assert.deepEqual(preview.value.writeSet, ["docs/tasks/index.md", "docs/tasks/category_index.md"]);

    const written = run(root, "--expected-source-revision", preview.value.sourceRevision, "--write");
    assert.equal(written.status, 0);
    assert.equal(written.value.status, "written");
    assert.match(await readFile(join(root, "docs/tasks/index.md"), "utf8"), /\| Task \| 상태 \| 우선순위 \| 관련 영역 \| 검증\/다음 액션 \|/u);
    assert.match(await readFile(join(root, "docs/tasks/category_index.md"), "utf8"), /\| `product` \| Product \| `001` \|/u);

    const validation = JSON.parse(execFileSync(process.execPath, [join(root, "contracts/task-work-bug/v4/validate-task-index.mjs"), "--root", root], { encoding: "utf8" }));
    assert.equal(validation.status, "accepted");
    assert.equal(validation.authoringStatus, "ready");
    assert.equal(validation.taskCount, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initializer rejects partial, existing, nonempty, and stale baselines", async () => {
  for (const [label, prepare, code] of [
    ["partial", async (root) => {
      await mkdir(join(root, "docs/tasks"), { recursive: true });
      await writeFile(join(root, "docs/tasks/index.md"), "# partial\n");
    }, "partial_registry"],
    ["existing", async (root) => {
      const preview = run(root, "--dry-run");
      const result = run(root, "--expected-source-revision", preview.value.sourceRevision, "--write");
      assert.equal(result.status, 0);
    }, "registry_already_initialized"],
    ["nonempty", async (root) => {
      await mkdir(join(root, "docs/tasks"), { recursive: true });
      await writeFile(join(root, "docs/tasks/future-registry.json"), "{}\n");
    }, "nonempty_task_directory"],
  ]) {
    const root = await project(label);
    try {
      await prepare(root);
      const result = run(root, "--dry-run");
      assert.equal(result.status, 2, label);
      assert.equal(result.value.code, code, label);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  const staleRoot = await project("stale");
  try {
    const preview = run(staleRoot, "--dry-run");
    const intentPath = join(staleRoot, fixtureIntent);
    const intent = JSON.parse(await readFile(intentPath, "utf8"));
    intent.intentId = "changed-after-preview";
    await writeFile(intentPath, `${JSON.stringify(intent, null, 2)}\n`);
    const result = run(staleRoot, "--expected-source-revision", preview.value.sourceRevision, "--write");
    assert.equal(result.status, 2);
    assert.equal(result.value.code, "stale_source_revision");
  } finally {
    await rm(staleRoot, { recursive: true, force: true });
  }
});

test("initializer rejects a legacy registry", async () => {
  const root = await project("legacy");
  try {
    await mkdir(join(root, "docs/slices"), { recursive: true });
    await writeFile(join(root, "docs/slices/index.md"), "# legacy\n");
    const result = run(root, "--dry-run");
    assert.equal(result.status, 2);
    assert.equal(result.value.code, "legacy_registry_present");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("initializer rejects symlinked Task parents", { skip: process.platform === "win32" }, async () => {
  const root = await project("symlink");
  const external = await mkdtemp(join(tmpdir(), "decal-task-registry-external-"));
  try {
    await mkdir(join(root, "docs"), { recursive: true });
    await import("node:fs/promises").then(({ symlink }) => symlink(external, join(root, "docs/tasks")));
    const result = run(root, "--dry-run");
    assert.equal(result.status, 2);
    assert.equal(result.value.code, "symlink_rejected");
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(external, { recursive: true, force: true });
  }
});
