import {
  dropColumnIfExists,
  dropIndexIfExists,
  ensureColumnExists,
  ensureIndexExists,
  type SchemaMigrationConnection
} from "../../apps/server/src/schema-migrations";
import {
  MYSQL_PLAYER_ACCOUNT_LOGIN_ID_INDEX,
  MYSQL_PLAYER_ACCOUNT_TABLE,
  MYSQL_PLAYER_ACCOUNT_WECHAT_OPEN_ID_INDEX
} from "../../apps/server/src/persistence";

export async function up(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "login_id",
    "`login_id` VARCHAR(40) NULL AFTER `last_seen_at`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "wechat_mini_game_open_id",
    "`wechat_mini_game_open_id` VARCHAR(191) NULL AFTER `login_id`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "wechat_mini_game_union_id",
    "`wechat_mini_game_union_id` VARCHAR(191) NULL AFTER `wechat_mini_game_open_id`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "wechat_mini_game_bound_at",
    "`wechat_mini_game_bound_at` DATETIME NULL DEFAULT NULL AFTER `wechat_mini_game_union_id`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "password_hash",
    "`password_hash` VARCHAR(255) NULL AFTER `wechat_mini_game_bound_at`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "credential_bound_at",
    "`credential_bound_at` DATETIME NULL DEFAULT NULL AFTER `password_hash`"
  );
  await ensureIndexExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    MYSQL_PLAYER_ACCOUNT_LOGIN_ID_INDEX,
    `CREATE UNIQUE INDEX \`${MYSQL_PLAYER_ACCOUNT_LOGIN_ID_INDEX}\` ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (login_id)`
  );
  await ensureIndexExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    MYSQL_PLAYER_ACCOUNT_WECHAT_OPEN_ID_INDEX,
    `CREATE UNIQUE INDEX \`${MYSQL_PLAYER_ACCOUNT_WECHAT_OPEN_ID_INDEX}\` ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (wechat_mini_game_open_id)`
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropIndexIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, MYSQL_PLAYER_ACCOUNT_WECHAT_OPEN_ID_INDEX);
  await dropIndexIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, MYSQL_PLAYER_ACCOUNT_LOGIN_ID_INDEX);
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "credential_bound_at");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "password_hash");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "wechat_mini_game_bound_at");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "wechat_mini_game_union_id");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "wechat_mini_game_open_id");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "login_id");
}
