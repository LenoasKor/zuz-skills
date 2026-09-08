# zuz ITS v3 — unpadded ticket keys

v3 keeps existing Task, Work, Bug, and Incident records in place while making their canonical user-facing keys unpadded.

- `TASK-007` and `TASK-7` resolve to `TASK-7`.
- `WORK-007` and `WORK-7` resolve to `WORK-7`.
- `BUG-007` and `BUG-7` resolve to `BUG-7`.
- `INC-007` and `INC-7` resolve to `INC-7`.
- New non-Task tickets are issued by `decal.task-work-bug/v9` without zero padding.
- Existing padded filenames are not renamed.
- A padded and unpadded physical record with the same kind and number is an ambiguity and must fail closed.

Incident transitions accept either alias and update the one existing physical record. Desktop, Remote, chat references, portable providers, and Jig consumers should display the canonical unpadded key.

