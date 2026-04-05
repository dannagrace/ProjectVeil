import {
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/schema-migrations";
import {
  MYSQL_PLAYER_QUEST_STATE_TABLE,
  MYSQL_PLAYER_QUEST_STATE_UPDATED_AT_INDEX
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  await ensureTableExists(
    connection,
    MYSQL_PLAYER_QUEST_STATE_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_QUEST_STATE_TABLE}\` (
      player_id VARCHAR(191) NOT NULL,
      current_date_key VARCHAR(10) NULL,
      active_quest_ids_json LONGTEXT NOT NULL,
      rotations_json LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (player_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_QUEST_STATE_TABLE,
    MYSQL_PLAYER_QUEST_STATE_UPDATED_AT_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_QUEST_STATE_UPDATED_AT_INDEX}\` ON \`${MYSQL_PLAYER_QUEST_STATE_TABLE}\` (updated_at)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  await dropTableIfExists(connection, MYSQL_PLAYER_QUEST_STATE_TABLE);
}
