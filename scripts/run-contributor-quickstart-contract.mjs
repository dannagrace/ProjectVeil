import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertSupportedRuntime } from "./runtime-preflight.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

export function runContributorQuickstartContractCli(
  argv,
  deps = {
    assertSupportedRuntimeImpl: assertSupportedRuntime,
    spawnSyncImpl: spawnSync
  }
) {
  deps.assertSupportedRuntimeImpl({
    commandName: "npm run validate:quickstart:contract",
    repoRoot
  });

  const result = deps.spawnSyncImpl(
    process.execPath,
    ["--import", "tsx", "./scripts/contributor-quickstart-contract.ts", ...argv],
    {
      cwd: repoRoot,
      stdio: "inherit"
    }
  );

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runContributorQuickstartContractCli(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
