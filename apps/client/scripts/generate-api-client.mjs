#!/usr/bin/env node
/**
 * Generates src/api/generated from the backend's swagger.json, and skips
 * quietly when it cannot.
 *
 * It runs on postinstall so a fresh clone compiles: the directory is gitignored
 * and nothing else produces it (#51). But `pnpm install` also runs in places
 * that only need this package's manifest to resolve the workspace graph — the
 * backend Docker image copies apps/client/package.json and nothing else. There,
 * openapi-ts has neither its config nor its input and dies with a cryptic
 * "Cannot read properties of undefined (reading 'importFileExtension')",
 * failing an image build that never wanted the client SDK in the first place.
 *
 * So: generate when the inputs are there, skip with a reason when they are not.
 * Never fail an install that was not about the client.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = resolve(clientRoot, "openapi-ts.config.ts");
const swagger = resolve(clientRoot, "..", "backend", "swagger.json");

const missing = [
  !existsSync(config) && "openapi-ts.config.ts",
  !existsSync(swagger) && "../backend/swagger.json",
].filter(Boolean);

if (missing.length > 0) {
  console.log(
    `[api-client] skipped — ${missing.join(" and ")} not in this install context.`,
  );
  process.exit(0);
}

const result = spawnSync("openapi-ts", [], {
  cwd: clientRoot,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
