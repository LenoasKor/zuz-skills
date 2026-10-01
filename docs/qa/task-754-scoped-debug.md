# Task 754 — scoped debug companion candidate

Date: 2026-10-02 (Asia/Seoul)
Canonical record: Decal `docs/tasks/task_754_workflow_041_scoped_rules_and_concise_user_reporting.md`
Approved source root: `/Users/jeremy/JeremyWork/zuz-skills`
Source base: `e7232b2c4c2c2fe382f36a7ae690784432f80d38`

The current user approved source reads, canonical debug/resource changes, relevant tests and builder, an exact source commit, Decal embedded Pack synchronization and Native pristine update of the current Decal installation. Publication, push, other consumers and registry initialization are outside this scope. This QA record references the existing Decal Task; it is not a newly issued source-repository ITS identity. The source repository has no separate Task registry or AGENTS/CLAUDE instructions.

Candidate: Pack 3.4.0 / development-core 1.2.0 / decal-debug 0.3.0. No Decal product SemVer settlement is implied. Unchanged contract v1-v12 bytes and authority boundaries stay pinned.

The main skill retains observed/expected results, reproduction, evidence-driven hypotheses, confirmed cause, minimal fix and comparable before/after verification. Local defects avoid unrelated census work while retaining directly relevant regressions. Repeated execution, lifetime/frequency/fan-out/cost changes, leaks and performance require `REPEATING-WORK.md` before code. The entire previous load gate remains byte-identical: SHA-256 `3b8e0d8420f9bd1c71bfbee4642163fd865ba00e7a4faa4c066dccf25230f685`. All providers receive a same-folder offline resource; Native uses its advertised allowlist. Missing or changed required resources block the affected change without guessed fetching or authority bypass.

## Source verification

- `npm run verify:source`: 31 skills across four opt-in modules accepted.
- `npm test`: 116 passed, zero failed, cancelled or skipped. Includes deterministic builds, unchanged pinned contracts, four-provider offline debug companion installation, digest binding and user-customized resource preservation.
- `git diff --check`: passed.
- The first run was 114 passed / two failed: an old main-template phrase assertion needed to read the preserved companion wording, and an old Pack 3.3.0 version expectation needed the new 3.4.0 candidate. Both expectations were corrected; the full second run above passed. The companion digest and complete original load gate were not changed to satisfy a test.

The exact source commit, committed-revision Pack build and Decal consumer application follow this verified source checkpoint. This is an unpublished candidate. Text and installation fixtures cannot prove every real model answer or Desktop/Remote user Smoke.
