// Acceptance for the v24 pairing trust contract: real client and authority processes, a real rogue answering on real sockets.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import crypto from "node:crypto";
import dgram from "node:dgram";
import { appendFile, chmod, cp, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { projectIdOf, readJson, writePrivateJson, ensurePrivateDirectory } from "../packs/decal-pack/src/contracts/task-work-bug/v24/authority-storage.mjs";
import { approvalTag, deriveSession, newKeyPair } from "../packs/decal-pack/src/contracts/task-work-bug/v19/lan-crypto.mjs";

const exec = promisify(execFile);
const source = fileURLToPath(new URL("../", import.meta.url));
const contracts = path.join(source, "packs/decal-pack/src/contracts");
const base = await realpath(await mkdtemp(path.join(tmpdir(), "its-lan-v24-")));
let nextPort = 44000 + Math.floor(Math.random() * 800);
const env = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test",
  // One target keeps a multi-homed test computer from answering twice; test 3 makes two answers on purpose.
  DECAL_ITS_DISCOVERY_TARGETS: "127.0.0.1", DECAL_ITS_PAIR_MIN_INTERVAL_MS: "0", DECAL_ITS_HOME: path.join(base, "unused-home"),
};
delete env.DECAL_SESSION_ID;
process.env.DECAL_ITS_HOME = path.join(base, "storage-home");

const script = (version, name) => path.join(contracts, "task-work-bug", version, name);
const client = script("v24", "lan-client.mjs");
const CLIENT_FILE = ".decal/its-lan-client.json";
const PENDING_FILE = ".decal/its-lan-client.pending.json";
const children = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exists = (file) => lstat(file).then(() => true, () => false);

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
const node = (file, args, options) => run(process.execPath, [file, ...args], options);
const scenario = () => ({ DECAL_ITS_DISCOVERY_PORT: String(nextPort++) });

let projectCount = 0;
/** No `.decal/` ignore rule here, so keeping the key out of Git is really tested. */
async function makeProject() {
  const dir = path.join(base, `project-${projectCount += 1}`);
  const seed = path.join(dir, "seed");
  await mkdir(dir, { recursive: true });
  await git(dir, "init", "-q", "--bare", "-b", "main", "origin.git");
  await git(dir, "init", "-q", "-b", "main", "seed");
  await cp(contracts, path.join(seed, "contracts"), { recursive: true });
  await cp(path.join(contracts, "task-work-bug/v4/fixtures/project/docs"), path.join(seed, "docs"), { recursive: true });
  await writeFile(path.join(seed, ".gitignore"), ".decal-slice-completion.lock\n");
  await git(seed, "add", ".");
  await git(seed, "commit", "-q", "-m", "seed");
  await git(seed, "remote", "add", "origin", path.join(dir, "origin.git"));
  await git(seed, "push", "-q", "origin", "main");
  const a = path.join(dir, "deviceA");
  const b = path.join(dir, "deviceB");
  await git(dir, "clone", "-q", "origin.git", "deviceA");
  await git(dir, "clone", "-q", "origin.git", "deviceB");
  return { dir, a, b };
}

const context = "## 사용자 요약\n\n```zuz-its-context\n" + JSON.stringify({ schemaVersion: 1, reason: "시험", goal: "시험", completion: "시험", nextAction: "시험" }) + "\n```\n";
function intentFor(id) {
  return {
    schema: "decal.task-work-bug.task-registration-batch-intent/v7", intentId: id, commitMessage: `docs(tasks): register ${id}`,
    tasks: [{ localRef: "item", category: "product", slug: id.replaceAll("-", "_"), title: `LAN ${id}`, priority: "P1", areas: ["ITS"], summary: "연결 시험", versionImpact: "none", remoteVersionImpact: "none", body: `## Context Budget\n\n- 시험\n\n${context}\n## 완료 기준\n\n- [ ] 시험\n` }],
  };
}
async function writeIntent(root, id) { const file = path.join(root, `${id}.json`); await writeFile(file, JSON.stringify(intentFor(id))); return file; }
const entryOf = (root) => path.join(root, "contracts/task-work-bug/its-register.mjs");

