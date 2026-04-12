import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createConnection, createPool, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { buildMySqlPoolOptions, type MySqlPoolConfig } from "./mysql-pool";

export interface SchemaMigrationConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  pool?: MySqlPoolConfig;
}

export interface SchemaMigrationModule {
  up(connection: SchemaMigrationConnection): Promise<void>;
  down(connection: SchemaMigrationConnection): Promise<void>;
}

export interface SchemaMigration {
  id: string;
  name: string;
  up(connection: SchemaMigrationConnection): Promise<void>;
  down(connection: SchemaMigrationConnection): Promise<void>;
}

export interface AppliedSchemaMigration extends RowDataPacket {
  id: string;
  name: string;
  applied_at: Date | string;
}

export interface SchemaMigrationStatus {
  database: string;
  hasDatabase: boolean;
  hasMigrationTable: boolean;
  applied: AppliedSchemaMigration[];
  pending: SchemaMigration[];
  expected: SchemaMigration[];
}

export interface SchemaMigrationRunSummary {
  database: string;
  applied: string[];
  skipped: string[];
}

export interface SchemaMigrationRollbackSummary {
  database: string;
  rolledBack: string | null;
}

export type SchemaMigrationConnection = Pool | PoolConnection;

export interface SchemaMigrationLoaderOptions {
  migrationsDirectory?: string;
  readdirFn?: typeof readdir;
  importModule?: (modulePath: string) => Promise<Partial<SchemaMigrationModule>>;
}

export interface SchemaMigrationStatusOptions extends SchemaMigrationLoaderOptions {
  createConnectionFn?: typeof createConnection;
  createPoolFn?: typeof createSchemaMigrationPool;
}

const SCHEMA_MIGRATIONS_TABLE = "schema_migrations";
const MIGRATION_FILE_PATTERN = /^(\d{4})_(.+)\.(?:ts|js|mjs)$/;
const MIGRATIONS_DIRECTORY = resolveDefaultMigrationsDirectory();

function resolveDefaultMigrationsDirectory(): string {
  const configured = process.env.VEIL_MIGRATIONS_PATH?.trim();
  if (configured) {
    return resolve(configured);
  }

  const compiledDirectory = resolve(process.cwd(), "dist/scripts/migrations");
  if (existsSync(compiledDirectory)) {
    return compiledDirectory;
  }

  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../scripts/migrations");
}

export function schemaMigrationTableName(): string {
  return SCHEMA_MIGRATIONS_TABLE;
}

export async function createSchemaMigrationPool(config: SchemaMigrationConfig): Promise<Pool> {
  return createPool(
    buildMySqlPoolOptions({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      pool: config.pool ?? {
        connectionLimit: 4,
        maxIdle: 4,
        idleTimeoutMs: 60_000,
        queueLimit: 0,
        waitForConnections: true
      }
    })
  );
}

export async function ensureSchemaMigrationDatabase(config: SchemaMigrationConfig): Promise<void> {
  const bootstrap = await createConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password
  });

  try {
    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`
    );
  } finally {
    await bootstrap.end();
  }
}

export async function ensureSchemaMigrationsTable(connection: SchemaMigrationConnection): Promise<void> {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS \`${SCHEMA_MIGRATIONS_TABLE}\` (
      id VARCHAR(32) NOT NULL,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
}

export async function ensureTableExists(
  connection: SchemaMigrationConnection,
  tableName: string,
  createTableSql: string
): Promise<void> {
  await connection.query(createTableSql);
}

export async function dropTableIfExists(
  connection: SchemaMigrationConnection,
  tableName: string
): Promise<void> {
  await connection.query(`DROP TABLE IF EXISTS \`${tableName}\``);
}

