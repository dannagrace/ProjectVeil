import {
  dropIndexIfExists,
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/schema-migrations";
import {
  MYSQL_BATTLE_SNAPSHOT_STATUS_UPDATED_INDEX,
  MYSQL_BATTLE_SNAPSHOT_TABLE
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  await ensureTableExists(
    connection,
    MYSQL_BATTLE_SNAPSHOT_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\` (
      room_id VARCHAR(191) NOT NULL,
      battle_id VARCHAR(191) NOT NULL,
      hero_id VARCHAR(191) NOT NULL,
      attacker_player_id VARCHAR(191) NOT NULL,
      defender_player_id VARCHAR(191) NULL,
      defender_hero_id VARCHAR(191) NULL,
      neutral_army_id VARCHAR(191) NULL,
      encounter_kind VARCHAR(16) NOT NULL,
      initiator VARCHAR(16) NULL,
      path_json LONGTEXT NOT NULL,
      move_cost INT NOT NULL,
      player_ids_json LONGTEXT NOT NULL,
      initial_state_json LONGTEXT NOT NULL,
      estimated_compensation_grant_json LONGTEXT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      result VARCHAR(32) NULL,
      resolution_reason VARCHAR(64) NULL,
      compensation_json LONGTEXT NULL,
      started_at DATETIME NOT NULL,
      resolved_at DATETIME NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (room_id, battle_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_BATTLE_SNAPSHOT_TABLE,
    MYSQL_BATTLE_SNAPSHOT_STATUS_UPDATED_INDEX,
    `CREATE INDEX \`${MYSQL_BATTLE_SNAPSHOT_STATUS_UPDATED_INDEX}\` ON \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\` (status, updated_at DESC)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  await dropIndexIfExists(
    connection,
    connection.config.database,
    MYSQL_BATTLE_SNAPSHOT_TABLE,
    MYSQL_BATTLE_SNAPSHOT_STATUS_UPDATED_INDEX
  );
  await dropTableIfExists(connection, MYSQL_BATTLE_SNAPSHOT_TABLE);
}
