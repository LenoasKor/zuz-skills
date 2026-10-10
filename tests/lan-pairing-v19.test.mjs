// Real-process acceptance for the v19 zero-setup ITS authority (Task 787).
// Device A hosts the authority, device B is a second checkout that must find, pair with and use it without any typed setup.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import { cp, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { projectIdOf } from "../packs/decal-pack/src/contracts/task-work-bug/v18/authority-common.mjs";
import { approvalTag, commitment, deriveSession, newKeyPair, open, requestAad, seal } from "../packs/decal-pack/src/contracts/task-work-bug/v19/lan-crypto.mjs";
import { broadcastTargets } from "../packs/decal-pack/src/contracts/task-work-bug/v19/lan-discovery.mjs";

const exec = promisify(execFile);
const source = fileURLToPath(new URL("../", import.meta.url));
const contracts = path.join(source, "packs/decal-pack/src/contracts");
const base = await realpath(await mkdtemp(path.join(tmpdir(), "its-lan-")));
const discoveryPort = String(43000 + Math.floor(Math.random() * 900));
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test",
  DECAL_ITS_DISCOVERY_PORT: discoveryPort,
};
if (broadcastTargets().length === 0) env.DECAL_ITS_DISCOVERY_TARGETS = "127.0.0.1";
delete env.DECAL_SESSION_ID;
Object.assign(process.env, env);

const v19 = (name) => path.join(contracts, "task-work-bug/v19", name);
const authorityScript = v19("lan-authority.mjs");
const clientScript = v19("lan-client.mjs");
const validator = path.join(contracts, "task-work-bug/v4/validate-task-index.mjs");

