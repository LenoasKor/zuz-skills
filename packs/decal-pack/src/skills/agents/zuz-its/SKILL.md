---
name: zuz-its
description: Understand and use ZUZ ITS Task, Work, Bug, Incident tickets and chat references in Decal or portable AI sessions.
metadata:
  version: "1.0.0"
  portable: true
---

# ZUZ ITS

Use the repository's installed ZUZ Issue Tracking System without replacing its existing Task, Work, or Bug records.

## Repository authority boundary

Treat the Git root containing the invocation context as the active project. Do not read or change another repository merely because it is linked or supplies this Pack. Cross-project access requires explicit current-user approval naming the other root and operation scope. Commit, push, deploy, delete, and settlement remain separate authorities unless the user explicitly includes them.

## Meaning

- Task / 작업: a formally tracked unit of planned work. Existing numeric IDs stay numeric internally and are displayed as `TASK-###`.
- Work / 소작업: a lightweight but still formally ticketed execution unit. Existing `WORK-###` IDs, lifecycle, relations, and settlement remain intact.
- Issue / 이슈: the common concept for a condition or event requiring attention.
- Bug / 버그: an Issue caused by a product implementation or behavior defect. Existing `BUG-###` files and IDs remain intact.
- Incident / 장애: an Issue for actual service interruption or quality degradation, stored as `INC-###` independently from Bugs.

Task Space, session work activity, Office work, Jig planning, and Slice implementation contracts are not ZUZ ITS Work tickets.

## Choosing a ticket

- Use Task when the work needs independent status, history, priority, relations, release evidence, or multi-session tracking.
- Use Work when it is a smaller execution item or subtask that still benefits from a stable `WORK-###` reference.
- Use Bug for an observed product defect whose intended behavior already exists.
- Use Incident for a real operational outage or service degradation. A Bug may cause an Incident, but neither automatically creates the other.

Preserve the repository's current statuses and lifecycle. Do not invent a Slice object, rewrite IDs, or force a separate Task for every Issue.

## Chat references

When a ticket is relevant, prefer the canonical reference tokens understood by Decal:

- `@task:<numeric-id>[optional title]`
- `@work:WORK-###[optional title]`
- `@bug:BUG-###[optional title]`
- `@incident:INC-###[optional title]`

Examples: `@task:12[출시 준비]`, `@work:WORK-003[문구 정리]`, `@bug:BUG-008[로그인 실패]`, `@incident:INC-002[인증 장애]`.

Never guess a missing ticket. Search the canonical repository records first. If Decal Native is unavailable, keep using the installed portable writers and plain-text approval flow; only the unavailable Native panel or helper is omitted.

## Contract routing

- Read compatibility projection rules from `contracts/zuz-its/v1`.
- Read Incident creation and lifecycle rules from `contracts/zuz-its/v2`.
- Continue to use `contracts/task-work-bug/v1` through `v6` for existing Task, Work, and Bug storage and writers.
- Use the more specific `decal-task`, `decal-work`, `decal-bug`, or `decal-incident` skill when creating or changing a ticket.