export async function ensureColumnExists(
  connection: SchemaMigrationConnection,
  database: string,
  tableName: string,
  columnName: string,
  columnSql: string
): Promise<void> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [database, tableName, columnName]
  );

  if (!rows[0]) {
    await connection.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${columnSql}`);
  }
}

export async function dropColumnIfExists(
  connection: SchemaMigrationConnection,
  database: string,
  tableName: string,
  columnName: string
): Promise<void> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [database, tableName, columnName]
  );

  if (rows[0]) {
    await connection.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``);
  }
}

export async function ensureIndexExists(
  connection: SchemaMigrationConnection,
  database: string,
  tableName: string,
  indexName: string,
  createIndexSql: string
): Promise<void> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT 1
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [database, tableName, indexName]
  );

  if (!rows[0]) {
    await connection.query(createIndexSql);
  }
}

export async function dropIndexIfExists(
  connection: SchemaMigrationConnection,
  database: string,
  tableName: string,
  indexName: string
): Promise<void> {
  const [rows] = await connection.query<RowDataPacket[]>(
    `SELECT 1
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND INDEX_NAME = ?
     LIMIT 1`,
    [database, tableName, indexName]
  );

  if (rows[0]) {
    await connection.query(`DROP INDEX \`${indexName}\` ON \`${tableName}\``);
  }
}

export async function loadSchemaMigrations(options: SchemaMigrationLoaderOptions = {}): Promise<SchemaMigration[]> {
  const migrationsDirectory = options.migrationsDirectory ?? MIGRATIONS_DIRECTORY;
  const readMigrationDirectory = options.readdirFn ?? readdir;
  const importModule =
    options.importModule ?? (async (modulePath: string): Promise<Partial<SchemaMigrationModule>> => import(modulePath));

  const fileNames = (await readMigrationDirectory(migrationsDirectory))
    .filter((fileName) => MIGRATION_FILE_PATTERN.test(fileName))
    .sort((left, right) => left.localeCompare(right));

  const migrations: SchemaMigration[] = [];

  for (const fileName of fileNames) {
    const match = MIGRATION_FILE_PATTERN.exec(fileName);
    if (!match) {
      continue;
    }

    const modulePath = pathToFileURL(resolve(migrationsDirectory, fileName)).href;
    const loaded = await importModule(modulePath);
    if (typeof loaded.up !== "function" || typeof loaded.down !== "function") {
      throw new Error(`Invalid schema migration module: ${fileName}`);
    }

    migrations.push({
      id: match[1] ?? fileName,
      name: fileName.replace(/\.ts$/, ""),
      up: loaded.up,
      down: loaded.down
    });
  }

  return migrations;
}

export async function getSchemaMigrationStatus(
  config: SchemaMigrationConfig,
  options: SchemaMigrationStatusOptions = {}
): Promise<SchemaMigrationStatus> {
  const expected = await loadSchemaMigrations(options);
  const bootstrapConnection = options.createConnectionFn ?? createConnection;
  const createPoolForStatus = options.createPoolFn ?? createSchemaMigrationPool;
  const bootstrap = await bootstrapConnection({
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password
  });

  try {
    const [databaseRows] = await bootstrap.query<RowDataPacket[]>(
      `SELECT SCHEMA_NAME
       FROM INFORMATION_SCHEMA.SCHEMATA
       WHERE SCHEMA_NAME = ?
       LIMIT 1`,
      [config.database]
    );

    if (!databaseRows[0]) {
      return {
        database: config.database,
        hasDatabase: false,
        hasMigrationTable: false,
        applied: [],
        pending: expected,
        expected
      };
    }
  } finally {
    await bootstrap.end();
  }

  const pool = await createPoolForStatus(config);

  try {
    const [tableRows] = await pool.query<RowDataPacket[]>(
      `SELECT 1
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
       LIMIT 1`,
      [config.database, SCHEMA_MIGRATIONS_TABLE]
    );

    if (!tableRows[0]) {
      return {
        database: config.database,
        hasDatabase: true,
        hasMigrationTable: false,
        applied: [],
        pending: expected,
        expected
      };
    }

    const [appliedRows] = await pool.query<AppliedSchemaMigration[]>(
      `SELECT id, name, applied_at
       FROM \`${SCHEMA_MIGRATIONS_TABLE}\`
       ORDER BY id ASC`
    );
    const appliedIds = new Set(appliedRows.map((row) => row.id));

    return {
      database: config.database,
      hasDatabase: true,
      hasMigrationTable: true,
      applied: appliedRows,
      pending: expected.filter((migration) => !appliedIds.has(migration.id)),
      expected
    };
  } finally {
    await pool.end();
  }
}

