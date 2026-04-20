import { config as loadEnv } from "dotenv";
import { readMySqlPersistenceConfig } from "@server/persistence";
import { rollbackLastSchemaMigration } from "@server/infra/schema-migrations";

loadEnv();

async function main(): Promise<void> {
  const config = readMySqlPersistenceConfig();
  if (!config) {
    throw new Error(
      "Missing MySQL env config. Set VEIL_MYSQL_HOST, VEIL_MYSQL_USER, VEIL_MYSQL_PASSWORD and optionally VEIL_MYSQL_PORT / VEIL_MYSQL_DATABASE."
    );
  }

  const result = await rollbackLastSchemaMigration(config);
  if (!result.rolledBack) {
    console.log(`No schema migrations to roll back for ${result.database}.`);
    return;
  }

  console.log(`Rolled back ${result.rolledBack} from ${result.database}.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
