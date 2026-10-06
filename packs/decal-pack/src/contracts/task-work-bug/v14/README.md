# Preserving registration locks v14

Compatible opt-in successor to the v10 canonical-main registration broker. Task v7 and ticket v9 intent/result/journal formats, registry checks, number assignment, exact commit and replay receipts remain unchanged. Published v1-v13 bytes are immutable. The two versioned writers are derived from v7/v9 with only imports, package identity and lock/cancellation wiring changed.

Run register-task-batch.mjs or register-ticket.mjs with the existing dry-run, approved-digest and write arguments. The v10 main-authority resolver still selects the canonical main worktree. Decal Native sessions cannot use the portable route.

Existing dead-owner, malformed, unsafe or timed-out locks are preserved. Live owners receive bounded exponential waiting up to five minutes. SIGINT/SIGTERM cancels waiting without replay or deletion. Successful acquisition is released only while the original inode and exact owner bytes still match. This is local coordination, not a security boundary against the OS account. Existing ambiguous journals require canonical recovery evidence; never delete a lock to force registration.

This contract does not modify pinned legacy entrypoints or settlement recovery. Installers and adapters must advertise v14 before selecting these entrypoints. User authority and current source checks remain required.
