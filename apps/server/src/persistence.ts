import { createConnection, createPool, type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import {
  appendPlayerBattleReplaySummaries,
  normalizeEventLogQuery,
  normalizeAchievementProgress,
  normalizeEventLogEntries,
  normalizePlayerAccountReadModel,
  type EventLogQuery,
  normalizeHeroState,
  type EventLogEntry,
  type HeroState,
  type PlayerAccountReadModel,
  type PlayerBattleReplaySummary,
  type PlayerAchievementProgress,
  type ResourceLedger,
  type WorldState
} from "../../../packages/shared/src/index";
import type { RoomPersistenceSnapshot } from "./index";

export interface RoomSnapshotStore {
  load(roomId: string): Promise<RoomPersistenceSnapshot | null>;
  loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null>;
  loadPlayerAccountByLoginId(loginId: string): Promise<PlayerAccountSnapshot | null>;
  loadPlayerAccountByWechatMiniGameOpenId(openId: string): Promise<PlayerAccountSnapshot | null>;
  loadPlayerEventHistory(playerId: string, query?: PlayerEventHistoryQuery): Promise<PlayerEventHistorySnapshot>;
  loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]>;
  loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null>;
  loadPlayerHeroArchives(playerIds: string[]): Promise<PlayerHeroArchiveSnapshot[]>;
  ensurePlayerAccount(input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot>;
  bindPlayerAccountCredentials(
    playerId: string,
    input: PlayerAccountCredentialInput
  ): Promise<PlayerAccountSnapshot>;
  bindPlayerAccountWechatMiniGameIdentity(
    playerId: string,
    input: PlayerAccountWechatMiniGameIdentityInput
  ): Promise<PlayerAccountSnapshot>;
  savePlayerAccountProfile(playerId: string, patch: PlayerAccountProfilePatch): Promise<PlayerAccountSnapshot>;
  savePlayerAccountProgress(playerId: string, patch: PlayerAccountProgressPatch): Promise<PlayerAccountSnapshot>;
  listPlayerAccounts(options?: PlayerAccountListOptions): Promise<PlayerAccountSnapshot[]>;
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

interface PlayerAccountRow extends RowDataPacket {
  player_id: string;
  display_name: string | null;
  avatar_url: string | null;
  global_resources_json: string | ResourceLedger;
  achievements_json: string | PlayerAchievementProgress[] | null;
  recent_event_log_json: string | EventLogEntry[] | null;
  recent_battle_replays_json: string | PlayerBattleReplaySummary[] | null;
  last_room_id: string | null;
  last_seen_at: Date | string | null;
  login_id: string | null;
  wechat_mini_game_open_id: string | null;
  wechat_mini_game_union_id: string | null;
  wechat_mini_game_bound_at: Date | string | null;
  credential_bound_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PlayerAccountAuthRow extends RowDataPacket {
  player_id: string;
  display_name: string | null;
  login_id: string | null;
  password_hash: string | null;
  credential_bound_at: Date | string | null;
}

interface PlayerEventHistoryRow extends RowDataPacket {
  player_id: string;
  event_id: string;
  timestamp: Date | string;
  room_id: string;
  category: EventLogEntry["category"];
  hero_id: string | null;
  world_event_type: EventLogEntry["worldEventType"] | null;
  achievement_id: EventLogEntry["achievementId"] | null;
  entry_json: string | EventLogEntry;
  created_at: Date | string;
}

interface PlayerEventHistoryCountRow extends RowDataPacket {
  total: number;
}

interface PlayerHeroArchiveRow extends RowDataPacket {
  player_id: string;
  hero_id: string;
  hero_json: string | HeroState;
  army_template_id: string | null;
  army_count: number | null;
  learned_skills_json: string | HeroState["loadout"]["learnedSkills"] | null;
  equipment_json: string | HeroState["loadout"]["equipment"] | null;
  inventory_json: string | HeroState["loadout"]["inventory"] | null;
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

export interface PlayerAccountSnapshot extends PlayerAccountReadModel {
  recentBattleReplays?: PlayerBattleReplaySummary[];
  wechatMiniGameOpenId?: string;
  wechatMiniGameUnionId?: string;
  wechatMiniGameBoundAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlayerAccountAuthSnapshot {
  playerId: string;
  displayName: string;
  loginId: string;
  passwordHash: string;
  credentialBoundAt?: string;
}

export interface PlayerHeroArchiveSnapshot {
  playerId: string;
  heroId: string;
  hero: HeroState;
}

export interface PlayerAccountEnsureInput {
  playerId: string;
  displayName?: string;
  lastRoomId?: string;
}

export interface PlayerAccountProfilePatch {
  displayName?: string;
  avatarUrl?: string | null;
  lastRoomId?: string | null;
}

export interface PlayerAccountProgressPatch {
  achievements?: Partial<PlayerAchievementProgress>[] | null;
  recentEventLog?: Partial<EventLogEntry>[] | null;
  recentBattleReplays?: Partial<PlayerBattleReplaySummary>[] | null;
  lastRoomId?: string | null;
}

export interface PlayerAccountCredentialInput {
  loginId: string;
  passwordHash: string;
}

export interface PlayerAccountWechatMiniGameIdentityInput {
  openId: string;
  unionId?: string;
  displayName?: string;
  avatarUrl?: string | null;
}

export interface PlayerAccountListOptions {
  limit?: number;
  playerId?: string;
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

export interface PlayerEventHistoryQuery extends EventLogQuery {}

export interface PlayerEventHistorySnapshot {
  items: EventLogEntry[];
  total: number;
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
export const MYSQL_PLAYER_ACCOUNT_TABLE = "player_accounts";
export const MYSQL_PLAYER_ACCOUNT_UPDATED_AT_INDEX = "idx_player_accounts_updated_at";
export const MYSQL_PLAYER_ACCOUNT_LOGIN_ID_INDEX = "uidx_player_accounts_login_id";
export const MYSQL_PLAYER_ACCOUNT_WECHAT_OPEN_ID_INDEX = "uidx_player_accounts_wechat_open_id";
export const MYSQL_PLAYER_EVENT_HISTORY_TABLE = "player_event_history";
export const MYSQL_PLAYER_EVENT_HISTORY_TIMESTAMP_INDEX = "idx_player_event_history_player_time";
export const MYSQL_PLAYER_HERO_ARCHIVE_TABLE = "player_hero_archives";
export const MYSQL_PLAYER_HERO_ARCHIVE_UPDATED_AT_INDEX = "idx_player_hero_archives_updated_at";
export const MYSQL_CONFIG_DOCUMENT_TABLE = "config_documents";
export const MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX = "idx_config_documents_updated_at";
export const DEFAULT_SNAPSHOT_TTL_HOURS = 72;
export const DEFAULT_SNAPSHOT_CLEANUP_INTERVAL_MINUTES = 30;
export const MAX_PLAYER_DISPLAY_NAME_LENGTH = 40;
export const MAX_PLAYER_LOGIN_ID_LENGTH = 40;
export const MAX_PLAYER_AVATAR_URL_LENGTH = 512;
const MYSQL_DUPLICATE_ENTRY_ERROR_CODE = "ER_DUP_ENTRY";
const MYSQL_DUPLICATE_ENTRY_ERRNO = 1062;

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

function normalizePlayerId(playerId: string): string {
  const normalized = playerId.trim();
  if (normalized.length === 0) {
    throw new Error("playerId must not be empty");
  }

  return normalized;
}

function normalizePlayerDisplayName(playerId: string, displayName?: string | null): string {
  const fallback = normalizePlayerId(playerId);
  const normalized = displayName?.trim();
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, MAX_PLAYER_DISPLAY_NAME_LENGTH);
}

function normalizePlayerAvatarUrl(avatarUrl?: string | null): string | undefined {
  const normalized = avatarUrl?.trim();
  return normalized ? normalized.slice(0, MAX_PLAYER_AVATAR_URL_LENGTH) : undefined;
}

export function normalizePlayerLoginId(loginId: string): string {
  const normalized = loginId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,39}$/.test(normalized)) {
    throw new Error(
      "loginId must be 3-40 chars and use only lowercase letters, digits, underscores, or hyphens"
    );
  }

  return normalized.slice(0, MAX_PLAYER_LOGIN_ID_LENGTH);
}

function normalizeWechatMiniGameOpenId(openId: string): string {
  const normalized = openId.trim();
  if (!normalized) {
    throw new Error("wechatMiniGameOpenId must not be empty");
  }

  return normalized;
}

function normalizeWechatMiniGameUnionId(unionId?: string | null): string | undefined {
  const normalized = unionId?.trim();
  return normalized ? normalized : undefined;
}

function formatTimestamp(value: Date | string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString();
}

function isMySqlDuplicateEntryError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    errno?: unknown;
  };

  return candidate.code === MYSQL_DUPLICATE_ENTRY_ERROR_CODE || candidate.errno === MYSQL_DUPLICATE_ENTRY_ERRNO;
}

function normalizePlayerAccountSnapshot(account: {
  playerId: string;
  displayName?: string | null | undefined;
  avatarUrl?: string | null | undefined;
  globalResources?: Partial<ResourceLedger>;
  achievements?: Partial<PlayerAchievementProgress>[] | null | undefined;
  recentEventLog?: Partial<EventLogEntry>[] | null | undefined;
  recentBattleReplays?: Partial<PlayerBattleReplaySummary>[] | null | undefined;
  lastRoomId?: string | undefined;
  lastSeenAt?: string | undefined;
  loginId?: string | null | undefined;
  wechatMiniGameOpenId?: string | null | undefined;
  wechatMiniGameUnionId?: string | null | undefined;
  wechatMiniGameBoundAt?: string | undefined;
  credentialBoundAt?: string | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
}): PlayerAccountSnapshot {
  const playerId = normalizePlayerId(account.playerId);
  const normalizedWechatMiniGameOpenId = account.wechatMiniGameOpenId
    ? normalizeWechatMiniGameOpenId(account.wechatMiniGameOpenId)
    : undefined;
  const normalizedWechatMiniGameUnionId = account.wechatMiniGameUnionId
    ? normalizeWechatMiniGameUnionId(account.wechatMiniGameUnionId)
    : undefined;

  return {
    ...normalizePlayerAccountReadModel({
      playerId,
      displayName: normalizePlayerDisplayName(playerId, account.displayName),
      avatarUrl: normalizePlayerAvatarUrl(account.avatarUrl),
      globalResources: normalizeResourceLedger(account.globalResources),
      achievements: account.achievements,
      recentEventLog: account.recentEventLog,
      recentBattleReplays: appendPlayerBattleReplaySummaries([], account.recentBattleReplays),
      lastRoomId: account.lastRoomId,
      lastSeenAt: account.lastSeenAt,
      loginId: account.loginId ? normalizePlayerLoginId(account.loginId) : undefined,
      credentialBoundAt: account.credentialBoundAt
    }),
    ...(normalizedWechatMiniGameOpenId ? { wechatMiniGameOpenId: normalizedWechatMiniGameOpenId } : {}),
    ...(normalizedWechatMiniGameUnionId ? { wechatMiniGameUnionId: normalizedWechatMiniGameUnionId } : {}),
    ...(account.wechatMiniGameBoundAt ? { wechatMiniGameBoundAt: account.wechatMiniGameBoundAt } : {}),
    ...(account.createdAt ? { createdAt: account.createdAt } : {}),
    ...(account.updatedAt ? { updatedAt: account.updatedAt } : {})
  };
}

function normalizePlayerEventHistoryQuery(query: PlayerEventHistoryQuery = {}): Required<Pick<PlayerEventHistoryQuery, "offset">> &
  Pick<PlayerEventHistoryQuery, "category" | "heroId" | "achievementId" | "worldEventType" | "since" | "until"> &
  { limit?: number } {
  return normalizeEventLogQuery(query);
}

function extractNewPlayerEventHistoryEntries(
  existing: Partial<EventLogEntry>[] | null | undefined,
  next: Partial<EventLogEntry>[] | null | undefined
): EventLogEntry[] {
  const existingIds = new Set(normalizeEventLogEntries(existing).map((entry) => entry.id));

  return normalizeEventLogEntries(next)
    .filter((entry) => !existingIds.has(entry.id))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id));
}

