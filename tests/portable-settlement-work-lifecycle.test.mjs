import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, realpath, cp } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "../packs/decal-pack/src/contracts/task-work-bug/v8/transaction.mjs";
import { digest } from "../packs/decal-pack/src/contracts/task-work-bug/v8/version-profile.mjs";
import { transitionWorkItem } from "../packs/decal-pack/src/contracts/task-work-bug/v8/work-item-lifecycle.mjs";

const run = promisify(execFile);
const contracts = fileURLToPath(new URL("../packs/decal-pack/src/contracts/task-work-bug/", import.meta.url));
const timestamp = "2026-09-06T00:00:00.000Z";
function source(kind, status = "new") {
  return ["---", `schema: decal.task-work-bug.${kind === "work" ? "work-document" : "bug-card"}`, "schemaVersion: 1",
    `id: ${kind === "work" ? "WORK" : "BUG"}-001`, `status: ${status}`, "versionImpact: desktop-patch", "remoteVersionImpact: none",
    "releaseMode: standalone", "releaseTaskRef: null", "versionApplied: pending", "remoteVersionApplied: not-required", "taskRefs: []",
    `createdAt: "${timestamp}"`, `updatedAt: "${timestamp}"`, "blocked: null", "completion: null", "closure: null",
    "customOwner: preserve-me", "---", "", "## Existing body", "Keep this content unchanged.", ""].join("\r\n");
}
for (const kind of ["work", "bug"]) {
  test(`${kind}: copied CLI normal lifecycle then standalone settlement, no Decal`, async () => {
    const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "its-work-lifecycle-")));
    await cp(contracts, path.join(root, "contracts/task-work-bug"), { recursive: true });
    await mkdir(path.join(root, ".decal"));
    await writeFile(path.join(root, ".decal/settlement-profile.json"), JSON.stringify({ schema: "zuz.its.settlement-profile/v1", engine: "portable",
      channels: { desktop: "app", remote: null }, products: [{ id: "app", files: [{ path: "package.json", format: "json", pointers: ["/version"] }] }] }));
    await writeFile(path.join(root, "package.json"), '{"version":"0.1.0"}\n');
    const id = `${kind === "work" ? "WORK" : "BUG"}-001`;
    const relative = `docs/work-items/${kind === "work" ? "work" : "bugs"}/${id}.md`;
    await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await writeFile(path.join(root, relative), source(kind));
    await writeFile(path.join(root, "unrelated"), "original");
    await git(root, ["init", "-b", "main"]); await git(root, ["config", "user.name", "Fixture"]); await git(root, ["config", "user.email", "fixture@example.invalid"]);
    await git(root, ["add", "."]); await git(root, ["commit", "-m", "fixture"]);
    await writeFile(path.join(root, "unrelated"), "other owner");
    const env = { ...process.env }; delete env.DECAL_SESSION_ID;
    const cli = async (file, args) => JSON.parse((await run(process.execPath, [`contracts/task-work-bug/v8/${file}.mjs`, "--root", root, ...args], { cwd: root, env })).stdout);
    for (const target of [kind === "work" ? "planned" : "confirmed", "in_progress", "development_complete", "release_ready", "closed"]) {
      const request = { schema: "zuz.its.work-item-lifecycle-request/v1", kind, id, target, timestamp,
        expectedSourceRevision: digest(await readFile(path.join(root, relative), "utf8")),
        ...(target === "development_complete" ? { summary: "Test fixture passed", evidence: ["fixture-only verification"] } : {}),
        ...(target === "closed" ? { reason: kind === "work" ? "completed" : "fixed" } : {}) };
      await writeFile(path.join(root, "request.json"), JSON.stringify(request));
      const preview = await cli("work-item-lifecycle", ["--request", "request.json", "--dry-run"]);
      assert.equal(preview.writeSet.length, 1);
      const result = await cli("work-item-lifecycle", ["--request", "request.json", "--write", "--approved-plan-digest", preview.approvalDigest]);
      assert.equal(result.state, "committed");
      assert.equal(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version, "0.1.0");
    }
    const preview = await cli("settle-work-item", ["--kind", kind, "--id", id, "--dry-run"]);
    await cli("settle-work-item", ["--kind", kind, "--id", id, "--write", "--approved-plan-digest", preview.approvalDigest]);
    assert.equal(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version, "0.1.1");
    const saved = await readFile(path.join(root, relative), "utf8");
    assert.match(saved, /customOwner: preserve-me\r\n/);
    assert.ok(saved.endsWith("## Existing body\r\nKeep this content unchanged.\r\n"));
    assert.match(saved, /createdAt: "2026-09-06T00:00:00.000Z"/);
    assert.equal(await readFile(path.join(root, "unrelated"), "utf8"), "other owner");
  });
}
test("lifecycle refuses skips, missing evidence, wrong-kind reasons and inferred unblock", () => {
  const base = { kind: "work", id: "WORK-001", timestamp };
  for (const [input, request, code] of [
    [source("work"), { target: "in_progress" }, "unsupported_transition"],
    [source("work", "in_progress"), { target: "development_complete", summary: " ", evidence: ["x"] }, "completion_evidence_required"],
    [source("work", "release_ready"), { target: "closed", reason: "fixed" }, "invalid_closure_reason"],
    [source("work", "release_ready"), { target: "closed", reason: "completed" }, "completion_evidence_required"],
    [source("work", "blocked"), { target: "in_progress" }, "unsupported_transition"],
    [source("work"), { target: "closed", reason: "duplicate", duplicateOf: "WORK-001" }, "duplicate_reference_required"],
  ]) assert.throws(() => transitionWorkItem(input, { ...base, ...request }), { code });
  const cancelled = transitionWorkItem(source("work"), { ...base, target: "closed", reason: "cancelled" });
  assert.match(cancelled.next, /reason: cancelled/);
  assert.match(cancelled.next, /completion: null/);
});
