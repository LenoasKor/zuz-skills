# zuz ITS zero-setup LAN authority contract v19

v19 preserves every published v1-v18 byte. It removes the manual setup of v18: on the same local network a second
device finds the number authority by itself, is approved with one click on the main device, and registers records
through an encrypted channel. Nothing is typed: no address, no key, no command.

## Flow

1. **Discovery.** The client broadcasts "who is the authority for project P?" (UDP, directed broadcast of every
   active IPv4 interface; limited broadcast and multicast are blocked on many networks). Only an authority that serves
   P answers, with its LAN port. The project id is derived from the root commit ids and is not secret.
2. **Request.** The new device sends an X25519 public key **commitment** first, receives the authority's public key,
   then reveals its own key. A man in the middle cannot grind keys until the check codes match.
3. **Approval.** Both devices derive the same six-digit check code from the shared secret and the full transcript.
   The main device shows "device X wants to connect · code 123 456"; the user confirms the new device shows the same
   code and approves once. An unanswered request expires after 120 seconds; at most five requests wait at once and one
   address may ask every ten seconds.
4. **Key.** Approval stores a fresh 256-bit key for that device. The client verifies an approval tag derived from the
   key before storing it. A single device can be revoked.
5. **Registration.** Requests and responses are sealed with AES-256-GCM. Method, route, device id and time (and, for
   responses, time and status) are authenticated data, so a sealed message cannot be replayed on another route or after
   five minutes. The authority runs the unchanged v15 broker; the client receives the registration commit as a verified
   git bundle exactly as in v18, and shares the v18 offline outbox (`.decal/its-outbox`).
6. **Moving authority.** When the authority restarts on another address or port the client discovers it again and
   retries once. Only the holder of the device key can produce a response the client accepts.

A project with no pairing registers locally and opens no port, exactly like v15.

## Commands

The app drives these; they are also the portable fallback.

```sh
# main device (the app does this at start-up)
node contracts/task-work-bug/v19/lan-authority.mjs init --label "Jeremy's Mac"
node contracts/task-work-bug/v19/lan-authority.mjs add-project --root /path/to/project
node contracts/task-work-bug/v19/lan-authority.mjs serve
node contracts/task-work-bug/v19/lan-authority.mjs pending            # requests with their check codes
node contracts/task-work-bug/v19/lan-authority.mjs approve <requestId>
node contracts/task-work-bug/v19/lan-authority.mjs deny <requestId>
node contracts/task-work-bug/v19/lan-authority.mjs devices
node contracts/task-work-bug/v19/lan-authority.mjs revoke <deviceId>

# second device
node contracts/task-work-bug/v19/lan-client.mjs pair --root . --label "Windows PC"   # prints {"status":"pending","sas":"123 456"}
node contracts/task-work-bug/v19/lan-client.mjs register --root . --intent intent.json
node contracts/task-work-bug/v19/lan-client.mjs flush --root .
node contracts/task-work-bug/v19/lan-client.mjs status --root .
```

Exit codes of `register`: `0` registered and synced, `3` queued, `4` registered but not yet synced, `2` rejected.

State lives outside Git: the authority in `~/.decal/its-authority/lan-authority.json` and `lan-admin.json`
(`DECAL_ITS_HOME` overrides), the client in `<project>/.decal/its-lan-client.json`, all mode 0600. The loopback admin
port is only reachable from the same machine and needs the bearer token in `lan-admin.json`.

## AI sessions outside Decal

An external AI session (Codex, Claude Code, Gemini CLI, ...) needs no new commands. It keeps calling the repository
adapter `scripts/register_its_context.mjs` (`--dry-run`, then `--approved-digest ... --write`). When the project has a
pairing (`.decal/its-lan-client.json`) the adapter sends the write to the authority with the same approved digest, so
the digest the user saw is the only one that can be written; a different digest writes nothing. Task, Work, Bug and
Incident are all supported (Incident uses the v16 broker on the authority). The receipt is the broker's own receipt plus
`delegatedTo: "its-authority"`. Without a pairing the adapter behaves exactly as before.

Pairing and approval are the only steps an AI performs on the user's behalf, and the user decides them:

- Second device: the AI runs `lan-client.mjs pair`, and shows the user the check code it prints.
- Main device: the AI runs `lan-authority.mjs pending`, shows the user the same request and code, and runs `approve`
  only after the user confirms both codes match.
- `lan-authority.mjs service install` makes the authority start at log-in (LaunchAgent or scheduled task); `service plan`
  only prints what it would do.

## Security notes

- The channel is local-network only. Relay, tunnel and other-network access are out of scope (v2.0.0 team Decal).
- Pairing is authenticated by the user comparing the check code, not by a pre-shared secret. Approve only when both
  screens show the same code and you started the pairing.
- The public pairing endpoints carry no secret. Failed sealed requests are throttled per source address.
- Keys are written to files with mode 0600 in this contract. The Decal app moves them to the OS secure store.
- `lan-authority.mjs` binds the LAN API to `0.0.0.0`; a host firewall prompt on first start is expected and should
  allow private networks only.

## Not included

No push, merge to a remote, deploy, lifecycle completion, version settlement, other repository, or connection outside
the local network. Embedding the authority in the Decal app (sidecar lifecycle, approval card, Language Pack) is the
next step of Task 787.
