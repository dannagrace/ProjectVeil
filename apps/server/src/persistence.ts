import { createConnection, createPool, type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { normalizeHeroState, type HeroState, type ResourceLedger, type WorldState } from "../../../packages/shared/src/index";
import type { RoomPersistenceSnapshot } from "./index";

export interface RoomSnapshotStore {
  load(roomId: string): Promise<RoomPersistenceSnapshot | null>;
  save(roomId: string, snapshot: RoomPersistenceSnapshot): Promise<void>;
  delete(roomId: string): Promise<void>;
  pruneExpired(referenceTime?: Date): Promise<number>;
  close(): Promise<void>;
}

export interface SnapshotRetentionPolicy {
  ttlHours: number | null;
  cleanupIntervalMinutes: number | null;
}

export interface MySqlPersistenceConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  retention: SnapshotRetentionPolicy;
}

interface RoomSnapshotRow extends RowDataPacket {
  room_id: string;
  state_json: string | RoomPersistenceSnapshot["state"];
  battles_json: string | RoomPersistenceSnapshot["battles"];
  updated_at: Date | string;
}

interface RoomSnapshotSummaryRow extends RowDataPacket {
  room_id: string;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
  payload_bytes: number;
}

interface PlayerRoomProfileRow extends RowDataPacket {
  room_id: string;
  player_id: string;
  heroes_json: string | HeroState[];
  resources_json: string | ResourceLedger;
  updated_at: Date | string;
}

