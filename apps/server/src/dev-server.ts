import { Server, WebSocketTransport } from "colyseus";
import { config as loadEnv } from "dotenv";
import { registerAuthRoutes } from "./auth";
import { FileSystemConfigCenterStore, MySqlConfigCenterStore, registerConfigCenterRoutes } from "./config-center";
import { configureRoomSnapshotStore, listLobbyRooms, VeilColyseusRoom } from "./colyseus-room";
import { registerLobbyRoutes } from "./lobby";
import { registerMatchmakingRoutes } from "./matchmaking";
import { registerRuntimeObservabilityRoutes } from "./observability";
import { MySqlRoomSnapshotStore, readMySqlPersistenceConfig } from "./persistence";
import { registerPlayerAccountRoutes } from "./player-accounts";
import { registerConfigViewerRoutes } from "./config-viewer";
import { createMemoryRoomSnapshotStore } from "./memory-room-snapshot-store";
import { formatSchemaMigrationWarning, getSchemaMigrationStatus } from "./schema-migrations";

loadEnv();

async function startDevServer(
  port = Number(process.env.PORT ?? 2567),
  host = process.env.HOST ?? "127.0.0.1"
): Promise<void> {
  const mysqlConfig = readMySqlPersistenceConfig();
  let snapshotStore: MySqlRoomSnapshotStore | null = null;
  let configCenterStore: FileSystemConfigCenterStore | MySqlConfigCenterStore = new FileSystemConfigCenterStore();

  if (mysqlConfig) {
    const migrationStatus = await getSchemaMigrationStatus(mysqlConfig);
    if (migrationStatus.pending.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(formatSchemaMigrationWarning(migrationStatus));
    } else {
      snapshotStore = await MySqlRoomSnapshotStore.create(mysqlConfig);
      configCenterStore = await MySqlConfigCenterStore.create(mysqlConfig);
    }
  }

  const effectiveSnapshotStore = snapshotStore ?? createMemoryRoomSnapshotStore();
  configureRoomSnapshotStore(effectiveSnapshotStore);
  await configCenterStore.initializeRuntimeConfigs();
  const transport = new WebSocketTransport();
  registerAuthRoutes(transport.getExpressApp() as never, effectiveSnapshotStore);
  registerConfigCenterRoutes(transport.getExpressApp() as never, configCenterStore);
  registerConfigViewerRoutes(transport.getExpressApp() as never, configCenterStore);
  registerPlayerAccountRoutes(transport.getExpressApp() as never, effectiveSnapshotStore);
  registerLobbyRoutes(transport.getExpressApp() as never, { listRooms: listLobbyRooms });
  registerMatchmakingRoutes(transport.getExpressApp() as never, { store: effectiveSnapshotStore });
  registerRuntimeObservabilityRoutes(transport.getExpressApp() as never);

  const gameServer = new Server({
    transport
  });

  gameServer.define("veil", VeilColyseusRoom).filterBy(["logicalRoomId"]);
  await gameServer.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`Project Veil Colyseus dev server listening on ws://${host}:${port}`);
  // eslint-disable-next-line no-console
  console.log(`Config center API available at http://${host}:${port}/api/config-center/configs`);
  // eslint-disable-next-line no-console
  console.log(`Config viewer available at http://${host}:${port}/config-viewer`);
  // eslint-disable-next-line no-console
  console.log(`Player account API available at http://${host}:${port}/api/player-accounts`);
  // eslint-disable-next-line no-console
  console.log(`Guest auth API available at http://${host}:${port}/api/auth/guest-login`);
  // eslint-disable-next-line no-console
  console.log(`WeChat mini game auth scaffold available at http://${host}:${port}/api/auth/wechat-mini-game-login`);
  // eslint-disable-next-line no-console
  console.log(`Lobby API available at http://${host}:${port}/api/lobby/rooms`);
  // eslint-disable-next-line no-console
  console.log(`Matchmaking API available at http://${host}:${port}/api/matchmaking/status`);
  // eslint-disable-next-line no-console
  console.log(`Runtime health available at http://${host}:${port}/api/runtime/health`);
  // eslint-disable-next-line no-console
  console.log(`Auth readiness available at http://${host}:${port}/api/runtime/auth-readiness`);
  // eslint-disable-next-line no-console
  console.log(`Runtime metrics available at http://${host}:${port}/api/runtime/metrics`);
  // eslint-disable-next-line no-console
  console.log(`Config center storage: ${configCenterStore.mode}`);
  if (snapshotStore) {
    // eslint-disable-next-line no-console
    console.log("MySQL room persistence enabled");
  } else {
    // eslint-disable-next-line no-console
    console.log("Local in-memory room persistence enabled");
  }

  let cleanupTimer: NodeJS.Timeout | null = null;
  if (snapshotStore instanceof MySqlRoomSnapshotStore) {
    const retention = snapshotStore.getRetentionPolicy();
    // eslint-disable-next-line no-console
    console.log(
      `Snapshot retention: ttl=${retention.ttlHours == null ? "disabled" : `${retention.ttlHours}h`} / cleanup=${retention.cleanupIntervalMinutes == null ? "disabled" : `${retention.cleanupIntervalMinutes}m`}`
    );

    const runCleanup = async (): Promise<void> => {
      const removed = await snapshotStore.pruneExpired();
      if (removed > 0) {
        // eslint-disable-next-line no-console
        console.log(`Pruned ${removed} expired room snapshot(s)`);
      }
    };

    await runCleanup();

    if (retention.cleanupIntervalMinutes != null) {
      cleanupTimer = setInterval(() => {
        void runCleanup().catch((error) => {
          // eslint-disable-next-line no-console
          console.error("Failed to prune expired room snapshots", error);
        });
      }, retention.cleanupIntervalMinutes * 60 * 1000);
      cleanupTimer.unref?.();
    }
  }

  const closeStore = async (): Promise<void> => {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }

    if (!snapshotStore) {
      await effectiveSnapshotStore.close();
      await configCenterStore.close();
      return;
    }

    await Promise.all([effectiveSnapshotStore.close(), configCenterStore.close()]);
  };

  process.once("SIGINT", () => {
    void closeStore().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void closeStore().finally(() => process.exit(0));
  });
}

void startDevServer();
