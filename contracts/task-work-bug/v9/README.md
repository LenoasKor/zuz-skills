# zuz ITS portable ticket contract v9

v9 keeps published v1–v8 bytes immutable and changes the current ticket-key rule.

- New Work, Bug, and Incident records use unpadded keys such as `WORK-7`, `BUG-7`, and `INC-7`.
- Existing padded records such as `WORK-007.md` remain valid and are resolved by numeric identity.
- If padded and unpadded files represent the same kind and number, registration, lifecycle, and settlement fail closed with `duplicate_record_identity`.
- Task IDs remain the existing positive decimal identity and are displayed as `TASK-7`.

Task batch registration keeps the v7 writer because Task IDs were already unpadded. Ticket registration uses `v9/register-ticket.mjs`. Work/Bug lifecycle and settlement use the v9 runners so a canonical unpadded request can safely resolve a legacy padded physical file.

Published records are not bulk-renamed. This avoids breaking historic links, receipts, and Git history.

