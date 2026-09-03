# zuz Skills

`zuz-skills` is the canonical authoring repository for first-party portable skills and the Decal Pack.

It is intentionally separate from the catalog service:

- this repository owns first-party source, portable contracts, versioned pack metadata, and consumer fixtures;
- `skills.zuz.dev` reviews, signs, publishes, and revokes immutable release packages;
- Decal, Primer, and Jig consume a pinned release and never read another product's checkout at runtime;
- third-party skills remain in their upstream repositories and are imported by exact commit through the Skill Store review pipeline.

## Current status

The repository starts as a private canonicalization workspace. Public release is blocked until the first-party license is selected and the release is signed by the Skill Store pipeline.

## Decal Pack

The source lives under [`packs/decal-pack`](packs/decal-pack). The pack contains:

- `portable-core`: status, build, debugging, safe Git, handoff, workspace, and motion guidance;
- `task-work-bug`: optional Task·Work·Bug skills and versioned portable contracts;
- `decal-maintainer`: Decal-repository-only development build helpers.

Installing the pack never initializes Task·Work·Bug records or Jig automatically. An installer selects modules explicitly, previews the exact relative paths, and records the selected release and file digests.

## Commands

```sh
npm test
npm run build:decal-pack -- --source-revision <40-character-git-sha>
```

The build is deterministic for the same source revision and source bytes. Generated artifacts are written to `dist/` and are not committed.

