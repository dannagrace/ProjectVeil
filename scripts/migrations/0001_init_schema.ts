import {
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/schema-migrations";
import {
  MYSQL_PLAYER_ACCOUNT_TABLE,
  MYSQL_PLAYER_ACCOUNT_UPDATED_AT_INDEX,
  MYSQL_PLAYER_ROOM_PROFILE_TABLE,
  MYSQL_PLAYER_ROOM_PROFILE_UPDATED_AT_INDEX,
  MYSQL_ROOM_SNAPSHOT_TABLE,
  MYSQL_ROOM_SNAPSHOT_UPDATED_AT_INDEX
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  await ensureTableExists(
    connection,
    MYSQL_ROOM_SNAPSHOT_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_ROOM_SNAPSHOT_TABLE}\` (
      room_id VARCHAR(191) NOT NULL,
      state_json LONGTEXT NOT NULL,
      battles_json LONGTEXT NOT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (room_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_ROOM_SNAPSHOT_TABLE,
    MYSQL_ROOM_SNAPSHOT_UPDATED_AT_INDEX,
    `CREATE INDEX \`${MYSQL_ROOM_SNAPSHOT_UPDATED_AT_INDEX}\` ON \`${MYSQL_ROOM_SNAPSHOT_TABLE}\` (updated_at)`
  );

  await ensureTableExists(
    connection,
    MYSQL_PLAYER_ROOM_PROFILE_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\` (
      room_id VARCHAR(191) NOT NULL,
      player_id VARCHAR(191) NOT NULL,
      heroes_json LONGTEXT NOT NULL,
      resources_json LONGTEXT NOT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (room_id, player_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_ROOM_PROFILE_TABLE,
    MYSQL_PLAYER_ROOM_PROFILE_UPDATED_AT_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_ROOM_PROFILE_UPDATED_AT_INDEX}\` ON \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\` (updated_at)`
  );

  await ensureTableExists(
    connection,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (
      player_id VARCHAR(191) NOT NULL,
      display_name VARCHAR(80) NULL,
      global_resources_json LONGTEXT NOT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (player_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    MYSQL_PLAYER_ACCOUNT_UPDATED_AT_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_ACCOUNT_UPDATED_AT_INDEX}\` ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (updated_at)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  await dropTableIfExists(connection, MYSQL_PLAYER_ACCOUNT_TABLE);
  await dropTableIfExists(connection, MYSQL_PLAYER_ROOM_PROFILE_TABLE);
  await dropTableIfExists(connection, MYSQL_ROOM_SNAPSHOT_TABLE);
}
