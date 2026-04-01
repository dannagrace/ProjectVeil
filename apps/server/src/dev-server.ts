import { Server, WebSocketTransport } from "colyseus";
import { config as loadEnv } from "dotenv";
import { registerAuthRoutes } from "./auth";
import {
  FileSystemConfigCenterStore,
  MySqlConfigCenterStore,
  registerConfigCenterRoutes,
  type ConfigCenterStore
} from "./config-center";
import { configureRoomSnapshotStore, listLobbyRooms, VeilColyseusRoom } from "./colyseus-room";
import { registerConfigViewerRoutes } from "./config-viewer";
import { registerLobbyRoutes } from "./lobby";
import { registerMatchmakingRoutes } from "./matchmaking";
import { createMemoryRoomSnapshotStore } from "./memory-room-snapshot-store";
import { registerRuntimeObservabilityRoutes } from "./observability";
import {
  MySqlRoomSnapshotStore,
  readMySqlPersistenceConfig,
  type MySqlPersistenceConfig,
  type RoomSnapshotStore,
  type SnapshotRetentionPolicy
} from "./persistence";
import { registerPlayerAccountRoutes } from "./player-accounts";
import { registerAdminRoutes } from "./admin-console";
import { formatSchemaMigrationWarning, getSchemaMigrationStatus } from "./schema-migrations";

loadEnv();

interface DevServerTransport {
  getExpressApp(): unknown;
}

interface DevServerDefinitionChain {
  filterBy(fields: string[]): void;
}

interface DevServerGameServer {
  define(name: string, room: typeof VeilColyseusRoom): DevServerDefinitionChain;
  listen(port: number, host: string): Promise<void>;
}

interface DevServerLogger {
  log(message: string): void;
  warn(message: string): void;
  error(message: string, error: unknown): void;
}

