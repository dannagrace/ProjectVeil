import {
  dropColumnIfExists,
  ensureColumnExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/infra/schema-migrations";
import { MYSQL_PLAYER_ACCOUNT_TABLE } from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "tutorial_step",
    "`tutorial_step` INT NULL DEFAULT NULL AFTER `daily_dungeon_state_json`"
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "tutorial_step");
}
