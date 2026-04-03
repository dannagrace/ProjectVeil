import {
  dropColumnIfExists,
  dropIndexIfExists,
  dropTableIfExists,
  ensureColumnExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/schema-migrations";
import {
  MYSQL_GEM_LEDGER_PLAYER_CREATED_INDEX,
  MYSQL_GEM_LEDGER_TABLE,
  MYSQL_PLAYER_ACCOUNT_TABLE
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "gems",
    "`gems` INT NOT NULL DEFAULT 0 AFTER `elo_rating`"
  );

  await ensureTableExists(
    connection,
    MYSQL_GEM_LEDGER_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_GEM_LEDGER_TABLE}\` (
      entry_id VARCHAR(191) NOT NULL,
      player_id VARCHAR(191) NOT NULL,
      delta INT NOT NULL,
      reason VARCHAR(16) NOT NULL,
      ref_id VARCHAR(191) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (entry_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureIndexExists(
    connection,
    database,
    MYSQL_GEM_LEDGER_TABLE,
    MYSQL_GEM_LEDGER_PLAYER_CREATED_INDEX,
    `CREATE INDEX \`${MYSQL_GEM_LEDGER_PLAYER_CREATED_INDEX}\` ON \`${MYSQL_GEM_LEDGER_TABLE}\` (player_id, created_at DESC)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropIndexIfExists(connection, database, MYSQL_GEM_LEDGER_TABLE, MYSQL_GEM_LEDGER_PLAYER_CREATED_INDEX);
  await dropTableIfExists(connection, MYSQL_GEM_LEDGER_TABLE);
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "gems");
}
