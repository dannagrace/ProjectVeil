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
  console.log("  npm run db -- profiles:list -- --limit 20");
  console.log("  npm run db -- profiles:list -- --roomId test-room");
  console.log("  npm run db -- profiles:list -- --playerId player-1");
  console.log("  npm run db -- profiles:delete -- --roomId test-room --playerId player-1");
  console.log("  npm run db -- profiles:prune");
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
      const roomId = readFlag("--roomId");
      const playerId = readFlag("--playerId");
      const profiles = await store.listPlayerProfiles({
        limit,
        ...(roomId ? { roomId } : {}),
        ...(playerId ? { playerId } : {})
      });
      const retention = store.getRetentionPolicy();

      console.log(`Database: ${config.database}`);
      console.log(
        `Retention: ttl=${retention.ttlHours == null ? "disabled" : `${retention.ttlHours}h`} / cleanup=${retention.cleanupIntervalMinutes == null ? "disabled" : `${retention.cleanupIntervalMinutes}m`}`
      );

      if (profiles.length === 0) {
        console.log("No player room profiles found.");
        return;
      }

      console.table(
        profiles.map((profile) => ({
          roomId: profile.roomId,
          playerId: profile.playerId,
          version: profile.version,
          heroCount: profile.heroCount,
          gold: profile.resources.gold,
          wood: profile.resources.wood,
          ore: profile.resources.ore,
          updatedAt: formatTimestamp(profile.updatedAt),
          createdAt: formatTimestamp(profile.createdAt),
          payloadBytes: profile.payloadBytes,
          expired: profile.expired
        }))
      );
      return;
    }

    if (command === "delete") {
      const roomId = readFlag("--roomId");
      const playerId = readFlag("--playerId");
      if (!roomId || !playerId) {
        throw new Error(
          "Missing --roomId or --playerId. Example: npm run db -- profiles:delete -- --roomId test-room --playerId player-1"
        );
      }

      const removed = await store.deletePlayerProfile(roomId, playerId);
      console.log(`Deleted ${removed} player room profile(s) for ${roomId} / ${playerId}.`);
      return;
    }

    if (command === "prune") {
      const removed = await store.pruneExpiredPlayerProfiles();
      console.log(`Pruned ${removed} expired player room profile(s).`);
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
