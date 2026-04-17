import {
  dropIndexIfExists,
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/infra/schema-migrations";
import {
  MYSQL_PAYMENT_RECEIPT_ORDER_ID_INDEX,
  MYSQL_PAYMENT_RECEIPT_PLAYER_VERIFIED_INDEX,
  MYSQL_PAYMENT_RECEIPT_TABLE
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureTableExists(
    connection,
    MYSQL_PAYMENT_RECEIPT_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PAYMENT_RECEIPT_TABLE}\` (
      transaction_id VARCHAR(191) NOT NULL,
      order_id VARCHAR(191) NOT NULL,
      player_id VARCHAR(191) NOT NULL,
      product_id VARCHAR(191) NOT NULL,
      amount INT NOT NULL,
      verified_at DATETIME NOT NULL,
      PRIMARY KEY (transaction_id),
      UNIQUE KEY \`${MYSQL_PAYMENT_RECEIPT_ORDER_ID_INDEX}\` (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureIndexExists(
    connection,
    database,
    MYSQL_PAYMENT_RECEIPT_TABLE,
    MYSQL_PAYMENT_RECEIPT_PLAYER_VERIFIED_INDEX,
    `CREATE INDEX \`${MYSQL_PAYMENT_RECEIPT_PLAYER_VERIFIED_INDEX}\` ON \`${MYSQL_PAYMENT_RECEIPT_TABLE}\` (player_id, verified_at DESC)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropIndexIfExists(connection, database, MYSQL_PAYMENT_RECEIPT_TABLE, MYSQL_PAYMENT_RECEIPT_PLAYER_VERIFIED_INDEX);
  await dropTableIfExists(connection, MYSQL_PAYMENT_RECEIPT_TABLE);
}
