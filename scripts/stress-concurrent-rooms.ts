import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import os from "node:os";
import util from "node:util";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import {
  decodePlayerWorldView,
  pickAutomatedBattleAction,
  type BattleAction,
  type BattleState,
  type ClientMessage,
  type PlayerWorldView,
  type ServerMessage,
  type SessionStatePayload,
  type Vec2
} from "../packages/shared/src/index";
import {
  configureRoomSnapshotStore,
  getActiveRoomInstances,
  resetLobbyRoomRegistry,
  VeilColyseusRoom
} from "../apps/server/src/colyseus-room";
import { createMemoryRoomSnapshotStore } from "../apps/server/src/memory-room-snapshot-store";
import { registerRuntimeObservabilityRoutes, resetRuntimeObservability } from "../apps/server/src/observability";
import type { RoomSnapshotStore } from "../apps/server/src/persistence";
import type { RoomPersistenceSnapshot } from "../apps/server/src/index";

type ScenarioName = "world_progression" | "battle_settlement" | "reconnect" | "reconnect_soak";

interface StressOptions {
  rooms: number;
  port: number;
  host: string;
  sampleIntervalMs: number;
  connectConcurrency: number;
  actionConcurrency: number;
  reconnectPauseMs: number;
  maxBattleTurns: number;
  reconnectCycles: number;
  artifactPath: string;
  scenarios: ScenarioName[];
}

interface GitRevision {
  commit: string;
  shortCommit: string;
  branch: string;
  dirty: boolean;
}

interface RoomContext {
  index: number;
  roomId: string;
  playerId: string;
  room: ColyseusRoom;
  payload: SessionStatePayload;
}

interface ScenarioResult {
  scenario: ScenarioName;
  rooms: number;
  successfulRooms: number;
  failedRooms: number;
  completedActions: number;
  durationMs: number;
  roomsPerSecond: number;
  actionsPerSecond: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  cpuTotalMs: number;
  cpuCoreUtilizationPct: number;
  rssStartMb: number;
  rssPeakMb: number;
  rssEndMb: number;
  heapStartMb: number;
  heapPeakMb: number;
  heapEndMb: number;
  peakActiveHandles: number;
  runtimeHealthAfterConnect?: RuntimeHealthSummary;
  runtimeHealthAfterScenario?: RuntimeHealthSummary;
  runtimeHealthAfterCleanup?: RuntimeHealthSummary;
  soakSummary?: ReconnectSoakSummary;
  errorMessage?: string;
}

interface ReconnectSoakSummary {
  reconnectCycles: number;
  reconnectAttempts: number;
  invariantChecks: number;
  worldReconnectCycles: number;
  battleReconnectCycles: number;
  finalBattleRooms: number;
  finalDayRange: {
    min: number;
    max: number;
  };
  sampleRoomStates: Array<{
    roomId: string;
    playerId: string;
    day: number;
    inBattle: boolean;
    heroPosition: Vec2 | null;
    visibleTiles: number;
  }>;
}

interface ResourceSnapshot {
  rssBytes: number;
  heapUsedBytes: number;
  activeHandles: number;
}

interface ResourceReport extends ResourceSnapshot {
  durationMs: number;
  cpuUserMs: number;
  cpuSystemMs: number;
  cpuTotalMs: number;
  cpuCoreUtilizationPct: number;
  rssStartMb: number;
  rssPeakMb: number;
  rssEndMb: number;
  heapStartMb: number;
  heapPeakMb: number;
  heapEndMb: number;
  peakActiveHandles: number;
}

interface RuntimeHealthSummary {
  checkedAt: string;
  activeRoomCount: number;
  connectionCount: number;
  activeBattleCount: number;
  heroCount: number;
  connectMessagesTotal: number;
  worldActionsTotal: number;
  battleActionsTotal: number;
  actionMessagesTotal: number;
}

interface StressArtifact {
  schemaVersion: 1;
  artifactType: "stress-runtime-metrics";
  generatedAt: string;
  command: string;
  revision: GitRevision;
  status: "passed" | "failed";
  options: StressOptions;
  summary: {
    totalScenarios: number;
    failedScenarios: number;
    scenarioNames: ScenarioName[];
  };
  soakSummary: ReconnectSoakSummary | null;
  results: ScenarioResult[];
}

const DEFAULT_BATTLE_DESTINATION: Vec2 = { x: 5, y: 4 };
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_ROOM_PLAYER_ID = "player-1";
const STRESS_ROOM_VARIANTS = ["phase1", "frontier_basin", "contested_basin"] as const;
const COLYSEUS_RECONNECT_MIN_UPTIME_LOG = "[Colyseus reconnection]: ❌ Room has not been up for long enough for automatic reconnection.";
const DEFAULT_RECONNECT_SOAK_ARTIFACT_PATH = path.resolve("artifacts", "release-readiness", "colyseus-reconnect-soak-summary.json");
const DEFAULT_STRESS_ARTIFACT_PATH = path.resolve("artifacts", "release-readiness", "stress-rooms-runtime-metrics.json");

let requestCounter = 0;

function nextRequestId(prefix: string): string {
  requestCounter += 1;
  return `${prefix}-${requestCounter}`;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function activeHandleCount(): number {
  const handles = (process as NodeJS.Process & {
    _getActiveHandles?: () => unknown[];
  })._getActiveHandles?.();
  return handles?.length ?? 0;
}

function toMegabytes(bytes: number): number {
  return Number((bytes / (1024 * 1024)).toFixed(2));
}

function parseIntegerFlag(name: string, fallback: number): number {
  const inlineArgument = process.argv.findLast((item) => item.startsWith(`--${name}=`));
  const argumentIndex = process.argv.lastIndexOf(`--${name}`);
  if (!inlineArgument && argumentIndex === -1) {
    return fallback;
  }

  const rawValue = inlineArgument
    ? inlineArgument.slice(name.length + 3)
    : process.argv[argumentIndex + 1];
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }

  return value;
}

