import { dropColumnIfExists, ensureColumnExists, type SchemaMigrationConnection } from "@server/infra/schema-migrations";
import { MYSQL_PAYMENT_ORDER_TABLE } from "@server/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PAYMENT_ORDER_TABLE,
    "refunded_at",
    "`refunded_at` DATETIME NULL DEFAULT NULL AFTER `last_grant_error`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PAYMENT_ORDER_TABLE,
    "refund_reason",
    "`refund_reason` VARCHAR(191) NULL DEFAULT NULL AFTER `refunded_at`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PAYMENT_ORDER_TABLE,
    "external_refund_id",
    "`external_refund_id` VARCHAR(191) NULL DEFAULT NULL AFTER `refund_reason`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PAYMENT_ORDER_TABLE,
    "refund_clawback_gems",
    "`refund_clawback_gems` INT NOT NULL DEFAULT 0 AFTER `external_refund_id`"
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropColumnIfExists(connection, database, MYSQL_PAYMENT_ORDER_TABLE, "refund_clawback_gems");
  await dropColumnIfExists(connection, database, MYSQL_PAYMENT_ORDER_TABLE, "external_refund_id");
  await dropColumnIfExists(connection, database, MYSQL_PAYMENT_ORDER_TABLE, "refund_reason");
  await dropColumnIfExists(connection, database, MYSQL_PAYMENT_ORDER_TABLE, "refunded_at");
}
