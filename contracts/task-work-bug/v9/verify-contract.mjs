#!/usr/bin/env node
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const required = ["README.md", "contract.json", "finalize.mjs", "recover.mjs", "register-ticket.mjs", "registration.mjs", "settle-work-item.mjs", "strict-json.mjs", "task-lifecycle.mjs", "task-policy.mjs", "ticket-path.mjs", "transaction.mjs", "unpadded-work-intent.json", "verify-contract.mjs", "version-profile.mjs", "work-bug-policy.mjs", "work-item-lifecycle.mjs"];
function fail(code) { const error = new Error(code); error.code = code; throw error; }
async function plain(file) {
  if (await realpath(file) !== file) fail("unsafe_contract_path");
  const stat = await lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024) fail("unsafe_contract_path");
  return readFile(file);
}
export async function verifyContract(directory = path.dirname(fileURLToPath(import.meta.url))) {
  if (await realpath(directory) !== directory) fail("unsafe_contract_path");
  const manifest = JSON.parse(await plain(path.join(directory, "manifest.json")));
  if (manifest.schema !== "decal.task-work-bug.fixture-manifest/v9" || !manifest.files || Array.isArray(manifest.files)
      || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify([...required].sort())) fail("invalid_contract_manifest");
  const actual = (await readdir(directory)).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...required, "manifest.json"].sort())) fail("unexpected_contract_file");
  for (const name of required) {
    const expected = manifest.files[name];
    if (!/^[a-f0-9]{64}$/u.test(expected) || createHash("sha256").update(await plain(path.join(directory, name))).digest("hex") !== expected) fail("contract_digest_mismatch");
  }
  if (!manifest.dependencies || JSON.stringify(Object.keys(manifest.dependencies).sort()) !== JSON.stringify(["v7/default-branch.mjs", "v8/manifest.json"].sort())) fail("invalid_contract_dependencies");
  for (const [relative, expected] of Object.entries(manifest.dependencies)) {
    if (!/^[a-f0-9]{64}$/u.test(expected) || createHash("sha256").update(await plain(path.join(directory, "..", relative))).digest("hex") !== expected) fail("contract_dependency_mismatch");
  }
  return { status: "accepted", schema: manifest.schema, fileCount: required.length };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) fail("usage_error");
    process.stdout.write(JSON.stringify(await verifyContract()) + "\n");
  } catch (error) { process.stdout.write(JSON.stringify({ status: "rejected", code: error.code ?? "contract_validation_failed" }) + "\n"); process.exitCode = 2; }
}