function parseStringFlag(name: string, fallback: string): string {
  const inlineArgument = process.argv.findLast((item) => item.startsWith(`--${name}=`));
  const argumentIndex = process.argv.lastIndexOf(`--${name}`);
  if (!inlineArgument && argumentIndex === -1) {
    return fallback;
  }

  const value = (inlineArgument
    ? inlineArgument.slice(name.length + 3)
    : process.argv[argumentIndex + 1] ?? "").trim();
  if (!value) {
    throw new Error(`--${name} must not be empty`);
  }

  return value;
}

function parseScenarioFlag(): ScenarioName[] {
  const argument = process.argv.findLast((item) => item.startsWith("--scenarios="));
  if (!argument) {
    return ["world_progression", "battle_settlement", "reconnect"];
  }

  const requested = argument
    .slice("--scenarios=".length)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const knownScenarios: ScenarioName[] = ["world_progression", "battle_settlement", "reconnect", "reconnect_soak"];
  const invalid = requested.filter((item) => !knownScenarios.includes(item as ScenarioName));
  if (invalid.length > 0) {
    throw new Error(`Unknown scenarios: ${invalid.join(", ")}`);
  }

  return requested as ScenarioName[];
}

function parseStressOptions(): StressOptions {
  const scenarios = parseScenarioFlag();
  const defaultArtifactPath = scenarios.includes("reconnect_soak")
    ? DEFAULT_RECONNECT_SOAK_ARTIFACT_PATH
    : DEFAULT_STRESS_ARTIFACT_PATH;
  return {
    rooms: parseIntegerFlag("rooms", 120),
    port: parseIntegerFlag("port", 39000 + Math.floor(Math.random() * 1000)),
    host: DEFAULT_HOST,
    sampleIntervalMs: parseIntegerFlag("sample-interval-ms", 200),
    connectConcurrency: parseIntegerFlag("connect-concurrency", 24),
    actionConcurrency: parseIntegerFlag("action-concurrency", 24),
    reconnectPauseMs: parseIntegerFlag("reconnect-pause-ms", 100),
    maxBattleTurns: parseIntegerFlag("max-battle-turns", 24),
    reconnectCycles: parseIntegerFlag("reconnect-cycles", 6),
    artifactPath: path.resolve(parseStringFlag("artifact-path", defaultArtifactPath)),
    scenarios
  };
}

function readGitRevision(): GitRevision {
  const command = spawnSync("git", ["rev-parse", "HEAD", "--abbrev-ref", "HEAD"], {
    encoding: "utf8"
  });
  const status = spawnSync("git", ["status", "--short"], {
    encoding: "utf8"
  });

  if (command.status !== 0 || !command.stdout.trim()) {
    return {
      commit: "unknown",
      shortCommit: "unknown",
      branch: "unknown",
      dirty: false
    };
  }

  const [commit, branch] = command.stdout
    .trim()
    .split("\n")
    .map((value) => value.trim());

  return {
    commit,
    shortCommit: commit.slice(0, 7),
    branch,
    dirty: Boolean(status.stdout.trim())
  };
}

function buildCommandString(): string {
  return ["node", "--import", "tsx", "./scripts/stress-concurrent-rooms.ts", ...process.argv.slice(2)].join(" ");
}

async function fetchRuntimeHealthSummary(host: string, port: number): Promise<RuntimeHealthSummary | undefined> {
  try {
    const response = await fetch(`http://${host}:${port}/api/runtime/health`);
    if (!response.ok) {
      return undefined;
    }

    const payload = (await response.json()) as {
      checkedAt?: string;
      runtime?: {
        activeRoomCount?: number;
        connectionCount?: number;
        activeBattleCount?: number;
        heroCount?: number;
        gameplayTraffic?: {
          connectMessagesTotal?: number;
          worldActionsTotal?: number;
          battleActionsTotal?: number;
          actionMessagesTotal?: number;
        };
      };
    };

    const runtime = payload.runtime;
    const gameplayTraffic = runtime?.gameplayTraffic;
    if (
      !payload.checkedAt ||
      typeof runtime?.activeRoomCount !== "number" ||
      typeof runtime.connectionCount !== "number" ||
      typeof runtime.activeBattleCount !== "number" ||
      typeof runtime.heroCount !== "number" ||
      typeof gameplayTraffic?.connectMessagesTotal !== "number" ||
      typeof gameplayTraffic.worldActionsTotal !== "number" ||
      typeof gameplayTraffic.battleActionsTotal !== "number" ||
      typeof gameplayTraffic.actionMessagesTotal !== "number"
    ) {
      return undefined;
    }

    return {
      checkedAt: payload.checkedAt,
      activeRoomCount: runtime.activeRoomCount,
      connectionCount: runtime.connectionCount,
      activeBattleCount: runtime.activeBattleCount,
      heroCount: runtime.heroCount,
      connectMessagesTotal: gameplayTraffic.connectMessagesTotal,
      worldActionsTotal: gameplayTraffic.worldActionsTotal,
      battleActionsTotal: gameplayTraffic.battleActionsTotal,
      actionMessagesTotal: gameplayTraffic.actionMessagesTotal
    };
  } catch {
    return undefined;
  }
}

