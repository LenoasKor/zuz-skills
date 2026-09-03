#!/usr/bin/env node

import path from "node:path";
import { validateProject } from "./registry.mjs";

function result(status, code, line = null, taskCount = 0, authoringStatus = "unavailable") {
  return { schema: "decal.task-work-bug.registry-validation/v4", status, code, line, taskCount, authoringStatus };
}

const rootFlag = process.argv.indexOf("--root");
if (rootFlag < 0 || !process.argv[rootFlag + 1]) {
  process.stderr.write("usage: validate-task-index.mjs --root <project-root>\n");
  process.exitCode = 1;
} else {
  try {
    const modeFlag = process.argv.indexOf("--mode");
    const mode = modeFlag < 0 ? "writer" : process.argv[modeFlag + 1];
    if (!new Set(["writer", "consumer-read-only"]).has(mode)) throw Object.assign(new Error("invalid_mode"), { code: "invalid_mode" });
    const project = await validateProject(path.resolve(process.argv[rootFlag + 1]), mode);
    process.stdout.write(`${JSON.stringify(result(
      "accepted",
      "accepted",
      null,
      project.index.records.length,
      mode === "writer" ? "ready" : "reader-only",
    ))}\n`);
  } catch (error) {
    const code = error.code === "ENOENT" ? "contract_unavailable" : (error.code || "registry_read_error");
    process.stdout.write(`${JSON.stringify(result("malformed", code, error.line ?? null))}\n`);
    process.exitCode = 2;
  }
}
