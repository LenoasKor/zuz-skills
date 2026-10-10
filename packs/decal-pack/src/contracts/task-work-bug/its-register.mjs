#!/usr/bin/env node
// Stable entry for zuz ITS registration. Skills and agents call this file, never a numbered contract.
//   node contracts/task-work-bug/its-register.mjs --kind task|ticket --root . --intent FILE --dry-run
//   node contracts/task-work-bug/its-register.mjs --kind task|ticket --root . --intent FILE --approved-digest DIGEST --write
// The entry looks up the capability in capabilities.json, verifies that contract's own manifest, and only then runs it.
// A project paired with a number authority on the local network is always routed to the authority; if that route is
// unavailable the entry stops instead of registering locally, because a local number could collide with another device.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RESULT_SCHEMA = "decal.task-work-bug.its-register/v1";
const TABLE_SCHEMA = "decal.task-work-bug.capabilities/v1";
const here = realpathSync(path.dirname(fileURLToPath(import.meta.url)));

function stop(code, extra = {}) {
  process.stdout.write(`${JSON.stringify({ schema: RESULT_SCHEMA, status: "rejected", code, ...extra })}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const parsed = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--") || parsed.has(key)) stop("usage_error");
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) parsed.set(key, true);
    else { parsed.set(key, value); index += 1; }
  }
  return parsed;
}

function plainFile(file, limit) {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) stop("unsafe_contract_path");
  return readFileSync(file, "utf8");
}

function loadTable() {
  let table;
  try { table = JSON.parse(plainFile(path.join(here, "capabilities.json"), 65536)); } catch { return stop("capability_table_unavailable"); }
  if (table?.schema !== TABLE_SCHEMA || !table.capabilities || typeof table.capabilities !== "object") stop("invalid_capability_table");
  for (const [name, item] of Object.entries(table.capabilities)) {
    if (!/^[a-z][a-z0-9-]*$/u.test(name) || !/^v[0-9]{1,3}$/u.test(item?.contract ?? "") || !/^[a-z0-9][a-z0-9-]*\.mjs$/u.test(item?.entry ?? "")) {
      stop("invalid_capability_table", { capability: name });
    }
  }
  return table.capabilities;
}

/** Returns the script of a listed capability after its contract verified; never anything that is not listed. */
function resolve(table, capability, code = "authoring_update_required") {
  const item = Object.hasOwn(table, capability) ? table[capability] : null;
  if (!item) return stop(code, { capability, reason: "capability_not_advertised" });
  const directory = path.join(here, item.contract);
  const verifier = path.join(directory, "verify-contract.mjs");
  const script = path.join(directory, item.entry);
  let real;
  try { real = realpathSync(script); realpathSync(verifier); } catch { return stop(code, { capability, contract: item.contract, reason: "contract_not_installed" }); }
  if (!real.startsWith(`${here}${path.sep}`)) stop(code, { capability, contract: item.contract, reason: "unsafe_contract_path" });
  const check = spawnSync(process.execPath, [verifier], { encoding: "utf8" });
  let verdict = null;
  try { verdict = JSON.parse(String(check.stdout).trim().split("\n").pop()); } catch { /* reported below */ }
  if (verdict?.status !== "accepted") {
    return stop(code, { capability, contract: item.contract, reason: verdict?.code ?? "contract_verification_failed" });
  }
  return real;
}

const args = parseArgs(process.argv.slice(2));
const kind = args.get("--kind");
const intentFile = args.get("--intent");
const dryRun = args.has("--dry-run");
const write = args.has("--write");
if (!["task", "ticket"].includes(kind) || typeof intentFile !== "string" || dryRun === write) stop("usage_error");
const root = path.resolve(String(args.get("--root") || "."));

let intent;
try { intent = JSON.parse(readFileSync(path.resolve(intentFile), "utf8")); } catch { stop("invalid_intent"); }

// Hosts that ship the reading-context contract get its body check; others simply skip it.
const contextModule = path.join(here, "..", "its-reading-context", "v1", "context.mjs");
if (existsSync(contextModule)) {
  try {
    const { requireContext } = await import(pathToFileURL(contextModule).href);
    for (const item of kind === "task" ? intent.tasks ?? [] : [intent]) requireContext(item.body);
  } catch (error) { stop(error?.message || "invalid_context"); }
}

const capability = kind === "task" ? "register-task-batch" : intent.kind === "incident" ? "register-incident" : "register-ticket";
const table = loadTable();
const broker = resolve(table, capability);
const paired = existsSync(path.join(root, ".decal", "its-lan-client.json"));

if (write && paired) {
  const digest = args.get("--approved-digest");
  if (typeof digest !== "string") stop("usage_error", { reason: "approved_digest_required" });
  // resolve() ends the process on failure, so a client that is missing or fails verification never falls back to a local number.
  const client = resolve(table, "register-via-authority", "authority_client_unavailable");
  const delegated = spawnSync(process.execPath, [client, "register", "--root", root, "--intent", path.resolve(intentFile), "--approved-digest", digest], { encoding: "utf8" });
  const line = String(delegated.stdout ?? "").trim().split("\n").pop();
  let outcome = null;
  try { outcome = JSON.parse(line); } catch { /* reported below */ }
  if (outcome?.status === "registered" && outcome.receipt) {
    process.stdout.write(`${JSON.stringify({ ...outcome.receipt, delegatedTo: "its-authority", sync: outcome.sync })}\n`);
  } else {
    process.stdout.write(`${line || JSON.stringify({ schema: RESULT_SCHEMA, status: "rejected", code: "authority_delegation_failed" })}\n`);
  }
  process.exit(delegated.status ?? 1);
}

const forwarded = [];
for (const [key, value] of args) {
  if (key === "--kind") continue;
  forwarded.push(key);
  if (value !== true) forwarded.push(String(value));
}
const result = spawnSync(process.execPath, [broker, ...forwarded], { stdio: "inherit" });
process.exit(result.status ?? 1);
