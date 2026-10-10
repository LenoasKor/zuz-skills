#!/usr/bin/env node
// ITS number authority for the local network. Devices find it, are approved once on this device, then register
// through AES-256-GCM-sealed requests. Nothing is typed by the user: no IP, no key, no command.
//   init [--label NAME]              create the device state
//   add-project --root PATH          serve a project
//   serve                            run: LAN API + discovery + loopback admin
//   pending | approve ID | deny ID   decide on connection requests (the app does this from its UI)
//   devices | revoke DEVICE_ID
//   service plan|install|uninstall   keep the authority running after log-in (macOS LaunchAgent, Windows scheduled task)
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { realpath, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  MAX_BODY_BYTES, MAX_SKEW_MS, buildBundle, deviceHome, projectIdOf, readJson, validateIntentShape, writePrivateJson,
} from "../v18/authority-common.mjs";
import { isRegistered, registerLocal, validDigest } from "./lan-broker.mjs";
import { approvalTag, commitment, constantTimeEqual, deriveSession, fail, newKeyPair, open, requestAad, responseAad, seal } from "./lan-crypto.mjs";
import { startResponder } from "./lan-discovery.mjs";

const STATE_SCHEMA = "decal.its-lan-authority/v1";
const statePath = () => path.join(deviceHome(), "lan-authority.json");
const adminPath = () => path.join(deviceHome(), "lan-admin.json");
const PAIR_TTL_MS = () => Number(process.env.DECAL_ITS_PAIR_TTL_MS || 120000);
const PAIR_MIN_INTERVAL_MS = () => Number(process.env.DECAL_ITS_PAIR_MIN_INTERVAL_MS ?? 10000);
const MAX_PENDING = 5;

function parseArgs(argv) {
  const parsed = new Map();
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) { positional.push(key); continue; }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) parsed.set(key, true);
    else { parsed.set(key, value); index += 1; }
  }
  return { args: parsed, positional };
}

const cleanLabel = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/gu, " ").trim().slice(0, 40) || "unnamed device";
const b64 = (buffer) => buffer.toString("base64");

async function loadState() {
  const state = await readJson(statePath());
  if (!state || state.schema !== STATE_SCHEMA) fail("authority_not_initialized");
  return state;
}

async function resolveProjects(state) {
  const projects = new Map();
  for (const entry of state.projects ?? []) {
    try {
      const root = await realpath(entry.root);
      projects.set(await projectIdOf(root), root);
    } catch { /* unavailable project is not served */ }
  }
  return projects;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => { size += chunk.length; if (size <= MAX_BODY_BYTES) chunks.push(chunk); });
    request.on("end", () => (size > MAX_BODY_BYTES
      ? reject(Object.assign(new Error("body_too_large"), { code: "body_too_large" }))
      : resolve(Buffer.concat(chunks).toString("utf8"))));
    request.on("error", reject);
  });
}

