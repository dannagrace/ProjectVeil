import type { IncomingMessage, ServerResponse } from "node:http";
import { Server, WebSocketTransport } from "colyseus";
import { config as loadEnv } from "dotenv";
import { registerAuthRoutes } from "./auth";
import { registerAnalyticsRoutes } from "./analytics";
import {
  FileSystemConfigCenterStore,
  MySqlConfigCenterStore,
  registerConfigCenterRoutes,
  type ConfigCenterStore
} from "./config-center";
import { configureRoomSnapshotStore, listLobbyRooms, VeilColyseusRoom } from "./colyseus-room";
import { registerConfigViewerRoutes } from "./config-viewer";
import { registerEventRoutes } from "./event-engine";
import { registerGuildRoutes } from "./guilds";
import { registerLeaderboardRoutes } from "./leaderboard";
import { registerLobbyRoutes } from "./lobby";
import { registerMatchmakingRoutes } from "./matchmaking";
import { createMemoryRoomSnapshotStore } from "./memory-room-snapshot-store";
import { registerMinorProtectionPreviewRoutes } from "./minor-protection-preview";
import {
  buildPrometheusMetricsDocument,
  recordHttpRequestDuration,
  registerRuntimeObservabilityRoutes,
  type RuntimePersistenceHealth
} from "./observability";
import { type MySqlPersistenceConfig, MySqlRoomSnapshotStore, type RoomSnapshotStore, readMySqlPersistenceConfig, type SnapshotRetentionPolicy } from "./persistence";
import { registerPlayerAccountRoutes } from "./player-accounts";
import { closeRedisResource, createRedisDriver, createRedisPresence, readRedisUrl } from "./redis";
import { registerRetentionSummaryRoute } from "./retention-summary";
import { formatSchemaMigrationWarning, getSchemaMigrationStatus } from "./schema-migrations";
import { registerAdminRoutes } from "./admin-console";
import { registerSeasonRoutes } from "./seasons";
import { registerShopRoutes } from "./shop";
import { registerWechatPayRoutes } from "./wechat-pay";

loadEnv();

interface DevServerTransport {
  getExpressApp(): unknown;
}

interface DevServerHttpApp {
  use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void): void;
  get(path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): void;
  post(path: string, handler: (request: IncomingMessage, response: ServerResponse) => void | Promise<void>): void;
}

interface DevServerDefinitionChain {
  filterBy(fields: string[]): void;
}

interface DevServerGameServer {
  define(name: string, room: typeof VeilColyseusRoom): DevServerDefinitionChain;
  listen(port: number, host: string): Promise<void>;
}

interface DevServerRealtimeOptions {
  driver?: unknown;
  presence?: unknown;
}

interface DevServerLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, error: unknown): void;
}

interface DevServerProcess {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): void;
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  on(event: "uncaughtException", listener: (error: Error) => void): void;
  exit(code: number): never | void;
}

interface CleanupTimerHandle {
  unref?(): void;
}

interface DevServerConfigCenterStore {
  initializeRuntimeConfigs(): Promise<void>;
  close(): Promise<void>;
  readonly mode: "filesystem" | "mysql";
}

interface DevServerRoomSnapshotStore {
  close(): Promise<void>;
  clearAll?(): void;
}

interface DevServerMySqlSnapshotStore extends DevServerRoomSnapshotStore {
  pruneExpired(): Promise<number>;
  getRetentionPolicy(): SnapshotRetentionPolicy;
}

interface SchemaMigrationStatusSummary {
  pending: unknown[];
}