function installLogFilter(): () => void {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const shouldSuppress = (args: unknown[]): boolean =>
    args.some(
      (arg) =>
        typeof arg === "string" &&
        (arg.includes(COLYSEUS_RECONNECT_MIN_UPTIME_LOG) || arg.includes("@colyseus/sdk: onMessage() not registered for type 'session.state'."))
    );

  console.log = (...args: Parameters<typeof console.log>) => {
    if (!shouldSuppress(args)) {
      originalLog(...args);
    }
  };
  console.info = (...args: Parameters<typeof console.info>) => {
    if (!shouldSuppress(args)) {
      originalInfo(...args);
    }
  };
  console.warn = (...args: Parameters<typeof console.warn>) => {
    if (!shouldSuppress(args)) {
      originalWarn(...args);
    }
  };
  console.error = (...args: Parameters<typeof console.error>) => {
    if (!shouldSuppress(args)) {
      originalError(...args);
    }
  };

  return () => {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
  };
}

class ResourceMonitor {
  private readonly cpuCount = Math.max(1, os.cpus().length);
  private readonly startedAt = performance.now();
  private readonly startedCpu = process.cpuUsage();
  private readonly startedMemory = process.memoryUsage();
  private peakRssBytes = this.startedMemory.rss;
  private peakHeapBytes = this.startedMemory.heapUsed;
  private peakHandles = activeHandleCount();
  private readonly timer: NodeJS.Timeout;

  constructor(private readonly sampleIntervalMs: number) {
    this.timer = setInterval(() => {
      this.captureSample();
    }, this.sampleIntervalMs);
    this.timer.unref?.();
  }

  private captureSample(): void {
    const memory = process.memoryUsage();
    this.peakRssBytes = Math.max(this.peakRssBytes, memory.rss);
    this.peakHeapBytes = Math.max(this.peakHeapBytes, memory.heapUsed);
    this.peakHandles = Math.max(this.peakHandles, activeHandleCount());
  }

  stop(): ResourceReport {
    clearInterval(this.timer);
    this.captureSample();

    const durationMs = performance.now() - this.startedAt;
    const cpu = process.cpuUsage(this.startedCpu);
    const cpuUserMs = cpu.user / 1_000;
    const cpuSystemMs = cpu.system / 1_000;
    const cpuTotalMs = cpuUserMs + cpuSystemMs;
    const cpuCoreUtilizationPct = Number(((cpuTotalMs / (durationMs * this.cpuCount)) * 100).toFixed(2));
    const memory = process.memoryUsage();

    return {
      durationMs: Number(durationMs.toFixed(2)),
      cpuUserMs: Number(cpuUserMs.toFixed(2)),
      cpuSystemMs: Number(cpuSystemMs.toFixed(2)),
      cpuTotalMs: Number(cpuTotalMs.toFixed(2)),
      cpuCoreUtilizationPct,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      activeHandles: activeHandleCount(),
      rssStartMb: toMegabytes(this.startedMemory.rss),
      rssPeakMb: toMegabytes(this.peakRssBytes),
      rssEndMb: toMegabytes(memory.rss),
      heapStartMb: toMegabytes(this.startedMemory.heapUsed),
      heapPeakMb: toMegabytes(this.peakHeapBytes),
      heapEndMb: toMegabytes(memory.heapUsed),
      peakActiveHandles: this.peakHandles
    };
  }
}

async function startStressServer(port: number, host: string, store: RoomSnapshotStore | null): Promise<Server> {
  configureRoomSnapshotStore(store);
  resetLobbyRoomRegistry();
  resetRuntimeObservability();

  const transport = new WebSocketTransport();
  registerRuntimeObservabilityRoutes(transport.getExpressApp() as never, {
    serviceName: "project-veil-stress-server"
  });

  const server = new Server({
    transport
  });

  server.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await server.listen(port, host);
  return server;
}

async function joinRoomWithRetry(host: string, port: number, roomId: string, playerId: string): Promise<ColyseusRoom> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const client = new Client(`http://${host}:${port}`);
      return await client.joinOrCreate("veil", {
        logicalRoomId: roomId,
        playerId,
        seed: 1001
      });
    } catch (error) {
      lastError = error;
      await wait(100 + attempt * 100);
    }
  }

  throw lastError;
}

async function sendRequest<T extends ServerMessage["type"]>(
  room: ColyseusRoom,
  message: ClientMessage,
  expectedType: T,
  timeoutMs = 8_000
): Promise<Extract<ServerMessage, { type: T }>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`Timed out waiting for ${expectedType}`));
    }, timeoutMs);

    const unsubscribe = room.onMessage("*", (type, payload) => {
      if (typeof type !== "string") {
        return;
      }

      const incoming = { type, ...(payload as object) } as ServerMessage;
      if (!("requestId" in incoming) || incoming.requestId !== message.requestId) {
        return;
      }

      clearTimeout(timeout);
      unsubscribe();

      if (incoming.type === "error") {
        reject(new Error(incoming.reason));
        return;
      }

      if (incoming.type !== expectedType) {
        reject(new Error(`Unexpected response type: ${incoming.type}`));
        return;
      }

      resolve(incoming as Extract<ServerMessage, { type: T }>);
    });

    room.send(message.type, message);
  });
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function consume(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) {
        return;
      }

      results[currentIndex] = await worker(items[currentIndex]!, currentIndex);
    }
  }

  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => consume());
  await Promise.all(workers);
  return results;
}

