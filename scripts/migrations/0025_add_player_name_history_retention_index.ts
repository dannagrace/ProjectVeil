import { dropIndexIfExists, ensureIndexExists, type SchemaMigrationConnection } from "../../apps/server/src/schema-migrations";
import {
  MYSQL_PLAYER_NAME_HISTORY_CHANGED_AT_INDEX,
  MYSQL_PLAYER_NAME_HISTORY_TABLE
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  await ensureIndexExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_NAME_HISTORY_TABLE,
    MYSQL_PLAYER_NAME_HISTORY_CHANGED_AT_INDEX,
    `CREATE INDEX \`${MYSQL_PLAYER_NAME_HISTORY_CHANGED_AT_INDEX}\` ON \`${MYSQL_PLAYER_NAME_HISTORY_TABLE}\` (changed_at)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  await dropIndexIfExists(
    connection,
    connection.config.database,
    MYSQL_PLAYER_NAME_HISTORY_TABLE,
    MYSQL_PLAYER_NAME_HISTORY_CHANGED_AT_INDEX
  );
}
