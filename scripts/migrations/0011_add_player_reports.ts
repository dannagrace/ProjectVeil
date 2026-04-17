import {
  dropIndexIfExists,
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/infra/schema-migrations";
import {
  MYSQL_PLAYER_REPORT_ROOM_REPORTER_TARGET_INDEX,
  MYSQL_PLAYER_REPORT_STATUS_CREATED_INDEX,
  MYSQL_PLAYER_REPORT_TABLE
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureTableExists(
    connection,
    MYSQL_PLAYER_REPORT_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_REPORT_TABLE}\` (
      report_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      reporter_id VARCHAR(191) NOT NULL,
      target_id VARCHAR(191) NOT NULL,
      reason VARCHAR(32) NOT NULL,
      description VARCHAR(512) NULL,
      room_id VARCHAR(191) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      resolved_at DATETIME NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (report_id),
      UNIQUE KEY \`${MYSQL_PLAYER_REPORT_ROOM_REPORTER_TARGET_INDEX}\` (room_id, reporter_id, target_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureIndexExists(
    connection,
    database,
    MYSQL_PLAYER_REPORT_TABLE,
    MYSQL_PLAYER_REPORT_STATUS_CREATED_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_REPORT_STATUS_CREATED_INDEX}\` ON \`${MYSQL_PLAYER_REPORT_TABLE}\` (status, created_at DESC)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;
  await dropIndexIfExists(connection, database, MYSQL_PLAYER_REPORT_TABLE, MYSQL_PLAYER_REPORT_STATUS_CREATED_INDEX);
  await dropTableIfExists(connection, MYSQL_PLAYER_REPORT_TABLE);
}
