import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { digest } from "../packs/decal-pack/src/contracts/task-work-bug/v9/version-profile.mjs";
import { git, planDigest } from "../packs/decal-pack/src/contracts/task-work-bug/v9/transaction.mjs";
import {
  cli,
  normalizeReleaseContext,
  planWorkItemTransition,
  transitionWorkItem,
} from "../packs/decal-pack/src/contracts/task-work-bug/v11/work-item-lifecycle.mjs";

const contracts = fileURLToPath(new URL("../packs/decal-pack/src/contracts/task-work-bug/", import.meta.url));
const timestamp = "2026-09-22T00:00:00.000Z";

function record(kind, status = "development_complete") {
  const id = `${kind === "work" ? "WORK" : "BUG"}-1`;
  const completion = ["development_complete", "release_ready"].includes(status)
    ? ["completion:", '  summary: "Verified"', "  evidence:", '    - "focused regression passed"', `  completedAt: "${timestamp}"`]
    : ["completion: null"];
  return [
    "---",
    `schema: decal.task-work-bug.${kind === "work" ? "work-document" : "bug-card"}`,
    "schemaVersion: 1",
    `id: ${id}`,
    `status: ${status}`,
    "taskRefs: []",
    'nextAction: "Verify lifecycle"',
    "versionImpact: desktop-patch",
    "remoteVersionImpact: none",
    "releaseMode: standalone",
    "releaseTaskRef: null",
    "versionApplied: pending",
    "remoteVersionApplied: not-required",
    `createdAt: "${timestamp}"`,
    `updatedAt: "${timestamp}"`,
    "blocked: null",
    ...completion,
    "closure: null",
    "customOwner: preserve-me",
    "---",
    "",
    "## Existing body",
    "Keep this content unchanged.",
    "",
  ].join("\n");
}

function request(kind, releaseStage, releaseStageSource, overrides = {}) {
  return {
    schema: "zuz.its.work-item-lifecycle-request/v2",
    kind,
    id: `${kind === "work" ? "WORK" : "BUG"}-1`,
    target: "closed",
    timestamp,
    releaseStage,
    releaseStageSource,
    reason: kind === "work" ? "completed" : "fixed",
    ...overrides,
  };
}

test("v11 normalizes only explicit stored or documented defaulted release stages", () => {
  assert.equal(normalizeReleaseContext({ schema: "zuz.its.work-item-lifecycle-request/v2", releaseStage: "pre_live", releaseStageSource: "stored" }).effectiveStage, "pre_live");
  assert.equal(normalizeReleaseContext({ schema: "zuz.its.work-item-lifecycle-request/v2", releaseStage: "live", releaseStageSource: "stored" }).effectiveStage, "live");
  assert.equal(normalizeReleaseContext({ schema: "zuz.its.work-item-lifecycle-request/v2", releaseStage: "unset", releaseStageSource: "defaulted" }).effectiveStage, "pre_live");
  assert.equal(normalizeReleaseContext({ schema: "zuz.its.work-item-lifecycle-request/v2", releaseStage: null, releaseStageSource: "defaulted" }).effectiveStage, "pre_live");
  assert.throws(() => normalizeReleaseContext({ schema: "zuz.its.work-item-lifecycle-request/v2", releaseStage: "live", releaseStageSource: "defaulted" }), { code: "invalid_release_context" });
  assert.throws(() => normalizeReleaseContext({ schema: "zuz.its.work-item-lifecycle-request/v2", releaseStage: "future", releaseStageSource: "stored" }), { code: "invalid_release_context" });
});

