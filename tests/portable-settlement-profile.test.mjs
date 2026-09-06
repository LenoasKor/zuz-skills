import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, symlink, link, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  PROFILE_SCHEMA, PROFILE_PATH, bumpVersion, digest, loadProfile,
  planProductVersions, readVersionFile, updateVersionFile, validateProfile,
} from "../packs/decal-pack/src/contracts/task-work-bug/v8/version-profile.mjs";

function profile(prefix = "") {
  return {
    schema: PROFILE_SCHEMA, engine: "portable",
    channels: { desktop: "showcase", remote: null },
    products: [{ id: "showcase", files: [
      { path: `${prefix}package.json`, format: "json", pointers: ["/version"] },
      { path: `${prefix}package-lock.json`, format: "json", pointers: ["/version", "/packages//version"] },
    ] }],
  };
}

async function fixture(prefix = "") {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "its-settlement-profile-")));
  await mkdir(path.join(root, ".decal"));
  if (prefix) await mkdir(path.join(root, prefix), { recursive: true });
  const value = profile(prefix);
  await writeFile(path.join(root, PROFILE_PATH), JSON.stringify(value));
  await writeFile(path.join(root, `${prefix}package.json`), '{\n  "version": "0.1.2",\n  "name": "showcase",\n  "custom": {"keep": true}\n}\n');
  await writeFile(path.join(root, `${prefix}package-lock.json`), JSON.stringify({
    version: "0.1.2", packages: { "": { version: "0.1.2" }, "node_modules/example": { version: "1.2.3" } },
  }, null, 2));
  return { root, value };
}

for (const prefix of ["", "product/"]) {
  test(`read-only plans support ${prefix || "root"} without Decal`, async () => {
    const { root, value } = await fixture(prefix);
    const loaded = await loadProfile(root);
    assert.deepEqual(loaded.profile, value);
    assert.equal(loaded.revision, digest(loaded.source));
    const plan = await planProductVersions(root, value, { desktop: "minor", remote: "none" });
    assert.deepEqual(plan.versions.desktop, { productId: "showcase", before: "0.1.2", after: "0.2.0" });
    assert.equal(plan.versions.remote, null);
    assert.equal(plan.writes.length, 2);
    for (const entry of plan.writes) {
      assert.equal(await readFile(path.join(root, entry.path), "utf8"), entry.source);
      assert.notEqual(entry.before, entry.after);
    }
    assert.deepEqual(JSON.parse(plan.writes[0].next).custom, { keep: true });
    assert.equal(JSON.parse(plan.writes[1].next).packages["node_modules/example"].version, "1.2.3");
    assert.equal(JSON.parse(plan.writes[1].next).packages[""].version, "0.2.0");
  });
}

test("none supports a versionless project and no default path guessing", async () => {
  const { root } = await fixture();
  const value = { schema: PROFILE_SCHEMA, engine: "portable", channels: { desktop: null, remote: null }, products: [] };
  assert.deepEqual(await planProductVersions(root, value, { desktop: "none", remote: "none" }), {
    versions: { desktop: null, remote: null }, writes: [],
  });
  await assert.rejects(planProductVersions(root, value, { desktop: "minor", remote: "none" }), { code: "product_configuration_required" });
});

test("repository-owned settlement cannot also use portable bump", async () => {
  const { root, value } = await fixture();
  value.engine = "repository";
  await assert.rejects(planProductVersions(root, value, { desktop: "patch", remote: "none" }), { code: "repository_settlement_required" });
});

test("unaffected product files remain byte-identical", async () => {
  const { root, value } = await fixture();
  const plan = await planProductVersions(root, value, { desktop: "none", remote: "none" });
  assert.ok(plan.writes.every((entry) => entry.source === entry.next && entry.before === entry.after));
});

test("two independent products do not reset each other's versions", async () => {
  const { root, value } = await fixture();
  value.channels.remote = "web";
  value.products.push({ id: "web", files: [{ path: "WEB_VERSION", format: "plain-semver" }] });
  await writeFile(path.join(root, "WEB_VERSION"), "2.3.8\n");
  const plan = await planProductVersions(root, value, { desktop: "minor", remote: "patch" });
  assert.equal(plan.versions.desktop.after, "0.2.0");
  assert.equal(plan.versions.remote.after, "2.3.9");
});

test("version mismatch across package lock and package file blocks", async () => {
  const { root, value } = await fixture();
  await writeFile(path.join(root, "package.json"), '{"version":"0.1.3"}');
  await assert.rejects(planProductVersions(root, value, { desktop: "minor", remote: "none" }), { code: "version_mismatch" });
});

