#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";

const args = process.argv.slice(2);
const env = { ...process.env };
const cwd = process.cwd();
const compiler = "tsdown";
const entryFile = resolve(cwd, "dist/entry.js");

// Run pre-build steps that tsdown --watch won't handle
for (const script of ["canvas:a2ui:bundle"]) {
  const r = spawnSync("pnpm", ["run", script], { cwd, env, stdio: "inherit" });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

// Do a one-shot build first — tsdown --watch hangs on initial build with multiple configs.
console.log("[watch] running initial tsdown build...");
const initialBuild = spawnSync("pnpm", ["exec", compiler], { cwd, env, stdio: "inherit" });
if (initialBuild.status !== 0) {
  console.error("[watch] initial tsdown build failed");
  process.exit(initialBuild.status ?? 1);
}

// Run post-build scripts
const postScripts = [
  ["pnpm", ["run", "build:plugin-sdk:dts"]],
  ["node", ["--import", "tsx", "scripts/write-plugin-sdk-entry-dts.ts"]],
  ["node", ["--import", "tsx", "scripts/canvas-a2ui-copy.ts"]],
  ["node", ["--import", "tsx", "scripts/copy-hook-metadata.ts"]],
  ["node", ["--import", "tsx", "scripts/write-build-info.ts"]],
  ["node", ["--import", "tsx", "scripts/write-cli-compat.ts"]],
];

for (const [cmd, cmdArgs] of postScripts) {
  const r = spawnSync(cmd, cmdArgs, { cwd, env, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[watch] post-build failed: ${cmd} ${cmdArgs.join(" ")}`);
  }
}

// Start gateway
console.log("[watch] initial build complete — starting gateway");
let gatewayProcess = null;
startGateway();

// Start tsdown --watch in the background for incremental rebuilds on source changes.
const compilerProcess = spawn("pnpm", ["exec", compiler, "--watch", "--no-clean"], {
  cwd,
  env,
  stdio: "inherit",
});

// Watch dist/entry.js for subsequent rebuilds — debounce restart
let restartTimer = null;
watch(entryFile, () => {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    console.log("[watch] rebuild detected — restarting gateway");
    if (gatewayProcess) {
      gatewayProcess.once("exit", () => startGateway());
      gatewayProcess.kill("SIGTERM");
    } else {
      startGateway();
    }
  }, 1000);
});

// --- helpers ---

function startGateway() {
  gatewayProcess = spawn(process.execPath, ["openclaw.mjs", ...args], {
    cwd,
    env,
    stdio: "inherit",
  });
  gatewayProcess.on("exit", (code, signal) => {
    gatewayProcess = null;
    if (signal || exiting) {
      return;
    }
    console.error(`[watch] gateway exited with code ${code}`);
  });
}

// --- cleanup ---
let exiting = false;

function cleanup(code = 0) {
  if (exiting) {
    return;
  }
  exiting = true;
  clearTimeout(restartTimer);
  if (gatewayProcess) {
    gatewayProcess.kill("SIGTERM");
  }
  compilerProcess.kill("SIGTERM");
  process.exit(code);
}

process.on("SIGINT", () => cleanup(130));
process.on("SIGTERM", () => cleanup(143));

compilerProcess.on("exit", (code) => {
  if (exiting) {
    return;
  }
  cleanup(code ?? 1);
});