/** A device that knows only the project id: it answers discovery and approves its own pairing. No main device is involved. */
async function startRogue(projectId, discoveryPort, { extraPorts = () => [] } = {}) {
  const sessions = new Map();
  const seen = { sealed: 0 };
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const route = new URL(request.url, "http://rogue").pathname;
      const payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      let body = { status: "rejected" };
      if (route === "/v1/pair/request") {
        const requestId = crypto.randomBytes(16).toString("hex");
        const keys = newKeyPair();
        sessions.set(requestId, { keys });
        body = { status: "ok", requestId, serverPublic: keys.publicRaw.toString("base64"), expiresAt: Date.now() + 60000 };
      } else if (route === "/v1/pair/reveal") {
        const item = sessions.get(payload.requestId);
        const clientPublic = Buffer.from(payload.clientPublic, "base64");
        item.session = deriveSession({ privateKey: item.keys.privateKey, peerPublicRaw: clientPublic, requestId: payload.requestId, clientPublicRaw: clientPublic, serverPublicRaw: item.keys.publicRaw });
        body = { status: "ok", state: "pending" };
      } else if (route === "/v1/pair/status") {
        const deviceId = "aaaabbbbccccdddd";
        body = { status: "ok", state: "approved", deviceId, confirm: approvalTag(sessions.get(payload.requestId).session.keyHex, payload.requestId, deviceId) };
      } else seen.sealed += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const udp = dgram.createSocket("udp4");
  udp.on("message", (message, remote) => {
    const packet = JSON.parse(message.toString("utf8"));
    if (packet.p !== projectId) return;
    for (const answerPort of [port, ...extraPorts()]) {
      udp.send(JSON.stringify({ k: "decal-its/here", v: 1, p: packet.p, q: packet.q, label: "main-mac", port: answerPort }), remote.port, remote.address);
    }
  });
  await new Promise((resolve) => udp.bind(discoveryPort, "127.0.0.1", resolve));
  return {
    port, seen,
    stop: async () => { await new Promise((resolve) => udp.close(resolve)); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); },
  };
}

async function startAuthority(version, home, root, extraEnv = {}) {
  const authority = script(version, "lan-authority.mjs");
  const options = { env: { DECAL_ITS_HOME: home } };
  assert.equal(lastJson(await node(authority, ["init", "--label", "main-mac"], options)).status, "initialized");
  assert.equal(lastJson(await node(authority, ["add-project", "--root", root], options)).status, "added");
  const child = spawn(process.execPath, [authority, "serve"], { env: { ...env, DECAL_ITS_HOME: home, ...extraEnv }, stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  const info = await new Promise((resolve, reject) => {
    let buffer = "";
    child.stdout.on("data", (data) => { buffer += data; if (buffer.includes("\n")) resolve(JSON.parse(buffer.split("\n")[0])); });
    child.once("exit", (code) => reject(new Error(`authority exited ${code}`)));
  });
  return {
    ...info, child,
    admin: (...args) => node(authority, args, options).then(lastJson),
    stop: () => new Promise((resolve) => { if (child.exitCode !== null) return resolve(); child.once("exit", resolve); child.kill("SIGTERM"); }),
  };
}

function startPair(file, root, label, extraEnv, ...rest) {
  const lines = [];
  const child = spawn(process.execPath, [file, "pair", "--root", root, "--label", label, "--timeout", "30", ...rest], { cwd: root, env: { ...env, ...extraEnv }, stdio: ["ignore", "pipe", "inherit"] });
  children.push(child);
  let buffer = "";
  child.stdout.on("data", (data) => { buffer += data; const parts = buffer.split("\n"); buffer = parts.pop(); lines.push(...parts.filter(Boolean).map((line) => JSON.parse(line))); });
  return { lines, done: new Promise((resolve) => child.once("exit", (code) => resolve({ code, lines }))) };
}
async function waitFor(check, what, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) assert.fail(`timeout waiting for ${what}`); await sleep(100); }
}
const approvedOnMain = async (authority) => (await waitFor(async () => { const r = await authority.admin("pending"); return r.pending?.length ? r : null; }, "approval card")).pending[0];

/** Runs `pair` against whatever answers; the rogue approves itself at once. */
const pairRogue = (root, port, extra = {}, ...rest) => node(client, ["pair", "--root", root, "--label", "second", "--timeout", "10", ...rest], { cwd: root, env: { ...port, ...extra } });

