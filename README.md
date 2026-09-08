# zuz Skills

`zuz-skills` is the canonical authoring repository for first-party portable skills and the Decal Pack.

It is intentionally separate from the catalog service:

- this repository owns first-party source, portable contracts, versioned pack metadata, and consumer fixtures;
- `skills.zuz.dev` reviews, signs, publishes, and revokes immutable release packages;
- Decal, Primer, and Jig consume a pinned release and never read another product's checkout at runtime;
- third-party skills remain in their upstream repositories and are imported by exact commit through the Skill Store review pipeline.

## Current status

First-party contents are licensed under Apache-2.0. Decal Pack 2.0.2 remains the published release. The 2.0.3 candidate adds mandatory shared LICENSE/NOTICE files and uses archive schema 2; consumers must support schema 2 before adopting it. No published 2.0.2 bytes are replaced.

- source tag/release: `decal-pack-v2.0.2` (published only after review)
- signed catalog: [skills.zuz.dev](https://skills.zuz.dev/)
- stable Pack identity: `decal-project-pack`

The GitHub release preserves the deterministic source manifest and package bytes. The Skill Store re-verifies those exact bytes, runs the isolated review, and publishes its own signed immutable release manifest.

Portable v7 keeps Task batch registration, while v9 issues new Work·Bug·Incident keys without leading zeroes and resolves padded legacy aliases. Native canonical-branch parity requires Decal 0.406.0 or newer.

## Decal Pack

The source lives under [`packs/decal-pack`](packs/decal-pack). The pack contains:

- `portable-core`: status, build, debugging, safe Git, handoff, workspace, and motion guidance;
- `task-work-bug`: optional zuz ITS Task·Work·Issue skills, legacy Task·Work·Bug contracts, and additive Incident support;
- `decal-maintainer`: Decal-repository-only development build helpers.

Installing the pack never initializes Task·Work·Bug records or Jig automatically. When a verified project has no Task registry, `contracts/task-work-bug/initialize-task-registry.mjs` provides a separate dry-run/revision-bound initializer that requires explicit repository-scoped user approval. The installer selects modules/providers explicitly and returns an `installationPlanDigest` bound to the canonical project root, immutable package/manifest identity, selection, and exact file digests. `--write` requires that digest and recomputes the plan under the installation lock. Existing lock-managed bytes can be updated transactionally; modified files and selection changes block the entire write, while obsolete managed files are reported and preserved.

## Commands

### Existing Task registry summary repair (BUG-162, 2.0.3 candidate)

The initializer now emits all supported non-legacy status rows, so initialization → v7 registration → v4 `planned` to `in_progress` works end to end. Pinned v1–v7 files are unchanged. An old initialized registry may pass validation but lack the target summary row.

After adopting a verified release that includes the repair tool, preview it in the **approved project root**:

```sh
node contracts/task-work-bug/repair-task-registry-summary.mjs --root /absolute/project --dry-run
```

The preview shows the exact before/after index and a root/content-bound revision. It only adds missing **empty** status rows; it never changes Task IDs, documents, statuses, existing summary rows, or user notes. Inconsistent counts, duplicate/unknown rows, missing nonempty statuses and symlinks require review instead of guessed repairs.

Pause all registry writers (including agents and Native lifecycle tools), obtain approval for that preview, then apply using its exact `sourceRevision`:

```sh
node contracts/task-work-bug/repair-task-registry-summary.mjs --root /absolute/project --expected-source-revision sha256:... --writers-paused --write
```

The tool also acquires the shared repository lock and rechecks index, category and Task bytes. Historical v4 writers do not honor that lock, so `--writers-paused` is a real operator precondition, not an automatic pause. The original index inode stays in a private `.decal-summary-*/index.before.md` recovery directory whose path is returned. A concurrent replacement is never overwritten: on `recovery_required`, preserve the returned backup and lock and seek review; do not manually delete the lock or retry a guessed rollback. A crash may likewise require explicit recovery. No automatic Git commit, Pack update, deployment or project migration occurs. Initializer acceptance now covers the full registration/transition sequence and repair conflict boundaries, not only empty-registry validation.

The fix remains an unpublished source candidate. Hub/STANZA and other installed projects have not been repaired by these tests.

Every selected configuration includes `docs/skills/vendor/decal-project-pack/LICENSE` and `NOTICE` in its preview, approval digest, installation receipt and rollback transaction. This does not select `portable-core` or initialize ITS. Modified notice files block installation just like other modified files. Schema 1 archives remain readable with their original behavior; schema 1 consumers reject the new archive instead of silently omitting required files. Task 665 tracks the coordinated consumer/review/publishing work; 2.0.3 is not published yet.

```sh
npm test
npm run build:decal-pack -- --source-revision <40-character-git-sha>
```

The build is deterministic for the same source revision and source bytes. Generated artifacts are written to `dist/` and are not committed. Every declared consumer acceptance ID is bound to a fixture digest in the signed manifest, so Decal, Primer, Jig, and each supported CLI can prove that they tested the same contract.

Prompt-based tools are preserved as shared documentation and are also emitted as Agent Skills in the native Codex, Claude, Gemini, and ACP project paths. This keeps the same Pack usable with or without Decal.

When Decal Native is unavailable, the installed skills continue through their documented portable CLI fallback. Only the missing Native panel or permission helper is unavailable; the Task·Work·Bug workflow itself must not be rejected merely because the current host is Codex, Claude, Gemini, or ACP outside Decal.
