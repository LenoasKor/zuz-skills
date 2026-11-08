---
name: decal-incident
description: Register and manage zuz ITS Incident tickets for real service interruption or quality degradation.
metadata:
  version: "1.8.2"
  portable: true
---

# Decal Incident

Manage a zuz ITS Incident using the repository's installed portable contract.

## Tracking decision first

Read `contracts/its-tracking-policy.md` from the verified project root before proposing a ticket. It is the shared registration decision, not an extra approval step. Exempt operations return to the requested work without issuing a ticket; matching scope continues its existing record. The procedures below apply only when a ticket is needed or the user explicitly requests one. A session, commit, push, or verification step does not itself need a Work.

## Repository authority boundary

Treat the Git root containing the invocation context as the only active project. Access to another repository requires explicit current-user approval naming its root and operation scope. Commit, push, deploy, delete, and settlement are separate authorities unless explicitly included.

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


## Incident boundary

Use Incident only for an actual operational interruption or quality degradation that requires response, resolution, or follow-up. Use Bug for a product implementation defect. Link them when appropriate, but do not automatically create a Bug or Task for every Incident.

Incident is a zuz ITS Issue with its own stable `INC-###` namespace and canonical path:

`docs/work-items/incidents/INC-<number>.md`

## Before changing files

1. Resolve and verify the current Git root and repository identity.
2. Read repository instructions, `contracts/zuz-its/v3` for identity and read compatibility, and the installed `contracts/zuz-its/v5` transition profile when present. Preserve published v1–v3 bytes as immutable compatibility inputs.
3. Preserve existing zuz ITS records and search current Incident records before reserving an ID.
4. Capture the observed impact, affected services, occurrence and detection times, classification tags, response state, and evidence.
5. Preserve unrelated dirty files and reject symlink, path escape, duplicate identity, or stale revision targets.

## Portable writer

Before any external registration, lifecycle or settlement operation, read `contracts/its-guides/decal-incident/portable.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. This pointer grants no authority and never permits a Native bypass.

## Chat reference

Use `@incident:INC-7` or `@incident:INC-7[title]` when referencing the Incident in a Decal conversation. Never guess a missing ID.

## Capability-resolved registration

Before external registration or multi-device pairing, read `contracts/its-guides/decal-incident/registration.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. Use `contracts/task-work-bug/its-register.mjs`; it never falls back to an older contract. This pointer grants no authority and never permits a Native bypass.

## Canonical Incident registration profile

Before external Incident registration or transition, read `contracts/its-guides/decal-incident/incident-profile.md` from the verified project root. Read only for that operation; reuse unchanged guidance already in the active context. Missing guidance blocks that operation, not independent work. This pointer grants no authority and never permits a Native bypass.