after(async () => {
  for (const child of children) if (child.exitCode === null) child.kill("SIGTERM");
  await rm(base, { recursive: true, force: true });
});

test("v24 manifest verifies and refuses a changed pinned dependency", async () => {
  assert.equal(lastJson(await node(client.replace("lan-client.mjs", "verify-contract.mjs"), [])).status, "accepted");
  const copy = path.join(base, "tamper");
  await cp(path.join(contracts, "task-work-bug"), copy, { recursive: true });
  await appendFile(path.join(copy, "v19/lan-crypto.mjs"), "\n// tampered\n");
  const refused = await node(path.join(copy, "v24/verify-contract.mjs"), []);
  assert.equal(refused.code, 2);
  assert.equal(lastJson(refused).status, "rejected");
});

test("a rogue that approves itself does not activate pairing, and nothing uses the result", async () => {
  const p = await makeProject();
  const port = scenario();
  const rogue = await startRogue(await projectIdOf(p.b), Number(port.DECAL_ITS_DISCOVERY_PORT));
  try {
    const head = await git(p.b, "rev-parse", "HEAD");
    const result = await pairRogue(p.b, port);
    assert.equal(result.code, 5, result.out);
    const final = lastJson(result);
    assert.equal(final.status, "awaiting_local_confirmation");
    assert.match(final.sas, /^\d{3} \d{3}$/u);
    assert.equal(await exists(path.join(p.b, CLIENT_FILE)), false, "no active key");
    if (process.platform !== "win32") assert.equal((await stat(path.join(p.b, PENDING_FILE))).mode & 0o077, 0, "pending key is private");

    const status = lastJson(await node(client, ["status", "--root", p.b], { cwd: p.b, env: port }));
    assert.equal(status.mode, "local");
    assert.equal(status.authority, null);
    assert.equal(status.pendingPairing.sas, final.sas);

    const refused = await node(client, ["register", "--root", p.b, "--intent", await writeIntent(p.b, "rogue-register")], { cwd: p.b, env: port });
    assert.equal(lastJson(refused).code, "pairing_awaiting_local_confirmation");
    assert.equal(lastJson(await node(client, ["flush", "--root", p.b], { cwd: p.b, env: port })).code, "not_paired");
    assert.equal(rogue.seen.sealed, 0, "the rogue never received a sealed request");
    assert.equal(await git(p.b, "rev-parse", "HEAD"), head, "the rogue could not bring a commit in");

    assert.equal(lastJson(await node(client, ["pair-cancel", "--root", p.b], { cwd: p.b, env: port })).status, "ok");
    assert.equal(await exists(path.join(p.b, PENDING_FILE)), false);
  } finally { await rogue.stop(); }
});

test("a wrong code is refused and never activates; the right code does, which is why the user's check is the guard", async () => {
  const p = await makeProject();
  const port = scenario();
  const rogue = await startRogue(await projectIdOf(p.b), Number(port.DECAL_ITS_DISCOVERY_PORT));
  const confirm = (sas) => node(client, ["pair-confirm", "--root", p.b, "--sas", sas], { cwd: p.b, env: port });
  try {
    assert.equal(lastJson(await confirm("123 456")).code, "no_pending_pairing");
    const { sas } = lastJson(await pairRogue(p.b, port));
    const wrong = sas === "000 000" ? "000 001" : "000 000";
    assert.equal(lastJson(await node(client, ["pair-confirm", "--root", p.b, "--sas", "12"], { cwd: p.b, env: port })).code, "usage_error");
    const refused = await confirm(wrong);
    assert.equal(refused.code, 2);
    assert.equal(lastJson(refused).code, "check_code_mismatch");
    assert.equal(await exists(path.join(p.b, CLIENT_FILE)), false);
    assert.equal(await exists(path.join(p.b, PENDING_FILE)), true, "a typing error can be corrected");
    for (let i = 0; i < 3; i += 1) assert.equal(lastJson(await confirm(wrong)).code, "check_code_mismatch");
    assert.equal(lastJson(await confirm(wrong)).code, "check_code_attempts_exhausted");
    assert.equal(await exists(path.join(p.b, PENDING_FILE)), false, "five wrong codes end the attempt");
    assert.equal(await exists(path.join(p.b, CLIENT_FILE)), false);

    const again = lastJson(await pairRogue(p.b, port));
    const paired = await confirm(again.sas.replace(" ", ""));
    assert.equal(lastJson(paired).status, "paired", "the code alone cannot tell who typed it; the README says so");
    assert.equal(paired.code, 0);
    assert.equal(await exists(path.join(p.b, PENDING_FILE)), false, "activation removes the pending copy of the key");
  } finally { await rogue.stop(); }
});