async function closeRoom(room: ColyseusRoom | null | undefined): Promise<void> {
  if (!room) {
    return;
  }

  room.removeAllListeners();

  try {
    await room.leave();
  } catch {
    room.connection.close();
  }
}

async function connectRooms(
  options: StressOptions,
  scenario: ScenarioName
): Promise<{ contexts: RoomContext[]; completedActions: number }> {
  const indexes = Array.from({ length: options.rooms }, (_, index) => index);
  const contexts = await mapConcurrent(indexes, options.connectConcurrency, async (index) => {
    const variant = STRESS_ROOM_VARIANTS[index % STRESS_ROOM_VARIANTS.length] ?? "phase1";
    const roomId = `stress-${scenario}-${index}[map:${variant}]`;
    const room = await joinRoomWithRetry(options.host, options.port, roomId, DEFAULT_ROOM_PLAYER_ID);
    const response = await sendRequest(
      room,
      {
        type: "connect",
        requestId: nextRequestId("connect"),
        roomId,
        playerId: DEFAULT_ROOM_PLAYER_ID
      },
      "session.state"
    );

    return {
      index,
      roomId,
      playerId: DEFAULT_ROOM_PLAYER_ID,
      room,
      payload: response.payload
    } satisfies RoomContext;
  });

  return {
    contexts,
    completedActions: contexts.length
  };
}

function pickWorldProgressionDestination(payload: SessionStatePayload): Vec2 | null {
  const hero = payload.world.ownHeroes[0];
  if (!hero) {
    return null;
  }

  const candidates = payload.reachableTiles.filter((tile) => tile.x !== hero.position.x || tile.y !== hero.position.y);
  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .slice()
    .sort((left, right) => {
      const leftDistance = Math.abs(left.x - hero.position.x) + Math.abs(left.y - hero.position.y);
      const rightDistance = Math.abs(right.x - hero.position.x) + Math.abs(right.y - hero.position.y);
      return rightDistance - leftDistance || left.y - right.y || left.x - right.x;
    })[0]!;
}

async function runWorldProgressionScenario(contexts: RoomContext[], options: StressOptions): Promise<number> {
  const actionsPerRoom = await mapConcurrent(contexts, options.actionConcurrency, async (context) => {
    const heroId = context.payload.world.ownHeroes[0]?.id;
    if (!heroId) {
      throw new Error(`No owned hero found for room ${context.roomId}`);
    }

    let actions = 0;
    const destination = pickWorldProgressionDestination(context.payload);
    if (destination) {
      const moved = await sendRequest(
        context.room,
        {
          type: "world.action",
          requestId: nextRequestId("move"),
          action: {
            type: "hero.move",
            heroId,
            destination
          }
        },
        "session.state"
      );
      context.payload = moved.payload;
      actions += 1;
    }

    const advanced = await sendRequest(
      context.room,
      {
        type: "world.action",
        requestId: nextRequestId("end-day"),
        action: {
          type: "turn.endDay"
        }
      },
      "session.state"
    );
    context.payload = advanced.payload;
    actions += 1;
    return actions;
  });

  return actionsPerRoom.reduce((total, value) => total + value, 0);
}

function selectPlayerBattleAction(payload: SessionStatePayload): BattleAction {
  const battle = payload.battle;
  if (!battle?.activeUnitId) {
    throw new Error("Battle is not active");
  }

  return (
    pickAutomatedBattleAction(battle) ?? {
      type: "battle.defend",
      unitId: battle.activeUnitId
    }
  );
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`).join(",")}}`;
}

function formatValue(value: unknown): string {
  return util.inspect(value, {
    depth: 6,
    breakLength: 120,
    maxArrayLength: 16
  });
}

function countVisibleTiles(view: PlayerWorldView): number {
  return view.map.tiles.filter((tile) => tile.fog !== "hidden").length;
}

function assertParity(
  invariant: string,
  expected: unknown,
  actual: unknown,
  context: {
    roomId: string;
    playerId: string;
    cycle: number;
  }
): void {
  if (stableSerialize(expected) === stableSerialize(actual)) {
    return;
  }

  throw new Error(
    `[${invariant}] drift in room ${context.roomId} player ${context.playerId} cycle ${context.cycle}: expected ${formatValue(expected)} but received ${formatValue(actual)}`
  );
}

async function loadPersistedSnapshot(store: RoomSnapshotStore | null, roomId: string): Promise<RoomPersistenceSnapshot | null> {
  if (!store) {
    return null;
  }

  return await store.load(roomId);
}

async function captureReconnectBaseline(
  context: RoomContext,
  cycle: number,
  store: RoomSnapshotStore | null
): Promise<{
  cycle: number;
  snapshot: RoomPersistenceSnapshot | null;
  world: PlayerWorldView;
  battle: BattleState | null;
  reachableTiles: Vec2[];
}> {
  return {
    cycle,
    snapshot: await loadPersistedSnapshot(store, context.roomId),
    world: decodePlayerWorldView(context.payload.world),
    battle: context.payload.battle ? structuredClone(context.payload.battle) : null,
    reachableTiles: structuredClone(context.payload.reachableTiles)
  };
}

function summarizeWorldState(view: PlayerWorldView): {
  day: number;
  heroPosition: Vec2 | null;
  moveRemaining: number | null;
  visibleTiles: number;
  resources: PlayerWorldView["resources"];
} {
  const hero = view.ownHeroes[0];
  return {
    day: view.meta.day,
    heroPosition: hero ? { ...hero.position } : null,
    moveRemaining: hero?.move.remaining ?? null,
    visibleTiles: countVisibleTiles(view),
    resources: structuredClone(view.resources)
  };
}