test("literal Cargo package version preserves comments and dependency versions", () => {
  const file = { path: "product/Cargo.toml", format: "cargo-package" };
  const source = '# hello\n[package]\nname = "showcase"\nversion = "0.1.2" # keep\n\n[dependencies]\nexample = "0.1.2"\n';
  assert.equal(readVersionFile(source, file), "0.1.2");
  assert.equal(updateVersionFile(source, file, "0.2.0"), source.replace('version = "0.1.2"', 'version = "0.2.0"'));
  assert.throws(() => readVersionFile('[package]\nversion.workspace = true\n', file), { code: "unsupported_cargo_version" });
  assert.throws(() => readVersionFile('[[package]]\nversion = "0.1.2"\n', file), { code: "unsupported_cargo_version" });
});

test("missing/ambiguous/unsafe version fields fail closed", () => {
  const file = { path: "package-lock.json", format: "json", pointers: ["/version", "/packages//version"] };
  assert.throws(() => readVersionFile('{"version":"1.0.0"}', file), { code: "missing_version_field" });
  assert.throws(() => readVersionFile('{"version":"1.0.0","packages":{"":{"version":"1.1.0"}}}', file), { code: "version_mismatch" });
  const invalid = profile();
  invalid.products[0].files[0].pointers = ["/__proto__/version"];
  assert.throws(() => validateProfile(invalid), { code: "invalid_json_pointer" });
});

for (const badPath of ["../package.json", "/package.json", "product/../package.json", "product\\package.json", "C:/package.json", "product//package.json"]) {
  test(`reject unsafe profile path ${badPath}`, () => {
    const value = profile(); value.products[0].files[0].path = badPath;
    assert.throws(() => validateProfile(value), { code: "unsafe_relative_path" });
  });
}

test("future schema, arbitrary hooks, repeated paths and shared channel targets are rejected", () => {
  for (const mutate of [
    (value) => { value.schema = "future"; },
    (value) => { value.postInstall = "curl anything"; },
    (value) => { value.products[0].files.push(value.products[0].files[0]); },
    (value) => { value.channels.remote = "showcase"; },
    (value) => { value.products[0].files[0].path = "docs/tasks/index.md"; },
  ]) {
    const value = profile(); mutate(value); assert.throws(() => validateProfile(value));
  }
});

test("parent symlink and hardlink cannot become version writes", async () => {
  const { root, value } = await fixture();
  await symlink(root, path.join(root, "linked"));
  value.products[0].files[0].path = "linked/package.json";
  await assert.rejects(planProductVersions(root, value, { desktop: "minor", remote: "none" }), { code: "unsafe_file" });
  value.products[0].files[0].path = "package.json";
  await link(path.join(root, "package.json"), path.join(root, "hard.json"));
  await assert.rejects(planProductVersions(root, value, { desktop: "minor", remote: "none" }), { code: "unsafe_file" });
});

test("SemVer policy does not accept build suffixes or overflow", () => {
  assert.equal(bumpVersion("1.2.9", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.9", "patch"), "1.2.10");
  for (const version of ["01.2.3", "1.2.3a", "1.2.3+build.2", "1.2", "1.2.9007199254740991"]) {
    assert.throws(() => bumpVersion(version, "patch"), { code: "invalid_version" });
  }
});

test("Cargo lock updates only the named local product", () => {
  const file = { path: "product/Cargo.lock", format: "cargo-lock-package", packageName: "showcase" };
  const source = '# generated\nversion = 4\n\n[[package]]\nname = "dependency"\nversion = "1.0.0"\nsource = "registry+example"\n\n[[package]]\nname = "showcase"\nversion = "0.1.2"\ndependencies = ["dependency"]\n';
  assert.equal(readVersionFile(source, file), "0.1.2");
  assert.equal(updateVersionFile(source, file, "0.2.0"), source.replace('version = "0.1.2"', 'version = "0.2.0"'));
  assert.throws(() => readVersionFile(source + '\n[[package]]\nname = "showcase"\nversion = "0.1.2"\n', file), { code: "ambiguous_cargo_package" });
  assert.throws(() => readVersionFile(source + 'source = "registry+example"\n', file), { code: "ambiguous_cargo_package" });
});

test("JSON rewrites reject duplicate keys and lossy integer values", () => {
  const file = { path: "package.json", format: "json", pointers: ["/version"] };
  for (const source of ['{"version":"0.1.2","version":"0.1.3"}', '{"version":"0.1.2","custom":{"x":1,"x":2}}', '{"version":"0.1.2","serial":9007199254740993}', '{"version":"0.1.2","precision":1.234567890123456789}']) {
    assert.throws(() => updateVersionFile(source, file, "0.2.0"), { code: "ambiguous_json_source" });
  }
});
