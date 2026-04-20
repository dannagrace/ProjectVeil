import {
  dropTableIfExists,
  ensureIndexExists,
  ensureTableExists,
  type SchemaMigrationConnection
} from "@server/infra/schema-migrations";
import {
  MYSQL_PLAYER_HERO_ARCHIVE_TABLE,
  MYSQL_PLAYER_HERO_ARCHIVE_UPDATED_AT_INDEX
} from "@server/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  await ensureTableExists(
    connection,
    MYSQL_PLAYER_HERO_ARCHIVE_TABLE,
    `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` (
      player_id VARCHAR(191) NOT NULL,
      hero_id VARCHAR(191) NOT NULL,
      hero_json LONGTEXT NOT NULL,
      army_template_id VARCHAR(191) NULL,
      army_count INT NULL,
      learned_skills_json LONGTEXT NULL,
      equipment_json LONGTEXT NULL,
      inventory_json LONGTEXT NULL,
      version BIGINT UNSIGNED NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (player_id, hero_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_HERO_ARCHIVE_TABLE,
    MYSQL_PLAYER_HERO_ARCHIVE_UPDATED_AT_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_HERO_ARCHIVE_UPDATED_AT_INDEX}\` ON \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` (updated_at)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  await dropTableIfExists(connection, MYSQL_PLAYER_HERO_ARCHIVE_TABLE);
}
