# Task 691 — portable settlement candidate verification

Date: 2026-09-06
Canonical record: Decal `docs/tasks/task_691_skills_031_portable_pack_lifecycle_settlement_consumer_rollout.md`
Implementation workspace: `/private/tmp/zuz-skills-task-691`
Branch: `codex/task-691-portable-settlement`
Upstream base: `56eaf9562f6f83d26f7ac5f114e90b2e3e1610ee`

## State

Implementation candidate, not published or installed in real consumer projects.
The new Pack source version is 2.1.0; published Pack 2.0.3 and existing pinned
v1–v7 files remain unchanged. No new product SemVer settlement, push, merge,
signing, Store release or Desktop application replacement has been performed.

The Decal main progress/index checkpoint is `700d495b15bb6f4132a5b0f9f29e82df6d27a445`.
It contains exactly the Task 691 document and Task index. Both were clean after
the commit; further implementation and this QA record remain in this isolated
upstream worktree, not in the shared index.

## Verified

- `npm test`: 88 tests passed, 0 failed. Includes existing registration,
  installer and source tests plus the portable settlement suite.
- `npm run verify:source`: 31 skills / 3 opt-in modules accepted.
- `node packs/decal-pack/src/contracts/task-work-bug/v8/verify-contract.mjs`:
  12 files and the pinned default-branch dependency accepted.
- `git diff --check`: passed.
- No diff under the published `contracts/task-work-bug/v1` through `v7`.

The first full run had one old expected skill-version assertion (1.8.0 vs the
new 1.9.0). Expectations were updated for the actual new skill versions; the
final full run above passed. An earlier focused run copied a fixture during a
manifest/source update and was correctly rejected for digest mismatch. The
final full run used an unchanged source set throughout.

### Runtime and installation evidence

- Copied and packaged entrypoints execute in disposable Git projects with
  `DECAL_SESSION_ID` absent. No Decal process or network is needed.
- Task registration → start → development → completion works on main/master.
  Batch settlement uses one exact commit, Task minor followed by numeric Work
  IDs and then Bug IDs. No-version work does not read unrelated product files.
- Work/Bug normal forward lifecycle retains completion evidence and typed
  closure reasons. Standalone settlement is idempotent. Blocked/reopen metadata
  is not guessed by the normal-forward Work/Bug command.
- Profile, HEAD, source digest, exact write-set, dirty/staged boundaries,
  symlink/hardlink rejection, runtime integrity, and Native host refusal tested.
- Concurrent registration and lifecycle share the lock; either serialization or
  a stale-plan rejection preserves all records. An unrelated category edit
  remains dirty and is excluded from the lifecycle commit.
- A real child-process exit after the first replacement leaves a journal and
  dead-owner lock. Resume and rollback preserve unrelated edits. Unknown bytes,
  forged approval, foreign pending state and live-owner locks are not discarded.
- A generated Pack installs identical skill source into Codex, Claude, Gemini
  and ACP paths. No release profile or Task registry is silently initialized.
- A Showcase-shaped disposable project uses five product version files:
  package.json, both package-lock root pointers, Tauri JSON, Cargo.toml and the
  named local Cargo.lock package. One settlement updates all to 0.1.3 while
  preserving dependency versions; repeating it does not bump again.

These are CLI/installation fixtures, not proof of live conversations with every
provider or a completed Showcase user ticket. Completion verification records
bind a caller's actual test attestation to HEAD/tree; they do not independently
authenticate a CI service or execute the claimed tests.

## Remaining work

1. Review/checkpoint the owned upstream implementation and finalize acceptance
   metadata/routing before an immutable release.
2. Keep Task 686 reader/locator supply changes separately owned under Task 686;
   coordinate only the new Pack release and rollout. Its five-file handoff was
   verified, but none of those runtime files is included in this candidate yet.
3. Sign/publish a new archive and Store release, update Decal's verified bundled
   consumer, and test actual Host/Remote contract use without opening new Remote
   installation or Git authority.
4. Inventory actual installed project receipts, preview every approved profile
   and update, preserve modified/unknown files, and delegate Primer-managed
   projects to skill_sync. Do not close real user tickets as a test.
5. Report actual consumer adoption separately from source publication and settle
   Task 691 only after its remaining delivery/verification criteria are met.

## Delivery review checkpoint

- Implementation checkpoint: `7f70ae823898269954259e0e171729d87d156c74`.
- The first 2.1.0 archive contained 31 skills / 182 files. It was a local
  candidate only and is superseded by the safety changes below, not published.
- Recovery journals are now size-checked during preview and again before write,
  including both file versions, UTF-8 and JSON escaping. An oversized plan cannot
  leave a journal the recovery reader itself would refuse. Finalization also
  validates the bound root and recomputed intent digest before removing evidence.
- Focused transaction/recovery: 13 passed; full frozen-source run: 88 passed.
  A 5 MiB escaped fixture exceeds the aggregate journal limit and preserves
  HEAD, target bytes and absence of locks/pending markers. Forged root/message/
  read-set journals remain in place and cannot finalize an otherwise exact commit.
- Task 686 has no approved alternative stage source for projects without a
  Decal registry. Do not invent that build/deploy product policy in Task 691 or
  make the standalone settlement runner depend on its reader. Reader source
  supply remains a separately owned Task 686 change pending that scope review.
