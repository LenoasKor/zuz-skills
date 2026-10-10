#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const required = ["README.md", "contract.json", "register-ticket.mjs", "registration.mjs", "verify-contract.mjs"];
const dependencies = ["task-work-bug/v10/README.md", "task-work-bug/v10/contract.json", "task-work-bug/v10/main-authority.mjs", "task-work-bug/v10/manifest.json", "task-work-bug/v10/register-task-batch.mjs", "task-work-bug/v10/register-ticket.mjs", "task-work-bug/v10/verify-contract.mjs", "task-work-bug/v15/README.md", "task-work-bug/v15/contract.json", "task-work-bug/v15/manifest.json", "task-work-bug/v15/register-task-batch.mjs", "task-work-bug/v15/register-ticket.mjs", "task-work-bug/v15/registration-lock.mjs", "task-work-bug/v15/registration.mjs", "task-work-bug/v15/task-registration-batch.mjs", "task-work-bug/v15/verify-contract.mjs", "task-work-bug/v7/README.md", "task-work-bug/v7/contract.json", "task-work-bug/v7/default-branch.mjs", "task-work-bug/v7/fixtures/work-intent.json", "task-work-bug/v7/manifest.json", "task-work-bug/v7/register-task-batch.mjs", "task-work-bug/v7/register-ticket.mjs", "task-work-bug/v7/registration.mjs", "task-work-bug/v7/task-registration-batch.mjs", "task-work-bug/v8/README.md", "task-work-bug/v8/finalize.mjs", "task-work-bug/v8/manifest.json", "task-work-bug/v8/recover.mjs", "task-work-bug/v8/settle-work-item.mjs", "task-work-bug/v8/strict-json.mjs", "task-work-bug/v8/task-lifecycle.mjs", "task-work-bug/v8/task-policy.mjs", "task-work-bug/v8/transaction.mjs", "task-work-bug/v8/verify-contract.mjs", "task-work-bug/v8/version-profile.mjs", "task-work-bug/v8/work-bug-policy.mjs", "task-work-bug/v8/work-item-lifecycle.mjs", "task-work-bug/v9/README.md", "task-work-bug/v9/contract.json", "task-work-bug/v9/finalize.mjs", "task-work-bug/v9/manifest.json", "task-work-bug/v9/recover.mjs", "task-work-bug/v9/register-ticket.mjs", "task-work-bug/v9/registration.mjs", "task-work-bug/v9/settle-work-item.mjs", "task-work-bug/v9/strict-json.mjs", "task-work-bug/v9/task-lifecycle.mjs", "task-work-bug/v9/task-policy.mjs", "task-work-bug/v9/ticket-path.mjs", "task-work-bug/v9/transaction.mjs", "task-work-bug/v9/unpadded-work-intent.json", "task-work-bug/v9/verify-contract.mjs", "task-work-bug/v9/version-profile.mjs", "task-work-bug/v9/work-bug-policy.mjs", "task-work-bug/v9/work-item-lifecycle.mjs", "zuz-its/v3/README.md", "zuz-its/v3/contract.json", "zuz-its/v3/fixtures/legacy-aliases.json", "zuz-its/v3/incident.mjs", "zuz-its/v3/manifest.json", "zuz-its/v3/project.mjs", "zuz-its/v3/transition-incident.mjs", "zuz-its/v4/README.md", "zuz-its/v4/incident.mjs", "zuz-its/v4/manifest.json", "zuz-its/v4/transition-incident.mjs", "zuz-its/v4/verify-contract.mjs", "zuz-its/v5/README.md", "zuz-its/v5/incident.mjs", "zuz-its/v5/manifest.json", "zuz-its/v5/transition-incident.mjs", "zuz-its/v5/verify-contract.mjs"];
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
  const same = (obj, keys) => obj && !Array.isArray(obj) && JSON.stringify(Object.keys(obj).sort()) === JSON.stringify([...keys].sort());
  if (manifest.schema !== "decal.task-work-bug.fixture-manifest/v16" || !same(manifest.files, required) || !same(manifest.dependencies, dependencies)) fail("invalid_contract_manifest");
  if (JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify([...required, "manifest.json"].sort())) fail("unexpected_contract_file");
  for (const name of required) if (!/^[a-f0-9]{64}$/u.test(manifest.files[name]) || sha(await plain(path.join(directory,name))) !== manifest.files[name]) fail("contract_digest_mismatch");
  const root = path.resolve(directory, "../..");
  for (const name of dependencies) if (!/^[a-f0-9]{64}$/u.test(manifest.dependencies[name]) || sha(await plain(path.join(root,name))) !== manifest.dependencies[name]) fail("contract_dependency_mismatch");
  await (await import(pathToFileURL(path.join(root,"task-work-bug/v15/verify-contract.mjs")).href)).verifyContract(path.join(root,"task-work-bug/v15"));
  await (await import(pathToFileURL(path.join(root,"zuz-its/v5/verify-contract.mjs")).href)).verifyContract(path.join(root,"zuz-its/v5"));
  return { status:"accepted", schema:manifest.schema, fileCount:required.length, scope:"incident-only" };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { if (process.argv.length !== 2) fail("usage_error"); console.log(JSON.stringify(await verifyContract())); }
  catch (error) { console.log(JSON.stringify({status:"rejected",code:error.code || "contract_validation_failed"}));process.exitCode=2; }
}
