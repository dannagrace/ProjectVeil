import { config as loadEnv } from "dotenv";
import { MySqlRoomSnapshotStore, readMySqlPersistenceConfig } from "../apps/server/src/persistence";

loadEnv();

function readFlag(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  return process.argv[index + 1];
}

function formatTimestamp(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function printUsage(): void {
  console.log("Usage:");
  console.log("  npm run db:snapshots:list -- --limit 20");
  console.log("  npm run db:snapshots:delete -- --roomId test-room");
  console.log("  npm run db:snapshots:prune");
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help") {
    printUsage();
    return;
  }

  const config = readMySqlPersistenceConfig();
  if (!config) {
    throw new Error(
      "Missing MySQL env config. Set VEIL_MYSQL_HOST, VEIL_MYSQL_USER, VEIL_MYSQL_PASSWORD and optionally VEIL_MYSQL_PORT / VEIL_MYSQL_DATABASE."
    );
  }

  const store = await MySqlRoomSnapshotStore.create(config);

  try {
    if (command === "list") {
      const limit = Number(readFlag("--limit") ?? 20);
      const snapshots = await store.listSnapshots(limit);
      const retention = store.getRetentionPolicy();

      console.log(`Database: ${config.database}`);
      console.log(
        `Retention: ttl=${retention.ttlHours == null ? "disabled" : `${retention.ttlHours}h`} / cleanup=${retention.cleanupIntervalMinutes == null ? "disabled" : `${retention.cleanupIntervalMinutes}m`}`
      );

      if (snapshots.length === 0) {
        console.log("No room snapshots found.");
        return;
      }

      console.table(
        snapshots.map((snapshot) => ({
          roomId: snapshot.roomId,
          version: snapshot.version,
          updatedAt: formatTimestamp(snapshot.updatedAt),
          createdAt: formatTimestamp(snapshot.createdAt),
          payloadBytes: snapshot.payloadBytes,
          expired: snapshot.expired
        }))
      );
      return;
    }

    if (command === "delete") {
      const roomId = readFlag("--roomId");
      if (!roomId) {
        throw new Error("Missing --roomId. Example: npm run db:snapshots:delete -- --roomId test-room");
      }

      await store.delete(roomId);
      console.log(`Deleted room snapshot: ${roomId}`);
      return;
    }

    if (command === "prune") {
      const removed = await store.pruneExpired();
      console.log(`Pruned ${removed} expired room snapshot(s).`);
      return;
    }

    throw new Error(`Unknown command: ${command}`);
  } finally {
    await store.close();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
