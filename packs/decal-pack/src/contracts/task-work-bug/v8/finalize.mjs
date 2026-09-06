#!/usr/bin/env node
import path from "node:path";
import { finalizeSettlement } from "./transaction.mjs";

try {
  if (process.argv.length !== 4 || process.argv[2] !== "--root") throw new Error("usage_error");
  process.stdout.write(JSON.stringify(await finalizeSettlement(path.resolve(process.argv[3]))) + "\n");
} catch (error) {
  process.stdout.write(JSON.stringify({ status: "rejected", code: error.code ?? error.message ?? "finalize_failed" }) + "\n");
  process.exitCode = 2;
}
