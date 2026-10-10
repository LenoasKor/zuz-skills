import { readFile } from "node:fs/promises";
import { digest, fail, safeFile } from "../v9/version-profile.mjs";
import { parseStrictJson } from "../v9/strict-json.mjs";

export const MODE_PATH = "config/its-settlement.json";
export const MODE_SCHEMA = "decal.its-settlement-mode/v1";
export const MODES = Object.freeze(["release", "per-ticket"]);

// The settlement profile keeps naming version sources (v9 schema, read by v11-v13 too).
// This separate committed file only chooses when versions are applied. A project without it
// keeps the published per-ticket settlement.
export async function readSettlementMode(root) {
  let target;
  try {
    target = await safeFile(root, MODE_PATH);
  } catch (error) {
    if (error?.code === "ENOENT") return { mode: "per-ticket", read: null };
    throw error;
  }
  const source = await readFile(target, "utf8");
  const value = parseStrictJson(source);
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["mode", "schema"])
      || value.schema !== MODE_SCHEMA || !MODES.includes(value.mode)) fail("invalid_settlement_mode");
  return { mode: value.mode, read: { path: MODE_PATH, before: digest(source) } };
}