for (const kind of ["work", "bug"]) {
  test(`${kind}: pre_live closes directly while explicit live keeps release_ready`, () => {
    const preLive = transitionWorkItem(record(kind), request(kind, "pre_live", "stored"));
    assert.equal(preLive.from, "development_complete");
    assert.equal(preLive.to, "closed");
    assert.match(preLive.next, /^status: closed$/mu);
    assert.match(preLive.next, new RegExp(`reason: ${kind === "work" ? "completed" : "fixed"}`, "u"));
    assert.match(preLive.next, /customOwner: preserve-me/u);
    assert.throws(
      () => transitionWorkItem(record(kind), request(kind, "pre_live", "stored", { target: "release_ready", reason: undefined })),
      { code: "release_ready_not_applicable" },
    );
    assert.throws(() => transitionWorkItem(record(kind), request(kind, "live", "stored")), { code: "unsupported_transition" });
    assert.equal(transitionWorkItem(record(kind, "release_ready"), request(kind, "live", "stored")).to, "closed");
    assert.equal(transitionWorkItem(record(kind), request(kind, "unset", "defaulted")).to, "closed");
    assert.throws(
      () => transitionWorkItem(record(kind), {
        schema: "zuz.its.work-item-lifecycle-request/v1",
        kind,
        id: `${kind === "work" ? "WORK" : "BUG"}-1`,
        target: "closed",
        timestamp,
        reason: kind === "work" ? "completed" : "fixed",
      }),
      { code: "unsupported_transition" },
    );
  });
}

async function fixture(kind, status = "development_complete") {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "its-pre-live-lifecycle-")));
  await cp(contracts, path.join(root, "contracts/task-work-bug"), { recursive: true });
  await mkdir(path.join(root, ".decal"));
  await writeFile(path.join(root, ".decal/settlement-profile.json"), JSON.stringify({
    schema: "zuz.its.settlement-profile/v1",
    engine: "portable",
    channels: { desktop: "app", remote: null },
    products: [{ id: "app", files: [{ path: "package.json", format: "json", pointers: ["/version"] }] }],
  }));
  await writeFile(path.join(root, "package.json"), '{"version":"0.1.0"}\n');
  const id = `${kind === "work" ? "WORK" : "BUG"}-1`;
  const relative = `docs/work-items/${kind === "work" ? "work" : "bugs"}/${id}.md`;
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), record(kind, status));
  await writeFile(path.join(root, "unrelated"), "original\n");
  await git(root, ["init", "-b", "main"]);
  await git(root, ["config", "user.name", "Fixture"]);
  await git(root, ["config", "user.email", "fixture@example.invalid"]);
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "fixture"]);
  return { root, id, relative };
}

test("v11 CLI closes defaulted pre_live Bug and leaves settlement separate", async () => {
  const { root, id, relative } = await fixture("bug");
  await writeFile(path.join(root, "unrelated"), "other owner\n");
  const lifecycleRequest = {
    ...request("bug", null, "defaulted"),
    id,
    expectedSourceRevision: digest(await readFile(path.join(root, relative), "utf8")),
  };
  await writeFile(path.join(root, "request.json"), JSON.stringify(lifecycleRequest));
  const preview = await cli(["--root", root, "--request", path.join(root, "request.json"), "--dry-run"]);
  assert.equal(preview.releaseContext.effectiveStage, "pre_live");
  const result = await cli(["--root", root, "--request", path.join(root, "request.json"), "--write", "--approved-plan-digest", preview.approvalDigest]);
  assert.equal(result.state, "committed");
  assert.match(await readFile(path.join(root, relative), "utf8"), /^status: closed$/mu);
  assert.equal(JSON.parse(await readFile(path.join(root, "package.json"), "utf8")).version, "0.1.0");
  assert.equal(await readFile(path.join(root, "unrelated"), "utf8"), "other owner\n");
});

test("v11 approval digest binds the observed release-stage source", async () => {
  const { root, id, relative } = await fixture("work", "in_progress");
  const expectedSourceRevision = digest(await readFile(path.join(root, relative), "utf8"));
  const common = {
    root,
    schema: "zuz.its.work-item-lifecycle-request/v2",
    kind: "work",
    id,
    target: "development_complete",
    timestamp,
    expectedSourceRevision,
    summary: "Verified",
    evidence: ["focused regression passed"],
  };
  const stored = await planWorkItemTransition({ ...common, releaseStage: "pre_live", releaseStageSource: "stored" });
  const defaulted = await planWorkItemTransition({ ...common, releaseStage: "unset", releaseStageSource: "defaulted" });
  assert.notEqual(planDigest(stored.plan), planDigest(defaulted.plan));
});