test("two answers stop as ambiguous; --authority must have answered, and the real authority's card shows the same code", async () => {
  const p = await makeProject();
  const port = scenario();
  // The real authority listens on another discovery port so the rogue can be the one socket answering for both, as two devices would.
  const authority = await startAuthority("v24", path.join(p.dir, "home"), p.a, scenario());
  const rogue = await startRogue(await projectIdOf(p.b), Number(port.DECAL_ITS_DISCOVERY_PORT), { extraPorts: () => [authority.lanPort] });
  try {
    const ambiguous = await pairRogue(p.b, port);
    assert.equal(ambiguous.code, 2);
    const stopped = lastJson(ambiguous);
    assert.equal(stopped.code, "authority_ambiguous");
    assert.deepEqual(stopped.answers.map((item) => item.authority).sort(), [`127.0.0.1:${authority.lanPort}`, `127.0.0.1:${rogue.port}`].sort(), "both devices are listed, even with the same label");
    assert.equal(await exists(path.join(p.b, PENDING_FILE)), false);
    assert.equal((await authority.admin("pending")).pending.length, 0, "no request reached anyone");

    const unknown = await pairRogue(p.b, port, {}, "--authority", "192.0.2.7:4000");
    assert.equal(lastJson(unknown).code, "authority_not_answered");
    assert.equal(lastJson(unknown).answers.length, 2);

    const pairing = startPair(client, p.b, "second", port, "--authority", `127.0.0.1:${authority.lanPort}`);
    const shown = await waitFor(() => pairing.lines.find((line) => line.status === "pending"), "check code");
    const card = await approvedOnMain(authority);
    assert.equal(card.sas, shown.sas, "both screens show the same code");
    assert.equal((await authority.admin("approve", card.requestId)).status, "approved");
    const { code, lines } = await pairing.done;
    assert.equal(code, 5);
    assert.equal(lines.at(-1).status, "awaiting_local_confirmation");
    assert.equal(await exists(path.join(p.b, CLIENT_FILE)), false, "approval on the main device alone does not activate either");
    assert.equal(lastJson(await node(client, ["pair-confirm", "--root", p.b, "--sas", card.sas], { cwd: p.b, env: port })).status, "paired");
    const config = JSON.parse(await readFile(path.join(p.b, CLIENT_FILE), "utf8"));
    assert.equal(config.port, authority.lanPort);

    const file = await writeIntent(p.b, "through-real-authority");
    const plan = lastJson(await node(entryOf(p.b), ["--kind", "task", "--root", p.b, "--intent", file, "--dry-run"], { cwd: p.b, env: port }));
    const done = lastJson(await node(entryOf(p.b), ["--kind", "task", "--root", p.b, "--intent", file, "--approved-digest", plan.intentDigest, "--write"], { cwd: p.b, env: port }));
    assert.equal(done.delegatedTo, "its-authority", JSON.stringify(done));
    assert.equal(rogue.seen.sealed, 0);
    assert.equal(await git(p.a, "rev-parse", "HEAD"), await git(p.b, "rev-parse", "HEAD"));
  } finally { await rogue.stop(); await authority.stop(); }
});

test("a pending pairing expires and its key goes with it", async () => {
  const p = await makeProject();
  const port = scenario();
  const rogue = await startRogue(await projectIdOf(p.b), Number(port.DECAL_ITS_DISCOVERY_PORT));
  try {
    const { sas } = lastJson(await pairRogue(p.b, port, { DECAL_ITS_PAIR_CONFIRM_TTL_MS: "200" }));
    await sleep(400);
    assert.equal(lastJson(await node(client, ["pair-confirm", "--root", p.b, "--sas", sas], { cwd: p.b, env: port })).code, "pending_pairing_expired");
    assert.equal(await exists(path.join(p.b, PENDING_FILE)), false);
    assert.equal(await exists(path.join(p.b, CLIENT_FILE)), false);
    assert.equal(lastJson(await node(client, ["pair-confirm", "--root", p.b, "--sas", sas], { cwd: p.b, env: port })).code, "no_pending_pairing");
  } finally { await rogue.stop(); }
});

