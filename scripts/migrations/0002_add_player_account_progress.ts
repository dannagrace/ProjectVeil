import {
  dropColumnIfExists,
  ensureColumnExists,
  type SchemaMigrationConnection
} from "@server/infra/schema-migrations";
import { MYSQL_PLAYER_ACCOUNT_TABLE } from "@server/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "avatar_url",
    "`avatar_url` VARCHAR(512) NULL AFTER `display_name`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "achievements_json",
    "`achievements_json` LONGTEXT NULL AFTER `global_resources_json`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "recent_event_log_json",
    "`recent_event_log_json` LONGTEXT NULL AFTER `achievements_json`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "recent_battle_replays_json",
    "`recent_battle_replays_json` LONGTEXT NULL AFTER `recent_event_log_json`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "last_room_id",
    "`last_room_id` VARCHAR(191) NULL AFTER `recent_battle_replays_json`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "last_seen_at",
    "`last_seen_at` DATETIME NULL DEFAULT NULL AFTER `last_room_id`"
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "last_seen_at");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "last_room_id");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "recent_battle_replays_json");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "recent_event_log_json");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "achievements_json");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "avatar_url");
}
