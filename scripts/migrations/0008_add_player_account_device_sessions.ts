import {
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "@server/infra/schema-migrations";
import {
  MYSQL_PLAYER_ACCOUNT_SESSION_PLAYER_LAST_USED_INDEX,
  MYSQL_PLAYER_ACCOUNT_SESSION_TABLE
} from "@server/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  await ensureTableExists(
    connection,
    MYSQL_PLAYER_ACCOUNT_SESSION_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\` (
      player_id VARCHAR(191) NOT NULL,
      session_id VARCHAR(64) NOT NULL,
      provider VARCHAR(64) NULL,
      device_label VARCHAR(191) NULL,
      refresh_token_hash VARCHAR(255) NOT NULL,
      refresh_token_expires_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_used_at DATETIME NOT NULL,
      PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  const database = connection.config.database;
  await ensureIndexExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_SESSION_TABLE,
    MYSQL_PLAYER_ACCOUNT_SESSION_PLAYER_LAST_USED_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_ACCOUNT_SESSION_PLAYER_LAST_USED_INDEX}\`
     ON \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\` (player_id, last_used_at DESC)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  await dropTableIfExists(connection, MYSQL_PLAYER_ACCOUNT_SESSION_TABLE);
}