export interface DevServerBootstrapDependencies {
  readMySqlPersistenceConfig(): MySqlPersistenceConfig | null;
  getSchemaMigrationStatus(config: MySqlPersistenceConfig): Promise<SchemaMigrationStatusSummary>;
  formatSchemaMigrationWarning(status: SchemaMigrationStatusSummary): string;
  createFileSystemConfigCenterStore(): DevServerConfigCenterStore;
  createMySqlRoomSnapshotStore(config: MySqlPersistenceConfig): Promise<DevServerMySqlSnapshotStore>;
  createMySqlConfigCenterStore(config: MySqlPersistenceConfig): Promise<DevServerConfigCenterStore>;
  createMemoryRoomSnapshotStore(): DevServerRoomSnapshotStore;
  configureRoomSnapshotStore(store: DevServerRoomSnapshotStore): void;
  createTransport(): DevServerTransport;
  readRedisUrl(): string | null;
  createRedisPresence(redisUrl: string): { shutdown(): Promise<void> | void };
  createRedisDriver(redisUrl: string): { shutdown(): Promise<void> | void };
  registerAuthRoutes(app: unknown, store: DevServerRoomSnapshotStore): void;
  registerAnalyticsRoutes(app: unknown): void;
  registerConfigCenterRoutes(app: unknown, store: DevServerConfigCenterStore): void;
  registerConfigViewerRoutes(app: unknown, store: DevServerConfigCenterStore): void;
  registerEventRoutes(app: unknown, store: DevServerRoomSnapshotStore | null): void;
  registerGuildRoutes(app: unknown, store: DevServerRoomSnapshotStore): void;
  registerPlayerAccountRoutes(app: unknown, store: DevServerRoomSnapshotStore): void;
  registerShopRoutes(app: unknown, store: DevServerRoomSnapshotStore): void;
  registerWechatPayRoutes(app: unknown, store: DevServerRoomSnapshotStore): void;
  registerLobbyRoutes(app: unknown, dependencies: { listRooms: typeof listLobbyRooms }): void;
  registerMatchmakingRoutes(app: unknown, dependencies: { store: DevServerRoomSnapshotStore }): void;
  registerMinorProtectionPreviewRoutes(app: unknown, store: DevServerRoomSnapshotStore | null): void;
  registerLeaderboardRoutes(app: unknown, store: DevServerRoomSnapshotStore | null): void;
  registerSeasonRoutes(app: unknown, store: DevServerRoomSnapshotStore | null): void;
  registerRuntimeObservabilityRoutes(
    app: unknown,
    options?: { store?: DevServerRoomSnapshotStore; persistence?: RuntimePersistenceHealth }
  ): void;
  registerRetentionSummaryRoute(app: unknown, store: DevServerRoomSnapshotStore | null): void;
  registerPrometheusMetricsMiddleware(app: unknown): void;
  registerPrometheusMetricsRoute(app: unknown): void;
  registerAdminRoutes(app: unknown, store: DevServerRoomSnapshotStore, gameServer: DevServerGameServer): void;
  createGameServer(transport: DevServerTransport, realtimeOptions?: DevServerRealtimeOptions): DevServerGameServer;
  logger: DevServerLogger;
  process: DevServerProcess;
  setInterval(handler: () => void, delayMs: number): CleanupTimerHandle;
  clearInterval(timer: CleanupTimerHandle): void;
  isMySqlSnapshotStore(store: DevServerRoomSnapshotStore): store is DevServerMySqlSnapshotStore;
}

export function registerPrometheusMetricsMiddleware(app: DevServerHttpApp): void {
  app.use((request, response, next) => {
    const startedAt = process.hrtime.bigint();
    let recorded = false;

    const recordDuration = (): void => {
      if (recorded) {
        return;
      }

      recorded = true;
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
      recordHttpRequestDuration(durationSeconds);
    };

    response.once("finish", recordDuration);
    response.once("close", recordDuration);
    next();
  });
}

export function registerPrometheusMetricsRoute(app: DevServerHttpApp): void {
  app.get("/metrics", async (_request, response) => {
    response.statusCode = 200;
    response.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
    response.end(`${buildPrometheusMetricsDocument()}\n`);
  });
}

