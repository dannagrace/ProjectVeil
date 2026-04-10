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
  handlers: Partial<
    Record<
      "SIGINT" | "SIGTERM" | "unhandledRejection" | "uncaughtException",
      (() => void) | ((reason: unknown) => void) | ((error: Error) => void)
    >
  >;
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
    on(event, listener) {
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
  const expressApp = {
    kind: "express-app",
    middleware: [] as Array<unknown>,
    getRoutes: [] as Array<{ path: string; handler: unknown }>,
    postRoutes: [] as Array<{ path: string; handler: unknown }>,
    use(handler: unknown) {
      this.middleware.push(handler);
    },
    get(path: string, handler: unknown) {
      this.getRoutes.push({ path, handler });
    },
    post(path: string, handler: unknown) {
      this.postRoutes.push({ path, handler });
    }
  };
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
    realtimeOptions: [] as Array<{ driver?: unknown; presence?: unknown } | undefined>,
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
  let guildStore: unknown;
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
    readRedisUrl: () => null,
    createRedisPresence: () => {
      throw new Error("createRedisPresence should not be used without REDIS_URL");
    },
    createRedisDriver: () => {
      throw new Error("createRedisDriver should not be used without REDIS_URL");
    },
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
    registerGuildRoutes: (app, store) => {
      assert.equal(app, base.expressApp);
      guildStore = store;
      base.routeCalls.push("guilds");
    },
    registerPlayerAccountRoutes: (app, store) => {
      assert.equal(app, base.expressApp);
      playerAccountStore = store;
      base.routeCalls.push("player-accounts");
    },
    registerShopRoutes: (app, store) => {
      assert.equal(app, base.expressApp);
      assert.equal(store, memoryStore);
      base.routeCalls.push("shop");
    },
    registerWechatPayRoutes: (app, store) => {
      assert.equal(app, base.expressApp);
      assert.equal(store, memoryStore);
      base.routeCalls.push("wechat-pay");
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
    registerMinorProtectionPreviewRoutes: (app, store) => {
      assert.equal(app, base.expressApp);
      assert.equal(store, memoryStore);
      base.routeCalls.push("minor-protection-preview");
    },
    registerPrometheusMetricsMiddleware: (app) => {
      assert.equal(app, base.expressApp);
      base.routeCalls.push("prometheus-middleware");
    },
    registerPrometheusMetricsRoute: (app) => {
      assert.equal(app, base.expressApp);
      base.routeCalls.push("prometheus-route");
    },
    registerLeaderboardRoutes: (app) => {
      assert.equal(app, base.expressApp);
      base.routeCalls.push("leaderboard");
    },
    registerSeasonRoutes: (app) => {
      assert.equal(app, base.expressApp);
      base.routeCalls.push("seasons");
    },
    registerRuntimeObservabilityRoutes: (app) => {
      assert.equal(app, base.expressApp);
      base.routeCalls.push("runtime-observability");
    },
    registerAdminRoutes: (app, store, gameServer) => {
      assert.equal(app, base.expressApp);
      assert.equal(store, memoryStore);
      assert.equal(gameServer, base.gameServer);
      base.routeCalls.push("admin");
    },
    createGameServer: (_transport, realtimeOptions) => {
      base.gameServer.realtimeOptions.push(realtimeOptions);
      return base.gameServer;
    },
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
  assert.equal(guildStore, memoryStore);
  assert.equal(playerAccountStore, memoryStore);
  assert.equal(matchmakingStore, memoryStore);
  assert.equal(lobbyListRooms, listLobbyRooms);
  assert.deepEqual(base.routeCalls, [
    "prometheus-middleware",
    "prometheus-route",
    "auth",
    "config-center",
    "config-viewer",
    "guilds",
    "player-accounts",
    "shop",
    "wechat-pay",
    "lobby",
    "matchmaking",
    "minor-protection-preview",
    "leaderboard",
    "seasons",
    "runtime-observability",
    "admin"
  ]);
  assert.deepEqual(base.gameServer.defineCalls.map((call) => call.name), ["veil"]);
  assert.deepEqual(base.gameServer.filterByCalls, [["logicalRoomId"]]);
  assert.deepEqual(base.gameServer.listenCalls, [{ port: 3101, host: "0.0.0.0" }]);
  assert.deepEqual(base.gameServer.realtimeOptions, [{ driver: undefined, presence: undefined }]);
  assert.equal(configCenterStore.initializeCalls, 1);
  assert.equal(base.logger.warnings.length, 0);
  assert.equal(base.logger.errors.length, 0);
  assertStartupLogIncludes(base.logger, [
    /Project Veil Colyseus dev server listening on ws:\/\/0\.0\.0\.0:3101/,
    /Guild API available at http:\/\/0\.0\.0\.0:3101\/api\/guilds/,
    /WeChat Pay API available at http:\/\/0\.0\.0\.0:3101\/api\/payments\/wechat\/create/,
    /Runtime health available at http:\/\/0\.0\.0\.0:3101\/api\/runtime\/health/,
    /Auth readiness available at http:\/\/0\.0\.0\.0:3101\/api\/runtime\/auth-readiness/,
    /Runtime diagnostic snapshot available at http:\/\/0\.0\.0\.0:3101\/api\/runtime\/diagnostic-snapshot/,
    /Prometheus metrics available at http:\/\/0\.0\.0\.0:3101\/metrics/,
    /Runtime metrics available at http:\/\/0\.0\.0\.0:3101\/api\/runtime\/metrics/,
    /Config center storage: filesystem/,
    /Local in-memory Colyseus presence\/driver enabled/,
    /Local in-memory room persistence enabled/
  ]);
  assert.ok(base.process.handlers.SIGINT);
  assert.ok(base.process.handlers.SIGTERM);
  assert.ok(base.process.handlers.unhandledRejection);
  assert.ok(base.process.handlers.uncaughtException);

  base.process.handlers.SIGINT?.();
  await flushAsyncWork();

  assert.equal(memoryStore.closeCalls, 1);
  assert.equal(configCenterStore.closeCalls, 1);
  assert.deepEqual(base.process.exitCodes, [0]);
});

