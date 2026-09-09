---
name: zuz-its
description: Understand and use zuz ITS Task, Work, Bug, Incident tickets and chat references in Decal or portable AI sessions.
metadata:
  version: "1.3.0"
  portable: true
---

# zuz ITS

Use the repository's installed zuz Issue Tracking System without replacing its existing Task, Work, or Bug records.

## Repository authority boundary

Treat the Git root containing the invocation context as the active project. Do not read or change another repository merely because it is linked or supplies this Pack. Cross-project access requires explicit current-user approval naming the other root and operation scope. Commit, push, deploy, delete, and settlement remain separate authorities unless the user explicitly includes them.

## External commit approval

For ordinary commits outside Decal, follow the host policy and valid user approval, including an
existing standing or automatic approval covering this repository and task scope. Before committing,
briefly report the repository, branch, exact files, and intended changes. Do not require a new-turn
approval when that authorization remains valid; ask when approval is absent or the scope is unclear
or expanded. Never self-authorize or treat tool availability as user consent. Recheck HEAD, target
contents, staged/conflict state and ongoing Git operations; preserve unrelated changes.
This does not replace Native approval, registration-digest approval, or completion/settlement gates,
and does not authorize push, merge, deploy, deletion, or access to another repository.

## Meaning

- Task / 작업: a formally tracked unit of planned work. Existing numeric IDs stay numeric internally and are displayed without leading zeroes, for example `TASK-7`.
- Work / 소작업: a lightweight but still formally ticketed execution unit. Existing padded records remain compatible, while the canonical display and new IDs use `WORK-7`.
- Issue / 이슈: the common concept for a condition or event requiring attention.
- Bug / 버그: an Issue caused by a product implementation or behavior defect. Existing padded files remain in place, while the canonical display and new IDs use `BUG-7`.
- Incident / 장애: an Issue for actual service interruption or quality degradation, displayed and newly issued as `INC-7` independently from Bugs.

Task Space, session work activity, Office work, Jig planning, and Slice implementation contracts are not zuz ITS Work tickets.

## Choosing a ticket

- Use Task when the work needs independent status, history, priority, relations, release evidence, or multi-session tracking.
- Use Work when it is a smaller execution item or subtask that still benefits from a stable `WORK-###` reference.
- Use Bug for an observed product defect whose intended behavior already exists.
- Use Incident for a real operational outage or service degradation. A Bug may cause an Incident, but neither automatically creates the other.

Preserve the repository's current statuses and lifecycle. Do not invent a Slice object, rewrite IDs, or force a separate Task for every Issue.

## Chat references

When a ticket is relevant, prefer the canonical reference tokens understood by Decal:

- `@task:TASK-<numeric-id>[optional title]`
- `@work:WORK-<numeric-id>[optional title]`
- `@bug:BUG-<numeric-id>[optional title]`
- `@incident:INC-<numeric-id>[optional title]`

Examples: `@task:TASK-12[출시 준비]`, `@work:WORK-3[문구 정리]`, `@bug:BUG-8[로그인 실패]`, `@incident:INC-2[인증 장애]`. Legacy padded references remain readable.

Never guess a missing ticket. Search the canonical repository records first. If Decal Native is unavailable, keep using the installed portable writers and plain-text approval flow; only the unavailable Native panel or helper is omitted.

## Contract routing

- Read current identity and Incident alias rules from `contracts/zuz-its/v3`; v1 and v2 remain immutable compatibility contracts.
- Preserve `contracts/task-work-bug/v1` through `v9` as pinned compatibility dependencies. Use the v10 main-authority broker for Task, Work, Bug, and Incident registration. It delegates the existing v7/v9 transaction to the one existing canonical default-branch worktree without changing the caller's worktree.
- Use v9 lifecycle and settlement runners. They accept legacy padded aliases, preserve physical filenames, and fail closed if padded and unpadded records collide.
- Use the more specific `decal-task`, `decal-work`, `decal-bug`, or `decal-incident` skill when creating or changing a ticket.