function collectPlayerIds(state: WorldState): string[] {
  return Array.from(new Set([...state.heroes.map((hero) => hero.playerId), ...Object.keys(state.resources)]));
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
  const playerIds = collectPlayerIds(state);

  return playerIds.map((playerId) => ({
    roomId: state.meta.roomId,
    playerId,
    heroes: state.heroes
      .filter((hero) => hero.playerId === playerId)
      .map((hero) => normalizeHeroState(hero)),
    resources: normalizeResourceLedger(state.resources[playerId])
  }));
}

export function createPlayerAccountsFromWorldState(state: WorldState): PlayerAccountSnapshot[] {
  return collectPlayerIds(state).map((playerId) => ({
    ...normalizePlayerAccountReadModel({
      playerId,
      displayName: normalizePlayerDisplayName(playerId),
      globalResources: normalizeResourceLedger(state.resources[playerId])
    })
  }));
}

export function createPlayerHeroArchivesFromWorldState(state: WorldState): PlayerHeroArchiveSnapshot[] {
  return state.heroes.map((hero) => ({
    playerId: hero.playerId,
    heroId: hero.id,
    hero: normalizeHeroState(hero)
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

function mergeHeroArchiveIntoFreshHero(baseHero: HeroState, archive: PlayerHeroArchiveSnapshot): HeroState {
  const archivedHero = normalizeHeroState(archive.hero);

  return normalizeHeroState({
    ...baseHero,
    stats: {
      ...archivedHero.stats,
      hp: archivedHero.stats.maxHp
    },
    progression: archivedHero.progression,
    loadout: archivedHero.loadout,
    armyTemplateId: archivedHero.armyTemplateId,
    armyCount: archivedHero.armyCount,
    learnedSkills: archivedHero.learnedSkills,
    move: {
      total: archivedHero.move.total,
      remaining: archivedHero.move.total
    }
  });
}

export function applyPlayerAccountsToWorldState(
  state: WorldState,
  accounts: PlayerAccountSnapshot[]
): WorldState {
  if (accounts.length === 0) {
    return state;
  }

  const accountByPlayerId = new Map(accounts.map((account) => [account.playerId, account] as const));
  const nextResources = { ...state.resources };
  const orderedPlayerIds = Array.from(new Set([...collectPlayerIds(state), ...accounts.map((account) => account.playerId)]));

  for (const playerId of orderedPlayerIds) {
    nextResources[playerId] = normalizeResourceLedger(
      accountByPlayerId.get(playerId)?.globalResources ?? state.resources[playerId]
    );
  }

  return {
    ...state,
    resources: nextResources
  };
}

export function applyPlayerHeroArchivesToWorldState(
  state: WorldState,
  archives: PlayerHeroArchiveSnapshot[]
): WorldState {
  if (archives.length === 0) {
    return state;
  }

  const archiveByKey = new Map(
    archives.map((archive) => [`${archive.playerId}:${archive.heroId}`, archive] as const)
  );

  return {
    ...state,
    heroes: state.heroes.map((hero) => {
      const archive = archiveByKey.get(`${hero.playerId}:${hero.id}`);
      return archive ? mergeHeroArchiveIntoFreshHero(hero, archive) : normalizeHeroState(hero);
    })
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

CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (
  player_id VARCHAR(191) NOT NULL,
  display_name VARCHAR(80) NULL,
  avatar_url VARCHAR(512) NULL,
  global_resources_json LONGTEXT NOT NULL,
  achievements_json LONGTEXT NULL,
  recent_event_log_json LONGTEXT NULL,
  recent_battle_replays_json LONGTEXT NULL,
  last_room_id VARCHAR(191) NULL,
  last_seen_at DATETIME NULL DEFAULT NULL,
  login_id VARCHAR(40) NULL,
  wechat_mini_game_open_id VARCHAR(191) NULL,
  wechat_mini_game_union_id VARCHAR(191) NULL,
  wechat_mini_game_bound_at DATETIME NULL DEFAULT NULL,
  password_hash VARCHAR(255) NULL,
  credential_bound_at DATETIME NULL DEFAULT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\` (
  player_id VARCHAR(191) NOT NULL,
  event_id VARCHAR(191) NOT NULL,
  timestamp DATETIME NOT NULL,
  room_id VARCHAR(191) NOT NULL,
  category VARCHAR(32) NOT NULL,
  hero_id VARCHAR(191) NULL,
  world_event_type VARCHAR(64) NULL,
  achievement_id VARCHAR(64) NULL,
  entry_json LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @veil_player_accounts_display_name_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'display_name'
);

SET @veil_player_accounts_display_name_sql := IF(
  @veil_player_accounts_display_name_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`display_name\` VARCHAR(80) NULL AFTER \`player_id\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_display_name_stmt FROM @veil_player_accounts_display_name_sql;
EXECUTE veil_player_accounts_display_name_stmt;
DEALLOCATE PREPARE veil_player_accounts_display_name_stmt;

SET @veil_player_event_history_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_EVENT_HISTORY_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_EVENT_HISTORY_TIMESTAMP_INDEX}'
);

SET @veil_player_event_history_idx_sql := IF(
  @veil_player_event_history_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PLAYER_EVENT_HISTORY_TIMESTAMP_INDEX}\` ON \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\` (player_id, timestamp)',
  'SELECT 1'
);

PREPARE veil_player_event_history_idx_stmt FROM @veil_player_event_history_idx_sql;
EXECUTE veil_player_event_history_idx_stmt;
DEALLOCATE PREPARE veil_player_event_history_idx_stmt;

SET @veil_player_accounts_achievements_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'achievements_json'
);

SET @veil_player_accounts_achievements_sql := IF(
  @veil_player_accounts_achievements_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`achievements_json\` LONGTEXT NULL AFTER \`global_resources_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_achievements_stmt FROM @veil_player_accounts_achievements_sql;
EXECUTE veil_player_accounts_achievements_stmt;
DEALLOCATE PREPARE veil_player_accounts_achievements_stmt;

SET @veil_player_accounts_avatar_url_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'avatar_url'
);

SET @veil_player_accounts_avatar_url_sql := IF(
  @veil_player_accounts_avatar_url_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`avatar_url\` VARCHAR(512) NULL AFTER \`display_name\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_avatar_url_stmt FROM @veil_player_accounts_avatar_url_sql;
EXECUTE veil_player_accounts_avatar_url_stmt;
DEALLOCATE PREPARE veil_player_accounts_avatar_url_stmt;

SET @veil_player_accounts_event_log_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'recent_event_log_json'
);

SET @veil_player_accounts_event_log_sql := IF(
  @veil_player_accounts_event_log_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`recent_event_log_json\` LONGTEXT NULL AFTER \`achievements_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_event_log_stmt FROM @veil_player_accounts_event_log_sql;
EXECUTE veil_player_accounts_event_log_stmt;
DEALLOCATE PREPARE veil_player_accounts_event_log_stmt;

SET @veil_player_accounts_battle_replays_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'recent_battle_replays_json'
);

SET @veil_player_accounts_battle_replays_sql := IF(
  @veil_player_accounts_battle_replays_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`recent_battle_replays_json\` LONGTEXT NULL AFTER \`recent_event_log_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_battle_replays_stmt FROM @veil_player_accounts_battle_replays_sql;
EXECUTE veil_player_accounts_battle_replays_stmt;
DEALLOCATE PREPARE veil_player_accounts_battle_replays_stmt;

SET @veil_player_accounts_last_room_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'last_room_id'
);

SET @veil_player_accounts_last_room_sql := IF(
  @veil_player_accounts_last_room_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`last_room_id\` VARCHAR(191) NULL AFTER \`recent_battle_replays_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_last_room_stmt FROM @veil_player_accounts_last_room_sql;
EXECUTE veil_player_accounts_last_room_stmt;
DEALLOCATE PREPARE veil_player_accounts_last_room_stmt;

SET @veil_player_accounts_last_seen_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'last_seen_at'
);

SET @veil_player_accounts_last_seen_sql := IF(
  @veil_player_accounts_last_seen_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`last_seen_at\` DATETIME NULL DEFAULT NULL AFTER \`last_room_id\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_last_seen_stmt FROM @veil_player_accounts_last_seen_sql;
EXECUTE veil_player_accounts_last_seen_stmt;
DEALLOCATE PREPARE veil_player_accounts_last_seen_stmt;

SET @veil_player_accounts_login_id_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'login_id'
);

SET @veil_player_accounts_login_id_sql := IF(
  @veil_player_accounts_login_id_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`login_id\` VARCHAR(40) NULL AFTER \`last_seen_at\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_login_id_stmt FROM @veil_player_accounts_login_id_sql;
EXECUTE veil_player_accounts_login_id_stmt;
DEALLOCATE PREPARE veil_player_accounts_login_id_stmt;

SET @veil_player_accounts_password_hash_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'password_hash'
);

SET @veil_player_accounts_password_hash_sql := IF(
  @veil_player_accounts_password_hash_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`password_hash\` VARCHAR(255) NULL AFTER \`login_id\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_password_hash_stmt FROM @veil_player_accounts_password_hash_sql;
EXECUTE veil_player_accounts_password_hash_stmt;
DEALLOCATE PREPARE veil_player_accounts_password_hash_stmt;

SET @veil_player_accounts_wechat_open_id_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'wechat_mini_game_open_id'
);

SET @veil_player_accounts_wechat_open_id_sql := IF(
  @veil_player_accounts_wechat_open_id_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`wechat_mini_game_open_id\` VARCHAR(191) NULL AFTER \`password_hash\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_wechat_open_id_stmt FROM @veil_player_accounts_wechat_open_id_sql;
EXECUTE veil_player_accounts_wechat_open_id_stmt;
DEALLOCATE PREPARE veil_player_accounts_wechat_open_id_stmt;

SET @veil_player_accounts_wechat_union_id_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'wechat_mini_game_union_id'
);

SET @veil_player_accounts_wechat_union_id_sql := IF(
  @veil_player_accounts_wechat_union_id_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`wechat_mini_game_union_id\` VARCHAR(191) NULL AFTER \`wechat_mini_game_open_id\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_wechat_union_id_stmt FROM @veil_player_accounts_wechat_union_id_sql;
EXECUTE veil_player_accounts_wechat_union_id_stmt;
DEALLOCATE PREPARE veil_player_accounts_wechat_union_id_stmt;

SET @veil_player_accounts_wechat_bound_at_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'wechat_mini_game_bound_at'
);

SET @veil_player_accounts_wechat_bound_at_sql := IF(
  @veil_player_accounts_wechat_bound_at_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`wechat_mini_game_bound_at\` DATETIME NULL DEFAULT NULL AFTER \`wechat_mini_game_union_id\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_wechat_bound_at_stmt FROM @veil_player_accounts_wechat_bound_at_sql;
EXECUTE veil_player_accounts_wechat_bound_at_stmt;
DEALLOCATE PREPARE veil_player_accounts_wechat_bound_at_stmt;

SET @veil_player_accounts_credential_bound_at_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'credential_bound_at'
);

SET @veil_player_accounts_credential_bound_at_sql := IF(
  @veil_player_accounts_credential_bound_at_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`credential_bound_at\` DATETIME NULL DEFAULT NULL AFTER \`wechat_mini_game_bound_at\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_credential_bound_at_stmt FROM @veil_player_accounts_credential_bound_at_sql;
EXECUTE veil_player_accounts_credential_bound_at_stmt;
DEALLOCATE PREPARE veil_player_accounts_credential_bound_at_stmt;

SET @veil_player_accounts_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_ACCOUNT_UPDATED_AT_INDEX}'
);

SET @veil_player_accounts_idx_sql := IF(
  @veil_player_accounts_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PLAYER_ACCOUNT_UPDATED_AT_INDEX}\` ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (updated_at)',
  'SELECT 1'
);

PREPARE veil_player_accounts_idx_stmt FROM @veil_player_accounts_idx_sql;
EXECUTE veil_player_accounts_idx_stmt;
DEALLOCATE PREPARE veil_player_accounts_idx_stmt;

SET @veil_player_accounts_login_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_ACCOUNT_LOGIN_ID_INDEX}'
);

SET @veil_player_accounts_login_idx_sql := IF(
  @veil_player_accounts_login_idx_exists = 0,
  'CREATE UNIQUE INDEX \`${MYSQL_PLAYER_ACCOUNT_LOGIN_ID_INDEX}\` ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (login_id)',
  'SELECT 1'
);

PREPARE veil_player_accounts_login_idx_stmt FROM @veil_player_accounts_login_idx_sql;
EXECUTE veil_player_accounts_login_idx_stmt;
DEALLOCATE PREPARE veil_player_accounts_login_idx_stmt;

SET @veil_player_accounts_wechat_open_id_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_ACCOUNT_WECHAT_OPEN_ID_INDEX}'
);

SET @veil_player_accounts_wechat_open_id_idx_sql := IF(
  @veil_player_accounts_wechat_open_id_idx_exists = 0,
  'CREATE UNIQUE INDEX \`${MYSQL_PLAYER_ACCOUNT_WECHAT_OPEN_ID_INDEX}\` ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (wechat_mini_game_open_id)',
  'SELECT 1'
);

PREPARE veil_player_accounts_wechat_open_id_idx_stmt FROM @veil_player_accounts_wechat_open_id_idx_sql;
EXECUTE veil_player_accounts_wechat_open_id_idx_stmt;
DEALLOCATE PREPARE veil_player_accounts_wechat_open_id_idx_stmt;

CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @veil_player_hero_archives_army_template_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}'
    AND COLUMN_NAME = 'army_template_id'
);

SET @veil_player_hero_archives_army_template_sql := IF(
  @veil_player_hero_archives_army_template_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` ADD COLUMN \`army_template_id\` VARCHAR(191) NULL AFTER \`hero_json\`',
  'SELECT 1'
);

PREPARE veil_player_hero_archives_army_template_stmt FROM @veil_player_hero_archives_army_template_sql;
EXECUTE veil_player_hero_archives_army_template_stmt;
DEALLOCATE PREPARE veil_player_hero_archives_army_template_stmt;

SET @veil_player_hero_archives_army_count_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}'
    AND COLUMN_NAME = 'army_count'
);

SET @veil_player_hero_archives_army_count_sql := IF(
  @veil_player_hero_archives_army_count_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` ADD COLUMN \`army_count\` INT NULL AFTER \`army_template_id\`',
  'SELECT 1'
);

PREPARE veil_player_hero_archives_army_count_stmt FROM @veil_player_hero_archives_army_count_sql;
EXECUTE veil_player_hero_archives_army_count_stmt;
DEALLOCATE PREPARE veil_player_hero_archives_army_count_stmt;

SET @veil_player_hero_archives_learned_skills_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}'
    AND COLUMN_NAME = 'learned_skills_json'
);

SET @veil_player_hero_archives_learned_skills_sql := IF(
  @veil_player_hero_archives_learned_skills_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` ADD COLUMN \`learned_skills_json\` LONGTEXT NULL AFTER \`army_count\`',
  'SELECT 1'
);

PREPARE veil_player_hero_archives_learned_skills_stmt FROM @veil_player_hero_archives_learned_skills_sql;
EXECUTE veil_player_hero_archives_learned_skills_stmt;
DEALLOCATE PREPARE veil_player_hero_archives_learned_skills_stmt;

SET @veil_player_hero_archives_equipment_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}'
    AND COLUMN_NAME = 'equipment_json'
);

SET @veil_player_hero_archives_equipment_sql := IF(
  @veil_player_hero_archives_equipment_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` ADD COLUMN \`equipment_json\` LONGTEXT NULL AFTER \`learned_skills_json\`',
  'SELECT 1'
);

PREPARE veil_player_hero_archives_equipment_stmt FROM @veil_player_hero_archives_equipment_sql;
EXECUTE veil_player_hero_archives_equipment_stmt;
DEALLOCATE PREPARE veil_player_hero_archives_equipment_stmt;

SET @veil_player_hero_archives_inventory_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}'
    AND COLUMN_NAME = 'inventory_json'
);

SET @veil_player_hero_archives_inventory_sql := IF(
  @veil_player_hero_archives_inventory_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` ADD COLUMN \`inventory_json\` LONGTEXT NULL AFTER \`equipment_json\`',
  'SELECT 1'
);

PREPARE veil_player_hero_archives_inventory_stmt FROM @veil_player_hero_archives_inventory_sql;
EXECUTE veil_player_hero_archives_inventory_stmt;
DEALLOCATE PREPARE veil_player_hero_archives_inventory_stmt;

SET @veil_player_hero_archives_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_HERO_ARCHIVE_UPDATED_AT_INDEX}'
);

SET @veil_player_hero_archives_idx_sql := IF(
  @veil_player_hero_archives_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PLAYER_HERO_ARCHIVE_UPDATED_AT_INDEX}\` ON \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` (updated_at)',
  'SELECT 1'
);

PREPARE veil_player_hero_archives_idx_stmt FROM @veil_player_hero_archives_idx_sql;
EXECUTE veil_player_hero_archives_idx_stmt;
DEALLOCATE PREPARE veil_player_hero_archives_idx_stmt;

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

function toPlayerHeroArchiveSnapshot(row: PlayerHeroArchiveRow): PlayerHeroArchiveSnapshot {
  const archivedHero = normalizeHeroState(parseJsonColumn<HeroState>(row.hero_json));

  return {
    playerId: row.player_id,
    heroId: row.hero_id,
    hero: normalizeHeroState({
      ...archivedHero,
      ...(row.army_template_id ? { armyTemplateId: row.army_template_id } : {}),
      ...(row.army_count != null ? { armyCount: row.army_count } : {}),
      loadout: {
        learnedSkills:
          row.learned_skills_json != null
            ? parseJsonColumn<HeroState["loadout"]["learnedSkills"]>(row.learned_skills_json)
            : archivedHero.loadout.learnedSkills,
        equipment:
          row.equipment_json != null
            ? parseJsonColumn<HeroState["loadout"]["equipment"]>(row.equipment_json)
            : archivedHero.loadout.equipment,
        inventory:
          row.inventory_json != null
            ? parseJsonColumn<HeroState["loadout"]["inventory"]>(row.inventory_json)
            : archivedHero.loadout.inventory
      }
    })
  };
}

function toPlayerAccountSnapshot(row: PlayerAccountRow): PlayerAccountSnapshot {
  const lastSeenAt = formatTimestamp(row.last_seen_at);
  const wechatMiniGameBoundAt = formatTimestamp(row.wechat_mini_game_bound_at);
  const credentialBoundAt = formatTimestamp(row.credential_bound_at);
  const createdAt = formatTimestamp(row.created_at);
  const updatedAt = formatTimestamp(row.updated_at);

  return normalizePlayerAccountSnapshot({
    playerId: row.player_id,
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    globalResources: parseJsonColumn<ResourceLedger>(row.global_resources_json),
    achievements:
      row.achievements_json != null
        ? parseJsonColumn<PlayerAchievementProgress[]>(row.achievements_json)
        : [],
    recentEventLog:
      row.recent_event_log_json != null
        ? parseJsonColumn<EventLogEntry[]>(row.recent_event_log_json)
        : [],
    recentBattleReplays:
      row.recent_battle_replays_json != null
        ? parseJsonColumn<PlayerBattleReplaySummary[]>(row.recent_battle_replays_json)
        : [],
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.last_room_id ? { lastRoomId: row.last_room_id } : {}),
    ...(row.login_id ? { loginId: row.login_id } : {}),
    ...(row.wechat_mini_game_open_id ? { wechatMiniGameOpenId: row.wechat_mini_game_open_id } : {}),
    ...(row.wechat_mini_game_union_id ? { wechatMiniGameUnionId: row.wechat_mini_game_union_id } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(wechatMiniGameBoundAt ? { wechatMiniGameBoundAt } : {}),
    ...(credentialBoundAt ? { credentialBoundAt } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {})
  });
}

function toPlayerAccountAuthSnapshot(row: PlayerAccountAuthRow): PlayerAccountAuthSnapshot | null {
  if (!row.login_id || !row.password_hash) {
    return null;
  }

  const credentialBoundAt = formatTimestamp(row.credential_bound_at);
  return {
    playerId: normalizePlayerId(row.player_id),
    displayName: normalizePlayerDisplayName(row.player_id, row.display_name),
    loginId: normalizePlayerLoginId(row.login_id),
    passwordHash: row.password_hash,
    ...(credentialBoundAt ? { credentialBoundAt } : {})
  };
}

function toPlayerEventHistoryEntry(row: PlayerEventHistoryRow): EventLogEntry {
  const entry = parseJsonColumn<EventLogEntry>(row.entry_json);

  return normalizeEventLogEntries([
    {
      ...entry,
      id: row.event_id,
      playerId: row.player_id,
      roomId: row.room_id,
      timestamp: formatTimestamp(row.timestamp) ?? entry.timestamp,
      category: row.category,
      ...(row.hero_id ? { heroId: row.hero_id } : {}),
      ...(row.world_event_type ? { worldEventType: row.world_event_type } : {}),
      ...(row.achievement_id ? { achievementId: row.achievement_id } : {})
    }
  ])[0] as EventLogEntry;
}

async function appendPlayerEventHistoryEntries(
  queryable: Pick<Pool, "query"> | Pick<PoolConnection, "query">,
  playerId: string,
  entries: EventLogEntry[]
): Promise<void> {
  for (const entry of entries) {
    await queryable.query(
      `INSERT INTO \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\` (
         player_id,
         event_id,
         timestamp,
         room_id,
         category,
         hero_id,
         world_event_type,
         achievement_id,
         entry_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         entry_json = VALUES(entry_json)`,
      [
        playerId,
        entry.id,
        new Date(entry.timestamp),
        entry.roomId,
        entry.category,
        entry.heroId ?? null,
        entry.worldEventType ?? null,
        entry.achievementId ?? null,
        JSON.stringify(entry)
      ]
    );
  }
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

async function savePlayerAccounts(
  connection: PoolConnection,
  accounts: PlayerAccountSnapshot[]
): Promise<void> {
  for (const account of accounts) {
    const normalizedAccount = normalizePlayerAccountSnapshot(account);
    await connection.query(
      `INSERT INTO \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (
         player_id,
         display_name,
         global_resources_json,
         achievements_json,
         recent_event_log_json
         ,
         recent_battle_replays_json
       )
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = COALESCE(display_name, VALUES(display_name)),
         global_resources_json = VALUES(global_resources_json),
         achievements_json = COALESCE(achievements_json, VALUES(achievements_json)),
         recent_event_log_json = COALESCE(recent_event_log_json, VALUES(recent_event_log_json)),
         recent_battle_replays_json = COALESCE(recent_battle_replays_json, VALUES(recent_battle_replays_json)),
         version = version + 1`,
      [
        normalizedAccount.playerId,
        normalizedAccount.displayName,
        JSON.stringify(normalizedAccount.globalResources),
        JSON.stringify(normalizedAccount.achievements),
        JSON.stringify(normalizedAccount.recentEventLog),
        JSON.stringify(normalizedAccount.recentBattleReplays)
      ]
    );
    await appendPlayerEventHistoryEntries(connection, normalizedAccount.playerId, normalizedAccount.recentEventLog);
  }
}

async function savePlayerHeroArchives(
  connection: PoolConnection,
  archives: PlayerHeroArchiveSnapshot[]
): Promise<void> {
  for (const archive of archives) {
    await connection.query(
      `INSERT INTO \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\`
         (player_id, hero_id, hero_json, army_template_id, army_count, learned_skills_json, equipment_json, inventory_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         hero_json = VALUES(hero_json),
         army_template_id = VALUES(army_template_id),
         army_count = VALUES(army_count),
         learned_skills_json = VALUES(learned_skills_json),
         equipment_json = VALUES(equipment_json),
         inventory_json = VALUES(inventory_json),
         version = version + 1`,
      [
        archive.playerId,
        archive.heroId,
        JSON.stringify(archive.hero),
        archive.hero.armyTemplateId,
        archive.hero.armyCount,
        JSON.stringify(archive.hero.loadout.learnedSkills),
        JSON.stringify(archive.hero.loadout.equipment),
        JSON.stringify(archive.hero.loadout.inventory)
      ]
    );
  }
}

async function ensureColumnExists(
  pool: Pool,
  database: string,
  tableName: string,
  columnName: string,
  columnSql: string
): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ?
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [database, tableName, columnName]
  );

  if (!rows[0]) {
    await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${columnSql}`);
  }
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
      `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (
        player_id VARCHAR(191) NOT NULL,
        display_name VARCHAR(80) NULL,
        avatar_url VARCHAR(512) NULL,
        global_resources_json LONGTEXT NOT NULL,
        achievements_json LONGTEXT NULL,
        recent_event_log_json LONGTEXT NULL,
        recent_battle_replays_json LONGTEXT NULL,
        last_room_id VARCHAR(191) NULL,
        last_seen_at DATETIME NULL DEFAULT NULL,
        login_id VARCHAR(40) NULL,
        wechat_mini_game_open_id VARCHAR(191) NULL,
        wechat_mini_game_union_id VARCHAR(191) NULL,
        wechat_mini_game_bound_at DATETIME NULL DEFAULT NULL,
        password_hash VARCHAR(255) NULL,
        credential_bound_at DATETIME NULL DEFAULT NULL,
        version BIGINT UNSIGNED NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (player_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\` (
        player_id VARCHAR(191) NOT NULL,
        event_id VARCHAR(191) NOT NULL,
        timestamp DATETIME NOT NULL,
        room_id VARCHAR(191) NOT NULL,
        category VARCHAR(32) NOT NULL,
        hero_id VARCHAR(191) NULL,
        world_event_type VARCHAR(64) NULL,
        achievement_id VARCHAR(64) NULL,
        entry_json LONGTEXT NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (player_id, event_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    await pool.query(
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
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "display_name",
      "`display_name` VARCHAR(80) NULL AFTER `player_id`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "avatar_url",
      "`avatar_url` VARCHAR(512) NULL AFTER `display_name`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "achievements_json",
      "`achievements_json` LONGTEXT NULL AFTER `global_resources_json`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "recent_event_log_json",
      "`recent_event_log_json` LONGTEXT NULL AFTER `achievements_json`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "recent_battle_replays_json",
      "`recent_battle_replays_json` LONGTEXT NULL AFTER `recent_event_log_json`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "last_room_id",
      "`last_room_id` VARCHAR(191) NULL AFTER `recent_battle_replays_json`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "last_seen_at",
      "`last_seen_at` DATETIME NULL DEFAULT NULL AFTER `last_room_id`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "login_id",
      "`login_id` VARCHAR(40) NULL AFTER `last_seen_at`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "password_hash",
      "`password_hash` VARCHAR(255) NULL AFTER `login_id`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "wechat_mini_game_open_id",
      "`wechat_mini_game_open_id` VARCHAR(191) NULL AFTER `password_hash`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "wechat_mini_game_union_id",
      "`wechat_mini_game_union_id` VARCHAR(191) NULL AFTER `wechat_mini_game_open_id`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "wechat_mini_game_bound_at",
      "`wechat_mini_game_bound_at` DATETIME NULL DEFAULT NULL AFTER `wechat_mini_game_union_id`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_ACCOUNT_TABLE,
      "credential_bound_at",
      "`credential_bound_at` DATETIME NULL DEFAULT NULL AFTER `wechat_mini_game_bound_at`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_HERO_ARCHIVE_TABLE,
      "army_template_id",
      "`army_template_id` VARCHAR(191) NULL AFTER `hero_json`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_HERO_ARCHIVE_TABLE,
      "army_count",
      "`army_count` INT NULL AFTER `army_template_id`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_HERO_ARCHIVE_TABLE,
      "learned_skills_json",
      "`learned_skills_json` LONGTEXT NULL AFTER `army_count`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_HERO_ARCHIVE_TABLE,
      "equipment_json",
      "`equipment_json` LONGTEXT NULL AFTER `learned_skills_json`"
    );
    await ensureColumnExists(
      pool,
      config.database,
      MYSQL_PLAYER_HERO_ARCHIVE_TABLE,
      "inventory_json",
      "`inventory_json` LONGTEXT NULL AFTER `equipment_json`"
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

    const [playerAccountIndexRows] = await pool.query<RowDataPacket[]>(
      `SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND INDEX_NAME = ?
       LIMIT 1`,
      [config.database, MYSQL_PLAYER_ACCOUNT_TABLE, MYSQL_PLAYER_ACCOUNT_UPDATED_AT_INDEX]
    );

    if (!playerAccountIndexRows[0]) {
      await pool.query(
        `CREATE INDEX \`${MYSQL_PLAYER_ACCOUNT_UPDATED_AT_INDEX}\`
         ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (updated_at)`
      );
    }

    const [playerAccountLoginIndexRows] = await pool.query<RowDataPacket[]>(
      `SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND INDEX_NAME = ?
       LIMIT 1`,
      [config.database, MYSQL_PLAYER_ACCOUNT_TABLE, MYSQL_PLAYER_ACCOUNT_LOGIN_ID_INDEX]
    );

    if (!playerAccountLoginIndexRows[0]) {
      await pool.query(
        `CREATE UNIQUE INDEX \`${MYSQL_PLAYER_ACCOUNT_LOGIN_ID_INDEX}\`
         ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (login_id)`
      );
    }

    const [playerAccountWechatOpenIdIndexRows] = await pool.query<RowDataPacket[]>(
      `SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND INDEX_NAME = ?
       LIMIT 1`,
      [config.database, MYSQL_PLAYER_ACCOUNT_TABLE, MYSQL_PLAYER_ACCOUNT_WECHAT_OPEN_ID_INDEX]
    );

    if (!playerAccountWechatOpenIdIndexRows[0]) {
      await pool.query(
        `CREATE UNIQUE INDEX \`${MYSQL_PLAYER_ACCOUNT_WECHAT_OPEN_ID_INDEX}\`
         ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (wechat_mini_game_open_id)`
      );
    }

    const [playerEventHistoryIndexRows] = await pool.query<RowDataPacket[]>(
      `SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND INDEX_NAME = ?
       LIMIT 1`,
      [config.database, MYSQL_PLAYER_EVENT_HISTORY_TABLE, MYSQL_PLAYER_EVENT_HISTORY_TIMESTAMP_INDEX]
    );

    if (!playerEventHistoryIndexRows[0]) {
      await pool.query(
        `CREATE INDEX \`${MYSQL_PLAYER_EVENT_HISTORY_TIMESTAMP_INDEX}\`
         ON \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\` (player_id, timestamp)`
      );
    }

    const [playerHeroArchiveIndexRows] = await pool.query<RowDataPacket[]>(
      `SELECT 1
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ?
         AND TABLE_NAME = ?
         AND INDEX_NAME = ?
       LIMIT 1`,
      [config.database, MYSQL_PLAYER_HERO_ARCHIVE_TABLE, MYSQL_PLAYER_HERO_ARCHIVE_UPDATED_AT_INDEX]
    );

    if (!playerHeroArchiveIndexRows[0]) {
      await pool.query(
        `CREATE INDEX \`${MYSQL_PLAYER_HERO_ARCHIVE_UPDATED_AT_INDEX}\`
         ON \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` (updated_at)`
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
    const mergedState = applyPlayerProfilesToWorldState(
      {
        ...persistedState,
        heroes: persistedState.heroes.map((hero) => normalizeHeroState(hero))
      },
      profiles
    );
    const accounts = await this.loadPlayerAccounts(collectPlayerIds(mergedState));

    return {
      state: applyPlayerAccountsToWorldState(mergedState, accounts),
      battles: parseJsonColumn<RoomPersistenceSnapshot["battles"]>(row.battles_json)
    };
  }

  async loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const accounts = await this.loadPlayerAccounts([normalizedPlayerId]);
    return accounts[0] ?? null;
  }

  async loadPlayerAccountByLoginId(loginId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedLoginId = normalizePlayerLoginId(loginId);
    const [rows] = await this.pool.query<PlayerAccountRow[]>(
      `SELECT
         player_id,
         display_name,
         avatar_url,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         last_room_id,
         last_seen_at,
         login_id,
         wechat_mini_game_open_id,
         wechat_mini_game_union_id,
         wechat_mini_game_bound_at,
         credential_bound_at,
         created_at,
         updated_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE login_id = ?
       LIMIT 1`,
      [normalizedLoginId]
    );

    const row = rows[0];
    return row ? toPlayerAccountSnapshot(row) : null;
  }

  async loadPlayerAccountByWechatMiniGameOpenId(openId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedOpenId = normalizeWechatMiniGameOpenId(openId);
    const [rows] = await this.pool.query<PlayerAccountRow[]>(
      `SELECT
         player_id,
         display_name,
         avatar_url,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         last_room_id,
         last_seen_at,
         login_id,
         wechat_mini_game_open_id,
         wechat_mini_game_union_id,
         wechat_mini_game_bound_at,
         credential_bound_at,
         created_at,
         updated_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE wechat_mini_game_open_id = ?
       LIMIT 1`,
      [normalizedOpenId]
    );

    const row = rows[0];
    return row ? toPlayerAccountSnapshot(row) : null;
  }

  async loadPlayerEventHistory(
    playerId: string,
    query: PlayerEventHistoryQuery = {}
  ): Promise<PlayerEventHistorySnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedQuery = normalizePlayerEventHistoryQuery(query);
    const clauses = ["player_id = ?"];
    const params: Array<string | number> = [normalizedPlayerId];

    if (normalizedQuery.category) {
      clauses.push("category = ?");
      params.push(normalizedQuery.category);
    }
    if (normalizedQuery.heroId) {
      clauses.push("hero_id = ?");
      params.push(normalizedQuery.heroId);
    }
    if (normalizedQuery.achievementId) {
      clauses.push("achievement_id = ?");
      params.push(normalizedQuery.achievementId);
    }
    if (normalizedQuery.worldEventType) {
      clauses.push("world_event_type = ?");
      params.push(normalizedQuery.worldEventType);
    }
    if (normalizedQuery.since) {
      clauses.push("timestamp >= ?");
      params.push(normalizedQuery.since);
    }
    if (normalizedQuery.until) {
      clauses.push("timestamp <= ?");
      params.push(normalizedQuery.until);
    }

    const whereClause = `WHERE ${clauses.join(" AND ")}`;
    const [countRows] = await this.pool.query<PlayerEventHistoryCountRow[]>(
      `SELECT COUNT(*) AS total
       FROM \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\`
       ${whereClause}`,
      params
    );

    const queryParams = [...params];
    let limitClause = "";
    const safeOffset = normalizedQuery.offset ?? 0;
    if (normalizedQuery.limit != null) {
      limitClause = "LIMIT ? OFFSET ?";
      queryParams.push(normalizedQuery.limit, safeOffset);
    } else if (safeOffset > 0) {
      limitClause = "LIMIT 18446744073709551615 OFFSET ?";
      queryParams.push(safeOffset);
    }

    const [rows] = await this.pool.query<PlayerEventHistoryRow[]>(
      `SELECT
         player_id,
         event_id,
         timestamp,
         room_id,
         category,
         hero_id,
         world_event_type,
         achievement_id,
         entry_json,
         created_at
       FROM \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\`
       ${whereClause}
       ORDER BY timestamp DESC, event_id ASC
       ${limitClause}`,
      queryParams
    );

    return {
      total: Math.max(0, Math.floor(countRows[0]?.total ?? 0)),
      items: rows.map((row) => toPlayerEventHistoryEntry(row))
    };
  }

  async loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]> {
    const safePlayerIds = Array.from(new Set(playerIds.map((playerId) => playerId.trim()).filter(Boolean)));
    if (safePlayerIds.length === 0) {
      return [];
    }

    const placeholders = safePlayerIds.map(() => "?").join(", ");
    const [rows] = await this.pool.query<PlayerAccountRow[]>(
      `SELECT
         player_id,
         display_name,
         avatar_url,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         last_room_id,
         last_seen_at,
         login_id,
         wechat_mini_game_open_id,
         wechat_mini_game_union_id,
         wechat_mini_game_bound_at,
         credential_bound_at,
         created_at,
         updated_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE player_id IN (${placeholders})`,
      safePlayerIds
    );

    return rows.map((row) => toPlayerAccountSnapshot(row));
  }

  async loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null> {
    const normalizedLoginId = normalizePlayerLoginId(loginId);
    const [rows] = await this.pool.query<PlayerAccountAuthRow[]>(
      `SELECT
         player_id,
         display_name,
         login_id,
         password_hash,
         credential_bound_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE login_id = ?
       LIMIT 1`,
      [normalizedLoginId]
    );

    const row = rows[0];
    return row ? toPlayerAccountAuthSnapshot(row) : null;
  }

  async ensurePlayerAccount(input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot> {
    const playerId = normalizePlayerId(input.playerId);
    const explicitDisplayName = input.displayName?.trim() ? normalizePlayerDisplayName(playerId, input.displayName) : null;
    const insertDisplayName = normalizePlayerDisplayName(playerId, explicitDisplayName);
    const lastRoomId = input.lastRoomId?.trim() ? input.lastRoomId.trim() : null;
    const lastSeenAt = new Date();

    await this.pool.query(
      `INSERT INTO \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (
         player_id,
         display_name,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         last_room_id,
         last_seen_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = COALESCE(?, display_name),
         last_room_id = COALESCE(?, last_room_id),
         last_seen_at = VALUES(last_seen_at),
         version = version + 1`,
      [
        playerId,
        insertDisplayName,
        JSON.stringify(normalizeResourceLedger()),
        JSON.stringify(normalizeAchievementProgress()),
        JSON.stringify(normalizeEventLogEntries()),
        JSON.stringify(appendPlayerBattleReplaySummaries([], [])),
        lastRoomId,
        lastSeenAt,
        explicitDisplayName,
        lastRoomId
      ]
    );

    return (
      (await this.loadPlayerAccount(playerId)) ??
      normalizePlayerAccountSnapshot({
        playerId,
        displayName: insertDisplayName,
        globalResources: normalizeResourceLedger(),
        achievements: normalizeAchievementProgress(),
        recentEventLog: normalizeEventLogEntries(),
        recentBattleReplays: appendPlayerBattleReplaySummaries([], []),
        ...(lastRoomId ? { lastRoomId } : {}),
        lastSeenAt: lastSeenAt.toISOString()
      })
    );
  }

  async bindPlayerAccountCredentials(
    playerId: string,
    input: PlayerAccountCredentialInput
  ): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedLoginId = normalizePlayerLoginId(input.loginId);
    const passwordHash = input.passwordHash.trim();
    if (!passwordHash) {
      throw new Error("passwordHash must not be empty");
    }

    const existingAccount = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    if (existingAccount.loginId && existingAccount.loginId !== normalizedLoginId) {
      throw new Error("account credentials already bound to another loginId");
    }

    const credentialBoundAt = existingAccount.credentialBoundAt ?? new Date().toISOString();
    try {
      await this.pool.query(
        `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         SET login_id = ?,
             password_hash = ?,
             credential_bound_at = COALESCE(credential_bound_at, ?),
             version = version + 1
         WHERE player_id = ?`,
        [normalizedLoginId, passwordHash, new Date(credentialBoundAt), normalizedPlayerId]
      );
    } catch (error) {
      if (isMySqlDuplicateEntryError(error)) {
        throw new Error("loginId is already taken");
      }

      throw error;
    }

    return (
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        ...existingAccount,
        loginId: normalizedLoginId,
        credentialBoundAt
      })
    );
  }

  async bindPlayerAccountWechatMiniGameIdentity(
    playerId: string,
    input: PlayerAccountWechatMiniGameIdentityInput
  ): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedOpenId = normalizeWechatMiniGameOpenId(input.openId);
    const normalizedUnionId = normalizeWechatMiniGameUnionId(input.unionId);
    const normalizedAvatarUrl = normalizePlayerAvatarUrl(input.avatarUrl);
    const existingAccount = await this.ensurePlayerAccount({
      playerId: normalizedPlayerId,
      ...(input.displayName?.trim() ? { displayName: input.displayName } : {})
    });
    if (existingAccount.wechatMiniGameOpenId && existingAccount.wechatMiniGameOpenId !== normalizedOpenId) {
      throw new Error("wechatMiniGameOpenId is already bound to another identity");
    }

    const owner = await this.loadPlayerAccountByWechatMiniGameOpenId(normalizedOpenId);
    if (owner && owner.playerId !== normalizedPlayerId) {
      throw new Error("wechatMiniGameOpenId is already taken");
    }

    const displayName = input.displayName?.trim()
      ? normalizePlayerDisplayName(normalizedPlayerId, input.displayName)
      : null;
    const boundAt = existingAccount.wechatMiniGameBoundAt ?? new Date().toISOString();

    try {
      await this.pool.query(
        `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         SET display_name = COALESCE(?, display_name),
             avatar_url = COALESCE(?, avatar_url),
             wechat_mini_game_open_id = ?,
             wechat_mini_game_union_id = COALESCE(?, wechat_mini_game_union_id),
             wechat_mini_game_bound_at = COALESCE(wechat_mini_game_bound_at, ?),
             version = version + 1
         WHERE player_id = ?`,
        [
          displayName,
          normalizedAvatarUrl ?? null,
          normalizedOpenId,
          normalizedUnionId ?? null,
          new Date(boundAt),
          normalizedPlayerId
        ]
      );
    } catch (error) {
      if (isMySqlDuplicateEntryError(error)) {
        throw new Error("wechatMiniGameOpenId is already taken");
      }

      throw error;
    }

    return (
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        ...existingAccount,
        ...(displayName ? { displayName } : {}),
        ...(normalizedAvatarUrl ? { avatarUrl: normalizedAvatarUrl } : {}),
        wechatMiniGameOpenId: normalizedOpenId,
        ...(normalizedUnionId ? { wechatMiniGameUnionId: normalizedUnionId } : {}),
        wechatMiniGameBoundAt: boundAt
      })
    );
  }

  async savePlayerAccountProfile(playerId: string, patch: PlayerAccountProfilePatch): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing =
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        playerId: normalizedPlayerId,
        displayName: normalizedPlayerId,
        globalResources: normalizeResourceLedger()
      });

    const nextAccount = normalizePlayerAccountSnapshot({
      ...existing,
      playerId: normalizedPlayerId,
      ...(patch.displayName !== undefined
        ? { displayName: normalizePlayerDisplayName(normalizedPlayerId, patch.displayName) }
        : {}),
      ...(patch.avatarUrl !== undefined
        ? patch.avatarUrl
          ? { avatarUrl: normalizePlayerAvatarUrl(patch.avatarUrl) }
          : {}
        : existing.avatarUrl
          ? { avatarUrl: existing.avatarUrl }
          : {}),
      ...(patch.lastRoomId !== undefined
        ? patch.lastRoomId
          ? { lastRoomId: patch.lastRoomId.trim() }
          : {}
        : existing.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
          : {})
    });

    await this.pool.query(
      `INSERT INTO \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (
         player_id,
         display_name,
         avatar_url,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         last_room_id,
         last_seen_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         avatar_url = VALUES(avatar_url),
         global_resources_json = VALUES(global_resources_json),
         achievements_json = VALUES(achievements_json),
         recent_event_log_json = VALUES(recent_event_log_json),
         recent_battle_replays_json = VALUES(recent_battle_replays_json),
         last_room_id = VALUES(last_room_id),
         last_seen_at = COALESCE(last_seen_at, VALUES(last_seen_at)),
         version = version + 1`,
      [
        nextAccount.playerId,
        nextAccount.displayName,
        nextAccount.avatarUrl ?? null,
        JSON.stringify(nextAccount.globalResources),
        JSON.stringify(nextAccount.achievements),
        JSON.stringify(nextAccount.recentEventLog),
        JSON.stringify(nextAccount.recentBattleReplays),
        nextAccount.lastRoomId ?? null,
        existing.lastSeenAt ? new Date(existing.lastSeenAt) : null
      ]
    );

    return (
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        ...nextAccount,
        ...(existing.lastSeenAt ? { lastSeenAt: existing.lastSeenAt } : {})
      })
    );
  }

  async savePlayerAccountProgress(playerId: string, patch: PlayerAccountProgressPatch): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existing =
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        playerId: normalizedPlayerId,
        displayName: normalizedPlayerId,
        globalResources: normalizeResourceLedger()
      });

    const nextAccount = normalizePlayerAccountSnapshot({
      ...existing,
      playerId: normalizedPlayerId,
      achievements: patch.achievements ?? existing.achievements,
      recentEventLog: patch.recentEventLog ?? existing.recentEventLog,
      recentBattleReplays: patch.recentBattleReplays ?? existing.recentBattleReplays,
      ...(patch.lastRoomId !== undefined
        ? patch.lastRoomId
          ? { lastRoomId: patch.lastRoomId.trim() }
          : {}
        : existing.lastRoomId
          ? { lastRoomId: existing.lastRoomId }
        : {})
    });
    const newHistoryEntries = extractNewPlayerEventHistoryEntries(existing.recentEventLog, nextAccount.recentEventLog);

    await this.pool.query(
      `INSERT INTO \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (
         player_id,
         display_name,
         avatar_url,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         last_room_id,
         last_seen_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         avatar_url = COALESCE(avatar_url, VALUES(avatar_url)),
         global_resources_json = VALUES(global_resources_json),
         achievements_json = VALUES(achievements_json),
         recent_event_log_json = VALUES(recent_event_log_json),
         recent_battle_replays_json = VALUES(recent_battle_replays_json),
         last_room_id = VALUES(last_room_id),
         last_seen_at = COALESCE(last_seen_at, VALUES(last_seen_at)),
         version = version + 1`,
      [
        nextAccount.playerId,
        nextAccount.displayName,
        nextAccount.avatarUrl ?? null,
        JSON.stringify(nextAccount.globalResources),
        JSON.stringify(nextAccount.achievements),
        JSON.stringify(nextAccount.recentEventLog),
        JSON.stringify(nextAccount.recentBattleReplays),
        nextAccount.lastRoomId ?? null,
        existing.lastSeenAt ? new Date(existing.lastSeenAt) : null
      ]
    );
    await appendPlayerEventHistoryEntries(this.pool, normalizedPlayerId, newHistoryEntries);

    return (
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        ...nextAccount,
        ...(existing.lastSeenAt ? { lastSeenAt: existing.lastSeenAt } : {})
      })
    );
  }

  async listPlayerAccounts(options: PlayerAccountListOptions = {}): Promise<PlayerAccountSnapshot[]> {
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (options.playerId?.trim()) {
      clauses.push("player_id = ?");
      params.push(options.playerId.trim());
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await this.pool.query<PlayerAccountRow[]>(
      `SELECT
         player_id,
         display_name,
         avatar_url,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         last_room_id,
         last_seen_at,
         login_id,
         wechat_mini_game_open_id,
         wechat_mini_game_union_id,
         wechat_mini_game_bound_at,
         credential_bound_at,
         created_at,
         updated_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       ${whereClause}
       ORDER BY updated_at DESC
       LIMIT ?`,
      [...params, safeLimit]
    );

    return rows.map((row) => toPlayerAccountSnapshot(row));
  }

  async loadPlayerHeroArchives(playerIds: string[]): Promise<PlayerHeroArchiveSnapshot[]> {
    const safePlayerIds = Array.from(new Set(playerIds.filter((playerId) => playerId.trim().length > 0)));
    if (safePlayerIds.length === 0) {
      return [];
    }

    const placeholders = safePlayerIds.map(() => "?").join(", ");
    const [rows] = await this.pool.query<PlayerHeroArchiveRow[]>(
      `SELECT player_id, hero_id, hero_json, army_template_id, army_count, learned_skills_json, equipment_json, inventory_json, updated_at
       FROM \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\`
       WHERE player_id IN (${placeholders})`,
      safePlayerIds
    );

    return rows.map((row) => toPlayerHeroArchiveSnapshot(row));
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
      await savePlayerAccounts(connection, createPlayerAccountsFromWorldState(snapshot.state));
      await savePlayerHeroArchives(connection, createPlayerHeroArchivesFromWorldState(snapshot.state));
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