test("its-register treats a pending-only state as not paired and never registers locally while it is live", async () => {
  const p = await makeProject();
  const port = scenario();
  const own = { DECAL_ITS_OWN_ADDRESSES: "203.0.113.99", ...port };
  const rogue = await startRogue(await projectIdOf(p.b), Number(port.DECAL_ITS_DISCOVERY_PORT));
  const register = async (id) => {
    const file = await writeIntent(p.b, id);
    const plan = lastJson(await node(entryOf(p.b), ["--kind", "task", "--root", p.b, "--intent", file, "--dry-run"], { cwd: p.b, env: own }));
    assert.equal(plan.status, "planned", "a preview is never blocked");
    return node(entryOf(p.b), ["--kind", "task", "--root", p.b, "--intent", file, "--approved-digest", plan.intentDigest, "--write"], { cwd: p.b, env: own });
  };
  let rogueRunning = true;
  try {
    const head = await git(p.b, "rev-parse", "HEAD");
    assert.equal(lastJson(await pairRogue(p.b, port, { DECAL_ITS_PAIR_CONFIRM_TTL_MS: "6000" })).status, "awaiting_local_confirmation");
    const started = Date.now();
    const blocked = await register("pending-only-a");
    assert.equal(blocked.code, 2);
    assert.equal(lastJson(blocked).code, "pairing_required", blocked.out);
    assert.equal(lastJson(blocked).reason, "pairing_awaiting_local_confirmation");
    assert.match(lastJson(blocked).next, /pair-confirm/u);
    assert.equal(rogue.seen.sealed, 0, "nothing was delegated to the responder");

    await rogue.stop();
    rogueRunning = false;
    const silent = await register("pending-only-b");
    assert.equal(lastJson(silent).code, "pairing_required", "an authority was just seen, so silence does not allow a local number");
    assert.equal(await git(p.b, "rev-parse", "HEAD"), head, "nothing was registered");

    await sleep(Math.max(0, 6200 - (Date.now() - started)));
    assert.equal(lastJson(await register("pending-expired")).status, "committed", "after expiry, with no authority answering, the device registers locally as before");
    assert.notEqual(await git(p.b, "rev-parse", "HEAD"), head);
  } finally { if (rogueRunning) await rogue.stop(); }
});

test("an unpaired device with no pending state keeps the original pairing_required", async () => {
  const p = await makeProject();
  const port = scenario();
  const own = { DECAL_ITS_OWN_ADDRESSES: "203.0.113.99", ...port };
  const rogue = await startRogue(await projectIdOf(p.b), Number(port.DECAL_ITS_DISCOVERY_PORT));
  try {
    const file = await writeIntent(p.b, "no-pending");
    const plan = lastJson(await node(entryOf(p.b), ["--kind", "task", "--root", p.b, "--intent", file, "--dry-run"], { cwd: p.b, env: own }));
    const stopped = lastJson(await node(entryOf(p.b), ["--kind", "task", "--root", p.b, "--intent", file, "--approved-digest", plan.intentDigest, "--write"], { cwd: p.b, env: own }));
    assert.equal(stopped.code, "pairing_required");
    assert.equal(stopped.reason, "an_authority_for_this_project_is_on_the_local_network");
    assert.match(stopped.next, /task-work-bug\/v24\/lan-client\.mjs pair/u);
  } finally { await rogue.stop(); }
});

