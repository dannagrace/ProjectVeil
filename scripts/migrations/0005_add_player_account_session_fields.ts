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
    "account_session_version",
    "`account_session_version` BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER `login_id`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "refresh_session_id",
    "`refresh_session_id` VARCHAR(64) NULL AFTER `account_session_version`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "refresh_token_hash",
    "`refresh_token_hash` VARCHAR(255) NULL AFTER `refresh_session_id`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "refresh_token_expires_at",
    "`refresh_token_expires_at` DATETIME NULL DEFAULT NULL AFTER `refresh_token_hash`"
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "refresh_token_expires_at");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "refresh_token_hash");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "refresh_session_id");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "account_session_version");
}
