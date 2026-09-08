import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { fail, safeFile } from "./version-profile.mjs";

const KINDS = {
  work: { directory: "work", prefix: "WORK" },
  bug: { directory: "bugs", prefix: "BUG" },
};

function decimal(value) {
  const normalized = value.replace(/^0+/u, "");
  return normalized || "0";
}

export function canonicalTicketId(kind, id) {
  const definition = KINDS[kind];
  if (!definition) fail("unsupported_settlement_kind");
  const match = new RegExp(`^${definition.prefix}-([0-9]+)$`, "u").exec(String(id ?? ""));
  if (!match || decimal(match[1]) === "0") fail("invalid_record_identity");
  return `${definition.prefix}-${decimal(match[1])}`;
}

export async function resolveTicketPath(root, kind, requestedId) {
  const definition = KINDS[kind];
  const canonical = canonicalTicketId(kind, requestedId);
  const directory = `docs/work-items/${definition.directory}`;
  const absoluteDirectory = path.join(root, ...directory.split("/"));
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") fail("record_not_found");
    throw error;
  }
  const matches = [];
  for (const entry of entries) {
    const match = new RegExp(`^${definition.prefix}-([0-9]+)\\.md$`, "u").exec(entry.name);
    if (!match || `${definition.prefix}-${decimal(match[1])}` !== canonical) continue;
    if (entry.isSymbolicLink() || !entry.isFile()) fail("unsafe_record_path");
    const relative = `${directory}/${entry.name}`;
    const target = await safeFile(root, relative);
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink()) fail("unsafe_record_path");
    matches.push({ id: entry.name.slice(0, -3), relative, target });
  }
  if (matches.length === 0) fail("record_not_found");
  if (matches.length !== 1) fail("duplicate_record_identity");
  return { ...matches[0], canonicalId: canonical };
}
