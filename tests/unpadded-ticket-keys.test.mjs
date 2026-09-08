import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { repositoryRoot } from "../scripts/pack-lib.mjs";
import { projectZuzItsIdentity } from "../packs/decal-pack/src/contracts/zuz-its/v3/project.mjs";
import { canonicalIncidentId } from "../packs/decal-pack/src/contracts/zuz-its/v3/incident.mjs";
import { canonicalTicketId, resolveTicketPath } from "../packs/decal-pack/src/contracts/task-work-bug/v9/ticket-path.mjs";
import { planTicketRegistration, registerTicket } from "../packs/decal-pack/src/contracts/task-work-bug/v9/registration.mjs";
import { verifyContract } from "../packs/decal-pack/src/contracts/task-work-bug/v9/verify-contract.mjs";

const run = promisify(execFile);
const sourceRoot = path.join(repositoryRoot, "packs/decal-pack/src");

test("canonical zuz ITS keys drop leading zeroes while legacy aliases remain readable", async () => {
  assert.equal((await verifyContract()).status, "accepted");
  for (const [kind, input, expected] of [
    ["task", "007", "TASK-7"],
    ["work", "WORK-007", "WORK-7"],
    ["bug", "BUG-0007", "BUG-7"],
    ["incident", "INC-7", "INC-7"],
  ]) assert.equal(projectZuzItsIdentity(kind, input).displayKey, expected);
  assert.equal(canonicalTicketId("work", "WORK-0007"), "WORK-7");
  assert.equal(canonicalIncidentId("INC-0007"), "INC-7");
});

test("v9 registration issues unpadded keys and rejects physical alias collisions", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "zuz-its-v9-")));
  try {
    await mkdir(path.join(root, "contracts/task-work-bug/v8"), { recursive: true });
    await writeFile(
      path.join(root, "contracts/task-work-bug/v8/manifest.json"),
      await readFile(path.join(sourceRoot, "contracts/task-work-bug/v8/manifest.json")),
    );
    await run("git", ["init", "-q", "-b", "main"], { cwd: root });
    await run("git", ["config", "user.email", "fixture@zuz.dev"], { cwd: root });
    await run("git", ["config", "user.name", "zuz ITS fixture"], { cwd: root });
    await run("git", ["add", "."], { cwd: root });
    await run("git", ["commit", "-qm", "fixture"], { cwd: root });

    const intent = JSON.parse(await readFile(path.join(sourceRoot, "contracts/task-work-bug/v9/unpadded-work-intent.json"), "utf8"));
    const plan = await planTicketRegistration(root, intent);
    const receipt = await registerTicket({ root, intent, approvedDigest: plan.intentDigest });
    assert.deepEqual(receipt.assigned, { id: "WORK-1", path: "docs/work-items/work/WORK-1.md" });
    assert.equal((await resolveTicketPath(root, "work", "WORK-001")).canonicalId, "WORK-1");

    const directory = path.join(root, "docs/work-items/work");
    const legacy = (id) => `---\nschema: decal.task-work-bug.work-document\nschemaVersion: 1\nid: ${id}\n---\n`;
    await writeFile(path.join(directory, "WORK-007.md"), legacy("WORK-007"));
    await writeFile(path.join(directory, "WORK-7.md"), legacy("WORK-7"));
    await assert.rejects(resolveTicketPath(root, "work", "WORK-7"), { code: "duplicate_record_identity" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
