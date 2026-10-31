// Migrating Windows files written before the DACL check. The decision runs here on any OS with the ACL calls injected;
// the real ACL behaviour needs Windows, so those tests skip elsewhere.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { legacyAclDecision, migrateLegacyAcl, readJson as readV24 } from "../packs/decal-pack/src/contracts/task-work-bug/v24/authority-storage.mjs";
import { readJson as readV23 } from "../packs/decal-pack/src/contracts/task-work-bug/v23/authority-storage.mjs";
import { assertPrivate } from "../packs/decal-pack/src/contracts/task-work-bug/v22/private-storage.mjs";

const contracts = fileURLToPath(new URL("../packs/decal-pack/src/contracts/task-work-bug/", import.meta.url));
const client = path.join(contracts, "v24/lan-client.mjs");
const authority = path.join(contracts, "v24/lan-authority.mjs");
const KEY = "ab".repeat(32);
const good = { schema: "decal.its-lan-client/v1", keyHex: KEY, deviceId: "d1", projectId: "p", host: "127.0.0.1", port: 1 };
const isValid = (value) => value?.schema === good.schema && /^[a-f0-9]{64}$/u.test(value.keyHex ?? "") && Boolean(value.deviceId);
const unsafe = Object.assign(new Error("unsafe_private_storage"), { code: "unsafe_private_storage" });
const windows = { skip: process.platform === "win32" ? false : "needs real Windows ACLs" };
const notWindows = { skip: process.platform === "win32" ? "POSIX behaviour" : false };
let base;
let count = 0;
before(async () => { base = await realpath(await mkdtemp(path.join(tmpdir(), "its-acl-"))); });
after(async () => { await rm(base, { recursive: true, force: true, maxRetries: 5 }); });
async function fixture(content = JSON.stringify(good)) {
  const directory = path.join(base, `case-${count += 1}`);
  await mkdir(directory);
  const file = path.join(directory, "its-lan-client.json");
  await writeFile(file, content);
  return { directory, file };
}
/** Fake ACL side: records whether anything would have been rewritten. */
function fakes({ owner = true } = {}) {
  const calls = { write: 0, verify: 0, owner: 0, written: null };
  return { calls, deps: {
    ownerIsCurrentUser: async () => { calls.owner += 1; return owner; },
    write: async (_file, value) => { calls.write += 1; calls.written = value; },
    verify: async () => { calls.verify += 1; },
  } };
}

test("the decision allows only a file whose DACL is its one fault", () => {
  const ok = { isFile: true, isSymbolicLink: false, nlink: 1, realpathMatches: true, ownedByCurrentUser: true, contentValid: true };
  assert.deepEqual(legacyAclDecision(ok), { migrate: true, reason: null });
  for (const [change, reason] of [
    [{ isSymbolicLink: true }, "symbolic_link"], [{ isFile: false }, "not_a_regular_file"], [{ nlink: 2 }, "other_hard_links"],
    [{ realpathMatches: false }, "path_mismatch"], [{ ownedByCurrentUser: false }, "another_owner"], [{ contentValid: false }, "invalid_content"],
  ]) assert.deepEqual(legacyAclDecision({ ...ok, ...change }), { migrate: false, reason });
});

test("a valid file is rewritten through the private route and verified", async () => {
  const { file } = await fixture();
  const { calls, deps } = fakes();
  const result = await migrateLegacyAcl(file, isValid, unsafe, deps);
  assert.equal(result.migrated, true);
  assert.deepEqual(calls.written, good);
  assert.equal(calls.write, 1);
  assert.equal(calls.verify, 1);
});

test("refusals keep the original error and write nothing", async () => {
  const another = await fixture();
  const other = fakes({ owner: false });
  await assert.rejects(migrateLegacyAcl(another.file, isValid, unsafe, other.deps), unsafe);
  assert.equal(other.calls.write, 0);

  for (const content of ["{not json", JSON.stringify({ ...good, schema: "other/v1" }), JSON.stringify({ ...good, keyHex: "short" })]) {
    const { file } = await fixture(content);
    const { calls, deps } = fakes();
    await assert.rejects(migrateLegacyAcl(file, isValid, unsafe, deps), unsafe);
    assert.equal(calls.write, 0);
    assert.equal(await readFile(file, "utf8"), content);
  }

  const hard = await fixture();
  await link(hard.file, path.join(hard.directory, "alias.json"));
  const hardFakes = fakes();
  await assert.rejects(migrateLegacyAcl(hard.file, isValid, unsafe, hardFakes.deps), unsafe);
  assert.equal(hardFakes.calls.write, 0);
  assert.equal(hardFakes.calls.owner, 0, "the ACL is not consulted for a file already refused");

  const missing = fakes();
  await assert.rejects(migrateLegacyAcl(path.join(hard.directory, "none.json"), isValid, unsafe, missing.deps), unsafe);
  assert.equal(missing.calls.write, 0);
});

