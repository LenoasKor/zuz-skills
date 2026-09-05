# zuz Skills

`zuz-skills` is the canonical authoring repository for first-party portable skills and the Decal Pack.

It is intentionally separate from the catalog service:

- this repository owns first-party source, portable contracts, versioned pack metadata, and consumer fixtures;
- `skills.zuz.dev` reviews, signs, publishes, and revokes immutable release packages;
- Decal, Primer, and Jig consume a pinned release and never read another product's checkout at runtime;
- third-party skills remain in their upstream repositories and are imported by exact commit through the Skill Store review pipeline.

## Current status

First-party contents are licensed under Apache-2.0. Decal Pack 2.0.1 is the current ZUZ ITS-compatible release with atomic Task·Work·Bug·Incident registration:

- source release: [decal-pack-v2.0.1](https://github.com/LenoasKor/zuz-skills/releases/tag/decal-pack-v2.0.1)
- signed catalog: [skills.zuz.dev](https://skills.zuz.dev/)
- stable Pack identity: `decal-project-pack`

The GitHub release preserves the deterministic source manifest and package bytes. The Skill Store re-verifies those exact bytes, runs the isolated review, and publishes its own signed immutable release manifest.

## Decal Pack

The source lives under [`packs/decal-pack`](packs/decal-pack). The pack contains:

- `portable-core`: status, build, debugging, safe Git, handoff, workspace, and motion guidance;
- `task-work-bug`: optional ZUZ ITS Task·Work·Issue skills, legacy Task·Work·Bug contracts, and additive Incident support;
- `decal-maintainer`: Decal-repository-only development build helpers.

Installing the pack never initializes Task·Work·Bug records or Jig automatically. When a verified project has no Task registry, `contracts/task-work-bug/initialize-task-registry.mjs` provides a separate dry-run/revision-bound initializer that requires explicit repository-scoped user approval. An installer selects modules explicitly, previews the exact relative paths, and records the selected release and file digests.

## Commands

```sh
npm test
npm run build:decal-pack -- --source-revision <40-character-git-sha>
```

The build is deterministic for the same source revision and source bytes. Generated artifacts are written to `dist/` and are not committed. Every declared consumer acceptance ID is bound to a fixture digest in the signed manifest, so Decal, Primer, Jig, and each supported CLI can prove that they tested the same contract.

Prompt-based tools are preserved as shared documentation and are also emitted as Agent Skills in the native Codex, Claude, Gemini, and ACP project paths. This keeps the same Pack usable with or without Decal.

When Decal Native is unavailable, the installed skills continue through their documented portable CLI fallback. Only the missing Native panel or permission helper is unavailable; the Task·Work·Bug workflow itself must not be rejected merely because the current host is Codex, Claude, Gemini, or ACP outside Decal.
