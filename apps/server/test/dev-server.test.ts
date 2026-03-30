import assert from "node:assert/strict";
import test from "node:test";
import { listLobbyRooms } from "../src/colyseus-room";
import { startDevServer, type DevServerBootstrapDependencies } from "../src/dev-server";
import type { MySqlPersistenceConfig, SnapshotRetentionPolicy } from "../src/persistence";

interface TestLogger {
  logs: string[];
  warnings: string[];
  errors: Array<{ message: string; error: unknown }>;
}

interface TestProcess {
  handlers: Partial<Record<"SIGINT" | "SIGTERM", () => void>>;
  exitCodes: number[];
}

interface TestTimer {
  callback: () => void;
  delayMs: number;
  unrefCalls: number;
  unref?(): void;
}

function createLogger(): DevServerBootstrapDependencies["logger"] & TestLogger {
  const logger: TestLogger = {
    logs: [],
    warnings: [],
    errors: []
  };

  return {
    ...logger,
    log(message: string) {
      logger.logs.push(message);
    },
    warn(message: string) {
      logger.warnings.push(message);
    },
    error(message: string, error: unknown) {
      logger.errors.push({ message, error });
    }
  };
}

function createProcessStub(): DevServerBootstrapDependencies["process"] & TestProcess {
  const handlers: TestProcess["handlers"] = {};
  const exitCodes: number[] = [];

  return {
    handlers,
    exitCodes,
    once(event, listener) {
      handlers[event] = listener;
    },
    exit(code) {
      exitCodes.push(code);
    }
  };
}

function createConfigCenterStore(mode: "filesystem" | "mysql") {
  return {
    mode,
    initializeCalls: 0,
    closeCalls: 0,
    async initializeRuntimeConfigs() {
      this.initializeCalls += 1;
    },
    async close() {
      this.closeCalls += 1;
    }
  };
}

function createMemoryStore() {
  return {
    closeCalls: 0,
    async close() {
      this.closeCalls += 1;
    }
  };
}

function createMySqlStore(retention: SnapshotRetentionPolicy, pruneImpl: () => Promise<number>) {
  return {
    closeCalls: 0,
    pruneCalls: 0,
    async close() {
      this.closeCalls += 1;
    },
    async pruneExpired() {
      this.pruneCalls += 1;
      return pruneImpl();
    },
    getRetentionPolicy() {
      return retention;
    }
  };
}

function createBaseDependencies() {
  const logger = createLogger();
  const process = createProcessStub();
  const expressApp = { kind: "express-app" };
  const routeCalls: string[] = [];
  const transport = {
    getExpressApp() {
      return expressApp;
    }
  };
  const gameServer = {
    defineCalls: [] as Array<{ name: string; room: unknown }>,
    filterByCalls: [] as string[][],
    listenCalls: [] as Array<{ port: number; host: string }>,
    define(name: string, room: unknown) {
      this.defineCalls.push({ name, room });
      return {
        filterBy: (fields: string[]) => {
          this.filterByCalls.push(fields);
        }
      };
    },
    async listen(port: number, host: string) {
      this.listenCalls.push({ port, host });
    }
  };

  return {
    logger,
    process,
    expressApp,
    routeCalls,
    transport,
    gameServer
  };
}