for (const version of ["v19", "v23"]) {
  test(`a v24 client pairs and registers through the published ${version} authority`, async () => {
    const p = await makeProject();
    const port = scenario();
    const authority = await startAuthority(version, path.join(p.dir, "home"), p.a, port);
    try {
      const pairing = startPair(client, p.b, "second", port);
      const shown = await waitFor(() => pairing.lines.find((line) => line.status === "pending"), "check code");
      const card = await approvedOnMain(authority);
      assert.equal(card.sas, shown.sas);
      await authority.admin("approve", card.requestId);
      assert.equal((await pairing.done).lines.at(-1).status, "awaiting_local_confirmation");
      assert.equal(lastJson(await node(client, ["pair-confirm", "--root", p.b, "--sas", card.sas], { cwd: p.b, env: port })).status, "paired");
      const result = lastJson(await node(client, ["register", "--root", p.b, "--intent", await writeIntent(p.b, `v24-to-${version}`)], { cwd: p.b, env: port }));
      assert.equal(result.status, "registered", JSON.stringify(result));
      assert.equal(result.mode, "authority");
      assert.equal(await git(p.a, "rev-parse", "HEAD"), await git(p.b, "rev-parse", "HEAD"));
    } finally { await authority.stop(); }
  });
}

test("a published v19 client pairs at once with a v24 authority, and a v24 client keeps using that older pairing", async () => {
  const p = await makeProject();
  const port = scenario();
  const home = path.join(p.dir, "home");
  const authority = await startAuthority("v24", home, p.a, port);
  try {
    if (process.platform !== "win32") {
      assert.equal((await stat(home)).mode & 0o077, 0, "the device home is private");
      assert.equal((await stat(path.join(home, "lan-authority.json"))).mode & 0o077, 0);
    }
    const old = script("v19", "lan-client.mjs");
    const pairing = startPair(old, p.b, "older", port);
    const shown = await waitFor(() => pairing.lines.find((line) => line.status === "pending"), "check code");
    const card = await approvedOnMain(authority);
    assert.equal(card.sas, shown.sas);
    await authority.admin("approve", card.requestId);
    assert.equal((await pairing.done).lines.at(-1).status, "paired");
    assert.equal(lastJson(await node(old, ["register", "--root", p.b, "--intent", await writeIntent(p.b, "v19-to-v24")], { cwd: p.b, env: port })).status, "registered");

    const newer = lastJson(await node(client, ["register", "--root", p.b, "--intent", await writeIntent(p.b, "older-pairing-loaded")], { cwd: p.b, env: port }));
    assert.equal(newer.status, "registered", JSON.stringify(newer));
    assert.equal(newer.mode, "authority");
    assert.match(await git(p.b, "status", "--porcelain", "--ignored", CLIENT_FILE), /^!! /u, "the older key is excluded from Git on first use");
    assert.equal(lastJson(await node(client, ["status", "--root", p.b], { cwd: p.b, env: port })).keyTrackedByGit, false);
  } finally { await authority.stop(); }
});

test("the key paths go into the local exclude file, in linked worktrees too, never into a tracked file", async () => {
  const p = await makeProject();
  const port = scenario();
  const rogue = await startRogue(await projectIdOf(p.b), Number(port.DECAL_ITS_DISCOVERY_PORT));
  try {
    const before = await readFile(path.join(p.b, ".gitignore"), "utf8");
    await git(p.b, "worktree", "add", "-q", "-b", "side", path.join(p.dir, "side"));
    const side = path.join(p.dir, "side");
    const { sas } = lastJson(await pairRogue(side, port));
    const exclude = await readFile(path.join(p.b, ".git/info/exclude"), "utf8");
    assert.ok(exclude.split("\n").includes(`/${CLIENT_FILE}`), exclude);
    assert.ok(exclude.split("\n").includes(`/${PENDING_FILE}`), exclude);
    assert.equal(await exists(path.join(p.dir, "side/.git/info")), false, "a linked worktree's .git is a file");
    assert.equal(await git(side, "status", "--porcelain"), "", "the pending key is invisible to Git");
    assert.equal(lastJson(await node(client, ["pair-confirm", "--root", side, "--sas", sas], { cwd: side, env: port })).status, "paired");
    assert.equal(await git(side, "status", "--porcelain"), "", "the active key is invisible to Git");
    await git(side, "add", "-A");
    assert.equal(await git(side, "diff", "--cached", "--name-only"), "", "git add -A does not pick the key up");
    assert.equal(await readFile(path.join(p.b, ".gitignore"), "utf8"), before);
    const again = lastJson(await pairRogue(side, port));
    assert.equal(again.status, "awaiting_local_confirmation");
    assert.equal((await readFile(path.join(p.b, ".git/info/exclude"), "utf8")).split(`/${CLIENT_FILE}`).length, 2, "entries are not repeated");
  } finally { await rogue.stop(); }
});

