import {
  dropColumnIfExists,
  ensureColumnExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/schema-migrations";
import { MYSQL_PLAYER_ACCOUNT_TABLE } from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "elo_rating",
    "`elo_rating` INT NOT NULL DEFAULT 1000 AFTER `avatar_url`"
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "elo_rating");
}