async function assertReconnectParity(
  context: RoomContext,
  baseline: Awaited<ReturnType<typeof captureReconnectBaseline>>,
  store: RoomSnapshotStore | null
): Promise<number> {
  const reconnectedWorld = decodePlayerWorldView(context.payload.world);
  const currentSnapshot = await loadPersistedSnapshot(store, context.roomId);
  const roomContext = {
    roomId: context.roomId,
    playerId: context.playerId,
    cycle: baseline.cycle
  };

  assertParity("room_snapshot_parity", baseline.snapshot, currentSnapshot, roomContext);
  assertParity("player_visible_world_parity", baseline.world, reconnectedWorld, roomContext);
  assertParity("player_visible_fog_state_parity", baseline.world.map.tiles, reconnectedWorld.map.tiles, roomContext);
  assertParity("battle_state_parity", baseline.battle, context.payload.battle ?? null, roomContext);
  assertParity("reachable_tiles_parity", baseline.reachableTiles, context.payload.reachableTiles, roomContext);
  assertParity("world_progression_invariant", summarizeWorldState(baseline.world), summarizeWorldState(reconnectedWorld), roomContext);

  return 6;
}

async function prepareReconnectSoakCycle(context: RoomContext, cycle: number): Promise<{
  actions: number;
  phase: "world" | "battle";
}> {
  const hero = context.payload.world.ownHeroes[0];
  if (!hero) {
    throw new Error(`No owned hero found for room ${context.roomId}`);
  }

  if (context.payload.battle) {
    const advancedBattle = await sendRequest(
      context.room,
      {
        type: "battle.action",
        requestId: nextRequestId("soak-battle-turn"),
        action: selectPlayerBattleAction(context.payload)
      },
      "session.state"
    );
    context.payload = advancedBattle.payload;
    return {
      actions: 1,
      phase: "battle"
    };
  }

  if (cycle % 2 === 0) {
    const destination = pickWorldProgressionDestination(context.payload);
    if (destination) {
      const moved = await sendRequest(
        context.room,
        {
          type: "world.action",
          requestId: nextRequestId("soak-world-move"),
          action: {
            type: "hero.move",
            heroId: hero.id,
            destination
          }
        },
        "session.state"
      );
      context.payload = moved.payload;
      return {
        actions: 1,
        phase: "world"
      };
    }
  }

  const movedToBattle = await sendRequest(
    context.room,
    {
      type: "world.action",
      requestId: nextRequestId("soak-battle-entry"),
      action: {
        type: "hero.move",
        heroId: hero.id,
        destination: DEFAULT_BATTLE_DESTINATION
      }
    },
    "session.state"
  );
  context.payload = movedToBattle.payload;

  if (context.payload.battle) {
    return {
      actions: 1,
      phase: "battle"
    };
  }

  const advancedDay = await sendRequest(
    context.room,
    {
      type: "world.action",
      requestId: nextRequestId("soak-end-day"),
      action: {
        type: "turn.endDay"
      }
    },
    "session.state"
  );
  context.payload = advancedDay.payload;
  return {
    actions: 2,
    phase: "world"
  };
}

function buildReconnectSoakSummary(contexts: RoomContext[], options: StressOptions, counters: {
  invariantChecks: number;
  worldReconnectCycles: number;
  battleReconnectCycles: number;
}): ReconnectSoakSummary {
  const days = contexts.map((context) => context.payload.world.meta.day);
  return {
    reconnectCycles: options.reconnectCycles,
    reconnectAttempts: options.rooms * options.reconnectCycles,
    invariantChecks: counters.invariantChecks,
    worldReconnectCycles: counters.worldReconnectCycles,
    battleReconnectCycles: counters.battleReconnectCycles,
    finalBattleRooms: contexts.filter((context) => Boolean(context.payload.battle)).length,
    finalDayRange: {
      min: Math.min(...days),
      max: Math.max(...days)
    },
    sampleRoomStates: contexts.slice(0, Math.min(5, contexts.length)).map((context) => {
      const world = decodePlayerWorldView(context.payload.world);
      return {
        roomId: context.roomId,
        playerId: context.playerId,
        day: world.meta.day,
        inBattle: Boolean(context.payload.battle),
        heroPosition: world.ownHeroes[0] ? { ...world.ownHeroes[0].position } : null,
        visibleTiles: countVisibleTiles(world)
      };
    })
  };
}

async function runBattleSettlementScenario(contexts: RoomContext[], options: StressOptions): Promise<number> {
  const actionsPerRoom = await mapConcurrent(contexts, options.actionConcurrency, async (context) => {
    const heroId = context.payload.world.ownHeroes[0]?.id;
    if (!heroId) {
      throw new Error(`No owned hero found for room ${context.roomId}`);
    }

    let actions = 0;
    const enteredBattle = await sendRequest(
      context.room,
      {
        type: "world.action",
        requestId: nextRequestId("battle-move"),
        action: {
          type: "hero.move",
          heroId,
          destination: DEFAULT_BATTLE_DESTINATION
        }
      },
      "session.state"
    );
    context.payload = enteredBattle.payload;
    actions += 1;

    if (!context.payload.battle) {
      throw new Error(`Room ${context.roomId} did not enter a battle at ${DEFAULT_BATTLE_DESTINATION.x},${DEFAULT_BATTLE_DESTINATION.y}`);
    }

    for (let turn = 0; turn < options.maxBattleTurns && context.payload.battle; turn += 1) {
      const action = selectPlayerBattleAction(context.payload);
      const advancedBattle = await sendRequest(
        context.room,
        {
          type: "battle.action",
          requestId: nextRequestId("battle-turn"),
          action
        },
        "session.state"
      );
      context.payload = advancedBattle.payload;
      actions += 1;
    }

    if (context.payload.battle) {
      throw new Error(`Room ${context.roomId} did not settle within ${options.maxBattleTurns} turns`);
    }

    return actions;
  });

  return actionsPerRoom.reduce((total, value) => total + value, 0);
}

