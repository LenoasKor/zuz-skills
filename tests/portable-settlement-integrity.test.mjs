import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, writeFile, realpath, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { verifyContract } from "../packs/decal-pack/src/contracts/task-work-bug/v8/verify-contract.mjs";
import { gitBoundary } from "../packs/decal-pack/src/contracts/task-work-bug/v8/transaction.mjs";

const run = promisify(execFile);
const contracts = fileURLToPath(new URL("../packs/decal-pack/src/contracts/task-work-bug/", import.meta.url));
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "its-contract-integrity-")));
  await cp(contracts, path.join(root, "task-work-bug"), { recursive: true });
  return path.join(root, "task-work-bug/v8");
}
test("copied contract verifier works using Node only and includes every runtime file", async () => {
  const dir = await fixture();
  const result = JSON.parse((await run(process.execPath, [path.join(dir, "verify-contract.mjs")], { cwd: dir })).stdout);
  assert.equal(result.status, "accepted");
  assert.equal(result.fileCount, 12);
});
test("changed bytes, omitted manifest entry, hidden file and changed dependency are rejected", async () => {
  for (const mode of ["bytes", "omitted", "hidden", "dependency"]) {
    const dir = await fixture();
    if (mode === "bytes") await writeFile(path.join(dir, "settle-work-item.mjs"), "throw Error('not original');\n");
    if (mode === "omitted") {
      const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8"));
      delete manifest.files["settle-work-item.mjs"];
      await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    }
    if (mode === "hidden") await writeFile(path.join(dir, ".injected.mjs"), "hidden");
    if (mode === "dependency") await writeFile(path.join(dir, "../v7/default-branch.mjs"), "modified");
    await assert.rejects(verifyContract(dir), { code: { bytes: "contract_digest_mismatch", omitted: "invalid_contract_manifest", hidden: "unexpected_contract_file", dependency: "contract_dependency_mismatch" }[mode] });
  }
});
test("contract directory aliases and Decal-owned session fallback are refused", async () => {
  const dir = await fixture();
  const alias = `${dir}-alias`;
  await symlink(dir, alias);
  await assert.rejects(verifyContract(alias), { code: "unsafe_contract_path" });
  const original = process.env.DECAL_SESSION_ID;
  const present = Object.hasOwn(process.env, "DECAL_SESSION_ID");
  process.env.DECAL_SESSION_ID = "";
  try { await assert.rejects(gitBoundary("/not-a-project"), { code: "native_authority_required" }); }
  finally { if (present) process.env.DECAL_SESSION_ID = original; else delete process.env.DECAL_SESSION_ID; }
});
