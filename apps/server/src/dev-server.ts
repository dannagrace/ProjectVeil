import { Server, WebSocketTransport } from "colyseus";
import { config as loadEnv } from "dotenv";
import { createConfiguredConfigCenterStore, registerConfigCenterRoutes } from "./config-center";
import { configureRoomSnapshotStore, VeilColyseusRoom } from "./colyseus-room";
import { createConfiguredRoomSnapshotStore, MySqlRoomSnapshotStore } from "./persistence";

loadEnv();

async function startDevServer(
  port = Number(process.env.PORT ?? 2567),
  host = process.env.HOST ?? "127.0.0.1"
): Promise<void> {
  const snapshotStore = await createConfiguredRoomSnapshotStore();
  configureRoomSnapshotStore(snapshotStore);
  const configCenterStore = await createConfiguredConfigCenterStore();
  await configCenterStore.initializeRuntimeConfigs();
  const transport = new WebSocketTransport();
  registerConfigCenterRoutes(transport.getExpressApp() as never, configCenterStore);

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
  console.log(`Config center storage: ${configCenterStore.mode}`);
  if (snapshotStore) {
    // eslint-disable-next-line no-console
    console.log("MySQL room persistence enabled");
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
      await configCenterStore.close();
      return;
    }

    await Promise.all([snapshotStore.close(), configCenterStore.close()]);
  };

  process.once("SIGINT", () => {
    void closeStore().finally(() => process.exit(0));
  });
  process.once("SIGTERM", () => {
    void closeStore().finally(() => process.exit(0));
  });
}

void startDevServer();