const plain = (response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

async function serve() {
  const state = await loadState();
  const pending = new Map();
  const lastRequestByIp = new Map();
  const failures = new Map();
  let queue = Promise.resolve();
  const serialized = (task) => { const run = queue.then(task, task); queue = run.catch(() => {}); return run; };
  const save = () => writePrivateJson(statePath(), state);
  let publicPort = 0;

  const sweep = () => {
    const now = Date.now();
    for (const [id, item] of pending) {
      if (item.expiresAt < now && !["approved", "denied"].includes(item.state)) item.state = "expired";
      if (item.expiresAt + 60000 < now) pending.delete(id);
    }
  };
  const sweeper = setInterval(sweep, 5000);
  sweeper.unref();

  // ---- connection requests (plain JSON; carries no secret, authenticated by the user's approval + check code)
  async function pairRoute(route, payload, remote) {
    sweep();
    const projects = await resolveProjects(state);
    if (route === "/v1/pair/request") {
      const projectId = String(payload.projectId ?? "");
      if (!projects.has(projectId)) return [404, { status: "rejected", code: "unknown_project" }];
      if (!/^[a-f0-9]{64}$/u.test(String(payload.commit ?? ""))) return [400, { status: "rejected", code: "invalid_commit" }];
      const waiting = [...pending.values()].filter((item) => ["awaiting_reveal", "pending"].includes(item.state)).length;
      const since = Date.now() - (lastRequestByIp.get(remote) ?? 0);
      if (waiting >= MAX_PENDING || since < PAIR_MIN_INTERVAL_MS()) return [429, { status: "rejected", code: "too_many_requests" }];
      lastRequestByIp.set(remote, Date.now());
      const requestId = crypto.randomBytes(16).toString("hex");
      const keys = newKeyPair();
      pending.set(requestId, {
        requestId, projectId, label: cleanLabel(payload.label), commit: payload.commit, ip: remote, keys,
        state: "awaiting_reveal", createdAt: Date.now(), expiresAt: Date.now() + PAIR_TTL_MS(),
      });
      return [200, { status: "ok", requestId, serverPublic: b64(keys.publicRaw), expiresAt: Date.now() + PAIR_TTL_MS() }];
    }
    const item = pending.get(String(payload.requestId ?? ""));
    if (!item) return [404, { status: "rejected", code: "unknown_request" }];
    if (route === "/v1/pair/reveal") {
      if (item.state !== "awaiting_reveal" || item.ip !== remote) return [409, { status: "rejected", code: "invalid_state" }];
      const clientPublic = Buffer.from(String(payload.clientPublic ?? ""), "base64");
      const nonce = Buffer.from(String(payload.nonce ?? ""), "base64");
      if (clientPublic.length !== 32 || nonce.length < 8 || !constantTimeEqual(commitment(clientPublic, nonce), item.commit)) {
        pending.delete(item.requestId);
        return [400, { status: "rejected", code: "commitment_mismatch" }];
      }
      const session = deriveSession({
        privateKey: item.keys.privateKey, peerPublicRaw: clientPublic, requestId: item.requestId,
        clientPublicRaw: clientPublic, serverPublicRaw: item.keys.publicRaw,
      });
      Object.assign(item, session, { state: "pending" });
      return [200, { status: "ok", state: "pending" }];
    }
    if (route === "/v1/pair/status") {
      if (item.ip !== remote) return [409, { status: "rejected", code: "invalid_state" }];
      if (item.state === "approved") {
        return [200, { status: "ok", state: "approved", deviceId: item.deviceId, confirm: approvalTag(item.keyHex, item.requestId, item.deviceId) }];
      }
      return [200, { status: "ok", state: item.state }];
    }
    return [404, { status: "rejected", code: "unknown_route" }];
  }

  // ---- sealed requests from approved devices
  async function sealedRoute(request, route, body, remote) {
    const envelope = JSON.parse(body);
    const device = state.devices.find((item) => item.deviceId === envelope.d);
    const skew = Math.abs(Date.now() - Number(envelope.t));
    if (!device || !Number.isFinite(skew) || skew > MAX_SKEW_MS) return { reject: true };
    let payload;
    try { payload = JSON.parse(open(device.keyHex, requestAad(request.method, route, device.deviceId, String(envelope.t)), envelope).toString("utf8")); }
    catch { return { reject: true }; }
    const projects = await resolveProjects(state);
    const root = projects.get(String(payload.projectId ?? ""));
    const reply = (status, value) => ({ status, device, time: String(envelope.t), value });
    if (!root || !device.projectIds.includes(payload.projectId)) return reply(404, { status: "rejected", code: "unknown_project" });
    if (route === "/v1/health") return reply(200, { status: "ok", label: state.label });
    if (route === "/v1/register") {
      validateIntentShape(payload.intent);
      const approvedDigest = payload.approvedDigest ?? null;
      if (approvedDigest !== null && !validDigest(approvedDigest)) return reply(400, { status: "rejected", code: "invalid_approved_digest" });
      const outcome = await serialized(async () => {
        const result = await registerLocal(root, payload.intent, { approvedDigest });
        if (!isRegistered(result)) return { result };
        const bundle = await buildBundle(root, result.commit, (payload.have ?? []).slice(0, 100));
        return { result, bundle: bundle ? bundle.toString("base64") : null };
      });
      const ok = isRegistered(outcome.result);
      return reply(ok ? 200 : 422, { status: ok ? "registered" : "rejected", ...outcome });
    }
    if (route === "/v1/sync") {
      const bundle = await serialized(() => buildBundle(root, String(payload.commit ?? ""), (payload.have ?? []).slice(0, 100)));
      return reply(200, { status: "ok", bundle: bundle ? bundle.toString("base64") : null });
    }
    return reply(404, { status: "rejected", code: "unknown_route" });
  }

  const lan = http.createServer(async (request, response) => {
    const route = new URL(request.url, "http://authority").pathname;
    const remote = request.socket.remoteAddress ?? "unknown";
    try {
      const body = await readBody(request);
      const recent = (failures.get(remote) ?? []).filter((at) => Date.now() - at < MAX_SKEW_MS);
      if (recent.length >= 10) return plain(response, 429, { status: "rejected", code: "too_many_failures" });
      if (request.method !== "POST") return plain(response, 405, { status: "rejected", code: "method_not_allowed" });
      if (route.startsWith("/v1/pair/")) {
        const [status, payload] = await pairRoute(route, JSON.parse(body || "{}"), remote);
        return plain(response, status, payload);
      }
      const outcome = await sealedRoute(request, route, body, remote);
      if (outcome.reject) {
        failures.set(remote, [...recent, Date.now()]);
        return plain(response, 401, { status: "rejected", code: "unauthorized" });
      }
      outcome.device.lastSeenAt = Date.now();
      const sealed = seal(outcome.device.keyHex, responseAad(outcome.time, outcome.status), JSON.stringify(outcome.value));
      response.writeHead(outcome.status, { "content-type": "application/json; charset=utf-8" });
      return response.end(JSON.stringify(sealed));
    } catch (error) {
      return plain(response, error.code === "body_too_large" ? 413 : 400, { status: "rejected", code: error.code ?? "bad_request" });
    }
  });

  // ---- admin: loopback only, bearer token; this is what the app's approval card talks to
  const admin = http.createServer(async (request, response) => {
    try {
      const token = String(request.headers.authorization ?? "").replace(/^Bearer /u, "");
      if (!constantTimeEqual(token, state.adminToken)) return plain(response, 401, { status: "rejected", code: "unauthorized" });
      sweep();
      const route = new URL(request.url, "http://admin").pathname;
      const payload = JSON.parse((await readBody(request)) || "{}");
      if (route === "/admin/pending") {
        return plain(response, 200, { status: "ok", pending: [...pending.values()].filter((item) => item.state === "pending").map((item) => ({
          requestId: item.requestId, label: item.label, ip: item.ip, sas: item.sas, projectId: item.projectId, expiresAt: item.expiresAt,
        })) });
      }
      if (route === "/admin/approve" || route === "/admin/deny") {
        const item = pending.get(String(payload.requestId ?? ""));
        if (!item || item.state !== "pending") return plain(response, 409, { status: "rejected", code: "not_pending" });
        if (route === "/admin/deny") { item.state = "denied"; return plain(response, 200, { status: "denied" }); }
        item.deviceId = crypto.randomBytes(8).toString("hex");
        state.devices.push({ deviceId: item.deviceId, label: item.label, keyHex: item.keyHex, projectIds: [item.projectId], createdAt: Date.now(), lastSeenAt: null });
        item.state = "approved";
        await save();
        return plain(response, 200, { status: "approved", deviceId: item.deviceId });
      }
      if (route === "/admin/devices") {
        return plain(response, 200, { status: "ok", devices: state.devices.map(({ keyHex, ...rest }) => rest) });
      }
      if (route === "/admin/revoke") {
        const before = state.devices.length;
        state.devices = state.devices.filter((item) => item.deviceId !== payload.deviceId);
        await save();
        return plain(response, 200, { status: state.devices.length < before ? "revoked" : "unknown_device" });
      }
      return plain(response, 404, { status: "rejected", code: "unknown_route" });
    } catch (error) {
      return plain(response, 400, { status: "rejected", code: error.code ?? "bad_request" });
    }
  });

  await new Promise((resolve, reject) => { lan.once("error", reject); lan.listen(Number(state.port || 0), "0.0.0.0", resolve); });
  publicPort = lan.address().port;
  await new Promise((resolve, reject) => { admin.once("error", reject); admin.listen(0, "127.0.0.1", resolve); });
  await writePrivateJson(adminPath(), { port: admin.address().port, token: state.adminToken, pid: process.pid, lanPort: publicPort });
  const responder = startResponder({ projects: () => resolveProjects(state), label: state.label, port: () => publicPort });
  process.stdout.write(`${JSON.stringify({ status: "listening", lanPort: publicPort, adminPort: admin.address().port, projects: (await resolveProjects(state)).size })}\n`);

  const stop = async () => {
    clearInterval(sweeper);
    responder.close();
    await rm(adminPath(), { force: true });
    lan.close(); admin.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

/** What it takes to start the authority at log-in on this OS. `plan` only prints; install/uninstall change the user's log-in items. */
function servicePlan() {
  const script = fileURLToPath(import.meta.url);
  if (process.platform === "darwin") {
    const file = path.join(os.homedir(), "Library", "LaunchAgents", "dev.decal.its-authority.plist");
    const log = path.join(deviceHome(), "authority.log");
    const env = process.env.DECAL_ITS_HOME ? `\n  <key>EnvironmentVariables</key><dict><key>DECAL_ITS_HOME</key><string>${process.env.DECAL_ITS_HOME}</string></dict>` : "";
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.decal.its-authority</string>
  <key>ProgramArguments</key><array><string>${process.execPath}</string><string>${script}</string><string>serve</string></array>${env}
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`;
    const uid = typeof process.getuid === "function" ? process.getuid() : 501;
    return { platform: "macos", file, content, install: [["launchctl", "bootstrap", `gui/${uid}`, file]], uninstall: [["launchctl", "bootout", `gui/${uid}/dev.decal.its-authority`]] };
  }
  if (process.platform === "win32") {
    const command = `"${process.execPath}" "${script}" serve`;
    return { platform: "windows", file: null, content: null, install: [["schtasks", "/Create", "/TN", "DecalItsAuthority", "/SC", "ONLOGON", "/TR", command, "/F"]], uninstall: [["schtasks", "/Delete", "/TN", "DecalItsAuthority", "/F"]] };
  }
  return { platform: process.platform, file: null, content: null, install: [], uninstall: [] };
}

async function service(action) {
  const plan = servicePlan();
  if (action === "plan") return { status: "plan", ...plan };
  if (!["install", "uninstall"].includes(action) || plan[action].length === 0) fail("service_unsupported", `${plan.platform} ${action}`);
  const { execFile } = await import("node:child_process");
  const { writeFile, mkdir } = await import("node:fs/promises");
  if (action === "install" && plan.file) { await mkdir(path.dirname(plan.file), { recursive: true }); await writeFile(plan.file, plan.content); }
  for (const [file, ...args] of plan[action]) {
    await new Promise((resolve, reject) => execFile(file, args, (error) => (error ? reject(Object.assign(new Error("service_command_failed"), { code: "service_command_failed", detail: `${file} ${args.join(" ")}: ${String(error.message).slice(0, 160)}` })) : resolve())));
  }
  if (action === "uninstall" && plan.file) await rm(plan.file, { force: true });
  return { status: action === "install" ? "installed" : "uninstalled", platform: plan.platform };
}

async function adminCall(route, payload = {}) {
  const info = await readJson(adminPath());
  if (!info) fail("authority_not_running");
  const response = await fetch(`http://127.0.0.1:${info.port}${route}`, {
    method: "POST", headers: { authorization: `Bearer ${info.token}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(5000),
  });
  return response.json();
}

async function main() {
  const { args, positional } = parseArgs(process.argv.slice(3));
  const command = process.argv[2];
  if (command === "init") {
    if (await readJson(statePath())) fail("authority_already_initialized");
    const state = { schema: STATE_SCHEMA, label: cleanLabel(args.get("--label") || os.hostname()), port: Number(args.get("--port") || 0), adminToken: crypto.randomBytes(32).toString("hex"), projects: [], devices: [] };
    await writePrivateJson(statePath(), state);
    return { status: "initialized", label: state.label };
  }
  if (command === "add-project") {
    const state = await loadState();
    const root = await realpath(path.resolve(String(args.get("--root") || "")));
    if (!state.projects.some((entry) => entry.root === root)) state.projects.push({ root });
    await writePrivateJson(statePath(), state);
    return { status: "added", root, projectId: await projectIdOf(root) };
  }
  if (command === "serve") return serve();
  if (command === "pending") return adminCall("/admin/pending");
  if (command === "approve") return adminCall("/admin/approve", { requestId: positional[0] });
  if (command === "deny") return adminCall("/admin/deny", { requestId: positional[0] });
  if (command === "devices") return adminCall("/admin/devices");
  if (command === "revoke") return adminCall("/admin/revoke", { deviceId: positional[0] });
  if (command === "service") return service(positional[0] ?? "plan");
  return fail("usage_error", "init | add-project | serve | pending | approve | deny | devices | revoke | service");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((result) => { if (result) process.stdout.write(`${JSON.stringify(result)}\n`); }, (error) => {
    process.stdout.write(`${JSON.stringify({ status: "rejected", code: error.code ?? "authority_failed", detail: error.detail ?? undefined })}\n`);
    process.exitCode = 2;
  });
}
