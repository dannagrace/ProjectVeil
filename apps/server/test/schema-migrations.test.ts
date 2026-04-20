import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Pool, RowDataPacket } from "mysql2/promise";
import {
  formatSchemaMigrationWarning,
  getSchemaMigrationStatus,
  loadSchemaMigrations,
  schemaMigrationTableName,
  type AppliedSchemaMigration,
  type SchemaMigrationConfig
} from "@server/infra/schema-migrations";

const TEST_CONFIG: SchemaMigrationConfig = {
  host: "127.0.0.1",
  port: 3306,
  user: "veil",
  password: "veil",
  database: "project_veil"
};

async function createMigrationDirectory(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "veil-schema-migrations-"));

  await Promise.all(
    Object.entries(files).map(([fileName, contents]) => writeFile(join(root, fileName), contents, "utf8"))
  );

  return root;
}

function createBootstrapConnection(databaseExists: boolean) {
  return {
    async query<T extends RowDataPacket[]>(): Promise<[T, unknown]> {
      const rows = databaseExists ? ([{ SCHEMA_NAME: TEST_CONFIG.database }] as T) : ([] as T);
      return [rows, undefined];
    },
    async end(): Promise<void> {}
  };
}

function createPoolConnection(hasMigrationTable: boolean, appliedRows: AppliedSchemaMigration[] = []) {
  let queryCount = 0;

  return {
    async query<T extends RowDataPacket[]>(): Promise<[T, unknown]> {
      queryCount += 1;
      if (queryCount === 1) {
        const rows = hasMigrationTable ? ([{ 1: 1 }] as T) : ([] as T);
        return [rows, undefined];
      }

      return [appliedRows as T, undefined];
    },
    async end(): Promise<void> {}
  } as Pick<Pool, "query" | "end">;
}

test("loadSchemaMigrations loads matching files in sorted order and ignores unrelated entries", async (t) => {
  const migrationsDirectory = await createMigrationDirectory({
    "0002_second.ts": "export async function up() {}\nexport async function down() {}\n",
    "0001_first.ts": "export async function up() {}\nexport async function down() {}\n",
    "README.md": "# ignored\n"
  });

  t.after(async () => {
    await rm(migrationsDirectory, { recursive: true, force: true });
  });

  const migrations = await loadSchemaMigrations({ migrationsDirectory });

  assert.deepEqual(
    migrations.map((migration) => ({ id: migration.id, name: migration.name })),
    [
      { id: "0001", name: "0001_first" },
      { id: "0002", name: "0002_second" }
    ]
  );
});

test("loadSchemaMigrations rejects migration modules without both up and down exports", async (t) => {
  const migrationsDirectory = await createMigrationDirectory({
    "0001_invalid.ts": "export async function up() {}\n"
  });

  t.after(async () => {
    await rm(migrationsDirectory, { recursive: true, force: true });
  });

  await assert.rejects(
    () => loadSchemaMigrations({ migrationsDirectory }),
    /Invalid schema migration module: 0001_invalid\.ts/
  );
});

test("getSchemaMigrationStatus reports pending migrations when metadata table exists", async (t) => {
  const migrationsDirectory = await createMigrationDirectory({
    "0002_add_sessions.ts": "export async function up() {}\nexport async function down() {}\n",
    "0001_init_schema.ts": "export async function up() {}\nexport async function down() {}\n"
  });

  t.after(async () => {
    await rm(migrationsDirectory, { recursive: true, force: true });
  });

  const status = await getSchemaMigrationStatus(TEST_CONFIG, {
    migrationsDirectory,
    createConnectionFn: async () => createBootstrapConnection(true) as never,
    createPoolFn: async () =>
      createPoolConnection(true, [
        {
          id: "0001",
          name: "0001_init_schema",
          applied_at: "2026-03-29T00:00:00.000Z"
        } as AppliedSchemaMigration
      ]) as never
  });

  assert.equal(status.hasDatabase, true);
  assert.equal(status.hasMigrationTable, true);
  assert.deepEqual(status.applied.map((migration) => migration.id), ["0001"]);
  assert.deepEqual(status.pending.map((migration) => migration.id), ["0002"]);
  assert.equal(schemaMigrationTableName(), "schema_migrations");
});

test("getSchemaMigrationStatus reports all migrations pending when metadata table is missing", async (t) => {
  const migrationsDirectory = await createMigrationDirectory({
    "0001_init_schema.ts": "export async function up() {}\nexport async function down() {}\n"
  });

  t.after(async () => {
    await rm(migrationsDirectory, { recursive: true, force: true });
  });

  const status = await getSchemaMigrationStatus(TEST_CONFIG, {
    migrationsDirectory,
    createConnectionFn: async () => createBootstrapConnection(true) as never,
    createPoolFn: async () => createPoolConnection(false) as never
  });

  assert.equal(status.hasDatabase, true);
  assert.equal(status.hasMigrationTable, false);
  assert.deepEqual(status.applied, []);
  assert.deepEqual(status.pending.map((migration) => migration.id), ["0001"]);
});

test("getSchemaMigrationStatus reports a missing database as fully pending and formats a bootstrap warning", async (t) => {
  const migrationsDirectory = await createMigrationDirectory({
    "0002_add_sessions.ts": "export async function up() {}\nexport async function down() {}\n",
    "0001_init_schema.ts": "export async function up() {}\nexport async function down() {}\n"
  });

  t.after(async () => {
    await rm(migrationsDirectory, { recursive: true, force: true });
  });

  const status = await getSchemaMigrationStatus(TEST_CONFIG, {
    migrationsDirectory,
    createConnectionFn: async () => createBootstrapConnection(false) as never,
    createPoolFn: async () => {
      throw new Error("pool should not be created when the database is missing");
    }
  });

  assert.equal(status.hasDatabase, false);
  assert.equal(status.hasMigrationTable, false);
  assert.deepEqual(status.applied, []);
  assert.deepEqual(status.pending.map((migration) => migration.id), ["0001", "0002"]);
  const warning = formatSchemaMigrationWarning(status);
  assert.match(warning, /Pending migrations: 0001_init_schema, 0002_add_sessions\./);
  assert.match(warning, /Database does not exist yet\.$/);
});