async function runReconnectScenario(contexts: RoomContext[], options: StressOptions): Promise<number> {
  const actionsPerRoom = await mapConcurrent(contexts, options.actionConcurrency, async (context) => {
    const hero = context.payload.world.ownHeroes[0];
    if (!hero) {
      throw new Error(`No owned hero found for room ${context.roomId}`);
    }

    let actions = 0;
    const destination = pickWorldProgressionDestination(context.payload);
    if (destination) {
      const moved = await sendRequest(
        context.room,
        {
          type: "world.action",
          requestId: nextRequestId("reconnect-move"),
          action: {
            type: "hero.move",
            heroId: hero.id,
            destination
          }
        },
        "session.state"
      );
      context.payload = moved.payload;
      actions += 1;
    }

    const expectedPosition = context.payload.world.ownHeroes[0]?.position;
    context.room.connection.close();
    context.room.removeAllListeners();
    await wait(options.reconnectPauseMs);

    context.room = await joinRoomWithRetry(options.host, options.port, context.roomId, context.playerId);
    const reconnected = await sendRequest(
      context.room,
      {
        type: "connect",
        requestId: nextRequestId("reconnect"),
        roomId: context.roomId,
        playerId: context.playerId
      },
      "session.state"
    );
    context.payload = reconnected.payload;
    actions += 1;

    if (expectedPosition) {
      const restoredPosition = context.payload.world.ownHeroes[0]?.position;
      if (!restoredPosition || restoredPosition.x !== expectedPosition.x || restoredPosition.y !== expectedPosition.y) {
        throw new Error(`Room ${context.roomId} failed to restore the moved hero position after reconnect`);
      }
    }

    return actions;
  });

  return actionsPerRoom.reduce((total, value) => total + value, 0);
}

async function runReconnectSoakScenario(
  contexts: RoomContext[],
  options: StressOptions,
  store: RoomSnapshotStore | null
): Promise<{ completedActions: number; soakSummary: ReconnectSoakSummary }> {
  const counters = {
    invariantChecks: 0,
    worldReconnectCycles: 0,
    battleReconnectCycles: 0
  };

  const actionsPerRoom = await mapConcurrent(contexts, options.actionConcurrency, async (context) => {
    let actions = 0;

    for (let cycle = 1; cycle <= options.reconnectCycles; cycle += 1) {
      const prepared = await prepareReconnectSoakCycle(context, cycle);
      actions += prepared.actions;
      if (prepared.phase === "battle") {
        counters.battleReconnectCycles += 1;
      } else {
        counters.worldReconnectCycles += 1;
      }

      const baseline = await captureReconnectBaseline(context, cycle, store);

      context.room.connection.close();
      context.room.removeAllListeners();
      await wait(options.reconnectPauseMs);

      context.room = await joinRoomWithRetry(options.host, options.port, context.roomId, context.playerId);
      const reconnected = await sendRequest(
        context.room,
        {
          type: "connect",
          requestId: nextRequestId("reconnect-soak"),
          roomId: context.roomId,
          playerId: context.playerId
        },
        "session.state"
      );
      context.payload = reconnected.payload;
      actions += 1;
      counters.invariantChecks += await assertReconnectParity(context, baseline, store);
    }

    return actions;
  });

  return {
    completedActions: actionsPerRoom.reduce((total, value) => total + value, 0),
    soakSummary: buildReconnectSoakSummary(contexts, options, counters)
  };
}

async function cleanupRooms(contexts: RoomContext[]): Promise<void> {
  await Promise.all(contexts.map((context) => closeRoom(context.room).catch(() => undefined)));
  for (const context of contexts) {
    const room = getActiveRoomInstances().get(context.roomId) as { disconnect?: () => Promise<unknown> | unknown } | undefined;
    try {
      await room?.disconnect?.();
    } catch {
      // Best-effort cleanup for soak artifact counters.
    }
  }
}

async function waitForCleanupHealth(host: string, port: number, timeoutMs = 5_000): Promise<RuntimeHealthSummary | undefined> {
  const deadline = Date.now() + timeoutMs;
  let latest = await fetchRuntimeHealthSummary(host, port);
  while (latest && Date.now() < deadline) {
    if (
      latest.activeRoomCount === 0 &&
      latest.connectionCount === 0 &&
      latest.activeBattleCount === 0 &&
      latest.heroCount === 0
    ) {
      return latest;
    }
    await wait(50);
    latest = await fetchRuntimeHealthSummary(host, port);
  }
  return latest;
}

