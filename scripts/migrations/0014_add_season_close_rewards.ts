import {
  dropColumnIfExists,
  dropTableIfExists,
  ensureColumnExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "@server/infra/schema-migrations";
import {
  MYSQL_PLAYER_ACCOUNT_TABLE,
  MYSQL_SEASON_REWARD_LOG_TABLE,
  MYSQL_SEASON_TABLE
} from "@server/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "season_badges_json",
    "`season_badges_json` LONGTEXT NULL AFTER `gems`"
  );

  await ensureColumnExists(
    connection,
    database,
    MYSQL_SEASON_TABLE,
    "reward_distributed_at",
    "`reward_distributed_at` DATETIME NULL DEFAULT NULL AFTER `ended_at`"
  );

  await ensureTableExists(
    connection,
    MYSQL_SEASON_REWARD_LOG_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_SEASON_REWARD_LOG_TABLE}\` (
      season_id VARCHAR(64) NOT NULL,
      player_id VARCHAR(64) NOT NULL,
      gems INT NOT NULL,
      badge VARCHAR(64) NOT NULL,
      distributed_at DATETIME NOT NULL,
      PRIMARY KEY (season_id, player_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropTableIfExists(connection, MYSQL_SEASON_REWARD_LOG_TABLE);
  await dropColumnIfExists(connection, database, MYSQL_SEASON_TABLE, "reward_distributed_at");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "season_badges_json");
}
