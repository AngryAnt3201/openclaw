import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(rootDir, "dist");
const cliDir = path.join(distDir, "cli");

const findCandidates = () =>
  fs.readdirSync(distDir).filter((entry) => {
    // Match both the primary entry (daemon-cli.js) and hash-suffixed chunks (daemon-cli-HASH.js).
    if (!entry.startsWith("daemon-cli")) {
      return false;
    }
    // tsdown can emit either .js or .mjs depending on bundler settings/runtime.
    return entry.endsWith(".js") || entry.endsWith(".mjs");
  });

// In watch mode, daemon-cli may not be built yet when this script runs.
// Retry with enough headroom for tsdown to finish all config entries.
let candidates = findCandidates();
for (let i = 0; i < 40 && candidates.length === 0; i++) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  candidates = findCandidates();
}

if (candidates.length === 0) {
  throw new Error("No daemon-cli bundle found in dist; cannot write legacy CLI shim.");
}

// Prefer the primary entry (daemon-cli.js/mjs) over hash-suffixed chunks.
const primary = candidates.find((c) => c === "daemon-cli.js" || c === "daemon-cli.mjs");
const target = primary ?? candidates.toSorted()[0];
const relPath = `../${target}`;

const contents =
  "// Legacy shim for pre-tsdown update-cli imports.\n" +
  `export { registerDaemonCli, runDaemonInstall, runDaemonRestart, runDaemonStart, runDaemonStatus, runDaemonStop, runDaemonUninstall } from "${relPath}";\n`;

fs.mkdirSync(cliDir, { recursive: true });
fs.writeFileSync(path.join(cliDir, "daemon-cli.js"), contents);
