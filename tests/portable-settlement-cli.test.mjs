import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, mkdir, readFile, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { git } from "../packs/decal-pack/src/contracts/task-work-bug/v8/transaction.mjs";

const run = promisify(execFile);
const contracts = fileURLToPath(new URL("../packs/decal-pack/src/contracts/task-work-bug/", import.meta.url));

async function fixture(kind) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "its-settlement-no-decal-")));
  await mkdir(path.join(root, "contracts/task-work-bug/v7"), { recursive: true });
  await cp(path.join(contracts, "v8"), path.join(root, "contracts/task-work-bug/v8"), { recursive: true });
  await cp(path.join(contracts, "v7/default-branch.mjs"), path.join(root, "contracts/task-work-bug/v7/default-branch.mjs"));
  await mkdir(path.join(root, ".decal"));
  await mkdir(path.join(root, "product"));
  const directory = kind === "work" ? "work" : "bugs";
  const id = kind === "work" ? "WORK-001" : "BUG-001";
  await mkdir(path.join(root, `docs/work-items/${directory}`), { recursive: true });
  const relative = `docs/work-items/${directory}/${id}.md`;
  const source = ["---", `schema: ${kind === "work" ? "decal.task-work-bug.work-document" : "decal.task-work-bug.bug-card"}`,
    "schemaVersion: 1", `id: ${id}`, "status: closed", "versionImpact: desktop-patch", "remoteVersionImpact: none",
    "releaseMode: standalone", "releaseTaskRef: null", "versionApplied: pending", "remoteVersionApplied: not-required",
    "taskRefs: []", "completion:", '  summary: "isolated smoke passed"', "  evidence:", '    - "test fixture only"',
    "closure:", `  reason: ${kind === "work" ? "completed" : "fixed"}`, "---", "# Original fixture", "",
  ].join("\n");
  await writeFile(path.join(root, relative), source);
  await writeFile(path.join(root, "product/package.json"), '{"name":"showcase-fixture","version":"0.1.2"}\n');
  await writeFile(path.join(root, "unrelated.txt"), "original\n");
  await writeFile(path.join(root, ".decal/settlement-profile.json"), JSON.stringify({
    schema: "zuz.its.settlement-profile/v1", engine: "portable", channels: { desktop: "showcase", remote: null },
    products: [{ id: "showcase", files: [{ path: "product/package.json", format: "json", pointers: ["/version"] }] }],
  }));
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "fixture: validated implementation"]);
  const command = async (args) => {
    const env = { ...process.env }; delete env.DECAL_SESSION_ID;
    const output = await run(process.execPath, ["contracts/task-work-bug/v8/settle-work-item.mjs", "--root", root, "--kind", kind, "--id", id, ...args], { cwd: root, env });
    return JSON.parse(output.stdout);
  };
  return { root, relative, source, command };
}

for (const kind of ["work", "bug"]) {
  test(`${kind}: installed standalone CLI preview → exact settlement → finalize, without Decal`, async () => {
    const { root, relative, source, command } = await fixture(kind);
    await writeFile(path.join(root, "unrelated.txt"), "another owner\n");
    const preview = await command(["--dry-run"]);
    assert.equal(preview.status, "preview");
    assert.equal(preview.versions.desktop.after, "0.1.3");
    assert.equal(await readFile(path.join(root, relative), "utf8"), source);
    const applied = await command(["--write", "--approved-plan-digest", preview.approvalDigest]);
    assert.equal(applied.state, "committed");
    assert.equal(JSON.parse(await readFile(path.join(root, "product/package.json"), "utf8")).version, "0.1.3");
    assert.equal(await readFile(path.join(root, "unrelated.txt"), "utf8"), "another owner\n");
    const again = await command(["--dry-run"]);
    assert.equal(again.alreadySettled, true);
    assert.deepEqual(again.writeSet, []);
    assert.equal((await command(["--write", "--approved-plan-digest", again.approvalDigest])).state, "unchanged");
    assert.equal((await git(root, ["rev-list", "--count", "HEAD"])).trim(), "2");
  });
}
