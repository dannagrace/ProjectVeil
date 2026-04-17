import {
  dropIndexIfExists,
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/infra/schema-migrations";
import {
  MYSQL_PLAYER_NAME_HISTORY_NORMALIZED_CHANGED_INDEX,
  MYSQL_PLAYER_NAME_HISTORY_PLAYER_CHANGED_INDEX,
  MYSQL_PLAYER_NAME_HISTORY_TABLE,
  MYSQL_PLAYER_NAME_RESERVATION_NORMALIZED_INDEX,
  MYSQL_PLAYER_NAME_RESERVATION_TABLE,
  MYSQL_PLAYER_NAME_RESERVATION_UNTIL_INDEX
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  await ensureTableExists(
    connection,
    MYSQL_PLAYER_NAME_HISTORY_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_NAME_HISTORY_TABLE}\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      player_id VARCHAR(191) NOT NULL,
      display_name VARCHAR(80) NOT NULL,
      normalized_name VARCHAR(191) NOT NULL,
      changed_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_NAME_HISTORY_TABLE,
    MYSQL_PLAYER_NAME_HISTORY_PLAYER_CHANGED_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_NAME_HISTORY_PLAYER_CHANGED_INDEX}\` ON \`${MYSQL_PLAYER_NAME_HISTORY_TABLE}\` (player_id, changed_at DESC)`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_NAME_HISTORY_TABLE,
    MYSQL_PLAYER_NAME_HISTORY_NORMALIZED_CHANGED_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_NAME_HISTORY_NORMALIZED_CHANGED_INDEX}\` ON \`${MYSQL_PLAYER_NAME_HISTORY_TABLE}\` (normalized_name, changed_at DESC)`
  );

  await ensureTableExists(
    connection,
    MYSQL_PLAYER_NAME_RESERVATION_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_NAME_RESERVATION_TABLE}\` (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      player_id VARCHAR(191) NOT NULL,
      display_name VARCHAR(80) NOT NULL,
      normalized_name VARCHAR(191) NOT NULL,
      reserved_until DATETIME NOT NULL,
      reason VARCHAR(64) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_NAME_RESERVATION_TABLE,
    MYSQL_PLAYER_NAME_RESERVATION_NORMALIZED_INDEX,
    `CREATE UNIQUE INDEX \`${MYSQL_PLAYER_NAME_RESERVATION_NORMALIZED_INDEX}\` ON \`${MYSQL_PLAYER_NAME_RESERVATION_TABLE}\` (normalized_name)`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_NAME_RESERVATION_TABLE,
    MYSQL_PLAYER_NAME_RESERVATION_UNTIL_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_NAME_RESERVATION_UNTIL_INDEX}\` ON \`${MYSQL_PLAYER_NAME_RESERVATION_TABLE}\` (reserved_until)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  await dropIndexIfExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_NAME_RESERVATION_TABLE,
    MYSQL_PLAYER_NAME_RESERVATION_UNTIL_INDEX
  );
  await dropIndexIfExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_NAME_RESERVATION_TABLE,
    MYSQL_PLAYER_NAME_RESERVATION_NORMALIZED_INDEX
  );
  await dropTableIfExists(connection, MYSQL_PLAYER_NAME_RESERVATION_TABLE);

  await dropIndexIfExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_NAME_HISTORY_TABLE,
    MYSQL_PLAYER_NAME_HISTORY_NORMALIZED_CHANGED_INDEX
  );
  await dropIndexIfExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_NAME_HISTORY_TABLE,
    MYSQL_PLAYER_NAME_HISTORY_PLAYER_CHANGED_INDEX
  );
  await dropTableIfExists(connection, MYSQL_PLAYER_NAME_HISTORY_TABLE);
}
