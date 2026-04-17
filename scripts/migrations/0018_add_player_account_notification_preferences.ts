import {
  ensureColumnExists,
  dropColumnIfExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/infra/schema-migrations";
import { MYSQL_PLAYER_ACCOUNT_TABLE } from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "notification_preferences_json",
    "`notification_preferences_json` LONGTEXT NULL AFTER `phone_number_bound_at`"
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "notification_preferences_json");
}
