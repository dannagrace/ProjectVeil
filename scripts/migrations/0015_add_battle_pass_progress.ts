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
    "season_xp",
    "`season_xp` INT NOT NULL DEFAULT 0 AFTER `gems`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "season_pass_tier",
    "`season_pass_tier` INT NOT NULL DEFAULT 1 AFTER `season_xp`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "season_pass_premium",
    "`season_pass_premium` TINYINT(1) NOT NULL DEFAULT 0 AFTER `season_pass_tier`"
  );
  await ensureColumnExists(
    connection,
    database,
    MYSQL_PLAYER_ACCOUNT_TABLE,
    "season_pass_claimed_tiers_json",
    "`season_pass_claimed_tiers_json` LONGTEXT NULL AFTER `season_pass_premium`"
  );
}

export async function down(connection: SchemaMigrationConnection): Promise<void> {
  const database = connection.config.database;

  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "season_pass_claimed_tiers_json");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "season_pass_premium");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "season_pass_tier");
  await dropColumnIfExists(connection, database, MYSQL_PLAYER_ACCOUNT_TABLE, "season_xp");
}
