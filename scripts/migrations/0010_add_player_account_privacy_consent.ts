import {
  ensureColumnExists,
  dropColumnIfExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/infra/schema-migrations";
import { MYSQL_PLAYER_ACCOUNT_TABLE } from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "privacy_consent_at",
    "`privacy_consent_at` DATETIME NULL DEFAULT NULL AFTER `credential_bound_at`"
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "privacy_consent_at");
}