test("dev server logs process-level failures, closes stores, and exits non-zero", async () => {
  const base = createBaseDependencies();
  const configCenterStore = createConfigCenterStore("filesystem");
  const memoryStore = createMemoryStore();
  const rejection = new Error("boom");

  await startDevServer(3404, "127.0.0.1", {
    readMySqlPersistenceConfig: () => null,
    createFileSystemConfigCenterStore: () => configCenterStore,
    createMemoryRoomSnapshotStore: () => memoryStore,
    configureRoomSnapshotStore: () => undefined,
    createTransport: () => base.transport,
    readRedisUrl: () => null,
    createRedisPresence: () => {
      throw new Error("createRedisPresence should not be used without REDIS_URL");
    },
    createRedisDriver: () => {
      throw new Error("createRedisDriver should not be used without REDIS_URL");
    },
    registerAuthRoutes: () => undefined,
    registerConfigCenterRoutes: () => undefined,
    registerConfigViewerRoutes: () => undefined,
    registerGuildRoutes: () => undefined,
    registerPlayerAccountRoutes: () => undefined,
    registerShopRoutes: () => undefined,
    registerWechatPayRoutes: () => undefined,
    registerLobbyRoutes: () => undefined,
    registerMatchmakingRoutes: () => undefined,
    registerMinorProtectionPreviewRoutes: () => undefined,
    registerPrometheusMetricsMiddleware: () => undefined,
    registerPrometheusMetricsRoute: () => undefined,
    registerLeaderboardRoutes: () => undefined,
    registerSeasonRoutes: () => undefined,
    registerRuntimeObservabilityRoutes: () => undefined,
    registerAdminRoutes: () => undefined,
    createGameServer: (_transport, realtimeOptions) => {
      base.gameServer.realtimeOptions.push(realtimeOptions);
      return base.gameServer;
    },
    logger: base.logger,
    process: base.process,
    setInterval: () => {
      throw new Error("setInterval should not be used for in-memory startup");
    },
    clearInterval: () => undefined,
    isMySqlSnapshotStore: () => false
  });

  const unhandledRejection = base.process.handlers.unhandledRejection as ((reason: unknown) => void) | undefined;
  assert.ok(unhandledRejection);
  unhandledRejection?.(rejection);
  await flushAsyncWork();

  assert.equal(memoryStore.closeCalls, 1);
  assert.equal(configCenterStore.closeCalls, 1);
  assert.deepEqual(base.logger.errors, [
    {
      message: "Unhandled promise rejection in dev server",
      error: rejection
    }
  ]);
  assert.deepEqual(base.process.exitCodes, [1]);
});

