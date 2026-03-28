import { config as loadEnv } from "dotenv";
import { readMySqlPersistenceConfig } from "../apps/server/src/persistence";
import { runPendingSchemaMigrations } from "../apps/server/src/schema-migrations";

loadEnv();

async function main(): Promise<void> {
  const config = readMySqlPersistenceConfig();
  if (!config) {
    throw new Error(
      "Missing MySQL env config. Set VEIL_MYSQL_HOST, VEIL_MYSQL_USER, VEIL_MYSQL_PASSWORD and optionally VEIL_MYSQL_PORT / VEIL_MYSQL_DATABASE."
    );
  }

  const result = await runPendingSchemaMigrations(config);
  console.log("MySQL persistence schema initialized successfully.");
  console.log(`Database: ${config.database}`);
  console.log(`Applied migrations: ${result.applied.length === 0 ? "none" : result.applied.join(", ")}`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
