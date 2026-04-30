import {
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "@server/infra/schema-migrations";
import {
  MYSQL_SEASONAL_EVENT_OPS_AUDIT_ACTOR_OCCURRED_INDEX,
  MYSQL_SEASONAL_EVENT_OPS_AUDIT_EVENT_OCCURRED_INDEX,
  MYSQL_SEASONAL_EVENT_OPS_AUDIT_LOG_TABLE
} from "@server/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  await ensureTableExists(
    connection,
    MYSQL_SEASONAL_EVENT_OPS_AUDIT_LOG_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_SEASONAL_EVENT_OPS_AUDIT_LOG_TABLE}\` (
      audit_id VARCHAR(191) NOT NULL,
      occurred_at DATETIME(3) NOT NULL,
      action VARCHAR(32) NOT NULL,
      actor VARCHAR(128) NOT NULL,
      event_id VARCHAR(64) NOT NULL,
      detail TEXT NOT NULL,
      metadata_json JSON NULL,
      pod_hostname VARCHAR(255) NULL,
      created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (audit_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_SEASONAL_EVENT_OPS_AUDIT_LOG_TABLE,
    MYSQL_SEASONAL_EVENT_OPS_AUDIT_EVENT_OCCURRED_INDEX,
    `CREATE INDEX \`${MYSQL_SEASONAL_EVENT_OPS_AUDIT_EVENT_OCCURRED_INDEX}\` ON \`${MYSQL_SEASONAL_EVENT_OPS_AUDIT_LOG_TABLE}\` (event_id, occurred_at)`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_SEASONAL_EVENT_OPS_AUDIT_LOG_TABLE,
    MYSQL_SEASONAL_EVENT_OPS_AUDIT_ACTOR_OCCURRED_INDEX,
    `CREATE INDEX \`${MYSQL_SEASONAL_EVENT_OPS_AUDIT_ACTOR_OCCURRED_INDEX}\` ON \`${MYSQL_SEASONAL_EVENT_OPS_AUDIT_LOG_TABLE}\` (actor, occurred_at)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  await dropTableIfExists(connection, MYSQL_SEASONAL_EVENT_OPS_AUDIT_LOG_TABLE);
}