test("a tracked key path is refused before pairing and at activation; a .gitignore that re-includes it is refused too", async () => {
  const p = await makeProject();
  const port = scenario();
  const rogue = await startRogue(await projectIdOf(p.b), Number(port.DECAL_ITS_DISCOVERY_PORT));
  const active = path.join(p.b, CLIENT_FILE);
  try {
    const { sas } = lastJson(await pairRogue(p.b, port));
    await writeFile(active, "{}", { mode: 0o600 });
    await git(p.b, "add", "-f", CLIENT_FILE);
    const refused = lastJson(await node(client, ["pair-confirm", "--root", p.b, "--sas", sas], { cwd: p.b, env: port }));
    assert.equal(refused.code, "client_key_tracked");
    assert.equal(await readFile(active, "utf8"), "{}", "the tracked file was not overwritten with a key");
    assert.equal(lastJson(await pairRogue(p.b, port)).code, "client_key_tracked", "pairing itself is refused while it is tracked");
    assert.equal(lastJson(await node(client, ["status", "--root", p.b], { cwd: p.b, env: port })).code, "invalid_client_config", "the fixture file is not a real key");
    await git(p.b, "rm", "-q", "--cached", "-f", CLIENT_FILE);
    await rm(active);
    await writeFile(path.join(p.b, ".gitignore"), `!/${CLIENT_FILE}\n`);
    const reincluded = lastJson(await pairRogue(p.b, port));
    assert.equal(reincluded.code, "client_key_not_excluded", JSON.stringify(reincluded));
  } finally { await rogue.stop(); }
});

test("its-register still honours platformContracts", async () => {
  const p = await makeProject();
  const tablePath = path.join(p.b, "contracts/task-work-bug/capabilities.json");
  const table = JSON.parse(await readFile(tablePath, "utf8"));
  const file = await writeIntent(p.b, "platform-table");
  const other = process.platform === "linux" ? "darwin" : "linux";
  table.capabilities["register-task-batch"].platformContracts = { [other]: "v98" };
  await writeFile(tablePath, JSON.stringify(table));
  assert.equal(lastJson(await node(entryOf(p.b), ["--kind", "task", "--root", p.b, "--intent", file, "--dry-run"], { cwd: p.b })).status, "planned");
  table.capabilities["register-task-batch"].platformContracts = { [process.platform]: "v98" };
  await writeFile(tablePath, JSON.stringify(table));
  const refused = lastJson(await node(entryOf(p.b), ["--kind", "task", "--root", p.b, "--intent", file, "--dry-run"], { cwd: p.b }));
  assert.equal(refused.code, "authoring_update_required");
  assert.equal(refused.contract, "v98");
});

const posix = { skip: process.platform === "win32" ? "Windows uses the v22 and v23 DACL route; POSIX modes do not apply" : false };

test("POSIX: a new directory is 0700 and a new file is 0600, replaced atomically with no temporary left", posix, async () => {
  const root = await realpath(await mkdtemp(path.join(base, "posix-")));
  const file = path.join(root, ".decal", "its-outbox", "entry.json");
  await writePrivateJson(file, { one: 1 });
  assert.equal((await stat(path.join(root, ".decal"))).mode & 0o777, 0o700);
  assert.equal((await stat(path.dirname(file))).mode & 0o777, 0o700);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await chmod(file, 0o400);
  await writePrivateJson(file, { two: 2 });
  assert.equal((await stat(file)).mode & 0o777, 0o600, "replacement carries its own mode");
  assert.deepEqual(await readJson(file), { two: 2 });
  assert.deepEqual(await readdir(path.dirname(file)), ["entry.json"]);
});

