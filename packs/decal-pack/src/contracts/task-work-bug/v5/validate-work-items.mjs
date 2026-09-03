#!/usr/bin/env node

import path from "node:path";

import { KINDS, output, parseArgs, scanKind } from "./work-items.mjs";

const RESULT_SCHEMA = "decal.task-work-bug.work-item-validation/v5";

try {
  const args = parseArgs(process.argv);
  const root = path.resolve(String(args.get("--root") || ""));
  const kinds = {};
  let present = 0;
  for (const kind of Object.keys(KINDS)) {
    const scan = await scanKind(root, kind);
    if (scan.present) present += 1;
    kinds[kind] = { path: scan.relative, present: scan.present, count: scan.records.length, highest: scan.highest };
  }
  const authoringStatus = present === Object.keys(KINDS).length ? "ready" : "update-required";
  output(RESULT_SCHEMA, { status: "accepted", code: "accepted", authoringStatus, kinds });
} catch (error) {
  output(RESULT_SCHEMA, { status: "rejected", code: error.code || "malformed", authoringStatus: "malformed" });
  process.exitCode = 2;
}