interface PlayerRoomProfileSummaryRow extends RowDataPacket {
  room_id: string;
  player_id: string;
  heroes_json: string | HeroState[];
  resources_json: string | ResourceLedger;
  version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface RoomSnapshotSummary {
  roomId: string;
  version: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  payloadBytes: number;
  expired: boolean;
}

export interface PlayerRoomProfileSnapshot {
  roomId: string;
  playerId: string;
  heroes: HeroState[];
  resources: ResourceLedger;
}

export interface PlayerRoomProfileSummary {
  roomId: string;
  playerId: string;
  version: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  heroCount: number;
  resources: ResourceLedger;
  payloadBytes: number;
  expired: boolean;
}

export interface PlayerRoomProfileListOptions {
  limit?: number;
  roomId?: string;
  playerId?: string;
}

export const MYSQL_DEFAULT_DATABASE = "project_veil";
export const MYSQL_ROOM_SNAPSHOT_TABLE = "room_snapshots";
export const MYSQL_ROOM_SNAPSHOT_UPDATED_AT_INDEX = "idx_room_snapshots_updated_at";
export const MYSQL_PLAYER_ROOM_PROFILE_TABLE = "player_room_profiles";
export const MYSQL_PLAYER_ROOM_PROFILE_UPDATED_AT_INDEX = "idx_player_room_profiles_updated_at";
export const MYSQL_CONFIG_DOCUMENT_TABLE = "config_documents";
export const MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX = "idx_config_documents_updated_at";
export const DEFAULT_SNAPSHOT_TTL_HOURS = 72;
export const DEFAULT_SNAPSHOT_CLEANUP_INTERVAL_MINUTES = 30;

function readOptionalPositiveNumber(value: string | undefined, fallback: number): number | null {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  if (parsed <= 0) {
    return null;
  }

  return parsed;
}

function timestampOf(value: Date | string): number {
  return (typeof value === "string" ? new Date(value) : value).getTime();
}

function payloadLengthOf(value: string | object): number {
  return typeof value === "string" ? value.length : JSON.stringify(value).length;
}

function normalizeResourceLedger(resources?: Partial<ResourceLedger>): ResourceLedger {
  return {
    gold: 0,
    wood: 0,
    ore: 0,
    ...resources
  };
}

export function snapshotHasExpired(
  updatedAt: Date | string,
  ttlHours: number | null,
  now = new Date()
): boolean {
  if (ttlHours == null) {
    return false;
  }

  return now.getTime() - timestampOf(updatedAt) >= ttlHours * 60 * 60 * 1000;
}

export function createPlayerRoomProfiles(state: WorldState): PlayerRoomProfileSnapshot[] {
  const playerIds = Array.from(new Set([...state.heroes.map((hero) => hero.playerId), ...Object.keys(state.resources)]));

  return playerIds.map((playerId) => ({
    roomId: state.meta.roomId,
    playerId,
    heroes: state.heroes
      .filter((hero) => hero.playerId === playerId)
      .map((hero) => normalizeHeroState(hero)),
    resources: normalizeResourceLedger(state.resources[playerId])
  }));
}

export function applyPlayerProfilesToWorldState(
  state: WorldState,
  profiles: PlayerRoomProfileSnapshot[]
): WorldState {
  if (profiles.length === 0) {
    return state;
  }

  const profileByPlayerId = new Map(profiles.map((profile) => [profile.playerId, profile] as const));
  const orderedPlayerIds = Array.from(
    new Set([...state.heroes.map((hero) => hero.playerId), ...profiles.map((profile) => profile.playerId)])
  );

  const nextHeroes = orderedPlayerIds.flatMap((playerId) => {
    const profile = profileByPlayerId.get(playerId);
    if (profile) {
      return profile.heroes.map((hero) => normalizeHeroState(hero));
    }

    return state.heroes
      .filter((hero) => hero.playerId === playerId)
      .map((hero) => normalizeHeroState(hero));
  });

  const nextResources = { ...state.resources };
  for (const playerId of orderedPlayerIds) {
    const profile = profileByPlayerId.get(playerId);
    nextResources[playerId] = normalizeResourceLedger(profile?.resources ?? state.resources[playerId]);
  }

  return {
    ...state,
    heroes: nextHeroes,
    resources: nextResources
  };
}

export function readMySqlPersistenceConfig(env: NodeJS.ProcessEnv = process.env): MySqlPersistenceConfig | null {
  const host = env.VEIL_MYSQL_HOST;
  const user = env.VEIL_MYSQL_USER;
  const password = env.VEIL_MYSQL_PASSWORD;
  if (!host || !user || !password) {
    return null;
  }

  return {
    host,
    port: Number(env.VEIL_MYSQL_PORT ?? 3306),
    user,
    password,
    database: env.VEIL_MYSQL_DATABASE ?? MYSQL_DEFAULT_DATABASE,
    retention: {
      ttlHours: readOptionalPositiveNumber(env.VEIL_MYSQL_SNAPSHOT_TTL_HOURS, DEFAULT_SNAPSHOT_TTL_HOURS),
      cleanupIntervalMinutes: readOptionalPositiveNumber(
        env.VEIL_MYSQL_SNAPSHOT_CLEANUP_INTERVAL_MINUTES,
        DEFAULT_SNAPSHOT_CLEANUP_INTERVAL_MINUTES
      )
    }
  };
}

export function buildMySqlSchemaSql(database = MYSQL_DEFAULT_DATABASE): string {
  return `
CREATE DATABASE IF NOT EXISTS \`${database}\`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE \`${database}\`;

CREATE TABLE IF NOT EXISTS \`${MYSQL_ROOM_SNAPSHOT_TABLE}\` (
  room_id VARCHAR(191) NOT NULL,
  state_json LONGTEXT NOT NULL,
  battles_json LONGTEXT NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @veil_room_snapshots_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_ROOM_SNAPSHOT_TABLE}'
    AND INDEX_NAME = '${MYSQL_ROOM_SNAPSHOT_UPDATED_AT_INDEX}'
);

SET @veil_room_snapshots_idx_sql := IF(
  @veil_room_snapshots_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_ROOM_SNAPSHOT_UPDATED_AT_INDEX}\` ON \`${MYSQL_ROOM_SNAPSHOT_TABLE}\` (updated_at)',
  'SELECT 1'
);

PREPARE veil_room_snapshots_idx_stmt FROM @veil_room_snapshots_idx_sql;
EXECUTE veil_room_snapshots_idx_stmt;
DEALLOCATE PREPARE veil_room_snapshots_idx_stmt;

CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\` (
  room_id VARCHAR(191) NOT NULL,
  player_id VARCHAR(191) NOT NULL,
  heroes_json LONGTEXT NOT NULL,
  resources_json LONGTEXT NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @veil_player_profiles_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ROOM_PROFILE_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_ROOM_PROFILE_UPDATED_AT_INDEX}'
);

SET @veil_player_profiles_idx_sql := IF(
  @veil_player_profiles_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PLAYER_ROOM_PROFILE_UPDATED_AT_INDEX}\` ON \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\` (updated_at)',
  'SELECT 1'
);

PREPARE veil_player_profiles_idx_stmt FROM @veil_player_profiles_idx_sql;
EXECUTE veil_player_profiles_idx_stmt;
DEALLOCATE PREPARE veil_player_profiles_idx_stmt;

CREATE TABLE IF NOT EXISTS \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (
  document_id VARCHAR(64) NOT NULL,
  content_json LONGTEXT NOT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  exported_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (document_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @veil_config_documents_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_CONFIG_DOCUMENT_TABLE}'
    AND INDEX_NAME = '${MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX}'
);

SET @veil_config_documents_idx_sql := IF(
  @veil_config_documents_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX}\` ON \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (updated_at)',
  'SELECT 1'
);

PREPARE veil_config_documents_idx_stmt FROM @veil_config_documents_idx_sql;
EXECUTE veil_config_documents_idx_stmt;
DEALLOCATE PREPARE veil_config_documents_idx_stmt;
`.trim();
}

function parseJsonColumn<T>(value: string | T): T {
  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return value;
}

async function deletePlayerProfilesForRoom(connection: PoolConnection, roomId: string): Promise<void> {
  await connection.query(`DELETE FROM \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\` WHERE room_id = ?`, [roomId]);
}

async function savePlayerProfiles(
  connection: PoolConnection,
  roomId: string,
  profiles: PlayerRoomProfileSnapshot[]
): Promise<void> {
  for (const profile of profiles) {
    await connection.query(
      `INSERT INTO \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\` (room_id, player_id, heroes_json, resources_json)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         heroes_json = VALUES(heroes_json),
         resources_json = VALUES(resources_json),
         version = version + 1`,
      [roomId, profile.playerId, JSON.stringify(profile.heroes), JSON.stringify(profile.resources)]
    );
  }

  if (profiles.length === 0) {
    await deletePlayerProfilesForRoom(connection, roomId);
    return;
  }

  const placeholders = profiles.map(() => "?").join(", ");
  await connection.query(
    `DELETE FROM \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\`
     WHERE room_id = ?
       AND player_id NOT IN (${placeholders})`,
    [roomId, ...profiles.map((profile) => profile.playerId)]
  );
}

export class MySqlRoomSnapshotStore implements RoomSnapshotStore {
  private readonly pool: Pool;
  private readonly database: string;
  private readonly retention: SnapshotRetentionPolicy;