async function runScenario(scenario: ScenarioName, options: StressOptions, store: RoomSnapshotStore | null): Promise<ScenarioResult> {
  const monitor = new ResourceMonitor(options.sampleIntervalMs);
  let contexts: RoomContext[] = [];
  let runtimeHealthAfterConnect: RuntimeHealthSummary | undefined;
  let runtimeHealthAfterScenario: RuntimeHealthSummary | undefined;
  let result: ScenarioResult | undefined;

  try {
    const connected = await connectRooms(options, scenario);
    contexts = connected.contexts;
    runtimeHealthAfterConnect = await fetchRuntimeHealthSummary(options.host, options.port);
    let completedActions = connected.completedActions;

    if (scenario === "world_progression") {
      completedActions += await runWorldProgressionScenario(contexts, options);
    } else if (scenario === "battle_settlement") {
      completedActions += await runBattleSettlementScenario(contexts, options);
    } else if (scenario === "reconnect") {
      completedActions += await runReconnectScenario(contexts, options);
    } else {
      const soak = await runReconnectSoakScenario(contexts, options, store);
      completedActions += soak.completedActions;
      runtimeHealthAfterScenario = await fetchRuntimeHealthSummary(options.host, options.port);
      const resources = monitor.stop();
      result = {
        scenario,
        rooms: options.rooms,
        successfulRooms: options.rooms,
        failedRooms: 0,
        completedActions,
        durationMs: resources.durationMs,
        roomsPerSecond: Number((options.rooms / (resources.durationMs / 1000)).toFixed(2)),
        actionsPerSecond: Number((completedActions / (resources.durationMs / 1000)).toFixed(2)),
        cpuUserMs: resources.cpuUserMs,
        cpuSystemMs: resources.cpuSystemMs,
        cpuTotalMs: resources.cpuTotalMs,
        cpuCoreUtilizationPct: resources.cpuCoreUtilizationPct,
        rssStartMb: resources.rssStartMb,
        rssPeakMb: resources.rssPeakMb,
        rssEndMb: resources.rssEndMb,
        heapStartMb: resources.heapStartMb,
        heapPeakMb: resources.heapPeakMb,
        heapEndMb: resources.heapEndMb,
        peakActiveHandles: resources.peakActiveHandles,
        soakSummary: soak.soakSummary,
        ...(runtimeHealthAfterConnect ? { runtimeHealthAfterConnect } : {}),
        ...(runtimeHealthAfterScenario ? { runtimeHealthAfterScenario } : {})
      };
      return result;
    }
    runtimeHealthAfterScenario = await fetchRuntimeHealthSummary(options.host, options.port);

    const resources = monitor.stop();
    result = {
      scenario,
      rooms: options.rooms,
      successfulRooms: options.rooms,
      failedRooms: 0,
      completedActions,
      durationMs: resources.durationMs,
      roomsPerSecond: Number((options.rooms / (resources.durationMs / 1000)).toFixed(2)),
      actionsPerSecond: Number((completedActions / (resources.durationMs / 1000)).toFixed(2)),
      cpuUserMs: resources.cpuUserMs,
      cpuSystemMs: resources.cpuSystemMs,
      cpuTotalMs: resources.cpuTotalMs,
      cpuCoreUtilizationPct: resources.cpuCoreUtilizationPct,
      rssStartMb: resources.rssStartMb,
      rssPeakMb: resources.rssPeakMb,
      rssEndMb: resources.rssEndMb,
      heapStartMb: resources.heapStartMb,
      heapPeakMb: resources.heapPeakMb,
      heapEndMb: resources.heapEndMb,
      peakActiveHandles: resources.peakActiveHandles,
      ...(runtimeHealthAfterConnect ? { runtimeHealthAfterConnect } : {}),
      ...(runtimeHealthAfterScenario ? { runtimeHealthAfterScenario } : {})
    };
    return result;
  } catch (error) {
    runtimeHealthAfterScenario = await fetchRuntimeHealthSummary(options.host, options.port);
    const resources = monitor.stop();
    result = {
      scenario,
      rooms: options.rooms,
      successfulRooms: 0,
      failedRooms: options.rooms,
      completedActions: 0,
      durationMs: resources.durationMs,
      roomsPerSecond: 0,
      actionsPerSecond: 0,
      cpuUserMs: resources.cpuUserMs,
      cpuSystemMs: resources.cpuSystemMs,
      cpuTotalMs: resources.cpuTotalMs,
      cpuCoreUtilizationPct: resources.cpuCoreUtilizationPct,
      rssStartMb: resources.rssStartMb,
      rssPeakMb: resources.rssPeakMb,
      rssEndMb: resources.rssEndMb,
      heapStartMb: resources.heapStartMb,
      heapPeakMb: resources.heapPeakMb,
      heapEndMb: resources.heapEndMb,
      peakActiveHandles: resources.peakActiveHandles,
      ...(runtimeHealthAfterConnect ? { runtimeHealthAfterConnect } : {}),
      ...(runtimeHealthAfterScenario ? { runtimeHealthAfterScenario } : {}),
      errorMessage: error instanceof Error ? error.message : String(error)
    };
    return result;
  } finally {
    await cleanupRooms(contexts);
    const runtimeHealthAfterCleanup = await waitForCleanupHealth(options.host, options.port);
    if (result && runtimeHealthAfterCleanup) {
      result.runtimeHealthAfterCleanup = runtimeHealthAfterCleanup;
    }
  }
}

