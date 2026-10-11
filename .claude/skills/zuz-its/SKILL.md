---
name: zuz-its
description: Understand and use zuz ITS Task, Work, Bug, Incident tickets and chat references in Decal or portable AI sessions.
metadata:
  version: "1.5.0"
  portable: true
---

# zuz ITS

Use the repository's installed zuz Issue Tracking System without replacing its existing Task, Work, or Bug records.

## Tracking decision first

Read `contracts/its-tracking-policy.md` from the verified project root before proposing a ticket. It is the shared registration decision, not an extra approval step. Exempt operations return to the requested work without issuing a ticket; matching scope continues its existing record. The procedures below apply only when a ticket is needed or the user explicitly requests one. A session, commit, push, or verification step does not itself need a Work.

## Repository authority boundary

Treat the Git root containing the invocation context as the active project. Do not read or change another repository merely because it is linked or supplies this Pack. Cross-project access requires explicit current-user approval naming the other root and operation scope. Commit, push, deploy, delete, and settlement remain separate authorities unless the user explicitly includes them.

## Automatic bookkeeping and mandatory reporting

Within the requested repository and task scope, an explicit user or repository automatic policy
may authorize registration, factual Task updates and ordinary isolated commits without another
approval question. Recheck the source revision, exact write-set and authority; preserve unrelated work.
Dry-run digests bind the same validated input, not an invented user click. Without applicable authority,
obtain it. This does not authorize another repository, registry initialization, installation, changed
scope, lifecycle completion, Smoke facts, version settlement, push, merge or deployment.

Use policy-authorized Native receipts directly. If an older host only offers a pending candidate,
use the common interaction panel and its existing grant; never bypass Native through direct files or
external fallback. Report kind/ID, create/reuse/reopen, checked records and decision reason, changes,
verification, canonical receipt/commit and remaining work after every operation.


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
- Before the active Task, Work, or Bug reaches `development_complete`, treat test failures inside its implementation and verification scope as development feedback. Fix them in the active record and add cause/correction/rerun notes only when useful; do not automatically issue another Bug. Separate tracking begins for post-development-completion regressions, independently scoped defects, or security, data-loss, and live-service conditions that require their own Bug or Incident.

Preserve the repository's current statuses and lifecycle. Do not invent a Slice object, rewrite IDs, or force a separate Task for every Issue.

## Chat references

When a ticket is relevant, prefer the canonical reference tokens understood by Decal:

- `@task:TASK-<numeric-id>[optional title]`
- `@work:WORK-<numeric-id>[optional title]`
- `@bug:BUG-<numeric-id>[optional title]`
- `@incident:INC-<numeric-id>[optional title]`

Examples: `@task:TASK-12[출시 준비]`, `@work:WORK-3[문구 정리]`, `@bug:BUG-8[로그인 실패]`, `@incident:INC-2[인증 장애]`. Legacy padded references remain readable.

Never guess a missing ticket. Search the canonical repository records first. Outside Decal (no `DECAL_SESSION_ID`), use the installed portable writers and plain-text approval flow. In a Decal-owned session, a missing Native capability holds only that action; do not switch to portable writers.

## Contract routing

- Read current identity and Incident alias rules from `contracts/zuz-its/v3`; v1 and v2 remain immutable compatibility contracts.
- Registration uses the installed `contracts/task-work-bug/its-register.mjs` and its advertised, verified capability; do not choose a version or bypass unavailable authority. Published version directories remain compatibility dependencies, not competing current instructions.
- Lifecycle and settlement use the repository's official engine, or the project's explicitly adopted portable execution profile. Read only the relevant operation's guidance. With `config/its-settlement.json` set to `release`, closure leaves applied versions pending until release; a missing mode file preserves per-ticket behavior.
- Use the more specific `decal-task`, `decal-work`, `decal-bug`, or `decal-incident` skill when creating or changing a ticket.

## Same-issue reuse and reopen

Before a new Work/Bug, inspect the current record and same-parent open/closed records. Use Native `issueReview` with checked IDs/revisions, decision (`distinct`, `reuse`, `reopen`) and scope rationale. Identical Work goal/acceptance/release unit or Bug cause/fix/verification scope uses the existing ID. Date or symptom similarity alone is insufficient. Evidence-only additions and repeated execution retain closed status and earlier completion/version history; actual resumed development uses the formal reopen operation; duplicate/cancelled/unfixed records and independently settled task-batch release units are separated. When the project adopts the portable engine and v12 is installed, read `contracts/task-work-bug/v12/README.md` and use its revision-bound `work-item-bookkeeping.mjs`. Repository lifecycle engines stay canonical. Never hand-edit a closed record into a developing status or overwrite historical evidence.