  private constructor(pool: Pool, database: string, retention: SnapshotRetentionPolicy) {
    this.pool = pool;
    this.database = database;
    this.retention = retention;
  }

  static async create(config: MySqlPersistenceConfig): Promise<MySqlRoomSnapshotStore> {
    const bootstrap = await createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password
    });

    await bootstrap.query(
      `CREATE DATABASE IF NOT EXISTS \`${config.database}\` DEFAULT CHARACTER SET utf8mb4 DEFAULT COLLATE utf8mb4_unicode_ci`
    );
    await bootstrap.end();

    const pool = createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      connectionLimit: 4,
      namedPlaceholders: true
    });

    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${MYSQL_ROOM_SNAPSHOT_TABLE}\` (
        room_id VARCHAR(191) NOT NULL,
        state_json LONGTEXT NOT NULL,
        battles_json LONGTEXT NOT NULL,
        version BIGINT UNSIGNED NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\` (
        room_id VARCHAR(191) NOT NULL,
        player_id VARCHAR(191) NOT NULL,
        heroes_json LONGTEXT NOT NULL,
        resources_json LONGTEXT NOT NULL,
        version BIGINT UNSIGNED NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (room_id, player_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (
        document_id VARCHAR(64) NOT NULL,
        content_json LONGTEXT NOT NULL,
        version BIGINT UNSIGNED NOT NULL DEFAULT 1,
        exported_at DATETIME NULL DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (document_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    const [indexRows] = await pool.query<RowDataPacket[]>(
      `SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND INDEX_NAME = ?
       LIMIT 1`,
      [config.database, MYSQL_ROOM_SNAPSHOT_TABLE, MYSQL_ROOM_SNAPSHOT_UPDATED_AT_INDEX]
    );

    if (!indexRows[0]) {
      await pool.query(
        `CREATE INDEX \`${MYSQL_ROOM_SNAPSHOT_UPDATED_AT_INDEX}\`
         ON \`${MYSQL_ROOM_SNAPSHOT_TABLE}\` (updated_at)`
      );
    }

    const [profileIndexRows] = await pool.query<RowDataPacket[]>(
      `SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND INDEX_NAME = ?
       LIMIT 1`,
      [config.database, MYSQL_PLAYER_ROOM_PROFILE_TABLE, MYSQL_PLAYER_ROOM_PROFILE_UPDATED_AT_INDEX]
    );

    if (!profileIndexRows[0]) {
      await pool.query(
        `CREATE INDEX \`${MYSQL_PLAYER_ROOM_PROFILE_UPDATED_AT_INDEX}\`
         ON \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\` (updated_at)`
      );
    }

    const [configIndexRows] = await pool.query<RowDataPacket[]>(
      `SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND INDEX_NAME = ?
       LIMIT 1`,
      [config.database, MYSQL_CONFIG_DOCUMENT_TABLE, MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX]
    );

    if (!configIndexRows[0]) {
      await pool.query(
        `CREATE INDEX \`${MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX}\`
         ON \`${MYSQL_CONFIG_DOCUMENT_TABLE}\` (updated_at)`
      );
    }

    return new MySqlRoomSnapshotStore(pool, config.database, config.retention);
  }

  async load(roomId: string): Promise<RoomPersistenceSnapshot | null> {
    const [rows] = await this.pool.query<RoomSnapshotRow[]>(
      `SELECT room_id, state_json, battles_json, updated_at
       FROM \`${MYSQL_ROOM_SNAPSHOT_TABLE}\`
       WHERE room_id = ?
       LIMIT 1`,
      [roomId]
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    if (snapshotHasExpired(row.updated_at, this.retention.ttlHours)) {
      await this.delete(roomId);
      return null;
    }

    const [profileRows] = await this.pool.query<PlayerRoomProfileRow[]>(
      `SELECT room_id, player_id, heroes_json, resources_json, updated_at
       FROM \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\`
       WHERE room_id = ?`,
      [roomId]
    );

    const profiles: PlayerRoomProfileSnapshot[] = profileRows.map((profile) => ({
      roomId: profile.room_id,
      playerId: profile.player_id,
      heroes: parseJsonColumn<HeroState[]>(profile.heroes_json).map((hero) => normalizeHeroState(hero)),
      resources: normalizeResourceLedger(parseJsonColumn<ResourceLedger>(profile.resources_json))
    }));

    const persistedState = parseJsonColumn<WorldState>(row.state_json);

    return {
      state: applyPlayerProfilesToWorldState(
        {
          ...persistedState,
          heroes: persistedState.heroes.map((hero) => normalizeHeroState(hero))
        },
        profiles
      ),
      battles: parseJsonColumn<RoomPersistenceSnapshot["battles"]>(row.battles_json)
    };
  }

  async save(roomId: string, snapshot: RoomPersistenceSnapshot): Promise<void> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO \`${MYSQL_ROOM_SNAPSHOT_TABLE}\` (room_id, state_json, battles_json)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE
           state_json = VALUES(state_json),
           battles_json = VALUES(battles_json),
           version = version + 1`,
        [roomId, JSON.stringify(snapshot.state), JSON.stringify(snapshot.battles)]
      );
      await savePlayerProfiles(connection, roomId, createPlayerRoomProfiles(snapshot.state));
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async delete(roomId: string): Promise<void> {
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      await connection.query(`DELETE FROM \`${MYSQL_ROOM_SNAPSHOT_TABLE}\` WHERE room_id = ?`, [roomId]);
      await deletePlayerProfilesForRoom(connection, roomId);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async pruneExpired(referenceTime = new Date()): Promise<number> {
    const [roomCount, profileCount] = await Promise.all([
      this.pruneExpiredRoomSnapshots(referenceTime),
      this.pruneExpiredPlayerProfiles(referenceTime)
    ]);

    return roomCount + profileCount;
  }

  async pruneExpiredRoomSnapshots(referenceTime = new Date()): Promise<number> {
    if (this.retention.ttlHours == null) {
      return 0;
    }

    const cutoff = new Date(referenceTime.getTime() - this.retention.ttlHours * 60 * 60 * 1000);
    const [roomResult] = await this.pool.query<ResultSetHeader>(
      `DELETE FROM \`${MYSQL_ROOM_SNAPSHOT_TABLE}\`
       WHERE updated_at < ?`,
      [cutoff]
    );

    return roomResult.affectedRows;
  }

  async pruneExpiredPlayerProfiles(referenceTime = new Date()): Promise<number> {
    if (this.retention.ttlHours == null) {
      return 0;
    }

    const cutoff = new Date(referenceTime.getTime() - this.retention.ttlHours * 60 * 60 * 1000);
    const [profileResult] = await this.pool.query<ResultSetHeader>(
      `DELETE FROM \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\`
       WHERE updated_at < ?`,
      [cutoff]
    );

    return profileResult.affectedRows;
  }

  async listSnapshots(limit = 20, referenceTime = new Date()): Promise<RoomSnapshotSummary[]> {
    const safeLimit = Math.max(1, Math.floor(limit));
    const [rows] = await this.pool.query<RoomSnapshotSummaryRow[]>(
      `SELECT room_id, version, created_at, updated_at,
              CHAR_LENGTH(state_json) + CHAR_LENGTH(battles_json) AS payload_bytes
       FROM \`${MYSQL_ROOM_SNAPSHOT_TABLE}\`
       ORDER BY updated_at DESC
       LIMIT ?`,
      [safeLimit]
    );

    return rows.map((row) => ({
      roomId: row.room_id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      payloadBytes: row.payload_bytes,
      expired: snapshotHasExpired(row.updated_at, this.retention.ttlHours, referenceTime)
    }));
  }

  async listPlayerProfiles(
    options: PlayerRoomProfileListOptions = {},
    referenceTime = new Date()
  ): Promise<PlayerRoomProfileSummary[]> {
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (options.roomId) {
      clauses.push("room_id = ?");
      params.push(options.roomId);
    }

    if (options.playerId) {
      clauses.push("player_id = ?");
      params.push(options.playerId);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await this.pool.query<PlayerRoomProfileSummaryRow[]>(
      `SELECT room_id, player_id, heroes_json, resources_json, version, created_at, updated_at
       FROM \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\`
       ${whereClause}
       ORDER BY updated_at DESC
       LIMIT ?`,
      [...params, safeLimit]
    );

    return rows.map((row) => {
      const heroes = parseJsonColumn<HeroState[]>(row.heroes_json);
      const resources = normalizeResourceLedger(parseJsonColumn<ResourceLedger>(row.resources_json));

      return {
        roomId: row.room_id,
        playerId: row.player_id,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        heroCount: heroes.length,
        resources,
        payloadBytes: payloadLengthOf(row.heroes_json) + payloadLengthOf(row.resources_json),
        expired: snapshotHasExpired(row.updated_at, this.retention.ttlHours, referenceTime)
      };
    });
  }

  async deletePlayerProfile(roomId: string, playerId: string): Promise<number> {
    const [result] = await this.pool.query<ResultSetHeader>(
      `DELETE FROM \`${MYSQL_PLAYER_ROOM_PROFILE_TABLE}\`
       WHERE room_id = ?
         AND player_id = ?`,
      [roomId, playerId]
    );

    return result.affectedRows;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  getRetentionPolicy(): SnapshotRetentionPolicy {
    return this.retention;
  }

  describe(): string {
    return `mysql://${this.database}/${MYSQL_ROOM_SNAPSHOT_TABLE}`;
  }
}

export async function createConfiguredRoomSnapshotStore(
  env: NodeJS.ProcessEnv = process.env
): Promise<RoomSnapshotStore | null> {
  const config = readMySqlPersistenceConfig(env);
  if (!config) {
    return null;
  }

  return MySqlRoomSnapshotStore.create(config);
}
