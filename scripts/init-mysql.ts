import { config as loadEnv } from "dotenv";
import { buildMySqlSchemaSql, createConfiguredRoomSnapshotStore, readMySqlPersistenceConfig } from "../apps/server/src/persistence";

loadEnv();

async function main(): Promise<void> {
  const config = readMySqlPersistenceConfig();
  if (!config) {
    throw new Error(
      "Missing MySQL env config. Set VEIL_MYSQL_HOST, VEIL_MYSQL_USER, VEIL_MYSQL_PASSWORD and optionally VEIL_MYSQL_PORT / VEIL_MYSQL_DATABASE."
    );
  }

  const store = await createConfiguredRoomSnapshotStore();
  if (!store) {
    throw new Error("Failed to initialize MySQL room snapshot store.");
  }

  await store.close();

  console.log("MySQL persistence schema initialized successfully.");
  console.log(`Database: ${config.database}`);
  console.log("Schema SQL:");
  console.log(buildMySqlSchemaSql(config.database));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