test("POSIX: symbolic links are refused for the file and the parent, and the target is left alone", posix, async () => {
  const root = await realpath(await mkdtemp(path.join(base, "posix-")));
  await mkdir(path.join(root, ".decal"), { mode: 0o700 });
  const outside = path.join(root, "outside.json");
  await writeFile(outside, '{"keep":true}\n', { mode: 0o600 });
  const file = path.join(root, ".decal", "its-lan-client.json");
  await symlink(outside, file);
  await assert.rejects(readJson(file), { code: "unsafe_private_storage" });
  await assert.rejects(writePrivateJson(file, { a: 1 }), { code: "unsafe_private_storage" });
  assert.equal(await readFile(outside, "utf8"), '{"keep":true}\n');

  const elsewhere = path.join(root, "elsewhere");
  await mkdir(elsewhere, { mode: 0o700 });
  await writeFile(path.join(elsewhere, "its-lan-client.json"), '{"keep":true}\n', { mode: 0o600 });
  const linkedProject = path.join(root, "linked");
  await mkdir(linkedProject);
  await symlink(elsewhere, path.join(linkedProject, ".decal"));
  await assert.rejects(readJson(path.join(linkedProject, ".decal/its-lan-client.json")), { code: "unsafe_private_storage" });
  await assert.rejects(writePrivateJson(path.join(linkedProject, ".decal/its-lan-client.json"), { a: 1 }), { code: "unsafe_private_storage" });
  await assert.rejects(writePrivateJson(path.join(linkedProject, ".decal/its-outbox/entry.json"), { a: 1 }), { code: "unsafe_private_storage" });
  assert.deepEqual(await readdir(elsewhere), ["its-lan-client.json"]);

  const dangling = path.join(root, "dangling");
  await mkdir(dangling);
  await symlink(path.join(root, "nowhere"), path.join(dangling, ".decal"));
  await assert.rejects(ensurePrivateDirectory(path.join(dangling, ".decal")), { code: "unsafe_private_storage" });
});

test("POSIX: a wider mode or a hard link is refused on read; an older 0600 file loads", posix, async () => {
  const root = await realpath(await mkdtemp(path.join(base, "posix-")));
  await mkdir(path.join(root, ".decal"), { mode: 0o755 });
  await chmod(path.join(root, ".decal"), 0o755);
  const file = path.join(root, ".decal", "its-lan-client.json");
  // Exactly how v18 wrote it.
  await writeFile(file, `${JSON.stringify({ old: true }, null, 2)}\n`, { mode: 0o600 });
  assert.deepEqual(await readJson(file), { old: true }, "an older file loads");
  for (const mode of [0o640, 0o604, 0o644]) {
    await chmod(file, mode);
    await assert.rejects(readJson(file), (error) => error.code === "unsafe_private_storage" && /chmod_600/u.test(error.detail));
  }
  await chmod(file, 0o600);
  const alias = path.join(root, "alias.json");
  await link(file, alias);
  await assert.rejects(readJson(file), { code: "unsafe_private_storage" });
  await rm(alias);
  assert.equal(await readJson(path.join(root, ".decal", "missing.json")), null);
  assert.equal(await readJson(path.join(root, "no-such-dir", ".decal", "missing.json")), null);
});

test("POSIX: the tool's home is tightened; a project's .decal is not changed, and is refused only when anyone may write to it", posix, async () => {
  const root = await realpath(await mkdtemp(path.join(base, "posix-")));
  const home = process.env.DECAL_ITS_HOME;
  await mkdir(home, { recursive: true });
  await chmod(home, 0o755);
  await writePrivateJson(path.join(home, "lan-authority.json"), { a: 1 });
  assert.equal((await stat(home)).mode & 0o777, 0o700, "tightened");

  const project = path.join(root, ".decal");
  await mkdir(project);
  for (const mode of [0o755, 0o775]) {
    await chmod(project, mode);
    await writePrivateJson(path.join(project, "its-lan-client.json"), { mode });
    assert.equal((await stat(project)).mode & 0o777, mode, "the user's directory keeps its mode");
    assert.equal((await stat(path.join(project, "its-lan-client.json"))).mode & 0o777, 0o600);
    assert.deepEqual(await readJson(path.join(project, "its-lan-client.json")), { mode });
  }
  await chmod(project, 0o777);
  await assert.rejects(writePrivateJson(path.join(project, "its-lan-client.json"), { a: 1 }), (error) => error.code === "unsafe_private_storage" && /world_writable/u.test(error.detail));
  assert.equal((await stat(project)).mode & 0o777, 0o777, "still not changed");
  await chmod(project, 0o755);
});
