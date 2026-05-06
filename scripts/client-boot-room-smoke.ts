import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { Client, type Room } from "@colyseus/sdk";
import type { ClientMessage, ServerMessage, SessionStatePayload } from "../packages/shared/src/index.ts";
import { assertBaselineRuntimeHealthResponse } from "./runtime-health-contract.mjs";

const FIXTURE_COMMAND = ["run", "validate", "--", "e2e:fixtures"] as const;
const DEFAULT_SERVER_HOST = "127.0.0.1";
const DEFAULT_CLIENT_HOST = "127.0.0.1";
const DEFAULT_SERVER_PORT = 2567;
const DEFAULT_CLIENT_PORT = 4173;
const STARTUP_TIMEOUT_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const LOG_TAIL_LIMIT = 80;
const ADMIN_TOKEN = process.env.VEIL_ADMIN_TOKEN?.trim() || randomUUID();

export interface SmokeRuntimeTargets {
  serverUrl: string;
  clientUrl: string;
  serverWsUrl: string;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

function readPort(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const parsed = Number.parseInt(env[key] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function derivePort(env: NodeJS.ProcessEnv, base: number, span = 300): number {
  const seed = env.VEIL_PLAYWRIGHT_WORKSPACE_SEED?.trim() || `${process.cwd()}:${process.pid}:client-boot-room-smoke`;
  const hash = createHash("sha1").update(seed).digest();
  const offset = ((hash[0] << 8) | hash[1]) % span;
  return base + offset;
}

function normalizeOrigin(
  value: string | undefined,
  fallbackHost: string,
  fallbackPort: number,
  protocol: "http" | "ws"
): string {
  return value?.trim() || `${protocol}://${fallbackHost}:${fallbackPort}`;
}

export function resolveSmokeRuntimeTargets(env: NodeJS.ProcessEnv): SmokeRuntimeTargets {
  const reuseDefaultPorts = env.VEIL_PLAYWRIGHT_REUSE_SERVER === "1";
  const serverPort = readPort(
    env,
    "VEIL_PLAYWRIGHT_SERVER_PORT",
    reuseDefaultPorts ? DEFAULT_SERVER_PORT : derivePort(env, DEFAULT_SERVER_PORT)
  );
  const clientPort = readPort(
    env,
    "VEIL_PLAYWRIGHT_CLIENT_PORT",
    reuseDefaultPorts ? DEFAULT_CLIENT_PORT : derivePort(env, DEFAULT_CLIENT_PORT)
  );

  return {
    serverUrl: normalizeOrigin(env.VEIL_PLAYWRIGHT_SERVER_ORIGIN, DEFAULT_SERVER_HOST, serverPort, "http"),
    clientUrl: normalizeOrigin(env.VEIL_PLAYWRIGHT_CLIENT_ORIGIN, DEFAULT_CLIENT_HOST, clientPort, "http"),
    serverWsUrl: normalizeOrigin(env.VEIL_PLAYWRIGHT_SERVER_WS_URL, DEFAULT_SERVER_HOST, serverPort, "ws")
  };
}

const SMOKE_RUNTIME_TARGETS = resolveSmokeRuntimeTargets(process.env);
const { serverUrl: SERVER_URL, clientUrl: CLIENT_URL, serverWsUrl: SERVER_WS_URL } = SMOKE_RUNTIME_TARGETS;

interface GuestAuthPayload {
  session?: {
    playerId?: string | null;
    displayName?: string | null;
    token?: string | null;
  } | null;
}

export interface SmokeGuestAuthContext {
  headers: Record<string, string>;
  token: string;
  playerId: string;
  displayName: string;
}

interface HttpJsonResponse<T> {
  status: number;
  body: T;
}

interface LobbyRoomsPayload {
  items?: Array<{
    roomId?: string;
    connectedPlayers?: number;
  }>;
}

interface RuntimeStatusPayload {
  status?: string;
}

interface RunningProcess {
  child: ChildProcess;
  label: string;
  logTail: string[];
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function logStep(message: string): void {
  process.stdout.write(`[smoke:client:boot-room] ${message}\n`);
}

function appendLogLine(lines: string[], chunk: string | Buffer): void {
  const text = String(chunk);
  const nextLines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  lines.push(...nextLines);
  if (lines.length > LOG_TAIL_LIMIT) {
    lines.splice(0, lines.length - LOG_TAIL_LIMIT);
  }
}

function formatLogTail(processes: RunningProcess[]): string {
  const sections = processes
    .map(({ label, logTail }) => {
      if (logTail.length === 0) {
        return `${label}: <no output captured>`;
      }
      return `${label}:\n${logTail.join("\n")}`;
    })
    .join("\n\n");
  return sections ? `\n\nCaptured process output:\n${sections}` : "";
}

function readPortFromOrigin(origin: string, fallback: number): string {
  try {
    const parsed = new URL(origin);
    return parsed.port || fallback.toString();
  } catch {
    return fallback.toString();
  }
}

function createManagedProcessEnv(): NodeJS.ProcessEnv {
  const serverPort = readPortFromOrigin(SERVER_URL, DEFAULT_SERVER_PORT);
  const clientPort = readPortFromOrigin(CLIENT_URL, DEFAULT_CLIENT_PORT);
  return {
    ...process.env,
    ADMIN_SECRET: process.env.ADMIN_SECRET?.trim() || ADMIN_TOKEN,
    PORT: serverPort,
    VEIL_ADMIN_TOKEN: ADMIN_TOKEN,
    VEIL_PLAYWRIGHT_SERVER_PORT: serverPort,
    VEIL_PLAYWRIGHT_CLIENT_PORT: clientPort,
    VEIL_PLAYWRIGHT_SERVER_ORIGIN: SERVER_URL,
    VEIL_PLAYWRIGHT_CLIENT_ORIGIN: CLIENT_URL,
    VEIL_PLAYWRIGHT_SERVER_WS_URL: SERVER_WS_URL,
    VEIL_DEV_SERVER_HTTP_URL: SERVER_URL,
    VITE_VEIL_SERVER_HTTP_URL: SERVER_URL,
    VITE_VEIL_SERVER_WS_URL: SERVER_WS_URL
  };
}

function runBlockingStep(label: string, args: readonly string[]): void {
  logStep(label);
  const result = spawnSync(npmCommand(), [...args], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: process.env
  });
  if (result.status === 0) {
    return;
  }
  throw new Error(`${label} failed with exit code ${result.status ?? 1}`);
}

function spawnManagedProcess(label: string, args: readonly string[]): RunningProcess {
  const child = spawn(npmCommand(), [...args], {
    cwd: process.cwd(),
    env: createManagedProcessEnv(),
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"]
  });
  const logTail: string[] = [];
  child.stdout?.on("data", (chunk) => appendLogLine(logTail, chunk));
  child.stderr?.on("data", (chunk) => appendLogLine(logTail, chunk));
  return { child, label, logTail };
}

export function resolveManagedProcessSignalTarget(
  pid: number,
  platform: NodeJS.Platform = process.platform
): number {
  return platform === "win32" ? pid : -pid;
}

function signalManagedProcess(processRef: RunningProcess, signal: NodeJS.Signals): void {
  const pid = processRef.child.pid;
  if (pid == null) {
    processRef.child.kill(signal);
    return;
  }

  const target = resolveManagedProcessSignalTarget(pid);
  try {
    process.kill(target, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      processRef.child.kill(signal);
    }
  }
}

async function stopManagedProcess(processRef: RunningProcess): Promise<void> {
  if (processRef.child.exitCode != null || processRef.child.signalCode != null) {
    return;
  }
  signalManagedProcess(processRef, "SIGTERM");
  const exited = await Promise.race([
    new Promise<void>((resolve) => processRef.child.once("exit", () => resolve())),
    delay(5_000).then(() => "timeout" as const)
  ]);
  if (exited === "timeout") {
    signalManagedProcess(processRef, "SIGKILL");
    await Promise.race([
      new Promise<void>((resolve) => processRef.child.once("exit", () => resolve())),
      delay(1_000).then(() => undefined)
    ]);
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} returned HTTP ${response.status}`);
  }
  return await response.text();
}

async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<HttpJsonResponse<T>> {
  const response = await fetch(url, headers ? { headers } : undefined);
  if (!response.ok) {
    throw new Error(`GET ${url} returned HTTP ${response.status}`);
  }
  return {
    status: response.status,
    body: (await response.json()) as T
  };
}

export async function createSmokeGuestAuthContext(
  fetchImpl: FetchLike = fetch,
  targets: SmokeRuntimeTargets = SMOKE_RUNTIME_TARGETS
): Promise<SmokeGuestAuthContext> {
  const url = `${targets.serverUrl}/api/auth/guest-login`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      displayName: "Smoke Runner",
      privacyConsentAccepted: true
    })
  });
  if (!response.ok) {
    throw new Error(`POST ${url} returned HTTP ${response.status}`);
  }

  const payload = (await response.json()) as GuestAuthPayload;
  const playerId = payload.session?.playerId?.trim();
  const token = payload.session?.token?.trim();
  const displayName = payload.session?.displayName?.trim() || "Smoke Runner";
  if (!playerId) {
    throw new Error("guest auth response is missing session.playerId");
  }
  if (!token) {
    throw new Error("guest auth response is missing session.token");
  }

  return {
    headers: {
      Authorization: `Bearer ${token}`
    },
    token,
    playerId,
    displayName
  };
}

export async function createSmokeGuestAuthHeaders(
  fetchImpl: FetchLike = fetch,
  targets: SmokeRuntimeTargets = SMOKE_RUNTIME_TARGETS
): Promise<Record<string, string>> {
  return (await createSmokeGuestAuthContext(fetchImpl, targets)).headers;
}

async function fetchRuntimeHealth(url: string, label: string): Promise<HttpJsonResponse<RuntimeStatusPayload>> {
  const response = await fetch(url);
  const body = (await response.json()) as RuntimeStatusPayload;
  assertBaselineRuntimeHealthResponse(response.status, body, label);
  return {
    status: response.status,
    body
  };
}

async function waitFor(check: () => Promise<void>, description: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;

  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError ?? "unknown error");
  throw new Error(`${description} did not become ready within ${timeoutMs / 1000}s: ${reason}`);
}

async function verifyClientBoot(authHeaders: Record<string, string>): Promise<void> {
  await waitFor(
    async () => {
      const html = await fetchText(`${CLIENT_URL}/`);
      if (!html.includes('<div id="app"></div>') || !html.includes('/src/main-browser.ts')) {
        throw new Error("client root html is missing the app shell or entry module");
      }
    },
    "client root",
    STARTUP_TIMEOUT_MS
  );

  const entryModule = await fetchText(`${CLIENT_URL}/src/main-browser.ts`);
  if (!entryModule.includes("main.ts")) {
    throw new Error("client entry module did not load expected bootstrap content");
  }

  await fetchRuntimeHealth(`${CLIENT_URL}/api/runtime/health`, "client-proxied runtime health");

  const authReadiness = await fetchJson<RuntimeStatusPayload>(`${CLIENT_URL}/api/runtime/auth-readiness`, {
    "x-veil-admin-token": ADMIN_TOKEN
  });
  if (authReadiness.body.status !== "ok") {
    throw new Error(`client-proxied auth readiness is ${JSON.stringify(authReadiness.body)}`);
  }

  const lobbyRooms = await fetchJson<LobbyRoomsPayload>(`${CLIENT_URL}/api/lobby/rooms`, authHeaders);
  if (!Array.isArray(lobbyRooms.body.items)) {
    throw new Error("client-proxied lobby rooms payload is missing items[]");
  }
}

async function waitForServerReadiness(): Promise<void> {
  await waitFor(
    async () => {
      await fetchRuntimeHealth(`${SERVER_URL}/api/runtime/health`, "server runtime health");
    },
    "server runtime health",
    STARTUP_TIMEOUT_MS
  );

  const authReadiness = await fetchJson<RuntimeStatusPayload>(`${SERVER_URL}/api/runtime/auth-readiness`, {
    "x-veil-admin-token": ADMIN_TOKEN
  });
  if (authReadiness.body.status !== "ok") {
    throw new Error(`runtime auth-readiness is ${JSON.stringify(authReadiness.body)}`);
  }
}

async function waitForMessage<T extends ServerMessage["type"]>(
  room: Room,
  expectedType: T,
  requestId: string
): Promise<Extract<ServerMessage, { type: T }>> {
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`timed out waiting for ${expectedType}/${requestId}`));
    }, REQUEST_TIMEOUT_MS);

    room.onMessage(expectedType, (message: Extract<ServerMessage, { type: T }>) => {
      if (message.requestId !== requestId) {
        return;
      }
      clearTimeout(timeout);
      resolve(message);
    });

    room.onMessage("error", (message: Extract<ServerMessage, { type: "error" }>) => {
      if (message.requestId !== requestId) {
        return;
      }
      clearTimeout(timeout);
      reject(new Error(`room responded with ${message.reason}`));
    });
  });
}

async function verifyRoomJoin(authContext: SmokeGuestAuthContext): Promise<void> {
  const roomId = `client-boot-room-smoke-${Date.now()}`;
  const playerId = authContext.playerId;
  const requestId = randomUUID();
  const client = new Client(SERVER_WS_URL);
  const room = await client.joinOrCreate("veil", {
    logicalRoomId: roomId,
    playerId,
    authToken: authContext.token,
    seed: 1001
  });

  try {
    const responsePromise = waitForMessage(room, "session.state", requestId);
    const connectMessage: Extract<ClientMessage, { type: "connect" }> = {
      type: "connect",
      requestId,
      roomId,
      playerId,
      authToken: authContext.token,
      displayName: authContext.displayName
    };
    room.send("connect", connectMessage);

    const response = await responsePromise;
    const payload = response.payload as SessionStatePayload;
    if (payload.world.meta.roomId !== roomId) {
      throw new Error(`joined room ${payload.world.meta.roomId ?? "<missing>"} instead of ${roomId}`);
    }
    if (!payload.world.ownHeroes.some((hero) => hero.playerId === playerId)) {
      throw new Error(`joined room payload is missing own hero for ${playerId}`);
    }

    await waitFor(
      async () => {
        const lobbyRooms = await fetchJson<LobbyRoomsPayload>(`${SERVER_URL}/api/lobby/rooms`, authContext.headers);
        const summary = lobbyRooms.body.items?.find((item) => item.roomId === roomId);
        if (!summary) {
          throw new Error("joined room is not visible in lobby summary");
        }
        if ((summary.connectedPlayers ?? 0) < 1) {
          throw new Error(`joined room reported connectedPlayers=${summary.connectedPlayers ?? 0}`);
        }
      },
      "joined room lobby summary",
      REQUEST_TIMEOUT_MS
    );
  } finally {
    await room.leave(true).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const [unknownArg] = process.argv.slice(2);
  if (unknownArg) {
    throw new Error(`Unknown argument: ${unknownArg}`);
  }

  const startedAt = Date.now();
  runBlockingStep("validating e2e fixtures", FIXTURE_COMMAND);
  logStep(`using server=${SERVER_URL} client=${CLIENT_URL}`);

  const processes = [
    spawnManagedProcess("dev -- server", ["run", "dev", "--", "server"]),
    spawnManagedProcess("dev -- client:h5", ["run", "dev", "--", "client:h5"])
  ];

  try {
    logStep("waiting for server readiness");
    await waitForServerReadiness();
    logStep("creating guest auth session");
    const authContext = await createSmokeGuestAuthContext();
    logStep("verifying client boot surface");
    await verifyClientBoot(authContext.headers);
    logStep("verifying room join flow");
    await verifyRoomJoin(authContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}${formatLogTail(processes)}`);
  } finally {
    await Promise.all(processes.map((processRef) => stopManagedProcess(processRef)));
  }

  const durationSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  logStep(`passed in ${durationSeconds}s`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[smoke:client:boot-room] failed: ${message}\n`);
    process.exitCode = 1;
  });
}