async function run(file, args, options = {}) {
  try {
    const { stdout } = await exec(file, args, { cwd: options.cwd, env: { ...env, ...options.env }, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, out: stdout.trim() };
  } catch (error) {
    return { code: error.code, out: String(error.stdout ?? "").trim(), err: String(error.stderr ?? "") };
  }
}
const git = async (cwd, ...args) => { const r = await run("git", args, { cwd }); assert.equal(r.code, 0, `git ${args.join(" ")}: ${r.err}`); return r.out; };
const lastJson = (r) => JSON.parse(r.out.split("\n").at(-1));
const node = (script, args, options) => run(process.execPath, [script, ...args], options);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function intentFor(id, slug) {
  return {
    schema: "decal.task-work-bug.task-registration-batch-intent/v7", intentId: id, commitMessage: `docs(tasks): register ${id}`,
    tasks: [{ localRef: "item", category: "product", slug, title: `LAN fixture ${id}`, priority: "P1", areas: ["ITS"], summary: "무설정 연결 시험", versionImpact: "none", remoteVersionImpact: "none", body: "## Context Budget\n\n- 시험\n\n## 완료 기준\n\n- [ ] 번호가 겹치지 않는다\n" }],
  };
}
async function writeIntent(dir, id, slug) { const file = path.join(dir, `${id}.json`); await writeFile(file, JSON.stringify(intentFor(id, slug))); return file; }

async function makeProject(name) {
  const dir = path.join(base, name);
  const seed = path.join(dir, "seed");
  const origin = path.join(dir, "origin.git");
  await git(base, "init", "-q", "--bare", "-b", "main", origin);
  await git(base, "init", "-q", "-b", "main", seed);
  await cp(contracts, path.join(seed, "contracts"), { recursive: true });
  await cp(path.join(contracts, "task-work-bug/v4/fixtures/project/docs"), path.join(seed, "docs"), { recursive: true });
  await writeFile(path.join(seed, ".gitignore"), ".decal/\n.decal-slice-completion.lock\n");
  await git(seed, "add", ".");
  await git(seed, "commit", "-q", "-m", `seed ${name}`);
  await git(seed, "remote", "add", "origin", origin);
  await git(seed, "push", "-q", "origin", "main");
  const a = path.join(dir, "deviceA");
  const b = path.join(dir, "deviceB");
  await git(base, "clone", "-q", origin, a);
  await git(base, "clone", "-q", origin, b);
  return { dir, a, b };
}

async function assertSound(root, expectedCount) {
  assert.equal(JSON.parse((await node(validator, ["--root", root], { cwd: root })).out).status, "accepted", `registry invalid in ${root}`);
  const names = (await readdir(path.join(root, "docs/tasks"))).filter((name) => /^task_\d+_/u.test(name));
  const ids = names.map((name) => Number(/^task_(\d+)_/u.exec(name)[1])).sort((x, y) => x - y);
  assert.equal(ids.length, expectedCount, `task count in ${root}`);
  assert.deepEqual(ids, ids.map((_, i) => i + 1), "numbers unique and contiguous");
  const indexes = [];
  for (const name of names) { const text = await readFile(path.join(root, "docs/tasks", name), "utf8"); if (/^Task Category: product$/mu.test(text)) indexes.push(Number(/^Category Index: (\d+)$/mu.exec(text)[1])); }
  indexes.sort((x, y) => x - y);
  assert.deepEqual(indexes, indexes.map((_, i) => i + 1), "category sequence unique and contiguous");
}

const children = [];
async function startAuthority(home, extraEnv = {}) {
  const child = spawn(process.execPath, [authorityScript, "serve"], { env: { ...env, DECAL_ITS_HOME: home, ...extraEnv }, stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  const info = await new Promise((resolve, reject) => {
    child.stdout.once("data", (data) => resolve(JSON.parse(String(data))));
    child.once("exit", (code) => reject(new Error(`authority exited ${code}`)));
  });
  return { child, ...info };
}
const stop = (child) => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once("exit", resolve); child.kill("SIGTERM"); });
const admin = (home, ...args) => node(authorityScript, args, { env: { DECAL_ITS_HOME: home } }).then(lastJson);

/** Starts `pair` and returns what it printed so far plus a promise for the final line. */
function startPair(cwd, label) {
  const lines = [];
  const child = spawn(process.execPath, [clientScript, "pair", "--root", cwd, "--label", label, "--timeout", "30"], { cwd, env, stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  let buffer = "";
  child.stdout.on("data", (data) => { buffer += data; const parts = buffer.split("\n"); buffer = parts.pop(); lines.push(...parts.filter(Boolean).map((line) => JSON.parse(line))); });
  const done = new Promise((resolve) => child.once("exit", (code) => resolve({ code, lines })));
  return { lines, done };
}
async function waitFor(check, what, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) assert.fail(`timeout waiting for ${what}`); await sleep(100); }
}

try {
  assert.equal(JSON.parse((await run(process.execPath, [v19("verify-contract.mjs")])).out).status, "accepted", "v19 manifest verifies");
  const p = await makeProject("lan");
  const other = await makeProject("other");
  const home = path.join(p.dir, "home-a");
  assert.equal(lastJson(await node(authorityScript, ["init", "--label", "main-mac"], { env: { DECAL_ITS_HOME: home } })).status, "initialized");
  assert.equal(lastJson(await node(authorityScript, ["add-project", "--root", p.a], { env: { DECAL_ITS_HOME: home } })).status, "added");

  let authority = await startAuthority(home);

  // 1. Discovery needs nothing typed, and answers only for the project it serves.
  {
    const found = lastJson(await node(clientScript, ["discover", "--root", p.b], { cwd: p.b }));
    assert.equal(found.authorities.length, 1, JSON.stringify(found));
    assert.equal(found.authorities[0].label, "main-mac");
    assert.equal(found.authorities[0].port, authority.lanPort);
    assert.deepEqual(lastJson(await node(clientScript, ["discover", "--root", other.b], { cwd: other.b })).authorities, [], "unserved project gets no answer");
    console.log("ok 1  discovery: the second device finds the authority by itself; other projects get no answer");
  }

  // 2. Abuse limits and the commit-reveal check on the public pairing endpoints.
  {
    const projectId = await projectIdOf(p.a);
    const post = async (route, payload) => { const r = await fetch(`http://127.0.0.1:${authority.lanPort}${route}`, { method: "POST", body: JSON.stringify(payload) }); return { status: r.status, body: await r.json() }; };
    const keys = newKeyPair();
    const nonce = crypto.randomBytes(16);
    const first = await post("/v1/pair/request", { projectId, label: "probe", commit: commitment(keys.publicRaw, nonce) });
    assert.equal(first.status, 200);
    assert.equal((await post("/v1/pair/request", { projectId, label: "flood", commit: commitment(keys.publicRaw, nonce) })).status, 429, "a second request from the same address is throttled");
    const swapped = newKeyPair();
    const cheat = await post("/v1/pair/reveal", { requestId: first.body.requestId, clientPublic: swapped.publicRaw.toString("base64"), nonce: nonce.toString("base64") });
    assert.equal(cheat.body.code, "commitment_mismatch", "revealing a different key than the committed one is refused");
    assert.equal((await post("/v1/pair/request", { projectId: "0".repeat(32), label: "x", commit: "0".repeat(64) })).status, 404);
    // A man in the middle that substitutes both public keys ends up with different check codes on the two screens.
    const real = { client: newKeyPair(), server: newKeyPair() };
    const attacker = { towardClient: newKeyPair(), towardServer: newKeyPair() };
    const shown = deriveSession({ privateKey: real.client.privateKey, peerPublicRaw: attacker.towardClient.publicRaw, requestId: "r", clientPublicRaw: real.client.publicRaw, serverPublicRaw: attacker.towardClient.publicRaw });
    const seen = deriveSession({ privateKey: real.server.privateKey, peerPublicRaw: attacker.towardServer.publicRaw, requestId: "r", clientPublicRaw: attacker.towardServer.publicRaw, serverPublicRaw: real.server.publicRaw });
    assert.notEqual(shown.sas, seen.sas, "substituted keys give different check codes");
    assert.notEqual(shown.keyHex, seen.keyHex);
    console.log("ok 2  pairing endpoints throttle floods, enforce commit-reveal, and a key-swapping middleman is exposed by the check codes");
  }

  // Restart without the throttle for the functional flows; the authority gets a new port on purpose.
  await stop(authority.child);
  authority = await startAuthority(home, { DECAL_ITS_PAIR_MIN_INTERVAL_MS: "0" });

  // 3. Denial leaves nothing behind.
  {
    const pairing = startPair(p.b, "windows-pc");
    const pendingLine = await waitFor(() => pairing.lines.find((line) => line.status === "pending"), "pending line");
    assert.match(pendingLine.sas, /^\d{3} \d{3}$/u);
    const listed = (await waitFor(async () => { const r = await admin(home, "pending"); return r.pending?.length ? r : null; }, "pending request")).pending;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].sas, pendingLine.sas, "both screens show the same check code");
    assert.equal(listed[0].label, "windows-pc");
    await admin(home, "deny", listed[0].requestId);
    const result = await pairing.done;
    assert.equal(result.lines.at(-1).status, "denied");
    await assert.rejects(stat(path.join(p.b, ".decal/its-lan-client.json")), "no credential is stored on denial");
    assert.equal((await admin(home, "devices")).devices.length, 0);
    console.log("ok 3  a denied request stores no credential on either side");
  }

  // 4. One approval click, no typed input.
  {
    const pairing = startPair(p.b, "windows-pc");
    const pendingLine = await waitFor(() => pairing.lines.find((line) => line.status === "pending"), "pending line");
    const listed = (await waitFor(async () => { const r = await admin(home, "pending"); return r.pending?.length ? r : null; }, "pending request")).pending;
    assert.equal(listed[0].sas, pendingLine.sas);
    assert.equal((await admin(home, "approve", listed[0].requestId)).status, "approved");
    assert.equal((await pairing.done).lines.at(-1).status, "paired");
    const config = JSON.parse(await readFile(path.join(p.b, ".decal/its-lan-client.json"), "utf8"));
    assert.match(config.keyHex, /^[a-f0-9]{64}$/u);
    assert.equal((await stat(path.join(p.b, ".decal/its-lan-client.json"))).mode & 0o077, 0, "credential file is private");
    const devices = (await admin(home, "devices")).devices;
    assert.equal(devices.length, 1);
    assert.equal(devices[0].keyHex, undefined, "the admin view never exposes keys");
    console.log("ok 4  approval: the device is paired with a private per-device key and nothing was typed");
  }

  // 5. Concurrent registration through the sealed transport.
  {
    const jobs = [];
    for (let i = 0; i < 4; i += 1) {
      jobs.push(writeIntent(p.b, `lan-remote-${i}`, `lan_remote_${i}`).then((f) => node(clientScript, ["register", "--root", p.b, "--intent", f], { cwd: p.b })));
      jobs.push(writeIntent(p.a, `lan-local-${i}`, `lan_local_${i}`).then((f) => node(clientScript, ["register", "--root", p.a, "--intent", f], { cwd: p.a })));
    }
    const results = (await Promise.all(jobs)).map(lastJson);
    for (const result of results) assert.equal(result.status, "registered", JSON.stringify(result));
    await assertSound(p.a, 1 + 8);
    const f = await writeIntent(p.b, "lan-last", "lan_last");
    assert.equal(lastJson(await node(clientScript, ["register", "--root", p.b, "--intent", f], { cwd: p.b })).status, "registered");
    assert.equal(await git(p.b, "rev-parse", "HEAD"), await git(p.a, "rev-parse", "HEAD"), "device B converges on A's HEAD");
    await assertSound(p.b, 1 + 9);
    console.log("ok 5  eight concurrent registrations over the sealed transport: unique numbers, B converges on A");
  }

  // 6. The authority moves (new port after restart): the client finds it again without help.
  {
    const oldPort = authority.lanPort;
    await stop(authority.child);
    authority = await startAuthority(home, { DECAL_ITS_PAIR_MIN_INTERVAL_MS: "0" });
    assert.notEqual(authority.lanPort, oldPort, "the restart picked a new port");
    const f = await writeIntent(p.b, "lan-moved", "lan_moved");
    assert.equal(lastJson(await node(clientScript, ["register", "--root", p.b, "--intent", f], { cwd: p.b })).status, "registered");
    assert.equal(JSON.parse(await readFile(path.join(p.b, ".decal/its-lan-client.json"), "utf8")).port, authority.lanPort, "client updated its stored address");
    await assertSound(p.b, 1 + 10);
    console.log("ok 6  authority restarted on a new port: the client re-discovered it and registered");
  }

  // 7. Authority off: the request waits and is delivered once.
  {
    await stop(authority.child);
    const f = await writeIntent(p.b, "lan-offline", "lan_offline");
    const queued = await node(clientScript, ["register", "--root", p.b, "--intent", f], { cwd: p.b });
    assert.equal(queued.code, 3);
    assert.equal(lastJson(queued).status, "queued");
    authority = await startAuthority(home, { DECAL_ITS_PAIR_MIN_INTERVAL_MS: "0" });
    const flushed = lastJson(await node(clientScript, ["flush", "--root", p.b], { cwd: p.b }));
    assert.equal(flushed.status, "flushed");
    assert.equal(lastJson(await node(clientScript, ["flush", "--root", p.b], { cwd: p.b })).results.length, 0);
    await assertSound(p.b, 1 + 11);
    await assertSound(p.a, 1 + 11);
    console.log("ok 7  main device off: request queued, delivered exactly once when it came back");
  }

  // 7b. An AI session outside Decal keeps calling the same adapter; a paired project is routed to the authority.
  {
    const context = "## 사용자 요약\n\n```zuz-its-context\n" + JSON.stringify({ schemaVersion: 1, reason: "시험", goal: "시험", completion: "시험", nextAction: "시험" }) + "\n```\n";
    const adapter = (root, kind, file, ...rest) => node(path.join(root, "contracts/task-work-bug/its-register.mjs"), ["--kind", kind, "--root", root, "--intent", file, ...rest], { cwd: root });
    const taskIntent = intentFor("adapter-task", "adapter_task");
    taskIntent.tasks[0].body = `## Context Budget\n\n- 시험\n\n${context}`;
    const taskFile = path.join(p.b, "adapter-task.json");
    await writeFile(taskFile, JSON.stringify(taskIntent));
    const preview = lastJson(await adapter(p.b, "task", taskFile, "--dry-run"));
    assert.equal(preview.status, "planned");
    const wrong = lastJson(await adapter(p.b, "task", taskFile, "--approved-digest", `sha256:${"0".repeat(64)}`, "--write"));
    assert.equal(wrong.code, "approval_digest_mismatch", "a digest the user did not see writes nothing");
    await assertSound(p.a, 1 + 11);
    const written = lastJson(await adapter(p.b, "task", taskFile, "--approved-digest", preview.intentDigest, "--write"));
    assert.equal(written.delegatedTo, "its-authority", JSON.stringify(written).slice(0, 700));
    assert.equal(written.status, "committed");
    assert.equal(written.assigned[0].taskId, 13);
    const ticket = (kind, extra = {}) => ({
      schema: "decal.zuz-its.ticket-registration-intent/v9", intentId: `adapter-${kind}`, kind, title: `Adapter ${kind}`, priority: "P1", taskRefs: ["1"],
      versionImpact: "none", remoteVersionImpact: "none", releaseMode: "standalone", body: context, ...extra,
    });
    const incident = { impact: "major", affectedServices: ["fixture"], classifications: ["security"], occurredAt: "2026-10-06T01:00:00Z", detectedAt: "2026-10-06T01:00:00.5001Z", mitigatedAt: null, recoveredAt: null, resolutionEvidence: [] };
    const ids = [];
    for (const [kind, extra] of [["work"], ["bug"], ["incident", { incident }]]) {
      const file = path.join(p.b, `adapter-${kind}.json`);
      await writeFile(file, JSON.stringify(ticket(kind, extra)));
      const plan = lastJson(await adapter(p.b, "ticket", file, "--dry-run"));
      assert.equal(plan.status, "planned", `${kind}: ${JSON.stringify(plan)}`);
      const done = lastJson(await adapter(p.b, "ticket", file, "--approved-digest", plan.intentDigest, "--write"));
      assert.equal(done.delegatedTo, "its-authority", `${kind}: ${JSON.stringify(done)}`);
      ids.push(done.assigned.id);
    }
    assert.equal(new Set(ids).size, 3, `three distinct ticket ids ${ids}`);
    for (const root of [p.a, p.b]) {
      for (const [folder, prefix] of [["work", "WORK"], ["bugs", "BUG"], ["incidents", "INC"]]) {
        const files = (await readdir(path.join(root, "docs/work-items", folder))).filter((name) => name.startsWith(prefix));
        assert.equal(files.length, 1, `${prefix} record present on ${root}`);
      }
    }
    assert.equal(await git(p.b, "rev-parse", "HEAD"), await git(p.a, "rev-parse", "HEAD"), "device B holds the same commits as A");
    await assertSound(p.b, 1 + 12);
    console.log("ok 7b an outside AI session using the stable entry is routed to the authority for Task, Work, Bug and Incident; a wrong approval digest writes nothing");
  }

  // 7c. Keeping the authority running at log-in is described, not done, by the plan command.
  {
    const plan = lastJson(await node(authorityScript, ["service", "plan"], { env: { DECAL_ITS_HOME: home } }));
    assert.equal(plan.status, "plan");
    assert.ok(plan.install.length > 0, "this OS has a log-in item mechanism");
    if (plan.platform === "macos") {
      const file = path.join(base, "plan.plist");
      await writeFile(file, plan.content);
      assert.equal((await run("plutil", ["-lint", file])).code, 0, "the LaunchAgent is a valid property list");
      assert.match(plan.content, /<key>KeepAlive<\/key><true\/>/u);
    } else {
      assert.match(plan.install[0].join(" "), /DecalItsAuthority/u);
    }
    console.log("ok 7c the log-in service is planned (not installed) with a valid definition");
  }

  // 8. Attacks on the sealed channel.
  {
    const config = JSON.parse(await readFile(path.join(p.b, ".decal/its-lan-client.json"), "utf8"));
    const projectId = await projectIdOf(p.a);
    const url = (route) => `http://127.0.0.1:${authority.lanPort}${route}`;
    const envelope = (route, { deviceId = config.deviceId, key = config.keyHex, time = String(Date.now()), aadRoute = route } = {}) =>
      ({ d: deviceId, t: time, ...seal(key, requestAad("POST", aadRoute, deviceId, time), JSON.stringify({ projectId })) });
    const send = async (route, body) => (await fetch(url(route), { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) })).status;
    assert.equal(await send("/v1/health", envelope("/v1/health")), 200, "a correct sealed request works");
    assert.equal(await send("/v1/health", envelope("/v1/health", { key: "00".repeat(32) })), 401, "wrong key");
    assert.equal(await send("/v1/health", envelope("/v1/health", { deviceId: "deadbeefdeadbeef" })), 401, "unknown device");
    assert.equal(await send("/v1/health", envelope("/v1/health", { time: String(Date.now() - 3600000) })), 401, "stale request");
    assert.equal(await send("/v1/sync", envelope("/v1/sync", { aadRoute: "/v1/health" })), 401, "a sealed request cannot be replayed on another route");
    const tampered = envelope("/v1/health");
    tampered.c = Buffer.from(tampered.c, "base64").map((byte, i) => (i === 3 ? byte ^ 1 : byte)).toString("base64");
    assert.equal(await send("/v1/health", tampered), 401, "tampered ciphertext");
    assert.equal(await send("/v1/register", { projectId, intent: {} }), 401, "plaintext registration refused");
    assert.equal(await send("/v1/register", "x".repeat(1024 * 1024 + 10)), 413, "oversized body");
    assert.equal(await send("/admin/pending", {}), 401, "admin routes do not exist on the LAN port");
    const lanIp = broadcastTargets().length ? (await import("node:os")).networkInterfaces() : null;
    const external = Object.values(lanIp ?? {}).flat().find((item) => item?.family === "IPv4" && !item.internal)?.address;
    const adminPort = JSON.parse(await readFile(path.join(home, "lan-admin.json"), "utf8")).port;
    assert.equal((await fetch(`http://127.0.0.1:${adminPort}/admin/pending`, { method: "POST" })).status, 401, "admin needs its token");
    if (external) await assert.rejects(fetch(`http://${external}:${adminPort}/admin/pending`, { method: "POST", signal: AbortSignal.timeout(2000) }), "admin is not reachable from the network");
    // A response forged by someone without the device key cannot be opened.
    const fakeKey = crypto.randomBytes(32).toString("hex");
    assert.throws(() => open(config.keyHex, "response\n1\n200", seal(fakeKey, "response\n1\n200", "{}")), /decryption_failed/u);
    assert.equal(approvalTag(config.keyHex, "r", "d") === approvalTag(fakeKey, "r", "d"), false);
    console.log("ok 8  wrong key, unknown device, stale, replay on another route, tampering, plaintext, oversize and admin probes are all refused");
  }

  // 9. Revoking a device ends its access immediately.
  {
    const devices = (await admin(home, "devices")).devices;
    assert.equal((await admin(home, "revoke", devices[0].deviceId)).status, "revoked");
    const f = await writeIntent(p.b, "lan-revoked", "lan_revoked");
    const denied = lastJson(await node(clientScript, ["register", "--root", p.b, "--intent", f], { cwd: p.b }));
    assert.equal(denied.code, "authority_rejected_device");
    await assertSound(p.a, 1 + 12);
    console.log("ok 9  a revoked device is refused at once and nothing is registered");
  }

  // 10. A pending request that nobody answers expires, and approval of an expired request is refused.
  {
    await stop(authority.child);
    authority = await startAuthority(home, { DECAL_ITS_PAIR_MIN_INTERVAL_MS: "0", DECAL_ITS_PAIR_TTL_MS: "1500" });
    const pairing = startPair(p.b, "late-device");
    await waitFor(() => pairing.lines.find((line) => line.status === "pending"), "pending line");
    const requestId = (await waitFor(async () => { const r = await admin(home, "pending"); return r.pending?.length ? r : null; }, "pending request")).pending[0].requestId;
    await sleep(2500);
    assert.equal((await admin(home, "approve", requestId)).code, "not_pending", "an expired request cannot be approved");
    assert.equal((await pairing.done).lines.at(-1).status, "expired");
    console.log("ok 10 an unanswered request expires and can no longer be approved");
  }

  // 11. A single-device project never needs any of this.
  {
    const solo = await makeProject("solo");
    const f = await writeIntent(solo.a, "solo-1", "solo_one");
    const result = lastJson(await node(clientScript, ["register", "--root", solo.a, "--intent", f], { cwd: solo.a }));
    assert.equal(result.status, "registered");
    assert.equal(result.mode, "local");
    await assert.rejects(stat(path.join(solo.a, ".decal/its-lan-client.json")));
    await assertSound(solo.a, 2);
    console.log("ok 11 a single-device project registers locally with no pairing, no network and no new files");
  }
  console.log("ITS LAN pairing v19 acceptance passed");
} finally {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  await rm(base, { recursive: true, force: true });
}
