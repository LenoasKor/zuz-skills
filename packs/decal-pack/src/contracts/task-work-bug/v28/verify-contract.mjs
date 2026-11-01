#!/usr/bin/env node
import { verifyContract as verifyProfileLifecycle } from "../v11/verify-contract.mjs";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const required = ["README.md", "contract.json", "work-item-lifecycle.mjs", "verify-contract.mjs"];
const dependencies = ["v11/manifest.json"];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fail(code) { throw Object.assign(new Error(code), { code }); }
async function plain(file) {
  if (await realpath(file) !== file) fail("unsafe_contract_path");
  const stat = await lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) fail("unsafe_contract_path");
  return readFile(file);
}

export async function verifyContract(directory = path.dirname(fileURLToPath(import.meta.url))) {
  if (await realpath(directory) !== directory) fail("unsafe_contract_path");
  const manifest = JSON.parse(await plain(path.join(directory, "manifest.json")));
  const same = (value, keys) => value && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
  if (manifest.schema !== "decal.task-work-bug.fixture-manifest/v28" || !same(manifest.files, required) || !same(manifest.dependencies, dependencies)) fail("invalid_contract_manifest");
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify([...required, "manifest.json"].sort())) fail("unexpected_contract_file");
  for (const name of required) {
    if (!/^[a-f0-9]{64}$/u.test(manifest.files[name]) || sha(await plain(path.join(directory, name))) !== manifest.files[name]) fail("contract_digest_mismatch");
  }
  for (const name of dependencies) {
    if (!/^[a-f0-9]{64}$/u.test(manifest.dependencies[name]) || sha(await plain(path.join(directory, "..", name))) !== manifest.dependencies[name]) fail("contract_dependency_mismatch");
  }
  await verifyProfileLifecycle(path.join(directory, "..", "v11"));
  return { status: "accepted", schema: manifest.schema, fileCount: required.length, scope: "work-bug-status-transition" };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) fail("usage_error");
    process.stdout.write(`${JSON.stringify(await verifyContract())}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ status: "rejected", code: error.code ?? "contract_validation_failed" })}\n`);
    process.exitCode = 2;
  }
}
