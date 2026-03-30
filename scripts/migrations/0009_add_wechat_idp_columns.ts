import {
  ensureColumnExists,
  ensureIndexExists,
  dropColumnIfExists,
  dropIndexIfExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/schema-migrations";
import {
  MYSQL_PLAYER_ACCOUNT_TABLE,
  MYSQL_PLAYER_ACCOUNT_WECHAT_IDP_OPEN_ID_INDEX
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "wechat_open_id",
    "`wechat_open_id` VARCHAR(191) NULL AFTER `password_hash`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "wechat_union_id",
    "`wechat_union_id` VARCHAR(191) NULL AFTER `wechat_open_id`"
  );

  await connection.query(
    `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
     SET wechat_open_id = COALESCE(wechat_open_id, wechat_mini_game_open_id),
         wechat_union_id = COALESCE(wechat_union_id, wechat_mini_game_union_id)
     WHERE wechat_mini_game_open_id IS NOT NULL
        OR wechat_mini_game_union_id IS NOT NULL`
  );

  await ensureIndexExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    MYSQL_PLAYER_ACCOUNT_WECHAT_IDP_OPEN_ID_INDEX,
    `CREATE UNIQUE INDEX \`${MYSQL_PLAYER_ACCOUNT_WECHAT_IDP_OPEN_ID_INDEX}\`
     ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (wechat_open_id)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropIndexIfExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    MYSQL_PLAYER_ACCOUNT_WECHAT_IDP_OPEN_ID_INDEX
  );
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "wechat_union_id");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "wechat_open_id");
}
