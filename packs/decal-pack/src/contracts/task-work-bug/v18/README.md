# zuz ITS multi-device number authority contract v18

v18 preserves every published v1-v17 byte and adds one thing: several devices can register Task, Work, Bug and
Incident records for the same project without issuing the same number twice.

## Why

The v10/v15 broker issues the global number, the category sequence and the index row from the checkout it runs in.
Its lock (`.decal-slice-completion.lock`, owner pid) only protects one machine. Two devices therefore read the same
"next number", and their registration commits collide on the number and on `docs/tasks/index.md`.

## Model

- One device is the **authority** for a project (an always-on device is the natural choice). It runs the unchanged v15
  broker (v10 when v15 is absent) on its own checkout, so every number still comes from one exact registration commit.
- Every other device is a **client**. It sends the same semantic intent the broker already takes (v7 Task batch,
  v9 ticket). It never picks a number or a path.
- After the authority commits, it returns that commit as a verified `git bundle` holding only the registration
  commit and the ancestors the client lacks. The client fast-forwards (or merges) its default branch, so both devices
  end on the same commit and nothing needs a push to converge.
- One authority process per device serves every project registered with it. A project is identified by its root commit
  ids, which are identical in every clone.
- A device with no client config registers locally, exactly as with v15. Single-device projects change nothing.

## Commands

```sh
# authority device (once)
node contracts/task-work-bug/v18/authority-server.mjs init --host 0.0.0.0 --port 8787   # prints the shared key once
node contracts/task-work-bug/v18/authority-server.mjs add-project --root /path/to/project
node contracts/task-work-bug/v18/authority-server.mjs serve

# client device (once per project, or --device for all projects)
node contracts/task-work-bug/v18/authority-client.mjs init --root . --url http://AUTHORITY:8787 --key <key>

# every registration, on any device
node contracts/task-work-bug/v18/authority-client.mjs register --root . --intent intent.json
node contracts/task-work-bug/v18/authority-client.mjs flush --root .      # deliver anything queued
node contracts/task-work-bug/v18/authority-client.mjs status --root .
```

`register` prints one JSON line. Exit codes: `0` registered and synced, `3` queued (authority unreachable),
`4` registered but this checkout could not take the commit yet (`flush` retries), `2` rejected.

Device config lives outside Git: the authority in `~/.decal/its-authority/daemon.json`, a client in
`<project>/.decal/its-authority.json` or `~/.decal/its-authority/client.json` (`DECAL_ITS_HOME` overrides the
directory). Files are written with mode 0600; keep the key private.

## Guarantees

- **No duplicate numbers.** All registrations are serialized on the authority; the v15 file lock covers any other
  process on that device.
- **Offline is not an error.** An unreachable authority queues the intent in `.decal/its-outbox/` before sending.
  `flush` delivers it later. The same `intentId` is delivered once; a resend returns the original commit. Reusing an
  `intentId` with different content is refused.
- **A blocked client keeps its number.** If the client's checkout cannot take the commit (for example a local edit to
  `docs/tasks/index.md`), the record stays `sync_pending` with its issued number; `flush` completes it after cleanup.
  The client never stashes, resets or overwrites local work, and aborts a conflicting merge.
- **Concurrent agents on one client** serialize their sync with `.decal/its-sync.lock`.

## Security

- Requests carry `x-decal-its-time` and `x-decal-its-sig` = HMAC-SHA256 over method, route, time and the SHA-256 of
  the body with the shared 256-bit key. The key never travels. Requests older than five minutes are refused.
  Responses are signed over time, status and body, and the client rejects an unsigned or altered response.
- The server accepts only the supported intent schemas, never a path or command from the client, limits bodies to
  1 MiB, and refuses a source address after ten failed signatures within five minutes.
- Intents and commits are not secret, but the channel is plain HTTP. Bind to `127.0.0.1` and reach it through a tunnel,
  VPN or trusted LAN; use TLS at the edge when it crosses an untrusted network.
- A client that holds the key can create registration commits on the authority. Treat the key like a repository
  write credential and rotate it by re-running `init` after removing `daemon.json`.

## Keeping the authority running

macOS (`~/Library/LaunchAgents/dev.decal.its-authority.plist`, then `launchctl load`):

```xml
<plist version="1.0"><dict>
  <key>Label</key><string>dev.decal.its-authority</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/node</string>
    <string>/path/to/project/contracts/task-work-bug/v18/authority-server.mjs</string>
    <string>serve</string>
  </array>
  <key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
```

Windows: a Task Scheduler task "At log on" running `node ...\authority-server.mjs serve`.

## Not included

This contract authorizes no push, merge to a remote, deploy, lifecycle completion, version settlement or other
repository. Status transitions, Smoke and release settlement keep their v9/v17 paths. Multi-user (team) operation is
out of scope. Packaging the authority inside the Decal app and the Decal Pack installer is follow-up work.