function createDefaultDevServerBootstrapDependencies(): DevServerBootstrapDependencies {
  return {
    readMySqlPersistenceConfig,
    getSchemaMigrationStatus,
    formatSchemaMigrationWarning,
    createFileSystemConfigCenterStore: () => new FileSystemConfigCenterStore(),
    createMySqlRoomSnapshotStore: (config) => MySqlRoomSnapshotStore.create(config),
    createMySqlConfigCenterStore: (config) => MySqlConfigCenterStore.create(config) as Promise<ConfigCenterStore>,
    createMemoryRoomSnapshotStore: () => createMemoryRoomSnapshotStore(),
    configureRoomSnapshotStore: (store) => configureRoomSnapshotStore(store as RoomSnapshotStore),
    createTransport: () => new WebSocketTransport(),
    readRedisUrl,
    createRedisPresence,
    createRedisDriver,
    registerAuthRoutes: (app, store) => registerAuthRoutes(app as never, store as RoomSnapshotStore),
    registerAnalyticsRoutes: (app) => registerAnalyticsRoutes(app as never),
    registerConfigCenterRoutes: (app, store) => registerConfigCenterRoutes(app as never, store as ConfigCenterStore),
    registerConfigViewerRoutes: (app, store) => registerConfigViewerRoutes(app as never, store as ConfigCenterStore),
    registerEventRoutes: (app, store) => registerEventRoutes(app as never, store as RoomSnapshotStore | null),
    registerGuildRoutes: (app, store) => registerGuildRoutes(app as never, store as RoomSnapshotStore),
    registerPlayerAccountRoutes: (app, store) => registerPlayerAccountRoutes(app as never, store as RoomSnapshotStore),
    registerShopRoutes: (app, store) => registerShopRoutes(app as never, store as RoomSnapshotStore),
    registerWechatPayRoutes: (app, store) => registerWechatPayRoutes(app as never, store as RoomSnapshotStore),
    registerLobbyRoutes: (app, dependencies) => registerLobbyRoutes(app as never, dependencies),
    registerMatchmakingRoutes: (app, dependencies) =>
      registerMatchmakingRoutes(app as never, { store: dependencies.store as RoomSnapshotStore }),
    registerMinorProtectionPreviewRoutes: (app, store) =>
      registerMinorProtectionPreviewRoutes(app as never, store as RoomSnapshotStore | null),
    registerLeaderboardRoutes: (app, store) => registerLeaderboardRoutes(app as never, store as RoomSnapshotStore | null),
    registerSeasonRoutes: (app, store) => registerSeasonRoutes(app as never, store as RoomSnapshotStore | null),
    registerRuntimeObservabilityRoutes: (app, options) => registerRuntimeObservabilityRoutes(app as never, options),
    registerRetentionSummaryRoute: (app, store) =>
      registerRetentionSummaryRoute(app as never, store as RoomSnapshotStore | null),
    registerPrometheusMetricsMiddleware: (app) => registerPrometheusMetricsMiddleware(app as DevServerHttpApp),
    registerPrometheusMetricsRoute: (app) => registerPrometheusMetricsRoute(app as DevServerHttpApp),
    registerAdminRoutes: (app, store, gameServer) =>
      registerAdminRoutes(app as never, store as RoomSnapshotStore, gameServer),
    createGameServer: (transport, realtimeOptions) =>
      new Server({
        transport: transport as WebSocketTransport,
        driver: realtimeOptions?.driver as never,
        presence: realtimeOptions?.presence as never
      }),
    logger: console,
    process,
    setInterval: (handler, delayMs) => setInterval(handler, delayMs),
    clearInterval: (timer) => clearInterval(timer as NodeJS.Timeout),
    isMySqlSnapshotStore: (store): store is DevServerMySqlSnapshotStore => store instanceof MySqlRoomSnapshotStore
  };
}