function assertStartupLogIncludes(logger: TestLogger, patterns: RegExp[]): void {
  const logOutput = logger.logs.join("\n");

  for (const pattern of patterns) {
    assert.match(logOutput, pattern);
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
}

test("dev server startup wires the in-memory bootstrap path and closes stores on SIGINT", async () => {
  const base = createBaseDependencies();
  const configCenterStore = createConfigCenterStore("filesystem");
  const memoryStore = createMemoryStore();
  let configuredStore: unknown;
  let authStore: unknown;
  let playerAccountStore: unknown;
  let matchmakingStore: unknown;
  let lobbyListRooms: unknown;

  await startDevServer(3101, "0.0.0.0", {
    readMySqlPersistenceConfig: () => null,
    createFileSystemConfigCenterStore: () => configCenterStore,
    createMemoryRoomSnapshotStore: () => memoryStore,
    configureRoomSnapshotStore: (store) => {
      configuredStore = store;
    },
    createTransport: () => base.transport,
    registerAuthRoutes: (app, store) => {
      assert.equal(app, base.expressApp);
      authStore = store;
      base.routeCalls.push("auth");
    },
    registerConfigCenterRoutes: (app, store) => {
      assert.equal(app, base.expressApp);
      assert.equal(store, configCenterStore);
      base.routeCalls.push("config-center");
    },
    registerConfigViewerRoutes: (app, store) => {
      assert.equal(app, base.expressApp);
      assert.equal(store, configCenterStore);
      base.routeCalls.push("config-viewer");
    },
    registerPlayerAccountRoutes: (app, store) => {
      assert.equal(app, base.expressApp);
      playerAccountStore = store;
      base.routeCalls.push("player-accounts");
    },
    registerLobbyRoutes: (app, dependencies) => {
      assert.equal(app, base.expressApp);
      lobbyListRooms = dependencies.listRooms;
      base.routeCalls.push("lobby");
    },
    registerMatchmakingRoutes: (app, dependencies) => {
      assert.equal(app, base.expressApp);
      matchmakingStore = dependencies.store;
      base.routeCalls.push("matchmaking");
    },
    registerRuntimeObservabilityRoutes: (app) => {
      assert.equal(app, base.expressApp);
      base.routeCalls.push("runtime-observability");
    },
    createGameServer: () => base.gameServer,
    logger: base.logger,
    process: base.process,
    setInterval: () => {
      throw new Error("setInterval should not be used for in-memory startup");
    },
    clearInterval: () => {
      throw new Error("clearInterval should not be used for in-memory startup");
    },
    isMySqlSnapshotStore: () => false
  });

  assert.equal(configuredStore, memoryStore);
  assert.equal(authStore, memoryStore);
  assert.equal(playerAccountStore, memoryStore);
  assert.equal(matchmakingStore, memoryStore);
  assert.equal(lobbyListRooms, listLobbyRooms);
  assert.deepEqual(base.routeCalls, [
    "auth",
    "config-center",
    "config-viewer",
    "player-accounts",
    "lobby",
    "matchmaking",
    "runtime-observability"
  ]);
  assert.deepEqual(base.gameServer.defineCalls.map((call) => call.name), ["veil"]);
  assert.deepEqual(base.gameServer.filterByCalls, [["logicalRoomId"]]);
  assert.deepEqual(base.gameServer.listenCalls, [{ port: 3101, host: "0.0.0.0" }]);
  assert.equal(configCenterStore.initializeCalls, 1);
  assert.equal(base.logger.warnings.length, 0);
  assert.equal(base.logger.errors.length, 0);
  assertStartupLogIncludes(base.logger, [
    /Project Veil Colyseus dev server listening on ws:\/\/0\.0\.0\.0:3101/,
    /Runtime health available at http:\/\/0\.0\.0\.0:3101\/api\/runtime\/health/,
    /Auth readiness available at http:\/\/0\.0\.0\.0:3101\/api\/runtime\/auth-readiness/,
    /Runtime diagnostic snapshot available at http:\/\/0\.0\.0\.0:3101\/api\/runtime\/diagnostic-snapshot/,
    /Runtime metrics available at http:\/\/0\.0\.0\.0:3101\/api\/runtime\/metrics/,
    /Config center storage: filesystem/,
    /Local in-memory room persistence enabled/
  ]);
  assert.ok(base.process.handlers.SIGINT);
  assert.ok(base.process.handlers.SIGTERM);

  base.process.handlers.SIGINT?.();
  await flushAsyncWork();

  assert.equal(memoryStore.closeCalls, 1);
  assert.equal(configCenterStore.closeCalls, 1);
  assert.deepEqual(base.process.exitCodes, [0]);
});

test("dev server falls back to in-memory persistence and warns when schema migrations are pending", async () => {
  const base = createBaseDependencies();
  const configCenterStore = createConfigCenterStore("filesystem");
  const memoryStore = createMemoryStore();
  const mysqlConfig: MySqlPersistenceConfig = {
    host: "127.0.0.1",
    port: 3306,
    user: "veil",
    password: "veil",
    database: "project_veil",
    retention: {
      ttlHours: 24,
      cleanupIntervalMinutes: 30
    }
  };
  let mysqlStoreCreated = false;
  let mysqlConfigStoreCreated = false;

  await startDevServer(3202, "127.0.0.1", {
    readMySqlPersistenceConfig: () => mysqlConfig,
    getSchemaMigrationStatus: async () => ({ pending: [{ id: "0001" }] }),
    formatSchemaMigrationWarning: () => "pending migration warning",
    createFileSystemConfigCenterStore: () => configCenterStore,
    createMySqlRoomSnapshotStore: async () => {
      mysqlStoreCreated = true;
      throw new Error("MySQL snapshot store should not be created when migrations are pending");
    },
    createMySqlConfigCenterStore: async () => {
      mysqlConfigStoreCreated = true;
      throw new Error("MySQL config store should not be created when migrations are pending");
    },
    createMemoryRoomSnapshotStore: () => memoryStore,
    configureRoomSnapshotStore: () => undefined,
    createTransport: () => base.transport,
    registerAuthRoutes: () => undefined,
    registerConfigCenterRoutes: () => undefined,
    registerConfigViewerRoutes: () => undefined,
    registerPlayerAccountRoutes: () => undefined,
    registerLobbyRoutes: () => undefined,
    registerMatchmakingRoutes: () => undefined,
    registerRuntimeObservabilityRoutes: () => undefined,
    createGameServer: () => base.gameServer,
    logger: base.logger,
    process: base.process,
    setInterval: () => {
      throw new Error("setInterval should not be scheduled when migrations are pending");
    },
    clearInterval: () => undefined,
    isMySqlSnapshotStore: () => false
  });

  assert.equal(mysqlStoreCreated, false);
  assert.equal(mysqlConfigStoreCreated, false);
  assert.equal(configCenterStore.initializeCalls, 1);
  assert.deepEqual(base.logger.warnings, ["pending migration warning"]);
  assert.equal(base.logger.errors.length, 0);
  assertStartupLogIncludes(base.logger, [
    /Runtime health available at http:\/\/127\.0\.0\.1:3202\/api\/runtime\/health/,
    /Auth readiness available at http:\/\/127\.0\.0\.1:3202\/api\/runtime\/auth-readiness/,
    /Runtime diagnostic snapshot available at http:\/\/127\.0\.0\.1:3202\/api\/runtime\/diagnostic-snapshot/,
    /Runtime metrics available at http:\/\/127\.0\.0\.1:3202\/api\/runtime\/metrics/,
    /Config center storage: filesystem/,
    /Local in-memory room persistence enabled/
  ]);
});

test("dev server starts MySQL persistence, runs retention cleanup, schedules pruning, and clears the timer on SIGTERM", async () => {
  const base = createBaseDependencies();
  const configCenterStore = createConfigCenterStore("mysql");
  const retention: SnapshotRetentionPolicy = {
    ttlHours: 48,
    cleanupIntervalMinutes: 15
  };
  let pruneAttempt = 0;
  const pruneFailure = new Error("cleanup failed");
  const mysqlStore = createMySqlStore(retention, async () => {
    pruneAttempt += 1;
    if (pruneAttempt === 1) {
      return 2;
    }

    throw pruneFailure;
  });
  const mysqlConfig: MySqlPersistenceConfig = {
    host: "127.0.0.1",
    port: 3306,
    user: "veil",
    password: "veil",
    database: "project_veil",
    retention
  };
  const scheduledTimers: TestTimer[] = [];
  const clearedTimers: TestTimer[] = [];
  let memoryStoreCreated = false;

  await startDevServer(3303, "127.0.0.2", {
    readMySqlPersistenceConfig: () => mysqlConfig,
    getSchemaMigrationStatus: async () => ({ pending: [] }),
    createFileSystemConfigCenterStore: () => createConfigCenterStore("filesystem"),
    createMySqlRoomSnapshotStore: async () => mysqlStore,
    createMySqlConfigCenterStore: async () => configCenterStore,
    createMemoryRoomSnapshotStore: () => {
      memoryStoreCreated = true;
      throw new Error("Memory snapshot store should not be created for MySQL startup");
    },
    configureRoomSnapshotStore: (store) => {
      assert.equal(store, mysqlStore);
    },
    createTransport: () => base.transport,
    registerAuthRoutes: () => undefined,
    registerConfigCenterRoutes: () => undefined,
    registerConfigViewerRoutes: () => undefined,
    registerPlayerAccountRoutes: () => undefined,
    registerLobbyRoutes: () => undefined,
    registerMatchmakingRoutes: () => undefined,
    registerRuntimeObservabilityRoutes: () => undefined,
    createGameServer: () => base.gameServer,
    logger: base.logger,
    process: base.process,
    setInterval: (callback, delayMs) => {
      const timer: TestTimer = {
        callback,
        delayMs,
        unrefCalls: 0
      };
      timer.unref = () => {
        timer.unrefCalls += 1;
      };
      scheduledTimers.push(timer);
      return timer;
    },
    clearInterval: (timer) => {
      clearedTimers.push(timer as TestTimer);
    },
    isMySqlSnapshotStore: (store) => store === mysqlStore
  });

  assert.equal(memoryStoreCreated, false);
  assert.equal(configCenterStore.initializeCalls, 1);
  assert.equal(mysqlStore.pruneCalls, 1);
  assert.equal(base.logger.warnings.length, 0);
  assertStartupLogIncludes(base.logger, [
    /Runtime health available at http:\/\/127\.0\.0\.2:3303\/api\/runtime\/health/,
    /Auth readiness available at http:\/\/127\.0\.0\.2:3303\/api\/runtime\/auth-readiness/,
    /Runtime diagnostic snapshot available at http:\/\/127\.0\.0\.2:3303\/api\/runtime\/diagnostic-snapshot/,
    /Runtime metrics available at http:\/\/127\.0\.0\.2:3303\/api\/runtime\/metrics/,
    /Config center storage: mysql/,
    /MySQL room persistence enabled/,
    /Snapshot retention: ttl=48h \/ cleanup=15m/,
    /Pruned 2 expired room snapshot\(s\)/
  ]);
  assert.equal(scheduledTimers.length, 1);
  assert.equal(scheduledTimers[0]?.delayMs, 15 * 60 * 1000);
  assert.equal(scheduledTimers[0]?.unrefCalls, 1);

  scheduledTimers[0]?.callback();
  await flushAsyncWork();

  assert.equal(mysqlStore.pruneCalls, 2);
  assert.deepEqual(base.logger.errors, [
    {
      message: "Failed to prune expired room snapshots",
      error: pruneFailure
    }
  ]);

  base.process.handlers.SIGTERM?.();
  await flushAsyncWork();

  assert.equal(mysqlStore.closeCalls, 1);
  assert.equal(configCenterStore.closeCalls, 1);
  assert.deepEqual(clearedTimers, [scheduledTimers[0]]);
  assert.deepEqual(base.process.exitCodes, [0]);
});