test("a symbolic link or a path that is not the real path is refused", notWindows, async () => {
  const target = await fixture();
  const alias = path.join(target.directory, "linked.json");
  await symlink(target.file, alias);
  const linked = fakes();
  await assert.rejects(migrateLegacyAcl(alias, isValid, unsafe, linked.deps), unsafe);
  assert.equal(linked.calls.write, 0);

  const realDirectory = path.join(base, "real-dir");
  await mkdir(realDirectory);
  await writeFile(path.join(realDirectory, "its-lan-client.json"), JSON.stringify(good));
  const aliasDirectory = path.join(base, "alias-dir");
  await symlink(realDirectory, aliasDirectory);
  const moved = fakes();
  await assert.rejects(migrateLegacyAcl(path.join(aliasDirectory, "its-lan-client.json"), isValid, unsafe, moved.deps), unsafe);
  assert.equal(moved.calls.write, 0);
});

test("macOS and Linux never migrate: a wider mode stays refused and untouched", notWindows, async () => {
  const root = path.join(base, "posix-project");
  await mkdir(path.join(root, ".decal"), { recursive: true });
  execFileSync("git", ["-C", root, "init", "-q"]);
  const file = path.join(root, ".decal/its-lan-client.json");
  await writeFile(file, JSON.stringify(good));
  await chmod(file, 0o644);
  const result = spawnSync(process.execPath, [client, "status", "--root", root], { encoding: "utf8" });
  const line = JSON.parse(result.stdout.trim());
  assert.equal(line.code, "unsafe_private_storage");
  assert.equal(line.migrated, undefined);
  assert.equal(result.stdout.includes(KEY), false);
  assert.equal(await readFile(file, "utf8"), JSON.stringify(good));
  await assert.rejects(readV24(file), { code: "unsafe_private_storage" });
});

async function windowsProject(content) {
  const root = path.join(base, `win-project-${count += 1}`);
  await mkdir(path.join(root, ".decal"), { recursive: true });
  execFileSync("git", ["-C", root, "init", "-q"]);
  const file = path.join(root, ".decal/its-lan-client.json");
  await writeFile(file, content); // Plain write: the ACL is inherited, as it was before the check existed.
  return { root, file };
}
const statusOf = (root) => {
  const result = spawnSync(process.execPath, [client, "status", "--root", root], { encoding: "utf8" });
  return { line: JSON.parse(result.stdout.trim()), stdout: result.stdout };
};

test("Windows: an inherited-ACL client file fails on v23 and migrates on v24", windows, async () => {
  const { root, file } = await windowsProject(JSON.stringify(good));
  await assert.rejects(readV23(file), { code: "unsafe_private_storage" });
  const { line, stdout } = statusOf(root);
  assert.equal(line.migrated, true, stdout);
  assert.equal(stdout.includes(KEY), false, "the key is never printed");
  await assertPrivate(file);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), good);
  assert.equal(statusOf(root).line.migrated, undefined, "once only");
});

test("Windows: links, malformed content and the wrong schema stay refused and untouched", windows, async () => {
  for (const content of ["{not json", JSON.stringify({ ...good, schema: "other/v1" })]) {
    const { root, file } = await windowsProject(content);
    const { line } = statusOf(root);
    assert.equal(line.code, "unsafe_private_storage");
    assert.equal(line.migrated, undefined);
    assert.equal(await readFile(file, "utf8"), content);
  }
  const hard = await windowsProject(JSON.stringify(good));
  await link(hard.file, path.join(hard.root, "alias.json"));
  assert.equal(statusOf(hard.root).line.code, "unsafe_private_storage");
  const linked = await windowsProject(JSON.stringify(good));
  const outside = path.join(linked.root, "outside.json");
  await writeFile(outside, JSON.stringify(good));
  await rm(linked.file);
  await symlink(outside, linked.file, "file");
  assert.equal(statusOf(linked.root).line.code, "unsafe_private_storage");
  assert.equal(await readFile(outside, "utf8"), JSON.stringify(good));
});

test("Windows: an inherited-ACL authority state migrates; a wrong schema does not", windows, async () => {
  const home = path.join(base, `win-home-${count += 1}`);
  await mkdir(home);
  const file = path.join(home, "lan-authority.json");
  const state = { schema: "decal.its-lan-authority/v1", label: "m", port: 0, adminToken: "secret-token", projects: [], devices: [] };
  await writeFile(file, JSON.stringify({ ...state, schema: "other/v1" }));
  const env = { ...process.env, DECAL_ITS_HOME: home };
  const refused = spawnSync(process.execPath, [authority, "add-project", "--root", home], { encoding: "utf8", env });
  assert.equal(JSON.parse(refused.stdout.trim()).code, "unsafe_private_storage");
  await rm(file);
  await writeFile(file, JSON.stringify(state));
  execFileSync("git", ["-C", home, "init", "-q"]);
  const result = spawnSync(process.execPath, [authority, "add-project", "--root", home], { encoding: "utf8", env });
  assert.equal(result.stdout.includes("secret-token"), false);
  assert.equal(JSON.parse(result.stdout.trim()).migrated, true, result.stdout);
  await assertPrivate(file);
});