export async function startDevServer(
  port = Number(process.env.PORT ?? 2567),
  host = process.env.HOST ?? "0.0.0.0",
  dependencies: Partial<DevServerBootstrapDependencies> = {}
): Promise<void> {
  const deps = {
    ...createDefaultDevServerBootstrapDependencies(),
    ...dependencies
  };
  const isProductionEnvironment = process.env.NODE_ENV?.trim().toLowerCase() === "production";

  const mysqlConfig = deps.readMySqlPersistenceConfig();
  let snapshotStore: DevServerMySqlSnapshotStore | null = null;
  let configCenterStore = deps.createFileSystemConfigCenterStore();
  let persistenceHealth: RuntimePersistenceHealth = {
    status: "degraded",
    storage: "memory",
    message: "In-memory room persistence active; room data will not survive process restarts."
  };

  const failStartup = async (message: string, error?: unknown): Promise<never> => {
    deps.logger.error(message, error ?? new Error(message));
    await configCenterStore.close().catch((closeError) => {
      deps.logger.error("Failed to close config center store during startup abort", closeError);
    });
    deps.process.exit(1);
    throw error instanceof Error ? error : new Error(message);
  };

  if (mysqlConfig) {
    try {
      const migrationStatus = await deps.getSchemaMigrationStatus(mysqlConfig);
      if (migrationStatus.pending.length > 0) {
        const warning = deps.formatSchemaMigrationWarning(migrationStatus);
        if (isProductionEnvironment) {
          await failStartup(
            "Refusing to start with in-memory persistence in production while schema migrations are pending",
            new Error(warning)
          );
        }
        deps.logger.warn(warning);
      } else {
        const mysqlSnapshotStore = await deps.createMySqlRoomSnapshotStore(mysqlConfig);
        try {
          const mysqlConfigCenterStore = await deps.createMySqlConfigCenterStore(mysqlConfig);
          snapshotStore = mysqlSnapshotStore;
          configCenterStore = mysqlConfigCenterStore;
          persistenceHealth = {
            status: "ok",
            storage: "mysql",
            message: "MySQL room persistence active."
          };
        } catch (error) {
          await mysqlSnapshotStore.close().catch((closeError) => {
            deps.logger.error("Failed to close MySQL snapshot store after startup error", closeError);
          });
          throw error;
        }
      }
    } catch (error) {
      if (isProductionEnvironment) {
        await failStartup("MySQL migration/bootstrap failed during production startup", error);
      }
      deps.logger.warn(
        `MySQL migration/bootstrap failed; falling back to in-memory room persistence in non-production mode: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const effectiveSnapshotStore = snapshotStore ?? deps.createMemoryRoomSnapshotStore();
  deps.configureRoomSnapshotStore(effectiveSnapshotStore);
  await configCenterStore.initializeRuntimeConfigs();
  const redisUrl = deps.readRedisUrl();
  const redisPresence = redisUrl ? deps.createRedisPresence(redisUrl) : null;
  const redisDriver = redisUrl ? deps.createRedisDriver(redisUrl) : null;

  const transport = deps.createTransport();
  const expressApp = transport.getExpressApp();
  deps.registerPrometheusMetricsMiddleware(expressApp);
  deps.registerPrometheusMetricsRoute(expressApp);
  deps.registerAuthRoutes(expressApp, effectiveSnapshotStore);
  deps.registerAnalyticsRoutes(expressApp);
  deps.registerConfigCenterRoutes(expressApp, configCenterStore);
  deps.registerConfigViewerRoutes(expressApp, configCenterStore);
  if ("use" in (expressApp as object) && "get" in (expressApp as object)) {
    deps.registerEventRoutes(expressApp, effectiveSnapshotStore);
  }
  deps.registerGuildRoutes(expressApp, effectiveSnapshotStore);
  deps.registerPlayerAccountRoutes(expressApp, effectiveSnapshotStore);
  deps.registerShopRoutes(expressApp, effectiveSnapshotStore);
  deps.registerWechatPayRoutes(expressApp, effectiveSnapshotStore);
  deps.registerLobbyRoutes(expressApp, { listRooms: listLobbyRooms });
  deps.registerMatchmakingRoutes(expressApp, { store: effectiveSnapshotStore });
  deps.registerMinorProtectionPreviewRoutes(expressApp, effectiveSnapshotStore);
  deps.registerLeaderboardRoutes(expressApp, effectiveSnapshotStore);
  deps.registerSeasonRoutes(expressApp, effectiveSnapshotStore);
  deps.registerRuntimeObservabilityRoutes(expressApp, {
    store: effectiveSnapshotStore,
    persistence: persistenceHealth
  });
  if ("get" in (expressApp as object)) {
    deps.registerRetentionSummaryRoute(expressApp, effectiveSnapshotStore);
  }

  const gameServer = deps.createGameServer(transport, {
    driver: redisDriver ?? undefined,
    presence: redisPresence ?? undefined
  });
  deps.registerAdminRoutes(expressApp, effectiveSnapshotStore, gameServer);
  gameServer.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await gameServer.listen(port, host);

  deps.logger.log(`Project Veil Colyseus dev server listening on ws://${host}:${port}`);
  deps.logger.log(`Config center API available at http://${host}:${port}/api/config-center/configs`);
  deps.logger.log(`Config viewer available at http://${host}:${port}/config-viewer`);
  deps.logger.log(`Player account API available at http://${host}:${port}/api/player-accounts`);
  deps.logger.log(`Guild API available at http://${host}:${port}/api/guilds`);
  deps.logger.log(`Guest auth API available at http://${host}:${port}/api/auth/guest-login`);
  deps.logger.log(`WeChat auth API available at http://${host}:${port}/api/auth/wechat-login`);
  deps.logger.log(`WeChat Pay API available at http://${host}:${port}/api/payments/wechat/create`);
  deps.logger.log(`Lobby API available at http://${host}:${port}/api/lobby/rooms`);
  deps.logger.log(`Matchmaking API available at http://${host}:${port}/api/matchmaking/status`);
  deps.logger.log(`Runtime health available at http://${host}:${port}/api/runtime/health`);
  deps.logger.log(`Auth readiness available at http://${host}:${port}/api/runtime/auth-readiness`);
  deps.logger.log(`Runtime diagnostic snapshot available at http://${host}:${port}/api/runtime/diagnostic-snapshot`);
  deps.logger.log(`Prometheus metrics available at http://${host}:${port}/metrics`);
  deps.logger.log(`Runtime metrics available at http://${host}:${port}/api/runtime/metrics`);
  deps.logger.log(`Retention summary available at http://${host}:${port}/ops/retention-summary`);
  deps.logger.log(`Config center storage: ${configCenterStore.mode}`);
  if (redisUrl) {
    deps.logger.log("Redis-backed Colyseus presence/driver enabled via REDIS_URL");
  } else {
    deps.logger.log("Local in-memory Colyseus presence/driver enabled");
  }
  if (snapshotStore) {
    deps.logger.log("Persistence mode: production/mysql");
  } else {
    deps.logger.log("Persistence mode: degraded/in-memory");
    deps.logger.log(persistenceHealth.message);
  }

  let cleanupTimer: CleanupTimerHandle | null = null;
  if (deps.isMySqlSnapshotStore(effectiveSnapshotStore)) {
    const retention = effectiveSnapshotStore.getRetentionPolicy();
    deps.logger.log(
      `Snapshot retention: ttl=${retention.ttlHours == null ? "disabled" : `${retention.ttlHours}h`} / cleanup=${retention.cleanupIntervalMinutes == null ? "disabled" : `${retention.cleanupIntervalMinutes}m`}`
    );

    const runCleanup = async (): Promise<void> => {
      const removed = await effectiveSnapshotStore.pruneExpired();
      if (removed > 0) {
        deps.logger.log(`Pruned ${removed} expired room snapshot(s)`);
      }
    };

    await runCleanup();

    if (retention.cleanupIntervalMinutes != null) {
      cleanupTimer = deps.setInterval(() => {
        void runCleanup().catch((error) => {
          deps.logger.error("Failed to prune expired room snapshots", error);
        });
      }, retention.cleanupIntervalMinutes * 60 * 1000);
      cleanupTimer.unref?.();
    }
  }

  const closeStore = async (): Promise<void> => {
    if (cleanupTimer) {
      deps.clearInterval(cleanupTimer);
      cleanupTimer = null;
    }

    if (!snapshotStore) {
      await effectiveSnapshotStore.close();
      await configCenterStore.close();
      await closeRedisResource(redisPresence);
      await closeRedisResource(redisDriver);
      return;
    }

    await Promise.all([
      effectiveSnapshotStore.close(),
      configCenterStore.close(),
      closeRedisResource(redisPresence),
      closeRedisResource(redisDriver)
    ]);
  };

  let shutdownStarted = false;
  const shutdown = (exitCode: number, message?: string, error?: unknown): void => {
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;

    if (message) {
      deps.logger.error(message, error);
    }

    void closeStore().finally(() => deps.process.exit(exitCode));
  };

  deps.process.once("SIGINT", () => {
    shutdown(0);
  });
  deps.process.once("SIGTERM", () => {
    shutdown(0);
  });
  deps.process.on("unhandledRejection", (reason) => {
    shutdown(1, "Unhandled promise rejection in dev server", reason);
  });
  deps.process.on("uncaughtException", (error) => {
    shutdown(1, "Uncaught exception in dev server", error);
  });
}

if (import.meta.main) {
  void startDevServer();
  // Keep the process alive - the Colyseus WebSocket transport may unref its
  // handles under tsx, causing Node to exit once the event loop drains.
  setInterval(() => {}, 30_000);
}
