import test from "node:test";
import assert from "node:assert/strict";
import { parseWorkBug, planStandalone, planTaskBatch, updateWorkBugApplied } from "../packs/decal-pack/src/contracts/task-work-bug/v8/work-bug-policy.mjs";

function record(kind = "work", overrides = {}) {
  const fields = {
    schema: kind === "work" ? "decal.task-work-bug.work-document" : "decal.task-work-bug.bug-card",
    schemaVersion: "1", id: kind === "work" ? "WORK-001" : "BUG-001", status: "closed",
    versionImpact: "desktop-patch", remoteVersionImpact: "none", releaseMode: "standalone", releaseTaskRef: "null",
    versionApplied: "pending", remoteVersionApplied: "not-required", ...overrides,
  };
  const reason = overrides.reason ?? (kind === "work" ? "completed" : "fixed");
  delete fields.reason;
  const source = ["---", ...Object.entries(fields).map(([key, value]) => `${key}: ${value}`),
    "taskRefs:", '  - "1"', "createdAt: 2026-09-06T00:00:00Z", "updatedAt: 2026-09-06T00:00:00Z",
    "completion:", '  summary: "verified"', "  evidence:", '    - "fixture passed"', "  completedAt: 2026-09-06T00:00:00Z",
    "closure:", `  reason: ${reason}`, "  note: null", "  duplicateOf: null", "  closedAt: 2026-09-06T00:00:00Z",
    "customField: untouched", "---", "# Keep original body", "Unknown prose stays exactly here.", "",
  ].join("\n");
  return { source, parsed: parseWorkBug(source, kind, fields.id) };
}

test("standalone Work/Bug applies patch exactly once", () => {
  for (const kind of ["work", "bug"]) {
    const { source, parsed } = record(kind);
    const plan = planStandalone(parsed, { desktop: "0.1.2", remote: null });
    assert.equal(plan.versions.desktop, "0.1.3");
    assert.equal(plan.record.versionApplied, "0.1.3");
    const next = updateWorkBugApplied(source, plan.record.versionApplied, plan.record.remoteVersionApplied);
    assert.equal(next, source.replace("versionApplied: pending", "versionApplied: 0.1.3"));
    const replay = planStandalone(parseWorkBug(next, kind), plan.versions);
    assert.deepEqual(replay.versions, plan.versions);
  }
});

test("no-fix and cancelled records settle without version bump", () => {
  for (const [kind, reasons] of Object.entries({ work: ["cancelled", "duplicate", "not_needed"], bug: ["duplicate", "cannot_reproduce", "wont_fix", "not_needed", "not-reproducible", "will-not-fix"] })) {
    for (const reason of reasons) {
      const { parsed } = record(kind, { reason });
      const result = planStandalone(parsed, { desktop: "1.2.3", remote: null });
      assert.deepEqual(result.versions, { desktop: "1.2.3", remote: null });
      assert.equal(result.record.versionApplied, "not-required");
    }
  }
});

test("task-batch orders Task minor then numeric Work then Bug patches", () => {
  const make = (kind, id) => record(kind, { id, releaseMode: "task-batch", releaseTaskRef: "1", versionApplied: "pending-task" }).parsed;
  const result = planTaskBatch([make("bug", "BUG-001"), make("work", "WORK-010"), make("work", "WORK-002")], {
    taskId: "1", impacts: { desktop: "minor", remote: "none" }, baseVersions: { desktop: "0.1.9", remote: null },
  });
  assert.deepEqual(result.taskApplied, { desktop: "0.2.0", remote: "not-required" });
  assert.deepEqual(result.records.map((item) => [item.id, item.versionApplied]), [["WORK-002", "0.2.1"], ["WORK-010", "0.2.2"], ["BUG-001", "0.2.3"]]);
  assert.equal(result.versions.desktop, "0.2.3");
});

test("batch rejects unclosed, previously applied, duplicate and mismatched task impact", () => {
  const options = { taskId: "1", impacts: { desktop: "minor", remote: "none" }, baseVersions: { desktop: "0.1.2", remote: null } };
  const make = (overrides) => record("work", { releaseMode: "task-batch", releaseTaskRef: "1", versionApplied: "pending-task", ...overrides }).parsed;
  assert.throws(() => planTaskBatch([make({ status: "in_progress" })], options), { code: "closed_record_required" });
  assert.throws(() => planTaskBatch([make({ versionApplied: "0.2.1" })], options), { code: "already_settled_batch" });
  assert.throws(() => planTaskBatch([make({}), make({})], options), { code: "duplicate_record_identity" });
  assert.throws(() => planTaskBatch([make({})], { ...options, impacts: { desktop: "none", remote: "none" } }), { code: "task_impact_mismatch" });
});

test("docs-only task and work require no product versions", () => {
  const { parsed } = record("work", { versionImpact: "none", versionApplied: "not-required" });
  assert.deepEqual(planStandalone(parsed, { desktop: null, remote: null }).versions, { desktop: null, remote: null });
  assert.deepEqual(planTaskBatch([], { taskId: "1", impacts: { desktop: "none", remote: "none" }, baseVersions: { desktop: null, remote: null } }).taskApplied, { desktop: "not-required", remote: "not-required" });
});

test("identity, future schema, missing evidence and duplicate metadata are blocked", () => {
  const { source } = record();
  for (const changed of [source.replace("schemaVersion: 1", "schemaVersion: 2"), source.replace('    - "fixture passed"', ""), source.replace("versionApplied: pending", "versionApplied: pending\nversionApplied: 1.2.3")]) {
    assert.throws(() => parseWorkBug(changed, "work"));
  }
  assert.throws(() => parseWorkBug(source, "work", "WORK-002"), { code: "identity_mismatch" });
  assert.throws(() => parseWorkBug(source, "incident"), { code: "unsupported_settlement_kind" });
});

test("unknown fields, original body and CRLF survive applied-version updates", () => {
  const { source } = record();
  const original = source.replaceAll("\n", "\r\n");
  assert.equal(updateWorkBugApplied(original, "0.2.3", "not-required"), original.replace("versionApplied: pending", "versionApplied: 0.2.3"));
});
