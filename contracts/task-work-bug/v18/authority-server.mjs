#!/usr/bin/env node
// ITS number authority for this device. One process serves every project registered with it.
//   init [--host H] [--port N]     create the device config and a shared key (printed once)
//   add-project --root PATH        let this authority issue numbers for a project
//   serve                          run the authority
//   status                         show config without the key
import http from "node:http";
import path from "node:path";
import { realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CONFIG_SCHEMA, MAX_BODY_BYTES, MAX_SKEW_MS, buildBundle, constantTimeEqual, deviceHome, fail, isRegistered, newKey,
  projectIdOf, readJson, registerLocal, requestSignature, responseSignature, validateIntentShape, writePrivateJson,
} from "./authority-common.mjs";

const configPath = () => path.join(deviceHome(), "daemon.json");

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) fail("usage_error", key);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) parsed.set(key, true);
    else { parsed.set(key, value); index += 1; }
  }
  return parsed;
}

async function loadConfig() {
  const config = await readJson(configPath());
  if (!config || config.schema !== CONFIG_SCHEMA) fail("authority_not_initialized");
  return config;
}

async function resolveProjects(config) {
  const projects = new Map();
  for (const entry of config.projects ?? []) {
    try {
      const root = await realpath(entry.root);
      projects.set(await projectIdOf(root), root);
    } catch { /* an unavailable project is simply not served */ }
  }
  return projects;
}

function sendSigned(response, key, time, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "x-decal-its-time": time,
    "x-decal-its-sig": responseSignature(key, time, status, body),
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size <= MAX_BODY_BYTES) chunks.push(chunk);
    });
    request.on("end", () => {
      if (size > MAX_BODY_BYTES) reject(Object.assign(new Error("body_too_large"), { code: "body_too_large" }));
      else resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

async function serve() {
  const config = await loadConfig();
  const host = config.host ?? "127.0.0.1";
  const port = Number(config.port ?? 8787);
  let queue = Promise.resolve();
  const serialized = (task) => {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  };
  const failures = new Map();

  const server = http.createServer(async (request, response) => {
    const route = new URL(request.url, "http://authority").pathname;
    const time = String(request.headers["x-decal-its-time"] ?? "");
    const address = request.socket.remoteAddress ?? "unknown";
    try {
      const body = await readBody(request);
      const recent = (failures.get(address) ?? []).filter((at) => Date.now() - at < MAX_SKEW_MS);
      if (recent.length >= 10) return sendSigned(response, config.key, time, 429, { status: "rejected", code: "too_many_failures" });
      const skew = Math.abs(Date.now() - Number(time));
      const signature = String(request.headers["x-decal-its-sig"] ?? "");
      if (!Number.isFinite(skew) || skew > MAX_SKEW_MS
          || !constantTimeEqual(signature, requestSignature(config.key, request.method, route, time, body))) {
        failures.set(address, [...recent, Date.now()]);
        response.writeHead(401, { "content-type": "application/json" });
        return response.end(JSON.stringify({ status: "rejected", code: "unauthorized" }));
      }
      const payload = body ? JSON.parse(body) : {};
      const projects = await resolveProjects(config);
      const root = projects.get(String(payload.projectId ?? ""));

      if (!root) return sendSigned(response, config.key, time, 404, { status: "rejected", code: "unknown_project" });
      if (request.method === "POST" && route === "/v1/health") {
        return sendSigned(response, config.key, time, 200, { status: "ok", schema: "decal.its-authority/v1" });
      }

      if (request.method === "POST" && route === "/v1/register") {
        validateIntentShape(payload.intent);
        const outcome = await serialized(async () => {
          const result = await registerLocal(root, payload.intent);
          if (!isRegistered(result)) return { result };
          const bundle = await buildBundle(root, result.commit, payload.have ?? []);
          return { result, bundle: bundle ? bundle.toString("base64") : null };
        });
        const ok = isRegistered(outcome.result);
        return sendSigned(response, config.key, time, ok ? 200 : 422, { status: ok ? "registered" : "rejected", ...outcome });
      }
      if (request.method === "POST" && route === "/v1/sync") {
        const bundle = await serialized(() => buildBundle(root, String(payload.commit ?? ""), payload.have ?? []));
        return sendSigned(response, config.key, time, 200, { status: "ok", bundle: bundle ? bundle.toString("base64") : null });
      }
      return sendSigned(response, config.key, time, 404, { status: "rejected", code: "unknown_route" });
    } catch (error) {
      const status = error.code === "body_too_large" ? 413 : 400;
      return sendSigned(response, config.key, time, status, { status: "rejected", code: error.code ?? "bad_request", detail: error.detail ?? undefined });
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(port, host, resolve); });
  const address = server.address();
  process.stdout.write(`${JSON.stringify({ status: "listening", host: address.address, port: address.port, projects: (await resolveProjects(config)).size })}\n`);
  const stop = () => server.close(() => process.exit(0));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);
  if (command === "init") {
    if (await readJson(configPath())) fail("authority_already_initialized");
    const key = newKey();
    const host = String(args.get("--host") || "127.0.0.1");
    await writePrivateJson(configPath(), { schema: CONFIG_SCHEMA, host, port: Number(args.get("--port") || 8787), key, projects: [] });
    process.stdout.write(`${JSON.stringify({ status: "initialized", host, key, note: "Copy this key to each client device now. It is not shown again." })}\n`);
  } else if (command === "add-project") {
    const config = await loadConfig();
    const root = await realpath(path.resolve(String(args.get("--root") || "")));
    const projectId = await projectIdOf(root);
    if (!config.projects.some((entry) => entry.root === root)) config.projects.push({ root });
    await writePrivateJson(configPath(), config);
    process.stdout.write(`${JSON.stringify({ status: "added", root, projectId })}\n`);
  } else if (command === "status") {
    const { key, ...safe } = await loadConfig();
    process.stdout.write(`${JSON.stringify({ status: "configured", ...safe, keyFingerprint: key.slice(0, 8) })}\n`);
  } else if (command === "serve") {
    await serve();
  } else {
    fail("usage_error", "init | add-project | serve | status");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stdout.write(`${JSON.stringify({ status: "rejected", code: error.code ?? "authority_failed", detail: error.detail ?? undefined })}\n`);
    process.exitCode = 2;
  });
}