export function formatSchemaMigrationWarning(status: SchemaMigrationStatus): string {
  const latestApplied = status.applied.at(-1)?.name ?? "none";
  const latestExpected = status.expected.at(-1)?.name ?? "none";
  const missingDatabase = !status.hasDatabase ? " Database does not exist yet." : "";
  const missingTable =
    status.hasDatabase && !status.hasMigrationTable ? " `schema_migrations` has not been created yet." : "";

  return [
    `MySQL schema is behind the expected application version for database \`${status.database}\`.`,
    `Current migration: ${latestApplied}. Expected migration: ${latestExpected}.`,
    `Pending migrations: ${status.pending.map((migration) => migration.name).join(", ") || "none"}.`,
    "Run `npm run db:migrate` before starting the server.",
    `${missingDatabase}${missingTable}`.trim()
  ]
    .filter((part) => part.length > 0)
    .join(" ");
}

export async function runPendingSchemaMigrations(
  config: SchemaMigrationConfig,
  logger: Pick<Console, "log"> = console
): Promise<SchemaMigrationRunSummary> {
  const expected = await loadSchemaMigrations();
  await ensureSchemaMigrationDatabase(config);
  const pool = await createSchemaMigrationPool(config);

  try {
    await ensureSchemaMigrationsTable(pool);
    const [appliedRows] = await pool.query<AppliedSchemaMigration[]>(
      `SELECT id, name
       FROM \`${SCHEMA_MIGRATIONS_TABLE}\`
       ORDER BY id ASC`
    );
    const appliedIds = new Set(appliedRows.map((row) => row.id));
    const pending = expected.filter((migration) => !appliedIds.has(migration.id));

    for (const migration of pending) {
      logger.log(`Applying ${migration.name}`);
      await migration.up(pool);
      await pool.query(
        `INSERT INTO \`${SCHEMA_MIGRATIONS_TABLE}\` (id, name)
         VALUES (?, ?)`,
        [migration.id, migration.name]
      );
    }

    return {
      database: config.database,
      applied: pending.map((migration) => migration.name),
      skipped: expected.filter((migration) => appliedIds.has(migration.id)).map((migration) => migration.name)
    };
  } finally {
    await pool.end();
  }
}

export async function rollbackLastSchemaMigration(
  config: SchemaMigrationConfig,
  logger: Pick<Console, "log"> = console
): Promise<SchemaMigrationRollbackSummary> {
  const expected = await loadSchemaMigrations();
  const migrationById = new Map(expected.map((migration) => [migration.id, migration] as const));
  const pool = await createSchemaMigrationPool(config);

  try {
    await ensureSchemaMigrationsTable(pool);
    const [appliedRows] = await pool.query<AppliedSchemaMigration[]>(
      `SELECT id, name
       FROM \`${SCHEMA_MIGRATIONS_TABLE}\`
       ORDER BY id DESC
       LIMIT 1`
    );
    const current = appliedRows[0];
    if (!current) {
      return {
        database: config.database,
        rolledBack: null
      };
    }

    const migration = migrationById.get(current.id);
    if (!migration) {
      throw new Error(`Applied migration ${current.name} is not present locally.`);
    }

    logger.log(`Rolling back ${migration.name}`);
    await migration.down(pool);
    await pool.query(
      `DELETE FROM \`${SCHEMA_MIGRATIONS_TABLE}\`
       WHERE id = ?`,
      [migration.id]
    );

    return {
      database: config.database,
      rolledBack: migration.name
    };
  } finally {
    await pool.end();
  }
}
