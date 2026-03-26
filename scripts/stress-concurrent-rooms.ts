import { performance } from "node:perf_hooks";
import os from "node:os";
import { Client, type Room as ColyseusRoom } from "@colyseus/sdk";
import { Server, WebSocketTransport } from "colyseus";
import { pickAutomatedBattleAction, type BattleAction, type ClientMessage, type ServerMessage, type SessionStatePayload, type Vec2 } from "../packages/shared/src/index";
import { configureRoomSnapshotStore, resetLobbyRoomRegistry, VeilColyseusRoom } from "../apps/server/src/colyseus-room";

type ScenarioName = "world_progression" | "battle_settlement" | "reconnect";

interface StressOptions {
  rooms: number;
  port: number;
  host: string;
  sampleIntervalMs: number;
  connectConcurrency: number;
  actionConcurrency: number;
  reconnectPauseMs: number;
  maxBattleTurns: number;
  scenarios: ScenarioName[];
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
  errorMessage?: string;
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

const DEFAULT_BATTLE_DESTINATION: Vec2 = { x: 5, y: 4 };
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_ROOM_PLAYER_ID = "player-1";
const COLYSEUS_RECONNECT_MIN_UPTIME_LOG = "[Colyseus reconnection]: ❌ Room has not been up for long enough for automatic reconnection.";

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
  const argument = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!argument) {
    return fallback;
  }

  const value = Number(argument.slice(name.length + 3));
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }

  return value;
}

function parseScenarioFlag(): ScenarioName[] {
  const argument = process.argv.find((item) => item.startsWith("--scenarios="));
  if (!argument) {
    return ["world_progression", "battle_settlement", "reconnect"];
  }

  const requested = argument
    .slice("--scenarios=".length)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const knownScenarios: ScenarioName[] = ["world_progression", "battle_settlement", "reconnect"];
  const invalid = requested.filter((item) => !knownScenarios.includes(item as ScenarioName));
  if (invalid.length > 0) {
    throw new Error(`Unknown scenarios: ${invalid.join(", ")}`);
  }

  return requested as ScenarioName[];
}

function parseStressOptions(): StressOptions {
  return {
    rooms: parseIntegerFlag("rooms", 120),
    port: parseIntegerFlag("port", 39000 + Math.floor(Math.random() * 1000)),
    host: DEFAULT_HOST,
    sampleIntervalMs: parseIntegerFlag("sample-interval-ms", 200),
    connectConcurrency: parseIntegerFlag("connect-concurrency", 24),
    actionConcurrency: parseIntegerFlag("action-concurrency", 24),
    reconnectPauseMs: parseIntegerFlag("reconnect-pause-ms", 100),
    maxBattleTurns: parseIntegerFlag("max-battle-turns", 24),
    scenarios: parseScenarioFlag()
  };
}

function installLogFilter(): () => void {
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const shouldSuppress = (args: unknown[]): boolean =>
    args.some((arg) => typeof arg === "string" && arg.includes(COLYSEUS_RECONNECT_MIN_UPTIME_LOG));

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

  return () => {
    console.log = originalLog;
    console.info = originalInfo;
    console.warn = originalWarn;
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

async function startStressServer(port: number, host: string): Promise<Server> {
  configureRoomSnapshotStore(null);
  resetLobbyRoomRegistry();

  const server = new Server({
    transport: new WebSocketTransport()
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
    const roomId = `stress-${scenario}-${index}`;
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

async function cleanupRooms(contexts: RoomContext[]): Promise<void> {
  await Promise.all(contexts.map((context) => closeRoom(context.room).catch(() => undefined)));
}

async function runScenario(scenario: ScenarioName, options: StressOptions): Promise<ScenarioResult> {
  const monitor = new ResourceMonitor(options.sampleIntervalMs);
  let contexts: RoomContext[] = [];

  try {
    const connected = await connectRooms(options, scenario);
    contexts = connected.contexts;
    let completedActions = connected.completedActions;

    if (scenario === "world_progression") {
      completedActions += await runWorldProgressionScenario(contexts, options);
    } else if (scenario === "battle_settlement") {
      completedActions += await runBattleSettlementScenario(contexts, options);
    } else {
      completedActions += await runReconnectScenario(contexts, options);
    }

    const resources = monitor.stop();
    return {
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
      peakActiveHandles: resources.peakActiveHandles
    };
  } catch (error) {
    const resources = monitor.stop();
    return {
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
      errorMessage: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await cleanupRooms(contexts);
  }
}

function printSummary(results: ScenarioResult[], options: StressOptions): void {
  console.log(`Concurrent room stress test on ws://${options.host}:${options.port}`);
  console.log(`Rooms: ${options.rooms} | Scenarios: ${options.scenarios.join(", ")}`);
  console.table(
    results.map((result) => ({
      scenario: result.scenario,
      rooms: result.rooms,
      success: result.successfulRooms,
      failed: result.failedRooms,
      durationMs: result.durationMs,
      roomsPerSec: result.roomsPerSecond,
      actions: result.completedActions,
      actionsPerSec: result.actionsPerSecond,
      cpuMs: result.cpuTotalMs,
      cpuCorePct: result.cpuCoreUtilizationPct,
      rssPeakMb: result.rssPeakMb,
      heapPeakMb: result.heapPeakMb,
      peakHandles: result.peakActiveHandles,
      error: result.errorMessage ?? ""
    }))
  );
  console.log("STRESS_RESULT_JSON_START");
  console.log(JSON.stringify({ options, results }, null, 2));
  console.log("STRESS_RESULT_JSON_END");
}

async function main(): Promise<void> {
  const options = parseStressOptions();
  const restoreLoggers = installLogFilter();
  const server = await startStressServer(options.port, options.host);

  try {
    const results: ScenarioResult[] = [];
    for (const scenario of options.scenarios) {
      results.push(await runScenario(scenario, options));
    }

    printSummary(results, options);

    if (results.some((result) => result.failedRooms > 0)) {
      process.exitCode = 1;
    }
  } finally {
    restoreLoggers();
    configureRoomSnapshotStore(null);
    resetLobbyRoomRegistry();
    await server.gracefullyShutdown(false).catch(() => undefined);
  }
}

void main().catch((error) => {
  console.error("Concurrent room stress test failed", error);
  process.exitCode = 1;
});
