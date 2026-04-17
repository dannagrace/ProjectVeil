import {
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/infra/schema-migrations";
import {
  MYSQL_CONFIG_DOCUMENT_TABLE,
  MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  await ensureTableExists(
    connection,
    MYSQL_CONFIG_DOCUMENT_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (
      document_id VARCHAR(64) NOT NULL,
      content_json LONGTEXT NOT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      exported_at DATETIME NULL DEFAULT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (document_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_CONFIG_DOCUMENT_TABLE,
    MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX,
    `CREATE INDEX \`${MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX}\` ON \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (updated_at)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  await dropTableIfExists(connection, MYSQL_CONFIG_DOCUMENT_TABLE);
}