test("dev server logs uncaught exceptions, closes stores, and exits non-zero", async () => {
  const base = createBaseDependencies();
  const configCenterStore = createConfigCenterStore("filesystem");
  const memoryStore = createMemoryStore();
  const exception = new Error("crash");

  await startDevServer(3505, "127.0.0.1", {
    readMySqlPersistenceConfig: () => null,
    createFileSystemConfigCenterStore: () => configCenterStore,
    createMemoryRoomSnapshotStore: () => memoryStore,
    configureRoomSnapshotStore: () => undefined,
    createTransport: () => base.transport,
    readRedisUrl: () => null,
    createRedisPresence: () => {
      throw new Error("createRedisPresence should not be used without REDIS_URL");
    },
    createRedisDriver: () => {
      throw new Error("createRedisDriver should not be used without REDIS_URL");
    },
    registerAuthRoutes: () => undefined,
    registerConfigCenterRoutes: () => undefined,
    registerConfigViewerRoutes: () => undefined,
    registerGuildRoutes: () => undefined,
    registerPlayerAccountRoutes: () => undefined,
    registerShopRoutes: () => undefined,
    registerWechatPayRoutes: () => undefined,
    registerLobbyRoutes: () => undefined,
    registerMatchmakingRoutes: () => undefined,
    registerMinorProtectionPreviewRoutes: () => undefined,
    registerPrometheusMetricsMiddleware: () => undefined,
    registerPrometheusMetricsRoute: () => undefined,
    registerLeaderboardRoutes: () => undefined,
    registerSeasonRoutes: () => undefined,
    registerRuntimeObservabilityRoutes: () => undefined,
    registerAdminRoutes: () => undefined,
    createGameServer: (_transport, realtimeOptions) => {
      base.gameServer.realtimeOptions.push(realtimeOptions);
      return base.gameServer;
    },
    logger: base.logger,
    process: base.process,
    setInterval: () => {
      throw new Error("setInterval should not be used for in-memory startup");
    },
    clearInterval: () => undefined,
    isMySqlSnapshotStore: () => false
  });

  const uncaughtException = base.process.handlers.uncaughtException as ((error: Error) => void) | undefined;
  assert.ok(uncaughtException);
  uncaughtException?.(exception);
  await flushAsyncWork();

  assert.equal(memoryStore.closeCalls, 1);
  assert.equal(configCenterStore.closeCalls, 1);
  assert.deepEqual(base.logger.errors, [
    {
      message: "Uncaught exception in dev server",
      error: exception
    }
  ]);
  assert.deepEqual(base.process.exitCodes, [1]);
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
    pool: {
      connectionLimit: 4,
      maxIdle: 4,
      idleTimeoutMs: 60_000,
      queueLimit: 0,
      waitForConnections: true
    },
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
    readRedisUrl: () => null,
    createRedisPresence: () => {
      throw new Error("createRedisPresence should not be used without REDIS_URL");
    },
    createRedisDriver: () => {
      throw new Error("createRedisDriver should not be used without REDIS_URL");
    },
    registerAuthRoutes: () => undefined,
    registerConfigCenterRoutes: () => undefined,
    registerConfigViewerRoutes: () => undefined,
    registerGuildRoutes: () => undefined,
    registerPlayerAccountRoutes: () => undefined,
    registerShopRoutes: () => undefined,
    registerWechatPayRoutes: () => undefined,
    registerLobbyRoutes: () => undefined,
    registerMatchmakingRoutes: () => undefined,
    registerMinorProtectionPreviewRoutes: () => undefined,
    registerPrometheusMetricsMiddleware: () => undefined,
    registerPrometheusMetricsRoute: () => undefined,
    registerLeaderboardRoutes: () => undefined,
    registerSeasonRoutes: () => undefined,
    registerRuntimeObservabilityRoutes: () => undefined,
    registerAdminRoutes: () => undefined,
    createGameServer: (_transport, realtimeOptions) => {
      base.gameServer.realtimeOptions.push(realtimeOptions);
      return base.gameServer;
    },
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
    /Prometheus metrics available at http:\/\/127\.0\.0\.1:3202\/metrics/,
    /Runtime metrics available at http:\/\/127\.0\.0\.1:3202\/api\/runtime\/metrics/,
    /Config center storage: filesystem/,
    /Local in-memory Colyseus presence\/driver enabled/,
    /Local in-memory room persistence enabled/
  ]);
});

