import {
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/schema-migrations";
import {
  MYSQL_PLAYER_EVENT_HISTORY_TABLE,
  MYSQL_PLAYER_EVENT_HISTORY_TIMESTAMP_INDEX
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  await ensureTableExists(
    connection,
    MYSQL_PLAYER_EVENT_HISTORY_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\` (
      player_id VARCHAR(191) NOT NULL,
      event_id VARCHAR(191) NOT NULL,
      timestamp DATETIME NOT NULL,
      room_id VARCHAR(191) NOT NULL,
      category VARCHAR(32) NOT NULL,
      hero_id VARCHAR(191) NULL,
      world_event_type VARCHAR(64) NULL,
      achievement_id VARCHAR(64) NULL,
      entry_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (player_id, event_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_EVENT_HISTORY_TABLE,
    MYSQL_PLAYER_EVENT_HISTORY_TIMESTAMP_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_EVENT_HISTORY_TIMESTAMP_INDEX}\` ON \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\` (player_id, timestamp)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  await dropTableIfExists(connection, MYSQL_PLAYER_EVENT_HISTORY_TABLE);
}
