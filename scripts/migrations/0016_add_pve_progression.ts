import {
  dropColumnIfExists,
  ensureColumnExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/schema-migrations";
import { MYSQL_PLAYER_ACCOUNT_TABLE } from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "campaign_progress_json",
    "`campaign_progress_json` LONGTEXT NULL AFTER `season_badges_json`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "daily_dungeon_state_json",
    "`daily_dungeon_state_json` LONGTEXT NULL AFTER `recent_battle_replays_json`"
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "daily_dungeon_state_json");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "campaign_progress_json");
}
