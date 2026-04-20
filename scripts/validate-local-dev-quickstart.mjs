import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assertSupportedRuntime } from "./runtime-preflight.mjs";
import { assertBaselineRuntimeHealthResponse } from "./runtime-health-contract.mjs";

const rootDir = new URL("../", import.meta.url);
const rootDirPath = fileURLToPath(rootDir);
export const QUICKSTART_DOCTOR_SCRIPT = "doctor";
export const QUICKSTART_VALIDATE_SCRIPT = "validate:quickstart";
export const QUICKSTART_H5_BUILD_SCRIPT = "build:client:h5";
export const QUICKSTART_H5_DEV_SCRIPT = "dev:client:h5";
export const QUICKSTART_SERVER_URL = "http://127.0.0.1:2567";
export const QUICKSTART_HEALTH_CHECKS = ["/api/runtime/health", "/api/runtime/auth-readiness", "/api/lobby/rooms"];
const startupTimeoutMs = 20_000;

function logStep(message) {
  process.stdout.write(`\n[quickstart] ${message}\n`);
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCommand(command, args, label, extraEnv = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit"
    });

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${label} failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`));
    });
  });
}

async function waitForServer() {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${QUICKSTART_SERVER_URL}/api/runtime/health`);
      const payload = await response.json();
      assertBaselineRuntimeHealthResponse(response.status, payload, "runtime health");
      return;
    } catch {
      // Retry until timeout while the server is booting.
    }
    await wait(500);
  }

  throw new Error(`dev server did not become healthy within ${startupTimeoutMs / 1000}s`);
}

async function verifyEndpoints() {
  for (const path of QUICKSTART_HEALTH_CHECKS) {
    const response = await fetch(`${QUICKSTART_SERVER_URL}${path}`);
    if (path === "/api/runtime/health") {
      const payload = await response.json();
      assertBaselineRuntimeHealthResponse(response.status, payload, "runtime health");
      logStep(`verified ${path}`);
      continue;
    }
    if (!response.ok) {
      throw new Error(`GET ${path} returned HTTP ${response.status}`);
    }
    logStep(`verified ${path}`);
  }
}

export async function main() {
  assertSupportedRuntime({
    commandName: "npm run validate -- quickstart",
    repoRoot: rootDirPath
  });

  logStep(`using Node ${process.version}`);
  logStep("validating e2e config fixtures");
  await runCommand(npmCommand(), ["run", "validate:e2e:fixtures"], "E2E fixture validation");
  logStep("building the H5 debug shell");
  await runCommand(npmCommand(), ["run", QUICKSTART_H5_BUILD_SCRIPT], "H5 build");

  logStep("starting the dev server without MySQL env overrides");
  const envWithoutMySql = { ...process.env };
  for (const key of Object.keys(envWithoutMySql)) {
    if (key.startsWith("VEIL_MYSQL_")) {
      delete envWithoutMySql[key];
    }
  }

  const server = spawn("node", ["--import", "tsx", "./apps/server/src/infra/dev-server.ts"], {
    cwd: rootDir,
    env: envWithoutMySql,
    stdio: "inherit"
  });

  let serverExitedEarly = false;
  server.once("exit", () => {
    serverExitedEarly = true;
  });

  try {
    await waitForServer();
    if (serverExitedEarly) {
      throw new Error("dev server exited before health checks completed");
    }
    await verifyEndpoints();
  } finally {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      wait(5_000)
    ]);
  }

  logStep("quickstart path validated");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`\n[quickstart] validation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
