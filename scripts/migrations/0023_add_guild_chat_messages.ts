import {
  dropIndexIfExists,
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "@server/infra/schema-migrations";
import {
  MYSQL_GUILD_MESSAGE_EXPIRES_AT_INDEX,
  MYSQL_GUILD_MESSAGE_GUILD_CREATED_INDEX,
  MYSQL_GUILD_MESSAGE_TABLE
} from "@server/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureTableExists(
    connection,
    MYSQL_GUILD_MESSAGE_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_GUILD_MESSAGE_TABLE}\` (
      message_id VARCHAR(191) NOT NULL,
      guild_id VARCHAR(191) NOT NULL,
      author_player_id VARCHAR(191) NOT NULL,
      author_display_name VARCHAR(40) NOT NULL,
      content VARCHAR(500) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP NOT NULL,
      PRIMARY KEY (message_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    database,
    MYSQL_GUILD_MESSAGE_TABLE,
    MYSQL_GUILD_MESSAGE_GUILD_CREATED_INDEX,
    `CREATE INDEX \`${MYSQL_GUILD_MESSAGE_GUILD_CREATED_INDEX}\` ON \`${MYSQL_GUILD_MESSAGE_TABLE}\` (guild_id, created_at, message_id)`
  );
  await ensureIndexExists(
    connection,
    database,
    MYSQL_GUILD_MESSAGE_TABLE,
    MYSQL_GUILD_MESSAGE_EXPIRES_AT_INDEX,
    `CREATE INDEX \`${MYSQL_GUILD_MESSAGE_EXPIRES_AT_INDEX}\` ON \`${MYSQL_GUILD_MESSAGE_TABLE}\` (expires_at)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;
  await dropIndexIfExists(connection, database, MYSQL_GUILD_MESSAGE_TABLE, MYSQL_GUILD_MESSAGE_EXPIRES_AT_INDEX);
  await dropIndexIfExists(connection, database, MYSQL_GUILD_MESSAGE_TABLE, MYSQL_GUILD_MESSAGE_GUILD_CREATED_INDEX);
  await dropTableIfExists(connection, MYSQL_GUILD_MESSAGE_TABLE);
}