interface DevServerProcess {
  once(event: "SIGINT" | "SIGTERM", listener: () => void): void;
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
  registerAuthRoutes(app: unknown, store: DevServerRoomSnapshotStore): void;
  registerConfigCenterRoutes(app: unknown, store: DevServerConfigCenterStore): void;
  registerConfigViewerRoutes(app: unknown, store: DevServerConfigCenterStore): void;
  registerPlayerAccountRoutes(app: unknown, store: DevServerRoomSnapshotStore): void;
  registerLobbyRoutes(app: unknown, dependencies: { listRooms: typeof listLobbyRooms }): void;
  registerMatchmakingRoutes(app: unknown, dependencies: { store: DevServerRoomSnapshotStore }): void;
  registerRuntimeObservabilityRoutes(app: unknown, options?: { store?: DevServerRoomSnapshotStore }): void;
  registerAdminRoutes(app: unknown, store: DevServerRoomSnapshotStore, gameServer: DevServerGameServer): void;
  createGameServer(transport: DevServerTransport): DevServerGameServer;
  logger: DevServerLogger;
  process: DevServerProcess;
  setInterval(handler: () => void, delayMs: number): CleanupTimerHandle;
  clearInterval(timer: CleanupTimerHandle): void;
  isMySqlSnapshotStore(store: DevServerRoomSnapshotStore): store is DevServerMySqlSnapshotStore;
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
    registerAuthRoutes: (app, store) => registerAuthRoutes(app as never, store as RoomSnapshotStore),
    registerConfigCenterRoutes: (app, store) => registerConfigCenterRoutes(app as never, store as ConfigCenterStore),
    registerConfigViewerRoutes: (app, store) => registerConfigViewerRoutes(app as never, store as ConfigCenterStore),
    registerPlayerAccountRoutes: (app, store) => registerPlayerAccountRoutes(app as never, store as RoomSnapshotStore),
    registerLobbyRoutes: (app, dependencies) => registerLobbyRoutes(app as never, dependencies),
    registerMatchmakingRoutes: (app, dependencies) =>
      registerMatchmakingRoutes(app as never, { store: dependencies.store as RoomSnapshotStore }),
    registerRuntimeObservabilityRoutes: (app, options) => registerRuntimeObservabilityRoutes(app as never, options),
    registerAdminRoutes: (app, store, gameServer) =>
      registerAdminRoutes(app as never, store as RoomSnapshotStore, gameServer),
    createGameServer: (transport) =>
      new Server({
        transport: transport as WebSocketTransport
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

  const mysqlConfig = deps.readMySqlPersistenceConfig();
  let snapshotStore: DevServerMySqlSnapshotStore | null = null;
  let configCenterStore = deps.createFileSystemConfigCenterStore();

  if (mysqlConfig) {
    const migrationStatus = await deps.getSchemaMigrationStatus(mysqlConfig);
    if (migrationStatus.pending.length > 0) {
      deps.logger.warn(deps.formatSchemaMigrationWarning(migrationStatus));
    } else {
      snapshotStore = await deps.createMySqlRoomSnapshotStore(mysqlConfig);
      configCenterStore = await deps.createMySqlConfigCenterStore(mysqlConfig);
    }
  }

  const effectiveSnapshotStore = snapshotStore ?? deps.createMemoryRoomSnapshotStore();
  deps.configureRoomSnapshotStore(effectiveSnapshotStore);
  await configCenterStore.initializeRuntimeConfigs();

  const transport = deps.createTransport();
  const expressApp = transport.getExpressApp();
  deps.registerAuthRoutes(expressApp, effectiveSnapshotStore);
  deps.registerConfigCenterRoutes(expressApp, configCenterStore);
  deps.registerConfigViewerRoutes(expressApp, configCenterStore);
  deps.registerPlayerAccountRoutes(expressApp, effectiveSnapshotStore);
  deps.registerLobbyRoutes(expressApp, { listRooms: listLobbyRooms });
  deps.registerMatchmakingRoutes(expressApp, { store: effectiveSnapshotStore });
  deps.registerRuntimeObservabilityRoutes(expressApp, { store: effectiveSnapshotStore });

  const gameServer = deps.createGameServer(transport);
  deps.registerAdminRoutes(expressApp, effectiveSnapshotStore, gameServer);
  gameServer.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await gameServer.listen(port, host);

  deps.logger.log(`Project Veil Colyseus dev server listening on ws://${host}:${port}`);
  deps.logger.log(`Config center API available at http://${host}:${port}/api/config-center/configs`);
  deps.logger.log(`Config viewer available at http://${host}:${port}/config-viewer`);
  deps.logger.log(`Player account API available at http://${host}:${port}/api/player-accounts`);
  deps.logger.log(`Guest auth API available at http://${host}:${port}/api/auth/guest-login`);
  deps.logger.log(`WeChat auth API available at http://${host}:${port}/api/auth/wechat-login`);
  deps.logger.log(`Lobby API available at http://${host}:${port}/api/lobby/rooms`);
  deps.logger.log(`Matchmaking API available at http://${host}:${port}/api/matchmaking/status`);
  deps.logger.log(`Runtime health available at http://${host}:${port}/api/runtime/health`);
  deps.logger.log(`Auth readiness available at http://${host}:${port}/api/runtime/auth-readiness`);
  deps.logger.log(`Runtime diagnostic snapshot available at http://${host}:${port}/api/runtime/diagnostic-snapshot`);
  deps.logger.log(`Runtime metrics available at http://${host}:${port}/api/runtime/metrics`);
  deps.logger.log(`Config center storage: ${configCenterStore.mode}`);
  if (snapshotStore) {
    deps.logger.log("MySQL room persistence enabled");
  } else {
    deps.logger.log("Local in-memory room persistence enabled");
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
      return;
    }

    await Promise.all([effectiveSnapshotStore.close(), configCenterStore.close()]);
  };

  deps.process.once("SIGINT", () => {
    void closeStore().finally(() => deps.process.exit(0));
  });
  deps.process.once("SIGTERM", () => {
    void closeStore().finally(() => deps.process.exit(0));
  });
}

if (import.meta.main) {
  void startDevServer();
}

// Keep the process alive — the Colyseus WebSocket transport may unref its
// handles under tsx, causing Node to exit once the event loop drains.
setInterval(() => {}, 30_000);