test("dev server enables Redis-backed Colyseus scaling resources when REDIS_URL is set", async () => {
  const base = createBaseDependencies();
  const configCenterStore = createConfigCenterStore("filesystem");
  const memoryStore = createMemoryStore();
  const redisPresence = {
    shutdownCalls: 0,
    shutdown() {
      this.shutdownCalls += 1;
    }
  };
  const redisDriver = {
    shutdownCalls: 0,
    shutdown() {
      this.shutdownCalls += 1;
    }
  };

  await startDevServer(3123, "127.0.0.1", {
    readMySqlPersistenceConfig: () => null,
    createFileSystemConfigCenterStore: () => configCenterStore,
    createMemoryRoomSnapshotStore: () => memoryStore,
    configureRoomSnapshotStore: () => undefined,
    createTransport: () => base.transport,
    readRedisUrl: () => "redis://127.0.0.1:6379/0",
    createRedisPresence: () => redisPresence,
    createRedisDriver: () => redisDriver,
    registerAuthRoutes: () => undefined,
    registerConfigCenterRoutes: () => undefined,
    registerConfigViewerRoutes: () => undefined,
    registerGuildRoutes: () => undefined,
    registerPlayerAccountRoutes: () => undefined,
    registerShopRoutes: () => undefined,
    registerWechatPayRoutes: () => undefined,
    registerLobbyRoutes: () => undefined,
    registerMatchmakingRoutes: () => undefined,
    registerMinorProtectionPreviewRoutes: () => undefined,
    registerPrometheusMetricsMiddleware: () => undefined,
    registerPrometheusMetricsRoute: () => undefined,
    registerLeaderboardRoutes: () => undefined,
    registerSeasonRoutes: () => undefined,
    registerRuntimeObservabilityRoutes: () => undefined,
    registerAdminRoutes: () => undefined,
    createGameServer: (_transport, realtimeOptions) => {
      base.gameServer.realtimeOptions.push(realtimeOptions);
      return base.gameServer;
    },
    logger: base.logger,
    process: base.process,
    setInterval: () => {
      throw new Error("setInterval should not be used for in-memory startup");
    },
    clearInterval: () => undefined,
    isMySqlSnapshotStore: () => false
  });

  assert.deepEqual(base.gameServer.realtimeOptions, [{ driver: redisDriver, presence: redisPresence }]);
  assertStartupLogIncludes(base.logger, [/Redis-backed Colyseus presence\/driver enabled via REDIS_URL/]);

  base.process.handlers.SIGTERM?.();
  await flushAsyncWork();

  assert.equal(redisPresence.shutdownCalls, 1);
  assert.equal(redisDriver.shutdownCalls, 1);
  assert.equal(memoryStore.closeCalls, 1);
  assert.equal(configCenterStore.closeCalls, 1);
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
    pool: {
      connectionLimit: 4,
      maxIdle: 4,
      idleTimeoutMs: 60_000,
      queueLimit: 0,
      waitForConnections: true
    },
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
    readRedisUrl: () => null,
    createRedisPresence: () => {
      throw new Error("createRedisPresence should not be used without REDIS_URL");
    },
    createRedisDriver: () => {
      throw new Error("createRedisDriver should not be used without REDIS_URL");
    },
    registerAuthRoutes: () => undefined,
    registerConfigCenterRoutes: () => undefined,
    registerConfigViewerRoutes: () => undefined,
    registerGuildRoutes: () => undefined,
    registerPlayerAccountRoutes: () => undefined,
    registerShopRoutes: () => undefined,
    registerWechatPayRoutes: () => undefined,
    registerLobbyRoutes: () => undefined,
    registerMatchmakingRoutes: () => undefined,
    registerMinorProtectionPreviewRoutes: () => undefined,
    registerPrometheusMetricsMiddleware: () => undefined,
    registerPrometheusMetricsRoute: () => undefined,
    registerLeaderboardRoutes: () => undefined,
    registerSeasonRoutes: () => undefined,
    registerRuntimeObservabilityRoutes: () => undefined,
    registerAdminRoutes: () => undefined,
    createGameServer: (_transport, realtimeOptions) => {
      base.gameServer.realtimeOptions.push(realtimeOptions);
      return base.gameServer;
    },
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
    /Prometheus metrics available at http:\/\/127\.0\.0\.2:3303\/metrics/,
    /Runtime metrics available at http:\/\/127\.0\.0\.2:3303\/api\/runtime\/metrics/,
    /Config center storage: mysql/,
    /Local in-memory Colyseus presence\/driver enabled/,
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
