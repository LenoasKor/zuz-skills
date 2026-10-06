#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED = ["README.md", "incident.mjs", "transition-incident.mjs", "verify-contract.mjs"];
const DEPENDENCIES = ["zuz-its/v3/incident.mjs", "task-work-bug/v9/transaction.mjs", "task-work-bug/v9/version-profile.mjs", "task-work-bug/v9/strict-json.mjs", "task-work-bug/v9/verify-contract.mjs", "task-work-bug/v7/default-branch.mjs"];
function fail(code) { throw Object.assign(new Error(code), { code }); }
async function plain(target) {
  if (await realpath(target) !== target) fail("unsafe_contract_path");
  const stat = await lstat(target);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) fail("unsafe_contract_path");
  return readFile(target);
}
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
export async function verifyContract(directory = path.dirname(fileURLToPath(import.meta.url))) {
  if (await realpath(directory) !== directory) fail("unsafe_contract_path");
  const manifest = JSON.parse(await plain(path.join(directory, "manifest.json")));
  const sameKeys = (value, expected) => value && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
  if (manifest.schema !== "zuz.its.fixture-manifest/v4" || manifest.contractId !== "zuz.its/v4" || !sameKeys(manifest.files, REQUIRED) || !sameKeys(manifest.dependencies, DEPENDENCIES)) fail("invalid_contract_manifest");
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify([...REQUIRED, "manifest.json"].sort())) fail("unexpected_contract_file");
  for (const name of REQUIRED) if (!/^[a-f0-9]{64}$/u.test(manifest.files[name]) || sha(await plain(path.join(directory, name))) !== manifest.files[name]) fail("contract_digest_mismatch");
  const contractRoot = path.resolve(directory, "../..");
  for (const name of DEPENDENCIES) if (!/^[a-f0-9]{64}$/u.test(manifest.dependencies[name]) || sha(await plain(path.join(contractRoot, name))) !== manifest.dependencies[name]) fail("contract_dependency_mismatch");
  return { status: "accepted", contractId: "zuz.its/v4", fileCount: REQUIRED.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv.length !== 2) fail("usage_error"); console.log(JSON.stringify(await verifyContract())); }
  catch (error) { console.log(JSON.stringify({ status: "rejected", code: error.code || "contract_validation_failed" })); process.exitCode = 2; }
}
