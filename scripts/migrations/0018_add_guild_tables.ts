import {
  dropIndexIfExists,
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/infra/schema-migrations";
import {
  MYSQL_GUILD_MEMBERSHIP_PLAYER_INDEX,
  MYSQL_GUILD_MEMBERSHIP_TABLE,
  MYSQL_GUILD_TABLE,
  MYSQL_GUILD_TAG_INDEX,
  MYSQL_GUILD_UPDATED_AT_INDEX
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureTableExists(
    connection,
    MYSQL_GUILD_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_GUILD_TABLE}\` (
      guild_id VARCHAR(191) NOT NULL,
      name VARCHAR(80) NOT NULL,
      tag VARCHAR(8) NOT NULL,
      description VARCHAR(160) NULL,
      owner_player_id VARCHAR(191) NULL,
      member_count INT NOT NULL DEFAULT 0,
      state_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    database,
    MYSQL_GUILD_TABLE,
    MYSQL_GUILD_UPDATED_AT_INDEX,
    `CREATE INDEX \`${MYSQL_GUILD_UPDATED_AT_INDEX}\` ON \`${MYSQL_GUILD_TABLE}\` (updated_at)`
  );
  await ensureIndexExists(
    connection,
    database,
    MYSQL_GUILD_TABLE,
    MYSQL_GUILD_TAG_INDEX,
    `CREATE UNIQUE INDEX \`${MYSQL_GUILD_TAG_INDEX}\` ON \`${MYSQL_GUILD_TABLE}\` (tag)`
  );

  await ensureTableExists(
    connection,
    MYSQL_GUILD_MEMBERSHIP_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_GUILD_MEMBERSHIP_TABLE}\` (
      guild_id VARCHAR(191) NOT NULL,
      player_id VARCHAR(191) NOT NULL,
      role VARCHAR(16) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (guild_id, player_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    database,
    MYSQL_GUILD_MEMBERSHIP_TABLE,
    MYSQL_GUILD_MEMBERSHIP_PLAYER_INDEX,
    `CREATE UNIQUE INDEX \`${MYSQL_GUILD_MEMBERSHIP_PLAYER_INDEX}\` ON \`${MYSQL_GUILD_MEMBERSHIP_TABLE}\` (player_id)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;
  await dropIndexIfExists(connection, database, MYSQL_GUILD_MEMBERSHIP_TABLE, MYSQL_GUILD_MEMBERSHIP_PLAYER_INDEX);
  await dropTableIfExists(connection, MYSQL_GUILD_MEMBERSHIP_TABLE);
  await dropIndexIfExists(connection, database, MYSQL_GUILD_TABLE, MYSQL_GUILD_TAG_INDEX);
  await dropIndexIfExists(connection, database, MYSQL_GUILD_TABLE, MYSQL_GUILD_UPDATED_AT_INDEX);
  await dropTableIfExists(connection, MYSQL_GUILD_TABLE);
}
