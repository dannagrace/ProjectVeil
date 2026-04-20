import {
  dropIndexIfExists,
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "@server/infra/schema-migrations";
import {
  MYSQL_PAYMENT_ORDER_PLAYER_CREATED_INDEX,
  MYSQL_PAYMENT_ORDER_TABLE,
  MYSQL_PAYMENT_ORDER_WECHAT_ORDER_ID_INDEX
} from "@server/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureTableExists(
    connection,
    MYSQL_PAYMENT_ORDER_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PAYMENT_ORDER_TABLE}\` (
      order_id VARCHAR(191) NOT NULL,
      player_id VARCHAR(191) NOT NULL,
      product_id VARCHAR(191) NOT NULL,
      wechat_order_id VARCHAR(191) NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'pending',
      amount INT NOT NULL,
      gem_amount INT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME NULL DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (order_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureIndexExists(
    connection,
    database,
    MYSQL_PAYMENT_ORDER_TABLE,
    MYSQL_PAYMENT_ORDER_PLAYER_CREATED_INDEX,
    `CREATE INDEX \`${MYSQL_PAYMENT_ORDER_PLAYER_CREATED_INDEX}\` ON \`${MYSQL_PAYMENT_ORDER_TABLE}\` (player_id, created_at DESC)`
  );

  await ensureIndexExists(
    connection,
    database,
    MYSQL_PAYMENT_ORDER_TABLE,
    MYSQL_PAYMENT_ORDER_WECHAT_ORDER_ID_INDEX,
    `CREATE UNIQUE INDEX \`${MYSQL_PAYMENT_ORDER_WECHAT_ORDER_ID_INDEX}\` ON \`${MYSQL_PAYMENT_ORDER_TABLE}\` (wechat_order_id)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropIndexIfExists(connection, database, MYSQL_PAYMENT_ORDER_TABLE, MYSQL_PAYMENT_ORDER_WECHAT_ORDER_ID_INDEX);
  await dropIndexIfExists(connection, database, MYSQL_PAYMENT_ORDER_TABLE, MYSQL_PAYMENT_ORDER_PLAYER_CREATED_INDEX);
  await dropTableIfExists(connection, MYSQL_PAYMENT_ORDER_TABLE);
}
