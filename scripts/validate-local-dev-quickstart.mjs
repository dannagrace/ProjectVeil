import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
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
const DEFAULT_SERVER_HOST = "127.0.0.1";
const DEFAULT_SERVER_PORT = 2567;
const QUICKSTART_ADMIN_TOKEN = process.env.VEIL_ADMIN_TOKEN?.trim() || randomUUID();
const startupTimeoutMs = 20_000;

function readPort(env, key, fallback) {
  const parsed = Number.parseInt(env[key] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function derivePort(env, base, span = 300) {
  const seed = env.VEIL_PLAYWRIGHT_WORKSPACE_SEED?.trim() || `${process.cwd()}:${process.pid}:quickstart`;
  const hash = createHash("sha1").update(seed).digest();
  const offset = ((hash[0] << 8) | hash[1]) % span;
  return base + offset;
}

function normalizeServerUrl(value, fallbackPort) {
  return value?.trim() || `http://${DEFAULT_SERVER_HOST}:${fallbackPort}`;
}

export function resolveQuickstartRuntimeTargets(env) {
  const reuseDefaultPort = env.VEIL_PLAYWRIGHT_REUSE_SERVER === "1";
  const serverPort = readPort(
    env,
    "VEIL_PLAYWRIGHT_SERVER_PORT",
    reuseDefaultPort ? DEFAULT_SERVER_PORT : derivePort(env, DEFAULT_SERVER_PORT)
  );
  return {
    serverUrl: normalizeServerUrl(env.VEIL_PLAYWRIGHT_SERVER_ORIGIN, serverPort)
  };
}

function readPortFromOrigin(origin, fallback) {
  try {
    const parsed = new URL(origin);
    return parsed.port || fallback.toString();
  } catch {
    return fallback.toString();
  }
}

const QUICKSTART_RUNTIME_TARGETS = resolveQuickstartRuntimeTargets(process.env);
const quickstartServerUrl = QUICKSTART_RUNTIME_TARGETS.serverUrl;

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
      const response = await fetch(`${quickstartServerUrl}/api/runtime/health`);
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

async function createGuestAuthHeaders() {
  const response = await fetch(`${quickstartServerUrl}/api/auth/guest-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      displayName: "Quickstart Runner",
      privacyConsentAccepted: true
    })
  });
  if (!response.ok) {
    throw new Error(`POST /api/auth/guest-login returned HTTP ${response.status}`);
  }

  const payload = await response.json();
  const token = payload?.session?.token?.trim();
  if (!token) {
    throw new Error("guest auth response is missing session.token");
  }

  return {
    Authorization: `Bearer ${token}`
  };
}

async function verifyEndpoints() {
  let guestAuthHeaders = null;
  for (const path of QUICKSTART_HEALTH_CHECKS) {
    if (path === "/api/lobby/rooms" && !guestAuthHeaders) {
      guestAuthHeaders = await createGuestAuthHeaders();
    }
    const response = await fetch(`${quickstartServerUrl}${path}`, {
      headers:
        path === "/api/runtime/auth-readiness"
          ? {
              "x-veil-admin-token": QUICKSTART_ADMIN_TOKEN
            }
          : path === "/api/lobby/rooms"
            ? guestAuthHeaders
          : undefined
    });
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
  const [unknownArg] = process.argv.slice(2);
  if (unknownArg) {
    throw new Error(`Unknown argument: ${unknownArg}`);
  }

  assertSupportedRuntime({
    commandName: "npm run validate -- quickstart",
    repoRoot: rootDirPath
  });

  logStep(`using Node ${process.version}`);
  logStep("validating e2e config fixtures");
  await runCommand(npmCommand(), ["run", "validate", "--", "e2e:fixtures"], "E2E fixture validation");
  logStep("building the H5 debug shell");
  await runCommand(npmCommand(), ["run", QUICKSTART_H5_BUILD_SCRIPT], "H5 build");

  logStep("starting the dev server without MySQL env overrides");
  logStep(`using server=${quickstartServerUrl}`);
  const envWithoutMySql = { ...process.env };
  const serverPort = readPortFromOrigin(quickstartServerUrl, DEFAULT_SERVER_PORT);
  envWithoutMySql.PORT = serverPort;
  envWithoutMySql.VEIL_ADMIN_TOKEN = envWithoutMySql.VEIL_ADMIN_TOKEN?.trim() || QUICKSTART_ADMIN_TOKEN;
  envWithoutMySql.VEIL_PLAYWRIGHT_SERVER_PORT = serverPort;
  envWithoutMySql.VEIL_PLAYWRIGHT_SERVER_ORIGIN = quickstartServerUrl;
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
