import {
  ensureColumnExists,
  dropColumnIfExists,
  type SchemaMigrationConnection
} from "@server/infra/schema-migrations";
import { MYSQL_PLAYER_ACCOUNT_TABLE } from "@server/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "push_tokens_json",
    "`push_tokens_json` LONGTEXT NULL AFTER `notification_preferences_json`"
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "push_tokens_json");
}