function printSummary(results: ScenarioResult[], options: StressOptions): void {
  console.log(`Concurrent room stress test on ws://${options.host}:${options.port}`);
  console.log(`Inspect runtime health at http://${options.host}:${options.port}/api/runtime/health`);
  console.log(`Inspect runtime metrics at http://${options.host}:${options.port}/api/runtime/metrics`);
  console.log(`Rooms: ${options.rooms} | Scenarios: ${options.scenarios.join(", ")}`);
  console.table(
    results.map((result) => ({
      scenario: result.scenario,
      rooms: result.rooms,
      success: result.successfulRooms,
      failed: result.failedRooms,
      activeRooms: result.runtimeHealthAfterConnect?.activeRoomCount ?? "",
      connections: result.runtimeHealthAfterConnect?.connectionCount ?? "",
      cleanupRooms: result.runtimeHealthAfterCleanup?.activeRoomCount ?? "",
      cleanupConnections: result.runtimeHealthAfterCleanup?.connectionCount ?? "",
      actionMsgs: result.runtimeHealthAfterScenario?.actionMessagesTotal ?? "",
      durationMs: result.durationMs,
      roomsPerSec: result.roomsPerSecond,
      actions: result.completedActions,
      actionsPerSec: result.actionsPerSecond,
      cpuMs: result.cpuTotalMs,
      cpuCorePct: result.cpuCoreUtilizationPct,
      rssPeakMb: result.rssPeakMb,
      heapPeakMb: result.heapPeakMb,
      peakHandles: result.peakActiveHandles,
      reconnectCycles: result.soakSummary?.reconnectCycles ?? "",
      invariantChecks: result.soakSummary?.invariantChecks ?? "",
      error: result.errorMessage ?? ""
    }))
  );
  const soakResult = results.find((result) => result.scenario === "reconnect_soak");
  if (soakResult?.soakSummary) {
    console.log(
      `Reconnect soak summary: ${soakResult.successfulRooms}/${soakResult.rooms} rooms, ${soakResult.soakSummary.reconnectAttempts} reconnects, ${soakResult.soakSummary.invariantChecks} invariant checks, world cycles ${soakResult.soakSummary.worldReconnectCycles}, battle cycles ${soakResult.soakSummary.battleReconnectCycles}.`
    );
  }
  console.log("STRESS_RESULT_JSON_START");
  console.log(JSON.stringify({ options, results }, null, 2));
  console.log("STRESS_RESULT_JSON_END");
}

function buildArtifact(results: ScenarioResult[], options: StressOptions): StressArtifact {
  const soakResult = results.find((result) => result.scenario === "reconnect_soak");
  return {
    schemaVersion: 1,
    artifactType: "stress-runtime-metrics",
    generatedAt: new Date().toISOString(),
    command: buildCommandString(),
    revision: readGitRevision(),
    status: results.some((result) => result.failedRooms > 0) ? "failed" : "passed",
    options,
    summary: {
      totalScenarios: results.length,
      failedScenarios: results.filter((result) => result.failedRooms > 0).length,
      scenarioNames: results.map((result) => result.scenario)
    },
    soakSummary: soakResult?.soakSummary ?? null,
    results
  };
}

function emitArtifact(results: ScenarioResult[], options: StressOptions): void {
  const artifact = buildArtifact(results, options);
  const soakResult = results.find((result) => result.scenario === "reconnect_soak");
  mkdirSync(path.dirname(options.artifactPath), { recursive: true });
  writeFileSync(options.artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(`Wrote stress artifact: ${path.relative(process.cwd(), options.artifactPath).replace(/\\/g, "/")}`);
  if (artifact.soakSummary) {
    console.log("RECONNECT_SOAK_ARTIFACT_SUMMARY");
    console.log(
      JSON.stringify(
        {
          status: artifact.status,
          artifactPath: path.relative(process.cwd(), options.artifactPath).replace(/\\/g, "/"),
          rooms: soakResult?.rooms ?? 0,
          reconnectAttempts: artifact.soakSummary.reconnectAttempts,
          invariantChecks: artifact.soakSummary.invariantChecks,
          worldReconnectCycles: artifact.soakSummary.worldReconnectCycles,
          battleReconnectCycles: artifact.soakSummary.battleReconnectCycles,
          finalBattleRooms: artifact.soakSummary.finalBattleRooms,
          finalDayRange: artifact.soakSummary.finalDayRange,
          cleanup: soakResult?.runtimeHealthAfterCleanup
            ? {
                activeRoomCount: soakResult.runtimeHealthAfterCleanup.activeRoomCount,
                connectionCount: soakResult.runtimeHealthAfterCleanup.connectionCount,
                activeBattleCount: soakResult.runtimeHealthAfterCleanup.activeBattleCount,
                heroCount: soakResult.runtimeHealthAfterCleanup.heroCount
              }
            : null
        },
        null,
        2
      )
    );
  }
}

async function main(): Promise<void> {
  const options = parseStressOptions();
  const restoreLoggers = installLogFilter();
  const needsSnapshotStore = options.scenarios.includes("reconnect_soak");
  const snapshotStore = needsSnapshotStore ? createMemoryRoomSnapshotStore() : null;
  const server = await startStressServer(options.port, options.host, snapshotStore);

  try {
    const results: ScenarioResult[] = [];
    for (const scenario of options.scenarios) {
      results.push(await runScenario(scenario, options, snapshotStore));
    }

    printSummary(results, options);
    emitArtifact(results, options);

    if (results.some((result) => result.failedRooms > 0)) {
      process.exitCode = 1;
    }
  } finally {
    restoreLoggers();
    configureRoomSnapshotStore(null);
    resetLobbyRoomRegistry();
    await snapshotStore?.close().catch(() => undefined);
    await server.gracefullyShutdown(false).catch(() => undefined);
  }
}

void main().catch((error) => {
  console.error("Concurrent room stress test failed", error);
  process.exitCode = 1;
});
