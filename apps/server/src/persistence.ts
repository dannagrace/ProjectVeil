import { randomUUID } from "node:crypto";
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import {
  appendEventLogEntries,
  DEFAULT_TUTORIAL_STEP,
  getEquipmentDefinition,
  getTierForRating,
  appendPlayerBattleReplaySummaries,
  normalizeGuildState,
  getRankDivisionForRating,
  normalizeEloRating,
  normalizeEventLogQuery,
  normalizeAchievementProgress,
  normalizeTextForModeration,
  normalizeCosmeticInventory,
  normalizeEventLogEntries,
  normalizeEquippedCosmetics,
  normalizePlayerAccountReadModel,
  resolveCosmeticCatalog,
  resolveWeeklyShopRotation,
  tryAddEquipmentToInventory,
  type EventLogQuery,
  type CosmeticId,
  normalizeHeroState,
  summarizePlayerMailbox,
  type EventLogEntry,
  type EquipmentId,
  type GuildState,
  type HeroState,
  type MobilePushTokenRegistration,
  type PlayerBanStatus,
  type PlayerAccountReadModel,
  type PlayerBattleReplaySummary,
  type PlayerAchievementProgress,
  type NotificationPreferences,
  type PlayerMailboxMessage,
  type PlayerMailboxGrant,
  type BattleState,
  type Vec2,
  type RankedWeeklyProgress,
  type ResourceLedger,
  type SeasonalEventState,
  type SeasonArchiveEntry,
  type WorldState
} from "../../../packages/shared/src/index";
import { normalizeMobilePushTokenRegistrations } from "./mobile-push-tokens";
import {
  assertDisplayNameAvailableOrThrow,
  buildBannedAccountNameReservationExpiry,
  normalizeDisplayNameForLookup
} from "./display-name-rules";
import {
  createTrackedMySqlPool,
  DEFAULT_MYSQL_POOL_CONNECTION_LIMIT,
  DEFAULT_MYSQL_POOL_IDLE_TIMEOUT_MS,
  DEFAULT_MYSQL_POOL_MAX_IDLE,
  DEFAULT_MYSQL_POOL_QUEUE_LIMIT,
  DEFAULT_MYSQL_POOL_WAIT_FOR_CONNECTIONS,
  type MySqlPoolConfig
} from "./mysql-pool";
import type { RoomPersistenceSnapshot } from "./index";
import {
  claimAllPlayerMailboxMessages,
  claimPlayerMailboxMessage,
  createMailboxClaimEventLogEntry,
  deliverPlayerMailboxMessage,
  normalizePlayerMailboxGrant,
  normalizePlayerMailboxMessage,
  pruneExpiredPlayerMailboxMessages,
  type PlayerMailboxClaimAllResult,
  type PlayerMailboxClaimResult,
  type PlayerMailboxDeliveryInput,
  type PlayerMailboxDeliveryResult
} from "./player-mailbox";
import {
  applyBattlePassXp,
  resolveBattlePassConfig,
  resolveBattlePassTier,
  toBattlePassRewardGrant,
  type BattlePassRewardGrant
} from "./battle-pass";
import { applySeasonSoftDecay, decayDivisionToRating, resolveCompetitiveProgression } from "./competitive-season";
import { readRuntimeSecret } from "./runtime-secrets";
import { computeSeasonReward, resolveSeasonRewardConfig } from "./season-rewards";
import {
  prunePlayerBattleReplaysForRetention,
  readBattleReplayRetentionPolicy
} from "./battle-replay-retention";

export interface SeasonSnapshot {
  seasonId: string;
  status: "active" | "closed";
  startedAt: string;
  endedAt?: string;
  rewardDistributedAt?: string;
}

export interface SeasonListOptions {
  status?: "active" | "closed" | "all";
  limit?: number;
}

export interface SeasonCloseSummary {
  seasonId: string;
  playersRewarded: number;
  totalGemsGranted: number;
}

export interface LeaderboardSeasonArchiveEntry {
  seasonId: string;
  rank: number;
  playerId: string;
  displayName: string;
  finalRating: number;
  tier: string;
  archivedAt: string;
}

export interface PlayerReferralClaimResult {
  claimed: boolean;
  rewardGems: number;
  referrerId: string;
  newPlayerId: string;
}

export interface BattlePassClaimResult {
  tier: number;
  granted: BattlePassRewardGrant;
  seasonPassPremiumApplied: boolean;
  account: PlayerAccountSnapshot;
}

export type BattleSnapshotStatus = "active" | "resolved" | "compensated" | "aborted";

export interface BattleSnapshotCompensation {
  mailboxMessageId: string;
  playerIds: string[];
  title: string;
  body: string;
  kind: PlayerMailboxMessage["kind"];
  grant?: PlayerMailboxGrant;
}

export interface BattleSnapshotRecord {
  roomId: string;
  battleId: string;
  heroId: string;
  attackerPlayerId: string;
  defenderPlayerId?: string;
  defenderHeroId?: string;
  neutralArmyId?: string;
  encounterKind: "neutral" | "hero";
  initiator?: "hero" | "neutral";
  path: Vec2[];
  moveCost: number;
  playerIds: string[];
  initialState: BattleState;
  estimatedCompensationGrant?: PlayerMailboxGrant;
  status: BattleSnapshotStatus;
  result?: "attacker_victory" | "defender_victory";
  resolutionReason?: string;
  compensation?: BattleSnapshotCompensation;
  startedAt: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BattleSnapshotStartInput {
  roomId: string;
  battleId: string;
  heroId: string;
  attackerPlayerId: string;
  defenderPlayerId?: string;
  defenderHeroId?: string;
  neutralArmyId?: string;
  encounterKind: "neutral" | "hero";
  initiator?: "hero" | "neutral";
  path: Vec2[];
  moveCost: number;
  playerIds: string[];
  initialState: BattleState;
  estimatedCompensationGrant?: PlayerMailboxGrant;
  startedAt?: string;
}

export interface BattleSnapshotResolutionInput {
  roomId: string;
  battleId: string;
  result: "attacker_victory" | "defender_victory";
  resolutionReason?: string;
  resolvedAt?: string;
}

export interface BattleSnapshotInterruptedSettlementInput {
  roomId: string;
  battleId: string;
  status: Extract<BattleSnapshotStatus, "compensated" | "aborted">;
  resolutionReason: string;
  compensation?: BattleSnapshotCompensation;
  resolvedAt?: string;
}

export interface BattleSnapshotListOptions {
  statuses?: BattleSnapshotStatus[];
  limit?: number;
}

export interface RoomSnapshotStore {
  load(roomId: string): Promise<RoomPersistenceSnapshot | null>;
  loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null>;
  loadGuild?(guildId: string): Promise<GuildState | null>;
  loadGuildByMemberPlayerId?(playerId: string): Promise<GuildState | null>;
  listGuildAuditLogs?(options?: GuildAuditLogListOptions): Promise<GuildAuditLogRecord[]>;
  listGuildChatMessages?(options: GuildChatMessageListOptions): Promise<GuildChatMessageRecord[]>;
  loadGuildChatMessage?(guildId: string, messageId: string): Promise<GuildChatMessageRecord | null>;
  loadPaymentOrder?(orderId: string): Promise<PaymentOrderSnapshot | null>;
  listPaymentOrders?(options?: PaymentOrderListOptions): Promise<PaymentOrderSnapshot[]>;
  loadPaymentReceiptByOrderId?(orderId: string): Promise<PaymentReceiptSnapshot | null>;
  countVerifiedPaymentReceiptsSince?(playerId: string, since: string): Promise<number>;
  loadPlayerReport?(reportId: string): Promise<PlayerReportRecord | null>;
  loadPlayerBan?(playerId: string): Promise<PlayerAccountBanSnapshot | null>;
  listPlayerNameHistory?(playerId: string, options?: PlayerNameHistoryListOptions): Promise<PlayerNameHistoryRecord[]>;
  findPlayerNameHistoryByDisplayName?(
    displayName: string,
    options?: PlayerNameLookupOptions
  ): Promise<PlayerNameHistoryRecord[]>;
  findActivePlayerNameReservation?(displayName: string): Promise<PlayerNameReservationRecord | null>;
  createPlayerReport?(input: PlayerReportCreateInput): Promise<PlayerReportRecord>;
  loadPlayerAccountByLoginId(loginId: string): Promise<PlayerAccountSnapshot | null>;
  loadPlayerAccountByWechatMiniGameOpenId(openId: string): Promise<PlayerAccountSnapshot | null>;
  loadPlayerEventHistory(playerId: string, query?: PlayerEventHistoryQuery): Promise<PlayerEventHistorySnapshot>;
  loadPlayerQuestState?(playerId: string): Promise<PlayerQuestState | null>;
  loadPlayerAccounts(playerIds: string[]): Promise<PlayerAccountSnapshot[]>;
  listPlayerReports?(options?: PlayerReportListOptions): Promise<PlayerReportRecord[]>;
  listPlayerBanHistory?(playerId: string, options?: PlayerAccountBanHistoryListOptions): Promise<PlayerBanHistoryRecord[]>;
  appendPlayerCompensationRecord?(
    playerId: string,
    input: PlayerCompensationCreateInput
  ): Promise<PlayerCompensationRecord>;
  listPlayerCompensationHistory?(
    playerId: string,
    options?: PlayerCompensationListOptions
  ): Promise<PlayerCompensationRecord[]>;
  listPlayerPurchaseHistory?(
    playerId: string,
    query?: PlayerPurchaseHistoryQuery
  ): Promise<PlayerPurchaseHistorySnapshot>;
  loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null>;
  loadPlayerAccountAuthByPlayerId(playerId: string): Promise<PlayerAccountAuthSnapshot | null>;
  loadPlayerHeroArchives(playerIds: string[]): Promise<PlayerHeroArchiveSnapshot[]>;
  listGuilds?(options?: GuildListOptions): Promise<GuildState[]>;
  ensurePlayerAccount(input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot>;
  saveGuild?(guild: GuildState): Promise<GuildState>;
  appendGuildAuditLog?(input: GuildAuditLogCreateInput): Promise<GuildAuditLogRecord>;
  createGuildChatMessage?(input: GuildChatMessageCreateInput): Promise<GuildChatMessageRecord>;
  deleteGuildChatMessage?(guildId: string, messageId: string): Promise<boolean>;
  savePlayerBan?(playerId: string, input: PlayerAccountBanInput): Promise<PlayerAccountSnapshot>;
  clearPlayerBan?(playerId: string, input?: PlayerAccountUnbanInput): Promise<PlayerAccountSnapshot>;
  bindPlayerAccountCredentials(
    playerId: string,
    input: PlayerAccountCredentialInput
  ): Promise<PlayerAccountSnapshot>;
  createPaymentOrder?(input: PaymentOrderCreateInput): Promise<PaymentOrderSnapshot>;
  completePaymentOrder?(orderId: string, input: PaymentOrderCompleteInput): Promise<PaymentOrderSettlement>;
  retryPaymentOrderGrant?(orderId: string, input: PaymentOrderGrantRetryInput): Promise<PaymentOrderSettlement>;
  creditGems(playerId: string, amount: number, reason: GemLedgerReason, refId: string): Promise<PlayerAccountSnapshot>;
  debitGems(playerId: string, amount: number, reason: GemLedgerReason, refId: string): Promise<PlayerAccountSnapshot>;
  claimPlayerReferral?(referrerId: string, newPlayerId: string, rewardGems: number): Promise<PlayerReferralClaimResult>;
  deliverPlayerMailbox?(input: PlayerMailboxDeliveryInput): Promise<PlayerMailboxDeliveryResult>;
  claimPlayerMailboxMessage?(playerId: string, messageId: string, claimedAt?: string): Promise<PlayerMailboxClaimResult>;
  claimAllPlayerMailboxMessages?(playerId: string, claimedAt?: string): Promise<PlayerMailboxClaimAllResult>;
  claimBattlePassTier?(playerId: string, tier: number): Promise<BattlePassClaimResult>;
  purchaseShopProduct?(playerId: string, input: ShopPurchaseMutationInput): Promise<ShopPurchaseResult>;
  savePlayerAccountPrivacyConsent(
    playerId: string,
    input?: PlayerAccountPrivacyConsentInput
  ): Promise<PlayerAccountSnapshot>;
  savePlayerAccountAuthSession(
    playerId: string,
    input: PlayerAccountAuthSessionInput
  ): Promise<PlayerAccountAuthSnapshot | null>;
  loadPlayerAccountAuthSession(
    playerId: string,
    sessionId: string
  ): Promise<PlayerAccountDeviceSessionSnapshot | null>;
  listPlayerAccountAuthSessions(playerId: string): Promise<PlayerAccountDeviceSessionSnapshot[]>;
  touchPlayerAccountAuthSession(playerId: string, sessionId: string, lastUsedAt?: string): Promise<void>;
  revokePlayerAccountAuthSession(playerId: string, sessionId: string): Promise<boolean>;
  revokePlayerAccountAuthSessions(
    playerId: string,
    input?: PlayerAccountAuthRevokeInput
  ): Promise<PlayerAccountAuthSnapshot | null>;
  bindPlayerAccountWechatMiniGameIdentity(
    playerId: string,
    input: PlayerAccountWechatMiniGameIdentityInput
  ): Promise<PlayerAccountSnapshot>;
  migrateGuestToRegistered(input: GuestAccountMigrationInput): Promise<GuestAccountMigrationResult>;
  deletePlayerAccount(
    playerId: string,
    input?: PlayerAccountDeleteInput
  ): Promise<PlayerAccountSnapshot | null>;
  resolvePlayerReport?(reportId: string, input: PlayerReportResolveInput): Promise<PlayerReportRecord | null>;
  savePlayerAccountProfile(playerId: string, patch: PlayerAccountProfilePatch): Promise<PlayerAccountSnapshot>;
  savePlayerAccountProgress(playerId: string, patch: PlayerAccountProgressPatch): Promise<PlayerAccountSnapshot>;
  saveBattleSnapshotStart?(input: BattleSnapshotStartInput): Promise<BattleSnapshotRecord>;
  saveBattleSnapshotResolution?(input: BattleSnapshotResolutionInput): Promise<BattleSnapshotRecord | null>;
  settleInterruptedBattleSnapshot?(input: BattleSnapshotInterruptedSettlementInput): Promise<BattleSnapshotRecord | null>;
  listBattleSnapshotsForPlayer?(playerId: string, options?: BattleSnapshotListOptions): Promise<BattleSnapshotRecord[]>;
  savePlayerQuestState?(playerId: string, state: PlayerQuestState): Promise<PlayerQuestState>;
  listPlayerAccounts(options?: PlayerAccountListOptions): Promise<PlayerAccountSnapshot[]>;
  getCurrentSeason(): Promise<SeasonSnapshot | null>;
  listSeasons?(options?: SeasonListOptions): Promise<SeasonSnapshot[]>;
  listLeaderboardSeasonArchive?(seasonId: string, limit?: number): Promise<LeaderboardSeasonArchiveEntry[]>;
  createSeason(seasonId: string): Promise<SeasonSnapshot>;
  closeSeason(seasonId: string): Promise<SeasonCloseSummary>;
  save(roomId: string, snapshot: RoomPersistenceSnapshot): Promise<void>;
  deleteGuild?(guildId: string): Promise<void>;
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
  pool: MySqlPoolConfig;
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
  elo_rating: number | null;
  rank_division: string | null;
  peak_rank_division: string | null;
  promotion_series_json: string | PlayerAccountSnapshot["promotionSeries"] | null;
  demotion_shield_json: string | PlayerAccountSnapshot["demotionShield"] | null;
  season_history_json: string | SeasonArchiveEntry[] | null;
  ranked_weekly_progress_json: string | RankedWeeklyProgress | null;
  gems: number | null;
  season_xp: number | null;
  season_pass_tier: number | null;
  season_pass_premium: number | boolean | null;
  season_pass_claimed_tiers_json: string | number[] | null;
  season_badges_json: string | string[] | null;
  campaign_progress_json: string | PlayerAccountSnapshot["campaignProgress"] | null;
  seasonal_event_states_json: string | PlayerAccountSnapshot["seasonalEventStates"] | null;
  mailbox_json: string | PlayerAccountSnapshot["mailbox"] | null;
  global_resources_json: string | ResourceLedger;
  achievements_json: string | PlayerAchievementProgress[] | null;
  cosmetic_inventory_json: string | PlayerAccountSnapshot["cosmeticInventory"] | null;
  equipped_cosmetics_json: string | PlayerAccountSnapshot["equippedCosmetics"] | null;
  recent_event_log_json: string | EventLogEntry[] | null;
  recent_battle_replays_json: string | PlayerBattleReplaySummary[] | null;
  daily_dungeon_state_json: string | PlayerAccountSnapshot["dailyDungeonState"] | null;
  leaderboard_abuse_state_json: string | PlayerAccountSnapshot["leaderboardAbuseState"] | null;
  leaderboard_moderation_state_json: string | PlayerAccountSnapshot["leaderboardModerationState"] | null;
  tutorial_step: number | null;
  last_room_id: string | null;
  last_seen_at: Date | string | null;
  login_id: string | null;
  age_verified: number | boolean | null;
  is_minor: number | boolean | null;
  daily_play_minutes: number | null;
  last_play_date: Date | string | null;
  login_streak: number | null;
  ban_status: string | null;
  ban_expiry: Date | string | null;
  ban_reason: string | null;
  account_session_version: number;
  refresh_session_id: string | null;
  refresh_token_hash: string | null;
  refresh_token_expires_at: Date | string | null;
  wechat_open_id: string | null;
  wechat_union_id: string | null;
  wechat_mini_game_open_id: string | null;
  wechat_mini_game_union_id: string | null;
  wechat_mini_game_bound_at: Date | string | null;
  guest_migrated_to_player_id: string | null;
  credential_bound_at: Date | string | null;
  privacy_consent_at: Date | string | null;
  phone_number: string | null;
  phone_number_bound_at: Date | string | null;
  notification_preferences_json: string | NotificationPreferences | null;
  push_tokens_json: string | MobilePushTokenRegistration[] | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PlayerAccountAuthRow extends RowDataPacket {
  player_id: string;
  display_name: string | null;
  login_id: string | null;
  password_hash: string | null;
  account_session_version: number;
  refresh_session_id: string | null;
  refresh_token_hash: string | null;
  refresh_token_expires_at: Date | string | null;
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

interface PlayerNameHistoryRow extends RowDataPacket {
  id: number;
  player_id: string;
  display_name: string;
  normalized_name: string;
  changed_at: Date | string;
  created_at: Date | string;
}

interface PlayerCompensationHistoryRow extends RowDataPacket {
  audit_id: string;
  player_id: string;
  type: PlayerCompensationType;
  currency: PlayerCompensationRecord["currency"];
  amount: number;
  reason: string;
  previous_balance: number;
  balance_after: number;
  created_at: Date | string;
}

interface PlayerNameReservationRow extends RowDataPacket {
  id: number;
  player_id: string;
  display_name: string;
  normalized_name: string;
  reserved_until: Date | string;
  reason: string;
  created_at: Date | string;
}

interface PlayerEventHistoryCountRow extends RowDataPacket {
  total: number;
}

interface PlayerQuestStateRow extends RowDataPacket {
  player_id: string;
  current_date_key: string | null;
  active_quest_ids_json: string | string[] | null;
  rotations_json: string | PlayerQuestRotationHistoryEntry[] | null;
  updated_at: Date | string;
}

interface PlayerBanHistoryRow extends RowDataPacket {
  id: number;
  player_id: string;
  action: string;
  ban_status: string;
  ban_expiry: Date | string | null;
  ban_reason: string | null;
  created_at: Date | string;
}

interface PlayerAccountDeviceSessionRow extends RowDataPacket {
  player_id: string;
  session_id: string;
  provider: string | null;
  device_label: string | null;
  refresh_token_hash: string;
  refresh_token_expires_at: Date | string;
  created_at: Date | string;
  last_used_at: Date | string;
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

interface ShopPurchaseRow extends RowDataPacket {
  player_id: string;
  purchase_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  result_json: string | ShopPurchaseResult;
  created_at: Date | string;
}

interface CountRow extends RowDataPacket {
  total: number;
}

interface PaymentOrderRow extends RowDataPacket {
  order_id: string;
  player_id: string;
  product_id: string;
  wechat_order_id: string | null;
  status: string;
  amount: number;
  gem_amount: number;
  created_at: Date | string;
  paid_at: Date | string | null;
  last_grant_attempt_at: Date | string | null;
  next_grant_retry_at: Date | string | null;
  settled_at: Date | string | null;
  dead_lettered_at: Date | string | null;
  grant_attempt_count: number;
  last_grant_error: string | null;
  updated_at: Date | string;
}

interface PaymentReceiptRow extends RowDataPacket {
  transaction_id: string;
  order_id: string;
  player_id: string;
  product_id: string;
  amount: number;
  verified_at: Date | string;
}

interface GuildRow extends RowDataPacket {
  guild_id: string;
  name: string;
  tag: string;
  description: string | null;
  owner_player_id: string | null;
  member_count: number;
  state_json: string | GuildState;
  created_at: Date | string;
  updated_at: Date | string;
}

interface GuildAuditLogRow extends RowDataPacket {
  audit_id: string;
  guild_id: string;
  action: string;
  actor_player_id: string;
  occurred_at: Date | string;
  name: string;
  tag: string;
  reason: string | null;
}

interface GuildChatMessageRow extends RowDataPacket {
  message_id: string;
  guild_id: string;
  author_player_id: string;
  author_display_name: string;
  content: string;
  created_at: Date | string;
  expires_at: Date | string;
}

interface PlayerReportRow extends RowDataPacket {
  report_id: string | number;
  reporter_id: string;
  target_id: string;
  reason: string;
  description: string | null;
  room_id: string;
  status: string;
  created_at: Date | string;
  resolved_at: Date | string | null;
}

interface BattleSnapshotRow extends RowDataPacket {
  room_id: string;
  battle_id: string;
  hero_id: string;
  attacker_player_id: string;
  defender_player_id: string | null;
  defender_hero_id: string | null;
  neutral_army_id: string | null;
  encounter_kind: "neutral" | "hero";
  initiator: "hero" | "neutral" | null;
  path_json: string | Vec2[];
  move_cost: number;
  player_ids_json: string | string[];
  initial_state_json: string | BattleState;
  estimated_compensation_grant_json: string | PlayerMailboxGrant | null;
  status: BattleSnapshotStatus;
  result: "attacker_victory" | "defender_victory" | null;
  resolution_reason: string | null;
  compensation_json: string | BattleSnapshotCompensation | null;
  started_at: Date | string;
  resolved_at: Date | string | null;
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

export interface PlayerAccountSnapshot extends PlayerAccountReadModel {
  recentBattleReplays?: PlayerBattleReplaySummary[];
  mailbox?: PlayerMailboxMessage[];
  accountSessionVersion?: number;
  refreshSessionId?: string;
  refreshTokenExpiresAt?: string;
  wechatMiniGameOpenId?: string;
  wechatMiniGameUnionId?: string;
  wechatMiniGameBoundAt?: string;
  guestMigratedToPlayerId?: string;
  createdAt?: string;
  updatedAt?: string;
  phoneNumber?: string;
  phoneNumberBoundAt?: string;
  pushTokens?: MobilePushTokenRegistration[];
}

export interface PlayerAccountBanSnapshot {
  playerId: string;
  banStatus: PlayerBanStatus;
  banExpiry?: string;
  banReason?: string;
}

export interface PlayerAccountAuthSnapshot {
  playerId: string;
  displayName: string;
  loginId: string;
  passwordHash: string;
  accountSessionVersion: number;
  refreshSessionId?: string;
  refreshTokenHash?: string;
  refreshTokenExpiresAt?: string;
  credentialBoundAt?: string;
}

export interface PlayerAccountDeviceSessionSnapshot {
  playerId: string;
  sessionId: string;
  provider: string;
  deviceLabel: string;
  refreshTokenHash: string;
  refreshTokenExpiresAt: string;
  createdAt: string;
  lastUsedAt: string;
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

export interface GuildListOptions {
  limit?: number;
  playerId?: string;
}

export type GuildAuditAction = "created" | "hidden" | "unhidden" | "deleted";

export interface GuildAuditLogRecord {
  auditId: string;
  guildId: string;
  action: GuildAuditAction;
  actorPlayerId: string;
  occurredAt: string;
  name: string;
  tag: string;
  reason?: string;
}

export interface GuildChatMessageRecord {
  messageId: string;
  guildId: string;
  authorPlayerId: string;
  authorDisplayName: string;
  content: string;
  createdAt: string;
  expiresAt: string;
}

export interface GuildAuditLogCreateInput {
  guildId: string;
  action: GuildAuditAction;
  actorPlayerId: string;
  occurredAt?: string;
  name: string;
  tag: string;
  reason?: string;
}

export interface GuildAuditLogListOptions {
  guildId?: string;
  actorPlayerId?: string;
  since?: string;
  limit?: number;
}

export interface GuildChatMessageListOptions {
  guildId: string;
  beforeCursor?: string;
  limit?: number;
}

export interface GuildChatMessageCreateInput {
  guildId: string;
  authorPlayerId: string;
  authorDisplayName: string;
  content: string;
  createdAt?: string;
  expiresAt: string;
}

export type GemLedgerReason = "purchase" | "reward" | "spend";

export interface ShopPurchaseGrant {
  gems?: number;
  resources?: Partial<ResourceLedger>;
  equipmentIds?: EquipmentId[];
  cosmeticIds?: CosmeticId[];
  seasonPassPremium?: boolean;
}

export interface ShopPurchaseMutationInput {
  purchaseId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  grant: ShopPurchaseGrant;
}

export interface ShopPurchaseResult {
  purchaseId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  granted: {
    gems: number;
    resources: ResourceLedger;
    equipmentIds: EquipmentId[];
    cosmeticIds: CosmeticId[];
    heroId?: string;
    seasonPassPremium?: boolean;
  };
  gemsBalance: number;
  processedAt: string;
}

export type PaymentOrderStatus = "created" | "paid" | "grant_pending" | "settled" | "dead_letter";

export interface PaymentOrderSnapshot {
  orderId: string;
  playerId: string;
  productId: string;
  status: PaymentOrderStatus;
  amount: number;
  gemAmount: number;
  createdAt: string;
  updatedAt: string;
  grantAttemptCount: number;
  wechatOrderId?: string;
  paidAt?: string;
  lastGrantAttemptAt?: string;
  nextGrantRetryAt?: string;
  lastGrantError?: string;
  settledAt?: string;
  deadLetteredAt?: string;
}

export interface PaymentOrderCreateInput {
  orderId: string;
  playerId: string;
  productId: string;
  amount: number;
  gemAmount: number;
}

export interface PaymentOrderCompleteInput {
  wechatOrderId: string;
  paidAt?: string;
  verifiedAt?: string;
  productName: string;
  grant: ShopPurchaseGrant;
  retryPolicy?: PaymentGrantRetryPolicy;
}

export interface PaymentOrderSettlement {
  order: PaymentOrderSnapshot;
  account: PlayerAccountSnapshot;
  credited: boolean;
  receipt?: PaymentReceiptSnapshot;
}

export interface PaymentReceiptSnapshot {
  transactionId: string;
  orderId: string;
  playerId: string;
  productId: string;
  amount: number;
  verifiedAt: string;
}

export interface PaymentGrantRetryPolicy {
  maxAttempts?: number;
  baseDelayMs?: number;
}

export interface PaymentOrderListOptions {
  statuses?: PaymentOrderStatus[];
  limit?: number;
  dueBefore?: string;
}

export interface PaymentOrderGrantRetryInput {
  productName: string;
  grant: ShopPurchaseGrant;
  retriedAt?: string;
  retryPolicy?: PaymentGrantRetryPolicy;
  allowDeadLetter?: boolean;
}

export interface GemLedgerEntry {
  entryId: string;
  playerId: string;
  delta: number;
  reason: GemLedgerReason;
  refId: string;
  createdAt: string;
}

export type PlayerReportReason = "cheating" | "harassment" | "afk";
export type PlayerReportStatus = "pending" | "dismissed" | "warned" | "banned";

export interface PlayerReportRecord {
  reportId: string;
  reporterId: string;
  targetId: string;
  reason: PlayerReportReason;
  description?: string;
  roomId: string;
  status: PlayerReportStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface PlayerReportCreateInput {
  reporterId: string;
  targetId: string;
  reason: PlayerReportReason;
  description?: string;
  roomId: string;
}

export interface PlayerReportListOptions {
  status?: PlayerReportStatus;
  roomId?: string;
  reporterId?: string;
  targetId?: string;
  limit?: number;
}

export interface PlayerReportResolveInput {
  status: Exclude<PlayerReportStatus, "pending">;
}

export interface PlayerAccountProfilePatch {
  displayName?: string;
  avatarUrl?: string | null;
  lastRoomId?: string | null;
  phoneNumber?: string | null;
  phoneNumberBoundAt?: string | null;
  notificationPreferences?: NotificationPreferences | null;
  pushTokens?: MobilePushTokenRegistration[] | null;
}

export interface PlayerAccountProgressPatch {
  gems?: number;
  seasonXpDelta?: number;
  seasonPassPremium?: boolean;
  cosmeticInventory?: PlayerAccountSnapshot["cosmeticInventory"] | null;
  equippedCosmetics?: PlayerAccountSnapshot["equippedCosmetics"] | null;
  seasonPassClaimedTiers?: number[] | null;
  seasonBadges?: string[] | null;
  rankDivision?: PlayerAccountSnapshot["rankDivision"];
  peakRankDivision?: PlayerAccountSnapshot["peakRankDivision"];
  promotionSeries?: PlayerAccountSnapshot["promotionSeries"] | null;
  demotionShield?: PlayerAccountSnapshot["demotionShield"] | null;
  seasonHistory?: PlayerAccountSnapshot["seasonHistory"] | null;
  rankedWeeklyProgress?: PlayerAccountSnapshot["rankedWeeklyProgress"] | null;
  campaignProgress?: PlayerAccountSnapshot["campaignProgress"] | null;
  seasonalEventStates?: SeasonalEventState[] | null;
  globalResources?: Partial<ResourceLedger> | null;
  achievements?: Partial<PlayerAchievementProgress>[] | null;
  recentEventLog?: Partial<EventLogEntry>[] | null;
  recentBattleReplays?: Partial<PlayerBattleReplaySummary>[] | null;
  dailyDungeonState?: PlayerAccountSnapshot["dailyDungeonState"] | null;
  mailbox?: PlayerAccountSnapshot["mailbox"] | null;
  tutorialStep?: number | null;
  dailyPlayMinutes?: number | null;
  lastPlayDate?: string | null;
  loginStreak?: number | null;
  lastRoomId?: string | null;
  eloRating?: number;
  leaderboardAbuseState?: PlayerAccountSnapshot["leaderboardAbuseState"] | null;
  leaderboardModerationState?: PlayerAccountSnapshot["leaderboardModerationState"] | null;
}

export interface PlayerAccountCredentialInput {
  loginId: string;
  passwordHash: string;
}

export interface PlayerAccountPrivacyConsentInput {
  privacyConsentAt?: string;
}

export interface PlayerAccountAuthSessionInput {
  refreshSessionId: string;
  refreshTokenHash: string;
  refreshTokenExpiresAt: string;
  provider?: string;
  deviceLabel?: string;
  lastUsedAt?: string;
}

export interface PlayerAccountAuthRevokeInput {
  passwordHash?: string;
  credentialBoundAt?: string;
}

export interface PlayerAccountWechatMiniGameIdentityInput {
  openId: string;
  unionId?: string;
  displayName?: string;
  avatarUrl?: string | null;
  ageVerified?: boolean;
  isMinor?: boolean;
}

export interface GuestAccountMigrationInput {
  guestPlayerId: string;
  targetPlayerId: string;
  progressSource: "guest" | "target";
  wechatIdentity: PlayerAccountWechatMiniGameIdentityInput;
}

export interface GuestAccountMigrationResult {
  account: PlayerAccountSnapshot;
  guestAccount: PlayerAccountSnapshot;
}

export interface PlayerAccountDeleteInput {
  deletedAt?: string;
}

export interface PlayerAccountListOptions {
  limit?: number;
  playerId?: string;
  orderBy?: "eloRating";
  offset?: number;
}

export interface PlayerNameHistoryRecord {
  id: number;
  playerId: string;
  displayName: string;
  normalizedName: string;
  changedAt: string;
}

export interface PlayerNameHistoryListOptions {
  limit?: number;
}

export interface PlayerNameLookupOptions {
  limit?: number;
}

export interface PlayerNameReservationRecord {
  id: number;
  playerId: string;
  displayName: string;
  normalizedName: string;
  reservedUntil: string;
  reason: string;
  createdAt: string;
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

export interface PlayerQuestRotationHistoryEntry {
  dateKey: string;
  questIds: string[];
  completedQuestIds: string[];
  claimedQuestIds: string[];
}

export interface PlayerQuestState {
  playerId: string;
  currentDateKey?: string;
  activeQuestIds: string[];
  rotations: PlayerQuestRotationHistoryEntry[];
  updatedAt: string;
}

export interface PlayerAccountBanInput {
  banStatus: Exclude<PlayerBanStatus, "none">;
  banExpiry?: string;
  banReason: string;
}

export interface PlayerAccountUnbanInput {
  reason?: string;
}

export interface PlayerBanHistoryRecord {
  id: number;
  playerId: string;
  action: "ban" | "unban";
  banStatus: PlayerBanStatus;
  banExpiry?: string;
  banReason?: string;
  createdAt: string;
}

export interface PlayerAccountBanHistoryListOptions {
  limit?: number;
}

export type PlayerCompensationType = "add" | "deduct";

export interface PlayerCompensationRecord {
  auditId: string;
  playerId: string;
  type: PlayerCompensationType;
  currency: "gems" | keyof ResourceLedger;
  amount: number;
  reason: string;
  previousBalance: number;
  balanceAfter: number;
  createdAt: string;
}

export interface PlayerCompensationCreateInput {
  type: PlayerCompensationType;
  currency: "gems" | keyof ResourceLedger;
  amount: number;
  reason: string;
  previousBalance: number;
  balanceAfter: number;
  createdAt?: string;
}

export interface PlayerCompensationListOptions {
  limit?: number;
}

export interface PlayerPurchaseHistoryRecord {
  purchaseId: string;
  itemId: string;
  quantity: number;
  currency: "gems";
  amount: number;
  paymentMethod: "gems";
  grantedAt: string;
  status: "completed";
}

export interface PlayerPurchaseHistoryQuery {
  from?: string;
  to?: string;
  itemId?: string;
  limit?: number;
  offset?: number;
}

export interface PlayerPurchaseHistorySnapshot {
  items: PlayerPurchaseHistoryRecord[];
  total: number;
  limit: number;
  offset: number;
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
export const MYSQL_PLAYER_ACCOUNT_WECHAT_IDP_OPEN_ID_INDEX = "uidx_player_accounts_wechat_idp_open_id";
export const MYSQL_GEM_LEDGER_TABLE = "gem_ledger";
export const MYSQL_GEM_LEDGER_PLAYER_CREATED_INDEX = "idx_gem_ledger_player_created";
export const MYSQL_PLAYER_REFERRAL_TABLE = "referrals";
export const MYSQL_PLAYER_REFERRAL_REFERRER_CREATED_INDEX = "idx_referrals_referrer_created";
export const MYSQL_SHOP_PURCHASE_TABLE = "shop_purchases";
export const MYSQL_PAYMENT_ORDER_TABLE = "orders";
export const MYSQL_PAYMENT_ORDER_PLAYER_CREATED_INDEX = "idx_orders_player_created";
export const MYSQL_PAYMENT_ORDER_WECHAT_ORDER_ID_INDEX = "uidx_orders_wechat_order_id";
export const MYSQL_PAYMENT_ORDER_STATUS_RETRY_INDEX = "idx_orders_status_next_retry";
export const MYSQL_PAYMENT_RECEIPT_TABLE = "payment_receipts";
export const MYSQL_PAYMENT_RECEIPT_ORDER_ID_INDEX = "uidx_payment_receipts_order_id";
export const MYSQL_PAYMENT_RECEIPT_PLAYER_VERIFIED_INDEX = "idx_payment_receipts_player_verified";
export const MYSQL_PLAYER_ACCOUNT_SESSION_TABLE = "player_account_sessions";
export const MYSQL_PLAYER_ACCOUNT_SESSION_PLAYER_LAST_USED_INDEX = "idx_player_account_sessions_player_last_used";
export const MYSQL_PLAYER_BAN_HISTORY_TABLE = "player_ban_history";
export const MYSQL_PLAYER_BAN_HISTORY_PLAYER_CREATED_INDEX = "idx_player_ban_history_player_created";
export const MYSQL_PLAYER_COMPENSATION_HISTORY_TABLE = "player_compensation_history";
export const MYSQL_PLAYER_COMPENSATION_HISTORY_PLAYER_CREATED_INDEX = "idx_player_compensation_history_player_created";
export const MYSQL_PLAYER_NAME_HISTORY_TABLE = "player_name_history";
export const MYSQL_PLAYER_NAME_HISTORY_PLAYER_CHANGED_INDEX = "idx_player_name_history_player_changed";
export const MYSQL_PLAYER_NAME_HISTORY_NORMALIZED_CHANGED_INDEX = "idx_player_name_history_normalized_changed";
export const MYSQL_PLAYER_NAME_RESERVATION_TABLE = "player_name_reservations";
export const MYSQL_PLAYER_NAME_RESERVATION_UNTIL_INDEX = "idx_player_name_reservations_until";
export const MYSQL_PLAYER_NAME_RESERVATION_NORMALIZED_INDEX = "uidx_player_name_reservations_normalized";
export const MYSQL_PLAYER_EVENT_HISTORY_TABLE = "player_event_history";
export const MYSQL_PLAYER_EVENT_HISTORY_TIMESTAMP_INDEX = "idx_player_event_history_player_time";
export const MYSQL_PLAYER_QUEST_STATE_TABLE = "player_quest_states";
export const MYSQL_PLAYER_QUEST_STATE_UPDATED_AT_INDEX = "idx_player_quest_states_updated_at";
export const MYSQL_PLAYER_HERO_ARCHIVE_TABLE = "player_hero_archives";
export const MYSQL_PLAYER_HERO_ARCHIVE_UPDATED_AT_INDEX = "idx_player_hero_archives_updated_at";
export const MYSQL_PLAYER_REPORT_TABLE = "player_reports";
export const MYSQL_PLAYER_REPORT_STATUS_CREATED_INDEX = "idx_player_reports_status_created";
export const MYSQL_PLAYER_REPORT_ROOM_REPORTER_TARGET_INDEX = "uidx_player_reports_room_reporter_target";
export const MYSQL_BATTLE_SNAPSHOT_TABLE = "battle_snapshots";
export const MYSQL_BATTLE_SNAPSHOT_STATUS_UPDATED_INDEX = "idx_battle_snapshots_status_updated";
export const MYSQL_GUILD_TABLE = "guilds";
export const MYSQL_GUILD_UPDATED_AT_INDEX = "idx_guilds_updated_at";
export const MYSQL_GUILD_TAG_INDEX = "uidx_guilds_tag";
export const MYSQL_GUILD_MEMBERSHIP_TABLE = "guild_memberships";
export const MYSQL_GUILD_MEMBERSHIP_PLAYER_INDEX = "uidx_guild_memberships_player";
export const MYSQL_GUILD_AUDIT_LOG_TABLE = "guild_audit_logs";
export const MYSQL_GUILD_AUDIT_LOG_GUILD_OCCURRED_INDEX = "idx_guild_audit_logs_guild_occurred";
export const MYSQL_GUILD_AUDIT_LOG_ACTOR_OCCURRED_INDEX = "idx_guild_audit_logs_actor_occurred";
export const MYSQL_GUILD_MESSAGE_TABLE = "guild_messages";
export const MYSQL_GUILD_MESSAGE_GUILD_CREATED_INDEX = "idx_guild_messages_guild_created";
export const MYSQL_GUILD_MESSAGE_EXPIRES_AT_INDEX = "idx_guild_messages_expires_at";
export const MYSQL_CONFIG_DOCUMENT_TABLE = "config_documents";
export const MYSQL_CONFIG_DOCUMENT_UPDATED_AT_INDEX = "idx_config_documents_updated_at";
export const MYSQL_SEASON_TABLE = "veil_seasons";
export const MYSQL_SEASON_RANKINGS_TABLE = "veil_season_rankings";
export const MYSQL_LEADERBOARD_SEASON_ARCHIVE_TABLE = "leaderboard_season_archives";
export const MYSQL_SEASON_REWARD_LOG_TABLE = "season_reward_log";
const MAX_LEADERBOARD_SEASON_ARCHIVE_SIZE = 100;
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

function readPositiveInteger(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function readNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
}

function readBooleanFlag(value: string | undefined, fallback: boolean): boolean {
  if (value == null || value.trim() === "") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
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

function addResourceLedgers(base: Partial<ResourceLedger>, delta: Partial<ResourceLedger>): ResourceLedger {
  return {
    gold: Math.max(0, Math.floor((base.gold ?? 0) + (delta.gold ?? 0))),
    wood: Math.max(0, Math.floor((base.wood ?? 0) + (delta.wood ?? 0))),
    ore: Math.max(0, Math.floor((base.ore ?? 0) + (delta.ore ?? 0)))
  };
}

function normalizeShopPurchaseId(purchaseId: string): string {
  const normalized = purchaseId.trim();
  if (!normalized) {
    throw new Error("purchaseId must not be empty");
  }

  return normalized.slice(0, 191);
}

function normalizePaymentOrderId(orderId: string): string {
  const normalized = orderId.trim();
  if (!normalized) {
    throw new Error("orderId must not be empty");
  }

  return normalized.slice(0, 191);
}

function normalizePaymentOrderStatus(status?: string | null): PaymentOrderStatus {
  switch (status) {
    case "created":
    case "paid":
    case "grant_pending":
    case "settled":
    case "dead_letter":
      return status;
    case "pending":
      return "created";
    default:
      return "created";
  }
}

function normalizeWechatOrderId(wechatOrderId: string): string {
  const normalized = wechatOrderId.trim();
  if (!normalized) {
    throw new Error("wechatOrderId must not be empty");
  }

  return normalized.slice(0, 191);
}

function normalizePaymentAmount(amount: number): number {
  const normalized = Math.floor(amount);
  if (!Number.isFinite(amount) || normalized <= 0) {
    throw new Error("amount must be a positive integer");
  }

  return normalized;
}

function normalizePaymentGrantAttemptCount(value?: number | null): number {
  const normalized = Math.max(0, Math.floor(value ?? 0));
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizePaymentGrantError(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 512) : undefined;
}

function normalizePaymentGrantRetryPolicy(input?: PaymentGrantRetryPolicy | null): Required<PaymentGrantRetryPolicy> {
  const maxAttempts = Math.max(1, Math.floor(input?.maxAttempts ?? 5));
  const baseDelayMs = Math.max(1_000, Math.floor(input?.baseDelayMs ?? 60_000));
  return {
    maxAttempts,
    baseDelayMs
  };
}

function computePaymentGrantRetryDelayMs(attemptCount: number, baseDelayMs: number): number {
  const exponent = Math.max(0, Math.min(6, Math.floor(attemptCount) - 1));
  return Math.max(1_000, baseDelayMs * 2 ** exponent);
}

function toPaymentOrderSnapshot(row: PaymentOrderRow): PaymentOrderSnapshot {
  const createdAt = formatTimestamp(row.created_at) ?? new Date(0).toISOString();
  const updatedAt = formatTimestamp(row.updated_at) ?? createdAt;
  const paidAt = formatTimestamp(row.paid_at);
  const lastGrantAttemptAt = formatTimestamp(row.last_grant_attempt_at);
  const nextGrantRetryAt = formatTimestamp(row.next_grant_retry_at);
  const settledAt = formatTimestamp(row.settled_at);
  const deadLetteredAt = formatTimestamp(row.dead_lettered_at);
  const lastGrantError = normalizePaymentGrantError(row.last_grant_error);

  return {
    orderId: normalizePaymentOrderId(row.order_id),
    playerId: normalizePlayerId(row.player_id),
    productId: normalizeShopProductId(row.product_id),
    status: normalizePaymentOrderStatus(row.status),
    amount: normalizePaymentAmount(row.amount),
    gemAmount: normalizeGemAmount(row.gem_amount),
    createdAt,
    updatedAt,
    grantAttemptCount: normalizePaymentGrantAttemptCount(row.grant_attempt_count),
    ...(row.wechat_order_id ? { wechatOrderId: normalizeWechatOrderId(row.wechat_order_id) } : {}),
    ...(paidAt ? { paidAt } : {}),
    ...(lastGrantAttemptAt ? { lastGrantAttemptAt } : {}),
    ...(nextGrantRetryAt ? { nextGrantRetryAt } : {}),
    ...(lastGrantError ? { lastGrantError } : {}),
    ...(settledAt ? { settledAt } : {}),
    ...(deadLetteredAt ? { deadLetteredAt } : {})
  };
}

function toPaymentReceiptSnapshot(row: PaymentReceiptRow): PaymentReceiptSnapshot {
  return {
    transactionId: normalizeWechatOrderId(row.transaction_id),
    orderId: normalizePaymentOrderId(row.order_id),
    playerId: normalizePlayerId(row.player_id),
    productId: normalizeShopProductId(row.product_id),
    amount: normalizePaymentAmount(row.amount),
    verifiedAt: formatTimestamp(row.verified_at) ?? new Date(0).toISOString()
  };
}

function normalizeShopProductId(productId: string): string {
  const normalized = productId.trim();
  if (!normalized) {
    throw new Error("productId must not be empty");
  }

  return normalized.slice(0, 191);
}

function normalizeGuildId(guildId: string): string {
  const normalized = guildId.trim();
  if (!normalized) {
    throw new Error("guildId must not be empty");
  }

  return normalized.slice(0, 191);
}

function normalizeGuildAuditReason(reason?: string | null): string | undefined {
  const normalized = reason?.trim();
  return normalized ? normalized.slice(0, 200) : undefined;
}

function normalizeGuildChatMessageId(messageId: string): string {
  const normalized = messageId.trim();
  if (!normalized) {
    throw new Error("messageId must not be empty");
  }

  return normalized.slice(0, 191);
}

function normalizeGuildChatAuthorDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized) {
    throw new Error("authorDisplayName must not be empty");
  }

  return normalized.slice(0, 40);
}

function normalizeGuildChatContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) {
    throw new Error("content must not be empty");
  }

  return normalized.slice(0, 500);
}

function parseGuildChatCursor(cursor?: string | null): { createdAt: string; messageId: string } | null {
  const normalized = cursor?.trim();
  if (!normalized) {
    return null;
  }

  const separatorIndex = normalized.indexOf("|");
  if (separatorIndex <= 0 || separatorIndex === normalized.length - 1) {
    throw new Error("beforeCursor must be formatted as createdAt|messageId");
  }

  const createdAt = normalized.slice(0, separatorIndex);
  const messageId = normalized.slice(separatorIndex + 1);
  const createdAtDate = new Date(createdAt);
  if (Number.isNaN(createdAtDate.getTime())) {
    throw new Error("beforeCursor createdAt must be a valid ISO timestamp");
  }

  return {
    createdAt: createdAtDate.toISOString(),
    messageId: normalizeGuildChatMessageId(messageId)
  };
}

function toGuildAuditLogRecord(row: GuildAuditLogRow): GuildAuditLogRecord {
  const action = row.action === "created" || row.action === "hidden" || row.action === "unhidden" || row.action === "deleted"
    ? row.action
    : "created";
  return {
    auditId: row.audit_id,
    guildId: normalizeGuildId(row.guild_id),
    action,
    actorPlayerId: normalizePlayerId(row.actor_player_id),
    occurredAt: formatTimestamp(row.occurred_at) ?? new Date().toISOString(),
    name: row.name.trim().slice(0, 40),
    tag: row.tag.trim().toUpperCase().slice(0, 4),
    ...(row.reason?.trim() ? { reason: row.reason.trim() } : {})
  };
}

function toGuildChatMessageRecord(row: GuildChatMessageRow): GuildChatMessageRecord {
  return {
    messageId: normalizeGuildChatMessageId(row.message_id),
    guildId: normalizeGuildId(row.guild_id),
    authorPlayerId: normalizePlayerId(row.author_player_id),
    authorDisplayName: normalizeGuildChatAuthorDisplayName(row.author_display_name),
    content: normalizeGuildChatContent(row.content),
    createdAt: formatTimestamp(row.created_at) ?? new Date().toISOString(),
    expiresAt: formatTimestamp(row.expires_at) ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  };
}

function toGuildState(row: GuildRow): GuildState {
  const parsed = normalizeGuildState(parseJsonColumn<GuildState>(row.state_json));
  return {
    ...parsed,
    id: normalizeGuildId(row.guild_id),
    name: row.name.trim() || parsed.name,
    tag: row.tag.trim().toUpperCase() || parsed.tag,
    ...(row.description?.trim() ? { description: row.description.trim() } : {}),
    createdAt: formatTimestamp(row.created_at) ?? parsed.createdAt,
    updatedAt: formatTimestamp(row.updated_at) ?? parsed.updatedAt
  };
}

function normalizeShopProductName(productName: string): string {
  const normalized = productName.trim();
  if (!normalized) {
    throw new Error("productName must not be empty");
  }

  return normalized.slice(0, 80);
}

function normalizeShopPurchaseQuantity(quantity: number): number {
  const normalized = Math.floor(quantity);
  if (!Number.isFinite(quantity) || normalized <= 0) {
    throw new Error("quantity must be a positive integer");
  }

  return normalized;
}

function normalizeShopPurchaseGrant(grant: ShopPurchaseGrant): {
  gems: number;
  resources: ResourceLedger;
  equipmentIds: EquipmentId[];
  cosmeticIds: CosmeticId[];
  seasonPassPremium: boolean;
} {
  const equipmentIds = (grant.equipmentIds ?? []).map((equipmentId) => equipmentId.trim()).filter(Boolean);
  for (const equipmentId of equipmentIds) {
    if (!getEquipmentDefinition(equipmentId)) {
      throw new Error(`unknown equipment grant: ${equipmentId}`);
    }
  }
  const cosmeticCatalogIds = new Set(resolveCosmeticCatalog().map((entry) => entry.id));
  const cosmeticIds = (grant.cosmeticIds ?? []).map((cosmeticId) => cosmeticId.trim()).filter(Boolean);
  for (const cosmeticId of cosmeticIds) {
    if (!cosmeticCatalogIds.has(cosmeticId)) {
      throw new Error(`unknown cosmetic grant: ${cosmeticId}`);
    }
  }

  return {
    gems: grant.gems != null ? normalizeGemAmount(grant.gems) : 0,
    resources: normalizeResourceLedger(grant.resources),
    equipmentIds,
    cosmeticIds,
    seasonPassPremium: grant.seasonPassPremium === true
  };
}

function multiplyShopPurchaseGrant(
  grant: { gems: number; resources: ResourceLedger; equipmentIds: EquipmentId[]; cosmeticIds: CosmeticId[]; seasonPassPremium: boolean },
  quantity: number
): { gems: number; resources: ResourceLedger; equipmentIds: EquipmentId[]; cosmeticIds: CosmeticId[]; seasonPassPremium: boolean } {
  return {
    gems: grant.gems * quantity,
    resources: {
      gold: grant.resources.gold * quantity,
      wood: grant.resources.wood * quantity,
      ore: grant.resources.ore * quantity
    },
    equipmentIds: Array.from({ length: quantity }, () => grant.equipmentIds).flat(),
    cosmeticIds: Array.from({ length: quantity }, () => grant.cosmeticIds).flat(),
    seasonPassPremium: grant.seasonPassPremium
  };
}

function createShopPurchaseEventLogEntry(playerId: string, input: {
  productId: string;
  productName: string;
  quantity: number;
  granted: { gems: number; resources: ResourceLedger; equipmentIds: EquipmentId[]; cosmeticIds: CosmeticId[] };
  processedAt: string;
}): EventLogEntry {
  const resourceRewards = [
    input.granted.resources.gold > 0 ? { type: "resource" as const, label: "gold", amount: input.granted.resources.gold } : null,
    input.granted.resources.wood > 0 ? { type: "resource" as const, label: "wood", amount: input.granted.resources.wood } : null,
    input.granted.resources.ore > 0 ? { type: "resource" as const, label: "ore", amount: input.granted.resources.ore } : null
  ].filter((reward): reward is NonNullable<typeof reward> => Boolean(reward));

  return {
    id: `${playerId}:${input.processedAt}:shop:${input.productId}:${input.quantity}`,
    timestamp: input.processedAt,
    roomId: "shop",
    playerId,
    category: "account",
    description:
      input.granted.cosmeticIds.length > 0
        ? `Purchased ${input.productName} x${input.quantity} and unlocked ${input.granted.cosmeticIds.length} cosmetic item(s).`
        : `Purchased ${input.productName} x${input.quantity}.`,
    rewards: resourceRewards
  };
}

async function applyVerifiedPaymentGrantToAccount(
  connection: PoolConnection,
  currentAccount: PlayerAccountSnapshot,
  input: {
    playerId: string;
    productId: string;
    productName: string;
    grant: ShopPurchaseGrant;
    refId: string;
    processedAt: string;
  }
): Promise<PlayerAccountSnapshot> {
  const normalizedGrant = normalizeShopPurchaseGrant(input.grant);

  let nextHeroArchive: PlayerHeroArchiveSnapshot | null = null;
  if (normalizedGrant.equipmentIds.length > 0) {
    const [heroArchiveRows] = await connection.query<PlayerHeroArchiveRow[]>(
      `SELECT player_id, hero_id, hero_json, army_template_id, army_count, learned_skills_json, equipment_json, inventory_json, updated_at
       FROM \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\`
       WHERE player_id = ?
       ORDER BY updated_at DESC, hero_id ASC
       LIMIT 1
       FOR UPDATE`,
      [input.playerId]
    );
    const currentArchive = heroArchiveRows[0] ? toPlayerHeroArchiveSnapshot(heroArchiveRows[0]) : null;
    if (!currentArchive) {
      throw new Error("player hero archive not found");
    }

    let nextInventory = [...currentArchive.hero.loadout.inventory];
    for (const equipmentId of normalizedGrant.equipmentIds) {
      const inventoryUpdate = tryAddEquipmentToInventory(nextInventory, equipmentId);
      if (!inventoryUpdate.stored) {
        throw new Error("equipment inventory full");
      }
      nextInventory = inventoryUpdate.inventory;
    }

    nextHeroArchive = {
      ...currentArchive,
      hero: normalizeHeroState({
        ...currentArchive.hero,
        loadout: {
          ...currentArchive.hero.loadout,
          inventory: nextInventory
        }
      })
    };
  }

  const nextRecentEventLog = appendEventLogEntries(currentAccount.recentEventLog, [
    createShopPurchaseEventLogEntry(input.playerId, {
      productId: input.productId,
      productName: input.productName,
      quantity: 1,
      granted: normalizedGrant,
      processedAt: input.processedAt
    })
  ]);
  const nextGlobalResources = addResourceLedgers(currentAccount.globalResources, normalizedGrant.resources);
  const nextGems = normalizeGemAmount(currentAccount.gems) + normalizedGrant.gems;
  const nextSeasonPassPremium = currentAccount.seasonPassPremium === true || normalizedGrant.seasonPassPremium;
  const nextCosmeticInventory = applyOwnedCosmetics(currentAccount.cosmeticInventory, normalizedGrant.cosmeticIds);

  await connection.query(
    `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
     SET gems = ?,
         season_pass_premium = ?,
         cosmetic_inventory_json = ?,
         global_resources_json = ?,
         recent_event_log_json = ?,
         version = version + 1
     WHERE player_id = ?`,
    [
      nextGems,
      nextSeasonPassPremium ? 1 : 0,
      JSON.stringify(nextCosmeticInventory),
      JSON.stringify(nextGlobalResources),
      JSON.stringify(nextRecentEventLog),
      input.playerId
    ]
  );

  if (normalizedGrant.gems > 0) {
    await appendGemLedgerEntry(connection, {
      entryId: randomUUID(),
      playerId: input.playerId,
      delta: normalizedGrant.gems,
      reason: "purchase",
      refId: input.refId
    });
  }

  if (nextHeroArchive) {
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
         updated_at = CURRENT_TIMESTAMP`,
      [
        nextHeroArchive.playerId,
        nextHeroArchive.heroId,
        JSON.stringify(nextHeroArchive.hero),
        nextHeroArchive.hero.armyTemplateId,
        nextHeroArchive.hero.armyCount,
        JSON.stringify(nextHeroArchive.hero.loadout.learnedSkills),
        JSON.stringify(nextHeroArchive.hero.loadout.equipment),
        JSON.stringify(nextHeroArchive.hero.loadout.inventory)
      ]
    );
  }

  await appendPlayerEventHistoryEntries(connection, input.playerId, nextRecentEventLog.slice(0, 1));

  return normalizePlayerAccountSnapshot({
    ...currentAccount,
    gems: nextGems,
    seasonPassPremium: nextSeasonPassPremium,
    cosmeticInventory: nextCosmeticInventory,
    globalResources: nextGlobalResources,
    recentEventLog: nextRecentEventLog,
    updatedAt: input.processedAt
  });
}

function createBattlePassClaimEventLogEntry(playerId: string, input: {
  tier: number;
  granted: BattlePassRewardGrant;
  processedAt: string;
}): EventLogEntry {
  const rewards = [
    input.granted.gems > 0 ? { type: "resource" as const, label: "gems", amount: input.granted.gems } : null,
    input.granted.resources.gold > 0 ? { type: "resource" as const, label: "gold", amount: input.granted.resources.gold } : null
  ].filter((reward): reward is NonNullable<typeof reward> => Boolean(reward));

  return {
    id: `${playerId}:${input.processedAt}:battle-pass:${input.tier}`,
    timestamp: input.processedAt,
    roomId: "battle-pass",
    playerId,
    category: "account",
    description: `Claimed battle pass tier ${input.tier}.`,
    rewards
  };
}

async function applyMailboxClaimsToAccount(
  connection: PoolConnection,
  currentAccount: PlayerAccountSnapshot,
  input: {
    playerId: string;
    mailbox: PlayerMailboxMessage[];
    claims: Array<{
      message: PlayerMailboxMessage;
      granted: ReturnType<typeof normalizePlayerMailboxGrant>;
    }>;
  }
): Promise<void> {
  if (input.claims.length === 0) {
    return;
  }

  const nextMailbox = input.mailbox;
  const totalGrant = input.claims.reduce(
    (accumulator, claim) => ({
      gems: accumulator.gems + claim.granted.gems,
      resources: addResourceLedgers(accumulator.resources, claim.granted.resources),
      equipmentIds: [...accumulator.equipmentIds, ...claim.granted.equipmentIds],
      cosmeticIds: [...accumulator.cosmeticIds, ...claim.granted.cosmeticIds],
      seasonBadges: [...accumulator.seasonBadges, ...claim.granted.seasonBadges],
      seasonPassPremium: accumulator.seasonPassPremium || claim.granted.seasonPassPremium
    }),
    {
      gems: 0,
      resources: normalizeResourceLedger(),
      equipmentIds: [] as EquipmentId[],
      cosmeticIds: [] as CosmeticId[],
      seasonBadges: [] as string[],
      seasonPassPremium: false
    }
  );

  let nextHeroArchive: PlayerHeroArchiveSnapshot | null = null;
  if (totalGrant.equipmentIds.length > 0) {
    const [heroArchiveRows] = await connection.query<PlayerHeroArchiveRow[]>(
      `SELECT player_id, hero_id, hero_json, army_template_id, army_count, learned_skills_json, equipment_json, inventory_json, updated_at
       FROM \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\`
       WHERE player_id = ?
       ORDER BY updated_at DESC, hero_id ASC
       LIMIT 1
       FOR UPDATE`,
      [input.playerId]
    );
    const currentArchive = heroArchiveRows[0] ? toPlayerHeroArchiveSnapshot(heroArchiveRows[0]) : null;
    if (!currentArchive) {
      throw new Error("player hero archive not found");
    }

    let nextInventory = [...currentArchive.hero.loadout.inventory];
    for (const equipmentId of totalGrant.equipmentIds) {
      const inventoryUpdate = tryAddEquipmentToInventory(nextInventory, equipmentId);
      if (!inventoryUpdate.stored) {
        throw new Error("equipment inventory full");
      }
      nextInventory = inventoryUpdate.inventory;
    }

    nextHeroArchive = {
      ...currentArchive,
      hero: normalizeHeroState({
        ...currentArchive.hero,
        loadout: {
          ...currentArchive.hero.loadout,
          inventory: nextInventory
        }
      })
    };
  }

  const eventEntries = input.claims.map((claim) =>
    createMailboxClaimEventLogEntry(input.playerId, claim.message, claim.granted, claim.message.claimedAt ?? new Date().toISOString())
  );
  const nextRecentEventLog = appendEventLogEntries(currentAccount.recentEventLog, eventEntries);
  const nextGlobalResources = addResourceLedgers(currentAccount.globalResources, totalGrant.resources);
  const nextGems = normalizeGemAmount(currentAccount.gems) + totalGrant.gems;
  const nextSeasonPassPremium = currentAccount.seasonPassPremium === true || totalGrant.seasonPassPremium;
  const nextCosmeticInventory = applyOwnedCosmetics(currentAccount.cosmeticInventory, totalGrant.cosmeticIds);
  const nextSeasonBadges = Array.from(new Set([...(currentAccount.seasonBadges ?? []), ...totalGrant.seasonBadges])).sort((left, right) =>
    left.localeCompare(right)
  );

  await connection.query(
    `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
     SET gems = ?,
         season_pass_premium = ?,
         season_badges_json = ?,
         cosmetic_inventory_json = ?,
         global_resources_json = ?,
         recent_event_log_json = ?,
         mailbox_json = ?,
         version = version + 1
     WHERE player_id = ?`,
    [
      nextGems,
      nextSeasonPassPremium ? 1 : 0,
      JSON.stringify(nextSeasonBadges),
      JSON.stringify(nextCosmeticInventory),
      JSON.stringify(nextGlobalResources),
      JSON.stringify(nextRecentEventLog),
      JSON.stringify(nextMailbox),
      input.playerId
    ]
  );

  for (const claim of input.claims) {
    if (claim.granted.gems > 0) {
      await appendGemLedgerEntry(connection, {
        entryId: randomUUID(),
        playerId: input.playerId,
        delta: claim.granted.gems,
        reason: "reward",
        refId: `mailbox:${claim.message.id}`
      });
    }
  }

  if (nextHeroArchive) {
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
         updated_at = CURRENT_TIMESTAMP`,
      [
        nextHeroArchive.playerId,
        nextHeroArchive.heroId,
        JSON.stringify(nextHeroArchive.hero),
        nextHeroArchive.hero.armyTemplateId,
        nextHeroArchive.hero.armyCount,
        JSON.stringify(nextHeroArchive.hero.loadout.learnedSkills),
        JSON.stringify(nextHeroArchive.hero.loadout.equipment),
        JSON.stringify(nextHeroArchive.hero.loadout.inventory)
      ]
    );
  }

  await appendPlayerEventHistoryEntries(connection, input.playerId, eventEntries);
}

function applyOwnedCosmetics(
  current: PlayerAccountSnapshot["cosmeticInventory"],
  grantedIds: CosmeticId[]
): PlayerAccountSnapshot["cosmeticInventory"] {
  return normalizeCosmeticInventory({
    ownedIds: [...(current?.ownedIds ?? []), ...grantedIds]
  });
}

export function equipOwnedCosmetic(
  currentAccount: Pick<PlayerAccountSnapshot, "cosmeticInventory" | "equippedCosmetics">,
  cosmeticId: CosmeticId
): PlayerAccountSnapshot["equippedCosmetics"] {
  const definition = resolveCosmeticCatalog().find((entry) => entry.id === cosmeticId);
  if (!definition) {
    throw new Error("cosmetic_not_found");
  }
  if (!(currentAccount.cosmeticInventory?.ownedIds ?? []).includes(cosmeticId)) {
    throw new Error("cosmetic_not_owned");
  }

  const nextEquipped = normalizeEquippedCosmetics(currentAccount.equippedCosmetics);
  if (definition.category === "hero_skin") {
    nextEquipped.heroSkinId = cosmeticId;
  } else if (definition.category === "unit_recolor") {
    nextEquipped.unitRecolorId = cosmeticId;
  } else if (definition.category === "profile_border") {
    nextEquipped.profileBorderId = cosmeticId;
  } else {
    nextEquipped.battleEmoteId = cosmeticId;
  }
  return nextEquipped;
}

function normalizePlayerBanStatus(status?: string | null): PlayerBanStatus {
  return status === "temporary" || status === "permanent" ? status : "none";
}

function normalizePlayerBanReason(reason?: string | null): string | undefined {
  const normalized = reason?.trim();
  return normalized ? normalized.slice(0, 512) : undefined;
}

function normalizePlayerBanExpiry(expiry?: string | Date | null): string | undefined {
  if (!expiry) {
    return undefined;
  }

  const parsed = expiry instanceof Date ? expiry : new Date(expiry);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("banExpiry must be a valid ISO timestamp");
  }

  return parsed.toISOString();
}

function normalizePlayerReportReason(reason?: string | null): PlayerReportReason {
  if (reason === "cheating" || reason === "harassment" || reason === "afk") {
    return reason;
  }

  throw new Error("report reason must be cheating, harassment, or afk");
}

function normalizePlayerReportStatus(status?: string | null): PlayerReportStatus {
  if (status === "pending" || status === "dismissed" || status === "warned" || status === "banned") {
    return status;
  }

  throw new Error("report status must be pending, dismissed, warned, or banned");
}

function normalizePlayerReportDescription(description?: string | null): string | undefined {
  const normalized = description?.trim();
  return normalized ? normalized.slice(0, 512) : undefined;
}

function normalizePlayerReportRecord(record: {
  reportId: string | number;
  reporterId: string;
  targetId: string;
  reason: string;
  description?: string | null;
  roomId: string;
  status: string;
  createdAt: string | Date;
  resolvedAt?: string | Date | null;
}): PlayerReportRecord {
  const description = normalizePlayerReportDescription(record.description);
  const resolvedAt = formatTimestamp(record.resolvedAt);

  return {
    reportId: String(record.reportId),
    reporterId: normalizePlayerId(record.reporterId),
    targetId: normalizePlayerId(record.targetId),
    reason: normalizePlayerReportReason(record.reason),
    ...(description ? { description } : {}),
    roomId: record.roomId.trim(),
    status: normalizePlayerReportStatus(record.status),
    createdAt: formatTimestamp(record.createdAt) ?? new Date(0).toISOString(),
    ...(resolvedAt ? { resolvedAt } : {})
  };
}

export function isPlayerBanActive(
  ban: Pick<PlayerAccountBanSnapshot, "banStatus" | "banExpiry"> | Pick<PlayerAccountSnapshot, "banStatus" | "banExpiry"> | null | undefined
): boolean {
  if (!ban || (ban.banStatus ?? "none") === "none") {
    return false;
  }

  if (ban.banStatus === "permanent") {
    return true;
  }

  const expiry = ban.banExpiry ? new Date(ban.banExpiry) : null;
  return Boolean(expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now());
}

function normalizePlayerId(playerId: string): string {
  const normalized = playerId.trim();
  if (normalized.length === 0) {
    throw new Error("playerId must not be empty");
  }

  return normalized;
}

function createDeletedFinancialRecordPseudonym(): string {
  return `deleted-financial-${randomUUID()}`;
}

function normalizeBattleSnapshotStatus(status: BattleSnapshotStatus): BattleSnapshotStatus {
  if (status !== "active" && status !== "resolved" && status !== "compensated" && status !== "aborted") {
    throw new Error("battle snapshot status is invalid");
  }

  return status;
}

function normalizeBattleSnapshotPlayerIds(playerIds: string[]): string[] {
  const normalized = Array.from(new Set(playerIds.map((playerId) => normalizePlayerId(playerId))));
  if (normalized.length === 0) {
    throw new Error("battle snapshot must include at least one playerId");
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

function normalizePlayerDisplayNameLookup(displayName: string): string {
  const normalized = normalizeDisplayNameForLookup(displayName);
  if (!normalized) {
    throw new Error("displayName must not be empty");
  }

  return normalized.slice(0, 191);
}

function normalizePlayerAvatarUrl(avatarUrl?: string | null): string | undefined {
  const normalized = avatarUrl?.trim();
  return normalized ? normalized.slice(0, MAX_PLAYER_AVATAR_URL_LENGTH) : undefined;
}

function normalizePrivacyConsentAt(value?: string | Date | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("privacyConsentAt must be a valid ISO timestamp");
  }

  return parsed.toISOString();
}

function normalizePlayerAgeVerified(ageVerified?: boolean | number | null): boolean | undefined {
  if (ageVerified == null) {
    return undefined;
  }

  return ageVerified === true || ageVerified === 1;
}

function normalizePlayerIsMinor(isMinor?: boolean | number | null): boolean | undefined {
  if (isMinor == null) {
    return undefined;
  }

  return isMinor === true || isMinor === 1;
}

function normalizeDailyPlayMinutes(minutes?: number | null): number {
  return Math.max(0, Math.floor(minutes ?? 0));
}

function normalizeLoginStreak(streak?: number | null): number {
  return Math.max(0, Math.floor(streak ?? 0));
}

function normalizeGemAmount(amount?: number | null): number {
  return Math.max(0, Math.floor(amount ?? 0));
}

function normalizePositiveGemDelta(amount: number): number {
  const normalized = Math.floor(amount);
  if (!Number.isFinite(amount) || normalized <= 0) {
    throw new Error("gem amount must be a positive integer");
  }

  return normalized;
}

function normalizeGemLedgerReason(reason: GemLedgerReason): GemLedgerReason {
  if (reason === "purchase" || reason === "reward" || reason === "spend") {
    return reason;
  }

  throw new Error("gem reason must be purchase, reward, or spend");
}

function normalizeGemLedgerRefId(refId: string): string {
  const normalized = refId.trim();
  if (!normalized) {
    throw new Error("refId must not be empty");
  }

  return normalized.slice(0, 191);
}

function normalizeLastPlayDate(value?: string | Date | null): string | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      return normalized;
    }

    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }

    throw new Error("lastPlayDate must be a valid date string");
  }

  if (Number.isNaN(value.getTime())) {
    throw new Error("lastPlayDate must be a valid date");
  }

  return value.toISOString().slice(0, 10);
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

function normalizeAuthSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) {
    throw new Error("sessionId must not be empty");
  }

  return normalized;
}

function normalizeAuthSessionDeviceLabel(deviceLabel?: string | null): string {
  const normalized = deviceLabel?.trim();
  return normalized ? normalized.slice(0, 191) : "Unknown device";
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
  eloRating?: number | null | undefined;
  rankDivision?: PlayerAccountSnapshot["rankDivision"] | null | undefined;
  peakRankDivision?: PlayerAccountSnapshot["peakRankDivision"] | null | undefined;
  promotionSeries?: PlayerAccountSnapshot["promotionSeries"] | null | undefined;
  demotionShield?: PlayerAccountSnapshot["demotionShield"] | null | undefined;
  seasonHistory?: PlayerAccountSnapshot["seasonHistory"] | null | undefined;
  rankedWeeklyProgress?: PlayerAccountSnapshot["rankedWeeklyProgress"] | null | undefined;
  gems?: number | null | undefined;
  seasonXp?: number | null | undefined;
  seasonPassTier?: number | null | undefined;
  seasonPassPremium?: boolean | number | null | undefined;
  cosmeticInventory?: PlayerAccountSnapshot["cosmeticInventory"] | null | undefined;
  equippedCosmetics?: PlayerAccountSnapshot["equippedCosmetics"] | null | undefined;
  currentShopRotation?: PlayerAccountSnapshot["currentShopRotation"] | null | undefined;
  seasonPassClaimedTiers?: number[] | null | undefined;
  seasonBadges?: string[] | null | undefined;
  campaignProgress?: PlayerAccountSnapshot["campaignProgress"] | null | undefined;
  seasonalEventStates?: PlayerAccountSnapshot["seasonalEventStates"] | null | undefined;
  mailbox?: PlayerAccountSnapshot["mailbox"] | null | undefined;
  globalResources?: Partial<ResourceLedger>;
  achievements?: Partial<PlayerAchievementProgress>[] | null | undefined;
  recentEventLog?: Partial<EventLogEntry>[] | null | undefined;
  recentBattleReplays?: Partial<PlayerBattleReplaySummary>[] | null | undefined;
  dailyDungeonState?: PlayerAccountSnapshot["dailyDungeonState"] | null | undefined;
  leaderboardAbuseState?: PlayerAccountSnapshot["leaderboardAbuseState"] | null | undefined;
  leaderboardModerationState?: PlayerAccountSnapshot["leaderboardModerationState"] | null | undefined;
  tutorialStep?: number | null | undefined;
  lastRoomId?: string | undefined;
  lastSeenAt?: string | undefined;
  loginId?: string | null | undefined;
  ageVerified?: boolean | number | null | undefined;
  isMinor?: boolean | number | null | undefined;
  dailyPlayMinutes?: number | null | undefined;
  lastPlayDate?: string | Date | null | undefined;
  loginStreak?: number | null | undefined;
  banStatus?: PlayerBanStatus | null | undefined;
  banExpiry?: string | undefined;
  banReason?: string | null | undefined;
  wechatMiniGameOpenId?: string | null | undefined;
  wechatMiniGameUnionId?: string | null | undefined;
  wechatMiniGameBoundAt?: string | undefined;
  guestMigratedToPlayerId?: string | null | undefined;
  credentialBoundAt?: string | undefined;
  privacyConsentAt?: string | Date | null | undefined;
  phoneNumber?: string | null | undefined;
  phoneNumberBoundAt?: string | Date | null | undefined;
  notificationPreferences?: NotificationPreferences | null | undefined;
  pushTokens?: MobilePushTokenRegistration[] | null | undefined;
  accountSessionVersion?: number | null | undefined;
  refreshSessionId?: string | null | undefined;
  refreshTokenExpiresAt?: string | Date | null | undefined;
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
  const phoneNumberBoundAt = formatTimestamp(account.phoneNumberBoundAt);
  const pushTokens = normalizeMobilePushTokenRegistrations(account.pushTokens);

  return {
    ...normalizePlayerAccountReadModel({
      playerId,
      displayName: normalizePlayerDisplayName(playerId, account.displayName),
      avatarUrl: normalizePlayerAvatarUrl(account.avatarUrl),
      eloRating: normalizeEloRating(account.eloRating),
      rankDivision: account.rankDivision ?? getRankDivisionForRating(account.eloRating ?? 1000),
      peakRankDivision:
        account.peakRankDivision ??
        account.rankDivision ??
        getRankDivisionForRating(account.eloRating ?? 1000),
      promotionSeries: account.promotionSeries ?? undefined,
      demotionShield: account.demotionShield ?? undefined,
      seasonHistory: account.seasonHistory ?? undefined,
      rankedWeeklyProgress: account.rankedWeeklyProgress ?? undefined,
      gems: normalizeGemAmount(account.gems),
      seasonXp: Math.max(0, Math.floor(account.seasonXp ?? 0)),
      seasonPassTier: Math.max(1, Math.floor(account.seasonPassTier ?? 1)),
      seasonPassPremium: account.seasonPassPremium === true || account.seasonPassPremium === 1,
      cosmeticInventory: normalizeCosmeticInventory(account.cosmeticInventory),
      equippedCosmetics: normalizeEquippedCosmetics(account.equippedCosmetics),
      currentShopRotation: account.currentShopRotation ?? resolveWeeklyShopRotation(),
      seasonPassClaimedTiers: account.seasonPassClaimedTiers ?? [],
      seasonBadges: account.seasonBadges,
      campaignProgress: account.campaignProgress,
      seasonalEventStates: account.seasonalEventStates,
      mailbox: account.mailbox,
      globalResources: normalizeResourceLedger(account.globalResources),
      achievements: account.achievements,
      recentEventLog: account.recentEventLog,
      recentBattleReplays: appendPlayerBattleReplaySummaries([], account.recentBattleReplays),
      dailyDungeonState: account.dailyDungeonState,
      leaderboardAbuseState: account.leaderboardAbuseState,
      leaderboardModerationState: account.leaderboardModerationState,
      tutorialStep: account.tutorialStep,
      lastRoomId: account.lastRoomId,
      lastSeenAt: account.lastSeenAt,
      loginId: account.loginId ? normalizePlayerLoginId(account.loginId) : undefined,
      credentialBoundAt: account.credentialBoundAt,
      privacyConsentAt: normalizePrivacyConsentAt(account.privacyConsentAt),
      phoneNumber: account.phoneNumber?.trim() || undefined,
      notificationPreferences: account.notificationPreferences ?? undefined,
      ...(phoneNumberBoundAt ? { phoneNumberBoundAt } : {}),
      ageVerified: normalizePlayerAgeVerified(account.ageVerified),
      isMinor: normalizePlayerIsMinor(account.isMinor),
      dailyPlayMinutes: normalizeDailyPlayMinutes(account.dailyPlayMinutes),
      lastPlayDate: normalizeLastPlayDate(account.lastPlayDate),
      loginStreak: normalizeLoginStreak(account.loginStreak),
      banStatus: normalizePlayerBanStatus(account.banStatus),
      banExpiry: normalizePlayerBanExpiry(account.banExpiry),
      banReason: normalizePlayerBanReason(account.banReason)
    }),
    ...(normalizedWechatMiniGameOpenId ? { wechatMiniGameOpenId: normalizedWechatMiniGameOpenId } : {}),
    ...(normalizedWechatMiniGameUnionId ? { wechatMiniGameUnionId: normalizedWechatMiniGameUnionId } : {}),
    ...(account.wechatMiniGameBoundAt ? { wechatMiniGameBoundAt: account.wechatMiniGameBoundAt } : {}),
    ...(pushTokens ? { pushTokens } : {}),
    ...(account.guestMigratedToPlayerId?.trim()
      ? { guestMigratedToPlayerId: normalizePlayerId(account.guestMigratedToPlayerId) }
      : {}),
    ...(account.accountSessionVersion != null ? { accountSessionVersion: Math.max(0, Math.floor(account.accountSessionVersion)) } : {}),
    ...(account.refreshSessionId?.trim() ? { refreshSessionId: account.refreshSessionId.trim() } : {}),
    ...(formatTimestamp(account.refreshTokenExpiresAt) ? { refreshTokenExpiresAt: formatTimestamp(account.refreshTokenExpiresAt)! } : {}),
    ...(account.phoneNumber?.trim() ? { phoneNumber: account.phoneNumber.trim() } : {}),
    ...(phoneNumberBoundAt ? { phoneNumberBoundAt } : {}),
    ...(account.createdAt ? { createdAt: account.createdAt } : {}),
    ...(account.updatedAt ? { updatedAt: account.updatedAt } : {})
  };
}

function normalizePlayerEventHistoryQuery(query: PlayerEventHistoryQuery = {}): Required<Pick<PlayerEventHistoryQuery, "offset">> &
  Pick<PlayerEventHistoryQuery, "category" | "heroId" | "achievementId" | "worldEventType" | "since" | "until"> &
  { limit?: number } {
  return normalizeEventLogQuery(query);
}

function normalizePlayerQuestState(state: Partial<PlayerQuestState> & Pick<PlayerQuestState, "playerId">): PlayerQuestState {
  const playerId = normalizePlayerId(state.playerId);
  const currentDateKey = /^\d{4}-\d{2}-\d{2}$/.test(state.currentDateKey?.trim() ?? "")
    ? state.currentDateKey?.trim()
    : undefined;
  const activeQuestIds = Array.from(
    new Set(
      (state.activeQuestIds ?? [])
        .map((questId) => questId?.trim())
        .filter((questId): questId is string => Boolean(questId))
    )
  );
  const rotations = (state.rotations ?? [])
    .map((entry) => {
      const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(entry?.dateKey?.trim() ?? "") ? entry.dateKey.trim() : null;
      if (!dateKey) {
        return null;
      }

      const normalizeQuestIds = (questIds?: string[] | null) =>
        Array.from(new Set((questIds ?? []).map((questId) => questId?.trim()).filter((questId): questId is string => Boolean(questId))));

      return {
        dateKey,
        questIds: normalizeQuestIds(entry.questIds),
        completedQuestIds: normalizeQuestIds(entry.completedQuestIds),
        claimedQuestIds: normalizeQuestIds(entry.claimedQuestIds)
      } satisfies PlayerQuestRotationHistoryEntry;
    })
    .filter((entry): entry is PlayerQuestRotationHistoryEntry => Boolean(entry))
    .sort((left, right) => left.dateKey.localeCompare(right.dateKey));

  return {
    playerId,
    ...(currentDateKey ? { currentDateKey } : {}),
    activeQuestIds,
    rotations,
    updatedAt: formatTimestamp(state.updatedAt) ?? new Date().toISOString()
  };
}

function toPlayerQuestState(row: PlayerQuestStateRow): PlayerQuestState {
  const updatedAt = formatTimestamp(row.updated_at);
  return normalizePlayerQuestState({
    playerId: row.player_id,
    ...(row.current_date_key ? { currentDateKey: row.current_date_key } : {}),
    activeQuestIds:
      row.active_quest_ids_json != null ? parseJsonColumn<string[]>(row.active_quest_ids_json) : [],
    rotations: row.rotations_json != null ? parseJsonColumn<PlayerQuestRotationHistoryEntry[]>(row.rotations_json) : [],
    ...(updatedAt ? { updatedAt } : {})
  });
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
    vision: archivedHero.vision,
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
  const password = readRuntimeSecret("VEIL_MYSQL_PASSWORD", env);
  if (!host || !user || !password) {
    return null;
  }

  return {
    host,
    port: Number(env.VEIL_MYSQL_PORT ?? 3306),
    user,
    password,
    database: env.VEIL_MYSQL_DATABASE ?? MYSQL_DEFAULT_DATABASE,
    pool: {
      connectionLimit: readPositiveInteger(env.VEIL_MYSQL_POOL_CONNECTION_LIMIT, DEFAULT_MYSQL_POOL_CONNECTION_LIMIT),
      maxIdle: readPositiveInteger(env.VEIL_MYSQL_POOL_MAX_IDLE, DEFAULT_MYSQL_POOL_MAX_IDLE),
      idleTimeoutMs: readPositiveInteger(env.VEIL_MYSQL_POOL_IDLE_TIMEOUT_MS, DEFAULT_MYSQL_POOL_IDLE_TIMEOUT_MS),
      queueLimit: readNonNegativeInteger(env.VEIL_MYSQL_POOL_QUEUE_LIMIT, DEFAULT_MYSQL_POOL_QUEUE_LIMIT),
      waitForConnections: readBooleanFlag(
        env.VEIL_MYSQL_POOL_WAIT_FOR_CONNECTIONS,
        DEFAULT_MYSQL_POOL_WAIT_FOR_CONNECTIONS
      )
    },
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
  elo_rating INT NOT NULL DEFAULT 1000,
  rank_division VARCHAR(32) NULL,
  peak_rank_division VARCHAR(32) NULL,
  promotion_series_json LONGTEXT NULL,
  demotion_shield_json LONGTEXT NULL,
  season_history_json LONGTEXT NULL,
  ranked_weekly_progress_json LONGTEXT NULL,
  gems INT NOT NULL DEFAULT 0,
  season_xp INT NOT NULL DEFAULT 0,
  season_pass_tier INT NOT NULL DEFAULT 1,
  season_pass_premium TINYINT(1) NOT NULL DEFAULT 0,
  season_pass_claimed_tiers_json LONGTEXT NULL,
  season_badges_json LONGTEXT NULL,
  campaign_progress_json LONGTEXT NULL,
  seasonal_event_states_json LONGTEXT NULL,
  mailbox_json LONGTEXT NULL,
  global_resources_json LONGTEXT NOT NULL,
  achievements_json LONGTEXT NULL,
  recent_event_log_json LONGTEXT NULL,
  recent_battle_replays_json LONGTEXT NULL,
  daily_dungeon_state_json LONGTEXT NULL,
  leaderboard_abuse_state_json LONGTEXT NULL,
  leaderboard_moderation_state_json LONGTEXT NULL,
  tutorial_step INT NULL DEFAULT NULL,
  last_room_id VARCHAR(191) NULL,
  last_seen_at DATETIME NULL DEFAULT NULL,
  login_id VARCHAR(40) NULL,
  age_verified TINYINT(1) NOT NULL DEFAULT 0,
  is_minor TINYINT(1) NOT NULL DEFAULT 0,
  daily_play_minutes INT NOT NULL DEFAULT 0,
  last_play_date DATE NULL DEFAULT NULL,
  login_streak INT NOT NULL DEFAULT 0,
  ban_status VARCHAR(16) NOT NULL DEFAULT 'none',
  ban_expiry DATETIME NULL DEFAULT NULL,
  ban_reason VARCHAR(512) NULL,
  wechat_open_id VARCHAR(191) NULL,
  wechat_union_id VARCHAR(191) NULL,
  wechat_mini_game_open_id VARCHAR(191) NULL,
  wechat_mini_game_union_id VARCHAR(191) NULL,
  wechat_mini_game_bound_at DATETIME NULL DEFAULT NULL,
  guest_migrated_to_player_id VARCHAR(191) NULL,
  password_hash VARCHAR(255) NULL,
  credential_bound_at DATETIME NULL DEFAULT NULL,
  privacy_consent_at DATETIME NULL DEFAULT NULL,
  phone_number VARCHAR(32) NULL,
  phone_number_bound_at DATETIME NULL DEFAULT NULL,
  notification_preferences_json LONGTEXT NULL,
  push_tokens_json LONGTEXT NULL,
  version BIGINT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_GEM_LEDGER_TABLE}\` (
  entry_id VARCHAR(191) NOT NULL,
  player_id VARCHAR(191) NOT NULL,
  delta INT NOT NULL,
  reason VARCHAR(16) NOT NULL,
  ref_id VARCHAR(191) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_SEASON_REWARD_LOG_TABLE}\` (
  season_id VARCHAR(64) NOT NULL,
  player_id VARCHAR(64) NOT NULL,
  gems INT NOT NULL,
  badge VARCHAR(64) NOT NULL,
  distributed_at DATETIME NOT NULL,
  PRIMARY KEY (season_id, player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_REFERRAL_TABLE}\` (
  id VARCHAR(191) NOT NULL,
  referrer_id VARCHAR(191) NOT NULL,
  new_player_id VARCHAR(191) NOT NULL,
  reward_gems INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY \`uidx_referrals_referrer_new_player\` (referrer_id, new_player_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_SHOP_PURCHASE_TABLE}\` (
  player_id VARCHAR(191) NOT NULL,
  purchase_id VARCHAR(191) NOT NULL,
  product_id VARCHAR(191) NOT NULL,
  quantity INT NOT NULL,
  unit_price INT NOT NULL,
  total_price INT NOT NULL,
  result_json LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (player_id, purchase_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_PAYMENT_ORDER_TABLE}\` (
  order_id VARCHAR(191) NOT NULL,
  player_id VARCHAR(191) NOT NULL,
  product_id VARCHAR(191) NOT NULL,
  wechat_order_id VARCHAR(191) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'created',
  amount INT NOT NULL,
  gem_amount INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at DATETIME NULL DEFAULT NULL,
  last_grant_attempt_at DATETIME NULL DEFAULT NULL,
  next_grant_retry_at DATETIME NULL DEFAULT NULL,
  settled_at DATETIME NULL DEFAULT NULL,
  dead_lettered_at DATETIME NULL DEFAULT NULL,
  grant_attempt_count INT NOT NULL DEFAULT 0,
  last_grant_error VARCHAR(512) NULL DEFAULT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_PAYMENT_RECEIPT_TABLE}\` (
  transaction_id VARCHAR(191) NOT NULL,
  order_id VARCHAR(191) NOT NULL,
  player_id VARCHAR(191) NOT NULL,
  product_id VARCHAR(191) NOT NULL,
  amount INT NOT NULL,
  verified_at DATETIME NOT NULL,
  PRIMARY KEY (transaction_id),
  UNIQUE KEY \`${MYSQL_PAYMENT_RECEIPT_ORDER_ID_INDEX}\` (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\` (
  player_id VARCHAR(191) NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  provider VARCHAR(64) NULL,
  device_label VARCHAR(191) NULL,
  refresh_token_hash VARCHAR(255) NOT NULL,
  refresh_token_expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NOT NULL,
  PRIMARY KEY (session_id),
  KEY \`${MYSQL_PLAYER_ACCOUNT_SESSION_PLAYER_LAST_USED_INDEX}\` (player_id, last_used_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_BAN_HISTORY_TABLE}\` (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  player_id VARCHAR(191) NOT NULL,
  action VARCHAR(16) NOT NULL,
  ban_status VARCHAR(16) NOT NULL,
  ban_expiry DATETIME NULL DEFAULT NULL,
  ban_reason VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_COMPENSATION_HISTORY_TABLE}\` (
  audit_id VARCHAR(191) NOT NULL,
  player_id VARCHAR(191) NOT NULL,
  type VARCHAR(16) NOT NULL,
  currency VARCHAR(16) NOT NULL,
  amount INT NOT NULL,
  reason VARCHAR(512) NOT NULL,
  previous_balance INT NOT NULL,
  balance_after INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (audit_id)
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

CREATE TABLE IF NOT EXISTS \`${MYSQL_PLAYER_REPORT_TABLE}\` (
  report_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reporter_id VARCHAR(191) NOT NULL,
  target_id VARCHAR(191) NOT NULL,
  reason VARCHAR(32) NOT NULL,
  description VARCHAR(512) NULL,
  room_id VARCHAR(191) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  resolved_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (report_id),
  UNIQUE KEY \`${MYSQL_PLAYER_REPORT_ROOM_REPORTER_TARGET_INDEX}\` (room_id, reporter_id, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\` (
  room_id VARCHAR(191) NOT NULL,
  battle_id VARCHAR(191) NOT NULL,
  hero_id VARCHAR(191) NOT NULL,
  attacker_player_id VARCHAR(191) NOT NULL,
  defender_player_id VARCHAR(191) NULL,
  defender_hero_id VARCHAR(191) NULL,
  neutral_army_id VARCHAR(191) NULL,
  encounter_kind VARCHAR(16) NOT NULL,
  initiator VARCHAR(16) NULL,
  path_json LONGTEXT NOT NULL,
  move_cost INT NOT NULL,
  player_ids_json LONGTEXT NOT NULL,
  initial_state_json LONGTEXT NOT NULL,
  estimated_compensation_grant_json LONGTEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  result VARCHAR(32) NULL,
  resolution_reason VARCHAR(64) NULL,
  compensation_json LONGTEXT NULL,
  started_at DATETIME NOT NULL,
  resolved_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, battle_id)
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

SET @veil_player_reports_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_REPORT_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_REPORT_STATUS_CREATED_INDEX}'
);

SET @veil_player_reports_idx_sql := IF(
  @veil_player_reports_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PLAYER_REPORT_STATUS_CREATED_INDEX}\` ON \`${MYSQL_PLAYER_REPORT_TABLE}\` (status, created_at DESC)',
  'SELECT 1'
);

PREPARE veil_player_reports_idx_stmt FROM @veil_player_reports_idx_sql;
EXECUTE veil_player_reports_idx_stmt;
DEALLOCATE PREPARE veil_player_reports_idx_stmt;

SET @veil_battle_snapshots_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_BATTLE_SNAPSHOT_TABLE}'
    AND INDEX_NAME = '${MYSQL_BATTLE_SNAPSHOT_STATUS_UPDATED_INDEX}'
);

SET @veil_battle_snapshots_idx_sql := IF(
  @veil_battle_snapshots_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_BATTLE_SNAPSHOT_STATUS_UPDATED_INDEX}\` ON \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\` (status, updated_at DESC)',
  'SELECT 1'
);

PREPARE veil_battle_snapshots_idx_stmt FROM @veil_battle_snapshots_idx_sql;
EXECUTE veil_battle_snapshots_idx_stmt;
DEALLOCATE PREPARE veil_battle_snapshots_idx_stmt;

SET @veil_player_referrals_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_REFERRAL_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_REFERRAL_REFERRER_CREATED_INDEX}'
);

SET @veil_player_referrals_idx_sql := IF(
  @veil_player_referrals_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PLAYER_REFERRAL_REFERRER_CREATED_INDEX}\` ON \`${MYSQL_PLAYER_REFERRAL_TABLE}\` (referrer_id, created_at DESC)',
  'SELECT 1'
);

PREPARE veil_player_referrals_idx_stmt FROM @veil_player_referrals_idx_sql;
EXECUTE veil_player_referrals_idx_stmt;
DEALLOCATE PREPARE veil_player_referrals_idx_stmt;

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

SET @veil_player_accounts_elo_rating_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'elo_rating'
);

SET @veil_player_accounts_elo_rating_sql := IF(
  @veil_player_accounts_elo_rating_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`elo_rating\` INT NOT NULL DEFAULT 1000 AFTER \`avatar_url\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_elo_rating_stmt FROM @veil_player_accounts_elo_rating_sql;
EXECUTE veil_player_accounts_elo_rating_stmt;
DEALLOCATE PREPARE veil_player_accounts_elo_rating_stmt;

SET @veil_player_accounts_rank_division_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'rank_division'
);

SET @veil_player_accounts_rank_division_sql := IF(
  @veil_player_accounts_rank_division_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`rank_division\` VARCHAR(32) NULL AFTER \`elo_rating\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_rank_division_stmt FROM @veil_player_accounts_rank_division_sql;
EXECUTE veil_player_accounts_rank_division_stmt;
DEALLOCATE PREPARE veil_player_accounts_rank_division_stmt;

SET @veil_player_accounts_peak_rank_division_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'peak_rank_division'
);

SET @veil_player_accounts_peak_rank_division_sql := IF(
  @veil_player_accounts_peak_rank_division_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`peak_rank_division\` VARCHAR(32) NULL AFTER \`rank_division\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_peak_rank_division_stmt FROM @veil_player_accounts_peak_rank_division_sql;
EXECUTE veil_player_accounts_peak_rank_division_stmt;
DEALLOCATE PREPARE veil_player_accounts_peak_rank_division_stmt;

SET @veil_player_accounts_promotion_series_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'promotion_series_json'
);

SET @veil_player_accounts_promotion_series_sql := IF(
  @veil_player_accounts_promotion_series_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`promotion_series_json\` LONGTEXT NULL AFTER \`peak_rank_division\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_promotion_series_stmt FROM @veil_player_accounts_promotion_series_sql;
EXECUTE veil_player_accounts_promotion_series_stmt;
DEALLOCATE PREPARE veil_player_accounts_promotion_series_stmt;

SET @veil_player_accounts_demotion_shield_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'demotion_shield_json'
);

SET @veil_player_accounts_demotion_shield_sql := IF(
  @veil_player_accounts_demotion_shield_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`demotion_shield_json\` LONGTEXT NULL AFTER \`promotion_series_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_demotion_shield_stmt FROM @veil_player_accounts_demotion_shield_sql;
EXECUTE veil_player_accounts_demotion_shield_stmt;
DEALLOCATE PREPARE veil_player_accounts_demotion_shield_stmt;

SET @veil_player_accounts_season_history_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'season_history_json'
);

SET @veil_player_accounts_season_history_sql := IF(
  @veil_player_accounts_season_history_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`season_history_json\` LONGTEXT NULL AFTER \`demotion_shield_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_season_history_stmt FROM @veil_player_accounts_season_history_sql;
EXECUTE veil_player_accounts_season_history_stmt;
DEALLOCATE PREPARE veil_player_accounts_season_history_stmt;

SET @veil_player_accounts_ranked_weekly_progress_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'ranked_weekly_progress_json'
);

SET @veil_player_accounts_ranked_weekly_progress_sql := IF(
  @veil_player_accounts_ranked_weekly_progress_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`ranked_weekly_progress_json\` LONGTEXT NULL AFTER \`season_history_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_ranked_weekly_progress_stmt FROM @veil_player_accounts_ranked_weekly_progress_sql;
EXECUTE veil_player_accounts_ranked_weekly_progress_stmt;
DEALLOCATE PREPARE veil_player_accounts_ranked_weekly_progress_stmt;

SET @veil_player_accounts_gems_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'gems'
);

SET @veil_player_accounts_gems_sql := IF(
  @veil_player_accounts_gems_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`gems\` INT NOT NULL DEFAULT 0 AFTER \`elo_rating\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_gems_stmt FROM @veil_player_accounts_gems_sql;
EXECUTE veil_player_accounts_gems_stmt;
DEALLOCATE PREPARE veil_player_accounts_gems_stmt;

SET @veil_player_accounts_season_badges_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'season_badges_json'
);

SET @veil_player_accounts_season_badges_sql := IF(
  @veil_player_accounts_season_badges_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`season_badges_json\` LONGTEXT NULL AFTER \`gems\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_season_badges_stmt FROM @veil_player_accounts_season_badges_sql;
EXECUTE veil_player_accounts_season_badges_stmt;
DEALLOCATE PREPARE veil_player_accounts_season_badges_stmt;

SET @veil_player_accounts_campaign_progress_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'campaign_progress_json'
);

SET @veil_player_accounts_campaign_progress_sql := IF(
  @veil_player_accounts_campaign_progress_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`campaign_progress_json\` LONGTEXT NULL AFTER \`season_badges_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_campaign_progress_stmt FROM @veil_player_accounts_campaign_progress_sql;
EXECUTE veil_player_accounts_campaign_progress_stmt;
DEALLOCATE PREPARE veil_player_accounts_campaign_progress_stmt;

SET @veil_player_accounts_seasonal_event_states_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'seasonal_event_states_json'
);
SET @veil_player_accounts_seasonal_event_states_sql := IF(
  @veil_player_accounts_seasonal_event_states_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`seasonal_event_states_json\` LONGTEXT NULL AFTER \`campaign_progress_json\`',
  'SELECT 1'
);
PREPARE veil_player_accounts_seasonal_event_states_stmt FROM @veil_player_accounts_seasonal_event_states_sql;
EXECUTE veil_player_accounts_seasonal_event_states_stmt;
DEALLOCATE PREPARE veil_player_accounts_seasonal_event_states_stmt;

SET @veil_player_accounts_mailbox_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'mailbox_json'
);
SET @veil_player_accounts_mailbox_sql := IF(
  @veil_player_accounts_mailbox_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`mailbox_json\` LONGTEXT NULL AFTER \`seasonal_event_states_json\`',
  'SELECT 1'
);
PREPARE veil_player_accounts_mailbox_stmt FROM @veil_player_accounts_mailbox_sql;
EXECUTE veil_player_accounts_mailbox_stmt;
DEALLOCATE PREPARE veil_player_accounts_mailbox_stmt;

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

SET @veil_player_accounts_daily_dungeon_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'daily_dungeon_state_json'
);

SET @veil_player_accounts_daily_dungeon_sql := IF(
  @veil_player_accounts_daily_dungeon_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`daily_dungeon_state_json\` LONGTEXT NULL AFTER \`recent_battle_replays_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_daily_dungeon_stmt FROM @veil_player_accounts_daily_dungeon_sql;
EXECUTE veil_player_accounts_daily_dungeon_stmt;
DEALLOCATE PREPARE veil_player_accounts_daily_dungeon_stmt;

SET @veil_player_accounts_leaderboard_abuse_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'leaderboard_abuse_state_json'
);

SET @veil_player_accounts_leaderboard_abuse_sql := IF(
  @veil_player_accounts_leaderboard_abuse_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`leaderboard_abuse_state_json\` LONGTEXT NULL AFTER \`daily_dungeon_state_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_leaderboard_abuse_stmt FROM @veil_player_accounts_leaderboard_abuse_sql;
EXECUTE veil_player_accounts_leaderboard_abuse_stmt;
DEALLOCATE PREPARE veil_player_accounts_leaderboard_abuse_stmt;

SET @veil_player_accounts_leaderboard_moderation_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'leaderboard_moderation_state_json'
);

SET @veil_player_accounts_leaderboard_moderation_sql := IF(
  @veil_player_accounts_leaderboard_moderation_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`leaderboard_moderation_state_json\` LONGTEXT NULL AFTER \`leaderboard_abuse_state_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_leaderboard_moderation_stmt FROM @veil_player_accounts_leaderboard_moderation_sql;
EXECUTE veil_player_accounts_leaderboard_moderation_stmt;
DEALLOCATE PREPARE veil_player_accounts_leaderboard_moderation_stmt;

SET @veil_player_accounts_tutorial_step_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'tutorial_step'
);

SET @veil_player_accounts_tutorial_step_sql := IF(
  @veil_player_accounts_tutorial_step_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`tutorial_step\` INT NULL DEFAULT NULL AFTER \`daily_dungeon_state_json\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_tutorial_step_stmt FROM @veil_player_accounts_tutorial_step_sql;
EXECUTE veil_player_accounts_tutorial_step_stmt;
DEALLOCATE PREPARE veil_player_accounts_tutorial_step_stmt;

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

SET @veil_player_accounts_age_verified_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'age_verified'
);

SET @veil_player_accounts_age_verified_sql := IF(
  @veil_player_accounts_age_verified_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`age_verified\` TINYINT(1) NOT NULL DEFAULT 0 AFTER \`login_id\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_age_verified_stmt FROM @veil_player_accounts_age_verified_sql;
EXECUTE veil_player_accounts_age_verified_stmt;
DEALLOCATE PREPARE veil_player_accounts_age_verified_stmt;

SET @veil_player_accounts_is_minor_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'is_minor'
);

SET @veil_player_accounts_is_minor_sql := IF(
  @veil_player_accounts_is_minor_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`is_minor\` TINYINT(1) NOT NULL DEFAULT 0 AFTER \`age_verified\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_is_minor_stmt FROM @veil_player_accounts_is_minor_sql;
EXECUTE veil_player_accounts_is_minor_stmt;
DEALLOCATE PREPARE veil_player_accounts_is_minor_stmt;

SET @veil_player_accounts_daily_play_minutes_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'daily_play_minutes'
);

SET @veil_player_accounts_daily_play_minutes_sql := IF(
  @veil_player_accounts_daily_play_minutes_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`daily_play_minutes\` INT NOT NULL DEFAULT 0 AFTER \`is_minor\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_daily_play_minutes_stmt FROM @veil_player_accounts_daily_play_minutes_sql;
EXECUTE veil_player_accounts_daily_play_minutes_stmt;
DEALLOCATE PREPARE veil_player_accounts_daily_play_minutes_stmt;

SET @veil_player_accounts_last_play_date_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'last_play_date'
);

SET @veil_player_accounts_last_play_date_sql := IF(
  @veil_player_accounts_last_play_date_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`last_play_date\` DATE NULL DEFAULT NULL AFTER \`daily_play_minutes\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_last_play_date_stmt FROM @veil_player_accounts_last_play_date_sql;
EXECUTE veil_player_accounts_last_play_date_stmt;
DEALLOCATE PREPARE veil_player_accounts_last_play_date_stmt;

SET @veil_player_accounts_login_streak_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'login_streak'
);

SET @veil_player_accounts_login_streak_sql := IF(
  @veil_player_accounts_login_streak_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`login_streak\` INT NOT NULL DEFAULT 0 AFTER \`last_play_date\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_login_streak_stmt FROM @veil_player_accounts_login_streak_sql;
EXECUTE veil_player_accounts_login_streak_stmt;
DEALLOCATE PREPARE veil_player_accounts_login_streak_stmt;

SET @veil_player_accounts_ban_status_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'ban_status'
);

SET @veil_player_accounts_ban_status_sql := IF(
  @veil_player_accounts_ban_status_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`ban_status\` VARCHAR(16) NOT NULL DEFAULT ''none'' AFTER \`login_id\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_ban_status_stmt FROM @veil_player_accounts_ban_status_sql;
EXECUTE veil_player_accounts_ban_status_stmt;
DEALLOCATE PREPARE veil_player_accounts_ban_status_stmt;

SET @veil_player_accounts_ban_expiry_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'ban_expiry'
);

SET @veil_player_accounts_ban_expiry_sql := IF(
  @veil_player_accounts_ban_expiry_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`ban_expiry\` DATETIME NULL DEFAULT NULL AFTER \`ban_status\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_ban_expiry_stmt FROM @veil_player_accounts_ban_expiry_sql;
EXECUTE veil_player_accounts_ban_expiry_stmt;
DEALLOCATE PREPARE veil_player_accounts_ban_expiry_stmt;

SET @veil_player_accounts_ban_reason_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'ban_reason'
);

SET @veil_player_accounts_ban_reason_sql := IF(
  @veil_player_accounts_ban_reason_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`ban_reason\` VARCHAR(512) NULL AFTER \`ban_expiry\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_ban_reason_stmt FROM @veil_player_accounts_ban_reason_sql;
EXECUTE veil_player_accounts_ban_reason_stmt;
DEALLOCATE PREPARE veil_player_accounts_ban_reason_stmt;

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

SET @veil_player_accounts_privacy_consent_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'privacy_consent_at'
);

SET @veil_player_accounts_privacy_consent_sql := IF(
  @veil_player_accounts_privacy_consent_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`privacy_consent_at\` DATETIME NULL DEFAULT NULL AFTER \`credential_bound_at\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_privacy_consent_stmt FROM @veil_player_accounts_privacy_consent_sql;
EXECUTE veil_player_accounts_privacy_consent_stmt;
DEALLOCATE PREPARE veil_player_accounts_privacy_consent_stmt;

SET @veil_player_accounts_phone_number_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'phone_number'
);

SET @veil_player_accounts_phone_number_sql := IF(
  @veil_player_accounts_phone_number_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`phone_number\` VARCHAR(32) NULL AFTER \`privacy_consent_at\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_phone_number_stmt FROM @veil_player_accounts_phone_number_sql;
EXECUTE veil_player_accounts_phone_number_stmt;
DEALLOCATE PREPARE veil_player_accounts_phone_number_stmt;

SET @veil_player_accounts_phone_number_bound_at_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'phone_number_bound_at'
);

SET @veil_player_accounts_phone_number_bound_at_sql := IF(
  @veil_player_accounts_phone_number_bound_at_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`phone_number_bound_at\` DATETIME NULL DEFAULT NULL AFTER \`phone_number\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_phone_number_bound_at_stmt FROM @veil_player_accounts_phone_number_bound_at_sql;
EXECUTE veil_player_accounts_phone_number_bound_at_stmt;
DEALLOCATE PREPARE veil_player_accounts_phone_number_bound_at_stmt;

SET @veil_player_accounts_wechat_idp_open_id_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'wechat_open_id'
);

SET @veil_player_accounts_wechat_idp_open_id_sql := IF(
  @veil_player_accounts_wechat_idp_open_id_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`wechat_open_id\` VARCHAR(191) NULL AFTER \`password_hash\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_wechat_idp_open_id_stmt FROM @veil_player_accounts_wechat_idp_open_id_sql;
EXECUTE veil_player_accounts_wechat_idp_open_id_stmt;
DEALLOCATE PREPARE veil_player_accounts_wechat_idp_open_id_stmt;

SET @veil_player_accounts_wechat_idp_union_id_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'wechat_union_id'
);

SET @veil_player_accounts_wechat_idp_union_id_sql := IF(
  @veil_player_accounts_wechat_idp_union_id_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`wechat_union_id\` VARCHAR(191) NULL AFTER \`wechat_open_id\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_wechat_idp_union_id_stmt FROM @veil_player_accounts_wechat_idp_union_id_sql;
EXECUTE veil_player_accounts_wechat_idp_union_id_stmt;
DEALLOCATE PREPARE veil_player_accounts_wechat_idp_union_id_stmt;

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

SET @veil_player_accounts_guest_migrated_to_player_id_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND COLUMN_NAME = 'guest_migrated_to_player_id'
);

SET @veil_player_accounts_guest_migrated_to_player_id_sql := IF(
  @veil_player_accounts_guest_migrated_to_player_id_exists = 0,
  'ALTER TABLE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` ADD COLUMN \`guest_migrated_to_player_id\` VARCHAR(191) NULL AFTER \`wechat_mini_game_bound_at\`',
  'SELECT 1'
);

PREPARE veil_player_accounts_guest_migrated_to_player_id_stmt FROM @veil_player_accounts_guest_migrated_to_player_id_sql;
EXECUTE veil_player_accounts_guest_migrated_to_player_id_stmt;
DEALLOCATE PREPARE veil_player_accounts_guest_migrated_to_player_id_stmt;

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

SET @veil_player_accounts_wechat_idp_open_id_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_ACCOUNT_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_ACCOUNT_WECHAT_IDP_OPEN_ID_INDEX}'
);

SET @veil_player_accounts_wechat_idp_open_id_idx_sql := IF(
  @veil_player_accounts_wechat_idp_open_id_idx_exists = 0,
  'CREATE UNIQUE INDEX \`${MYSQL_PLAYER_ACCOUNT_WECHAT_IDP_OPEN_ID_INDEX}\` ON \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (wechat_open_id)',
  'SELECT 1'
);

PREPARE veil_player_accounts_wechat_idp_open_id_idx_stmt FROM @veil_player_accounts_wechat_idp_open_id_idx_sql;
EXECUTE veil_player_accounts_wechat_idp_open_id_idx_stmt;
DEALLOCATE PREPARE veil_player_accounts_wechat_idp_open_id_idx_stmt;

SET @veil_gem_ledger_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_GEM_LEDGER_TABLE}'
    AND INDEX_NAME = '${MYSQL_GEM_LEDGER_PLAYER_CREATED_INDEX}'
);

SET @veil_gem_ledger_idx_sql := IF(
  @veil_gem_ledger_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_GEM_LEDGER_PLAYER_CREATED_INDEX}\` ON \`${MYSQL_GEM_LEDGER_TABLE}\` (player_id, created_at DESC)',
  'SELECT 1'
);

PREPARE veil_gem_ledger_idx_stmt FROM @veil_gem_ledger_idx_sql;
EXECUTE veil_gem_ledger_idx_stmt;
DEALLOCATE PREPARE veil_gem_ledger_idx_stmt;

SET @veil_payment_orders_player_created_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PAYMENT_ORDER_TABLE}'
    AND INDEX_NAME = '${MYSQL_PAYMENT_ORDER_PLAYER_CREATED_INDEX}'
);

SET @veil_payment_orders_player_created_idx_sql := IF(
  @veil_payment_orders_player_created_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PAYMENT_ORDER_PLAYER_CREATED_INDEX}\` ON \`${MYSQL_PAYMENT_ORDER_TABLE}\` (player_id, created_at DESC)',
  'SELECT 1'
);

PREPARE veil_payment_orders_player_created_idx_stmt FROM @veil_payment_orders_player_created_idx_sql;
EXECUTE veil_payment_orders_player_created_idx_stmt;
DEALLOCATE PREPARE veil_payment_orders_player_created_idx_stmt;

SET @veil_payment_orders_wechat_order_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PAYMENT_ORDER_TABLE}'
    AND INDEX_NAME = '${MYSQL_PAYMENT_ORDER_WECHAT_ORDER_ID_INDEX}'
);

SET @veil_payment_orders_wechat_order_idx_sql := IF(
  @veil_payment_orders_wechat_order_idx_exists = 0,
  'CREATE UNIQUE INDEX \`${MYSQL_PAYMENT_ORDER_WECHAT_ORDER_ID_INDEX}\` ON \`${MYSQL_PAYMENT_ORDER_TABLE}\` (wechat_order_id)',
  'SELECT 1'
);

PREPARE veil_payment_orders_wechat_order_idx_stmt FROM @veil_payment_orders_wechat_order_idx_sql;
EXECUTE veil_payment_orders_wechat_order_idx_stmt;
DEALLOCATE PREPARE veil_payment_orders_wechat_order_idx_stmt;

SET @veil_payment_orders_last_grant_attempt_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PAYMENT_ORDER_TABLE}'
    AND COLUMN_NAME = 'last_grant_attempt_at'
);

SET @veil_payment_orders_last_grant_attempt_sql := IF(
  @veil_payment_orders_last_grant_attempt_exists = 0,
  'ALTER TABLE \`${MYSQL_PAYMENT_ORDER_TABLE}\` ADD COLUMN \`last_grant_attempt_at\` DATETIME NULL DEFAULT NULL AFTER \`paid_at\`',
  'SELECT 1'
);

PREPARE veil_payment_orders_last_grant_attempt_stmt FROM @veil_payment_orders_last_grant_attempt_sql;
EXECUTE veil_payment_orders_last_grant_attempt_stmt;
DEALLOCATE PREPARE veil_payment_orders_last_grant_attempt_stmt;

SET @veil_payment_orders_next_grant_retry_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PAYMENT_ORDER_TABLE}'
    AND COLUMN_NAME = 'next_grant_retry_at'
);

SET @veil_payment_orders_next_grant_retry_sql := IF(
  @veil_payment_orders_next_grant_retry_exists = 0,
  'ALTER TABLE \`${MYSQL_PAYMENT_ORDER_TABLE}\` ADD COLUMN \`next_grant_retry_at\` DATETIME NULL DEFAULT NULL AFTER \`last_grant_attempt_at\`',
  'SELECT 1'
);

PREPARE veil_payment_orders_next_grant_retry_stmt FROM @veil_payment_orders_next_grant_retry_sql;
EXECUTE veil_payment_orders_next_grant_retry_stmt;
DEALLOCATE PREPARE veil_payment_orders_next_grant_retry_stmt;

SET @veil_payment_orders_settled_at_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PAYMENT_ORDER_TABLE}'
    AND COLUMN_NAME = 'settled_at'
);

SET @veil_payment_orders_settled_at_sql := IF(
  @veil_payment_orders_settled_at_exists = 0,
  'ALTER TABLE \`${MYSQL_PAYMENT_ORDER_TABLE}\` ADD COLUMN \`settled_at\` DATETIME NULL DEFAULT NULL AFTER \`next_grant_retry_at\`',
  'SELECT 1'
);

PREPARE veil_payment_orders_settled_at_stmt FROM @veil_payment_orders_settled_at_sql;
EXECUTE veil_payment_orders_settled_at_stmt;
DEALLOCATE PREPARE veil_payment_orders_settled_at_stmt;

SET @veil_payment_orders_dead_lettered_at_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PAYMENT_ORDER_TABLE}'
    AND COLUMN_NAME = 'dead_lettered_at'
);

SET @veil_payment_orders_dead_lettered_at_sql := IF(
  @veil_payment_orders_dead_lettered_at_exists = 0,
  'ALTER TABLE \`${MYSQL_PAYMENT_ORDER_TABLE}\` ADD COLUMN \`dead_lettered_at\` DATETIME NULL DEFAULT NULL AFTER \`settled_at\`',
  'SELECT 1'
);

PREPARE veil_payment_orders_dead_lettered_at_stmt FROM @veil_payment_orders_dead_lettered_at_sql;
EXECUTE veil_payment_orders_dead_lettered_at_stmt;
DEALLOCATE PREPARE veil_payment_orders_dead_lettered_at_stmt;

SET @veil_payment_orders_grant_attempt_count_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PAYMENT_ORDER_TABLE}'
    AND COLUMN_NAME = 'grant_attempt_count'
);

SET @veil_payment_orders_grant_attempt_count_sql := IF(
  @veil_payment_orders_grant_attempt_count_exists = 0,
  'ALTER TABLE \`${MYSQL_PAYMENT_ORDER_TABLE}\` ADD COLUMN \`grant_attempt_count\` INT NOT NULL DEFAULT 0 AFTER \`dead_lettered_at\`',
  'SELECT 1'
);

PREPARE veil_payment_orders_grant_attempt_count_stmt FROM @veil_payment_orders_grant_attempt_count_sql;
EXECUTE veil_payment_orders_grant_attempt_count_stmt;
DEALLOCATE PREPARE veil_payment_orders_grant_attempt_count_stmt;

SET @veil_payment_orders_last_grant_error_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PAYMENT_ORDER_TABLE}'
    AND COLUMN_NAME = 'last_grant_error'
);

SET @veil_payment_orders_last_grant_error_sql := IF(
  @veil_payment_orders_last_grant_error_exists = 0,
  'ALTER TABLE \`${MYSQL_PAYMENT_ORDER_TABLE}\` ADD COLUMN \`last_grant_error\` VARCHAR(512) NULL DEFAULT NULL AFTER \`grant_attempt_count\`',
  'SELECT 1'
);

PREPARE veil_payment_orders_last_grant_error_stmt FROM @veil_payment_orders_last_grant_error_sql;
EXECUTE veil_payment_orders_last_grant_error_stmt;
DEALLOCATE PREPARE veil_payment_orders_last_grant_error_stmt;

UPDATE \`${MYSQL_PAYMENT_ORDER_TABLE}\`
SET status = 'created'
WHERE status = 'pending';

UPDATE \`${MYSQL_PAYMENT_ORDER_TABLE}\`
SET status = 'settled',
    settled_at = COALESCE(settled_at, paid_at, updated_at),
    grant_attempt_count = CASE WHEN grant_attempt_count <= 0 THEN 1 ELSE grant_attempt_count END,
    last_grant_attempt_at = COALESCE(last_grant_attempt_at, paid_at, updated_at),
    next_grant_retry_at = NULL,
    last_grant_error = NULL
WHERE status = 'paid';

SET @veil_payment_orders_status_retry_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PAYMENT_ORDER_TABLE}'
    AND INDEX_NAME = '${MYSQL_PAYMENT_ORDER_STATUS_RETRY_INDEX}'
);

SET @veil_payment_orders_status_retry_idx_sql := IF(
  @veil_payment_orders_status_retry_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PAYMENT_ORDER_STATUS_RETRY_INDEX}\` ON \`${MYSQL_PAYMENT_ORDER_TABLE}\` (status, next_grant_retry_at, updated_at DESC)',
  'SELECT 1'
);

PREPARE veil_payment_orders_status_retry_idx_stmt FROM @veil_payment_orders_status_retry_idx_sql;
EXECUTE veil_payment_orders_status_retry_idx_stmt;
DEALLOCATE PREPARE veil_payment_orders_status_retry_idx_stmt;

SET @veil_payment_receipts_player_verified_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PAYMENT_RECEIPT_TABLE}'
    AND INDEX_NAME = '${MYSQL_PAYMENT_RECEIPT_PLAYER_VERIFIED_INDEX}'
);

SET @veil_payment_receipts_player_verified_idx_sql := IF(
  @veil_payment_receipts_player_verified_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PAYMENT_RECEIPT_PLAYER_VERIFIED_INDEX}\` ON \`${MYSQL_PAYMENT_RECEIPT_TABLE}\` (player_id, verified_at DESC)',
  'SELECT 1'
);

PREPARE veil_payment_receipts_player_verified_idx_stmt FROM @veil_payment_receipts_player_verified_idx_sql;
EXECUTE veil_payment_receipts_player_verified_idx_stmt;
DEALLOCATE PREPARE veil_payment_receipts_player_verified_idx_stmt;

SET @veil_player_ban_history_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_BAN_HISTORY_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_BAN_HISTORY_PLAYER_CREATED_INDEX}'
);

SET @veil_player_ban_history_idx_sql := IF(
  @veil_player_ban_history_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PLAYER_BAN_HISTORY_PLAYER_CREATED_INDEX}\` ON \`${MYSQL_PLAYER_BAN_HISTORY_TABLE}\` (player_id, created_at DESC)',
  'SELECT 1'
);

PREPARE veil_player_ban_history_idx_stmt FROM @veil_player_ban_history_idx_sql;
EXECUTE veil_player_ban_history_idx_stmt;
DEALLOCATE PREPARE veil_player_ban_history_idx_stmt;

SET @veil_player_compensation_history_idx_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_PLAYER_COMPENSATION_HISTORY_TABLE}'
    AND INDEX_NAME = '${MYSQL_PLAYER_COMPENSATION_HISTORY_PLAYER_CREATED_INDEX}'
);

SET @veil_player_compensation_history_idx_sql := IF(
  @veil_player_compensation_history_idx_exists = 0,
  'CREATE INDEX \`${MYSQL_PLAYER_COMPENSATION_HISTORY_PLAYER_CREATED_INDEX}\` ON \`${MYSQL_PLAYER_COMPENSATION_HISTORY_TABLE}\` (player_id, created_at DESC)',
  'SELECT 1'
);

PREPARE veil_player_compensation_history_idx_stmt FROM @veil_player_compensation_history_idx_sql;
EXECUTE veil_player_compensation_history_idx_stmt;
DEALLOCATE PREPARE veil_player_compensation_history_idx_stmt;

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

CREATE TABLE IF NOT EXISTS \`${MYSQL_SEASON_TABLE}\` (
  \`season_id\` VARCHAR(64) NOT NULL,
  \`status\` ENUM('active','closed') NOT NULL DEFAULT 'active',
  \`started_at\` DATETIME NOT NULL,
  \`ended_at\` DATETIME NULL,
  \`reward_distributed_at\` DATETIME NULL,
  \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`season_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS \`${MYSQL_LEADERBOARD_SEASON_ARCHIVE_TABLE}\` (
  \`season_id\` VARCHAR(64) NOT NULL,
  \`rank_position\` INT NOT NULL,
  \`player_id\` VARCHAR(64) NOT NULL,
  \`display_name\` VARCHAR(191) NOT NULL,
  \`final_rating\` INT NOT NULL,
  \`tier\` VARCHAR(32) NOT NULL,
  \`archived_at\` DATETIME NOT NULL,
  PRIMARY KEY (\`season_id\`, \`rank_position\`),
  UNIQUE KEY \`uniq_leaderboard_season_archives_player\` (\`season_id\`, \`player_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET @veil_seasons_reward_distributed_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = '${MYSQL_SEASON_TABLE}'
    AND COLUMN_NAME = 'reward_distributed_at'
);

SET @veil_seasons_reward_distributed_sql := IF(
  @veil_seasons_reward_distributed_exists = 0,
  'ALTER TABLE \`${MYSQL_SEASON_TABLE}\` ADD COLUMN \`reward_distributed_at\` DATETIME NULL AFTER \`ended_at\`',
  'SELECT 1'
);

PREPARE veil_seasons_reward_distributed_stmt FROM @veil_seasons_reward_distributed_sql;
EXECUTE veil_seasons_reward_distributed_stmt;
DEALLOCATE PREPARE veil_seasons_reward_distributed_stmt;

CREATE TABLE IF NOT EXISTS \`${MYSQL_SEASON_REWARD_LOG_TABLE}\` (
  \`season_id\` VARCHAR(64) NOT NULL,
  \`player_id\` VARCHAR(64) NOT NULL,
  \`gems\` INT NOT NULL,
  \`badge\` VARCHAR(64) NOT NULL,
  \`distributed_at\` DATETIME NOT NULL,
  PRIMARY KEY (\`season_id\`, \`player_id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
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

function toShopPurchaseResult(row: ShopPurchaseRow): ShopPurchaseResult {
  const result = parseJsonColumn<ShopPurchaseResult>(row.result_json);
  return {
    purchaseId: normalizeShopPurchaseId(result.purchaseId ?? row.purchase_id),
    productId: normalizeShopProductId(result.productId ?? row.product_id),
    quantity: normalizeShopPurchaseQuantity(result.quantity ?? row.quantity),
    unitPrice: normalizePositiveGemDelta(result.unitPrice ?? row.unit_price),
    totalPrice: normalizePositiveGemDelta(result.totalPrice ?? row.total_price),
    granted: {
      gems: normalizeGemAmount(result.granted?.gems),
      resources: normalizeResourceLedger(result.granted?.resources),
      equipmentIds: (result.granted?.equipmentIds ?? []).map((equipmentId) => equipmentId.trim()).filter(Boolean),
      cosmeticIds: (result.granted?.cosmeticIds ?? []).map((cosmeticId) => cosmeticId.trim()).filter(Boolean),
      ...(result.granted?.heroId?.trim() ? { heroId: result.granted.heroId.trim() } : {})
    },
    gemsBalance: normalizeGemAmount(result.gemsBalance),
    processedAt: formatTimestamp(result.processedAt) ?? formatTimestamp(row.created_at) ?? new Date(0).toISOString()
  };
}

function toPlayerPurchaseHistoryRecord(row: ShopPurchaseRow): PlayerPurchaseHistoryRecord {
  const result = toShopPurchaseResult(row);
  return {
    purchaseId: result.purchaseId,
    itemId: result.productId,
    quantity: result.quantity,
    currency: "gems",
    amount: result.totalPrice,
    paymentMethod: "gems",
    grantedAt: result.processedAt,
    status: "completed"
  };
}

function toPlayerAccountSnapshot(row: PlayerAccountRow): PlayerAccountSnapshot {
  const lastSeenAt = formatTimestamp(row.last_seen_at);
  const banExpiry = formatTimestamp(row.ban_expiry);
  const refreshTokenExpiresAt = formatTimestamp(row.refresh_token_expires_at);
  const wechatMiniGameBoundAt = formatTimestamp(row.wechat_mini_game_bound_at);
  const credentialBoundAt = formatTimestamp(row.credential_bound_at);
  const privacyConsentAt = formatTimestamp(row.privacy_consent_at);
  const phoneNumberBoundAt = formatTimestamp(row.phone_number_bound_at);
  const createdAt = formatTimestamp(row.created_at);
  const updatedAt = formatTimestamp(row.updated_at);
  const wechatOpenId = row.wechat_open_id ?? row.wechat_mini_game_open_id;
  const wechatUnionId = row.wechat_union_id ?? row.wechat_mini_game_union_id;

  return normalizePlayerAccountSnapshot({
    playerId: row.player_id,
    ...(row.avatar_url ? { avatarUrl: row.avatar_url } : {}),
    ...(row.elo_rating != null ? { eloRating: row.elo_rating } : {}),
    ...(row.rank_division ? { rankDivision: row.rank_division as PlayerAccountSnapshot["rankDivision"] } : {}),
    ...(row.peak_rank_division ? { peakRankDivision: row.peak_rank_division as PlayerAccountSnapshot["peakRankDivision"] } : {}),
    promotionSeries:
      row.promotion_series_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["promotionSeries"]>>(row.promotion_series_json)
        : undefined,
    demotionShield:
      row.demotion_shield_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["demotionShield"]>>(row.demotion_shield_json)
        : undefined,
    seasonHistory:
      row.season_history_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["seasonHistory"]>>(row.season_history_json)
        : undefined,
    rankedWeeklyProgress:
      row.ranked_weekly_progress_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["rankedWeeklyProgress"]>>(row.ranked_weekly_progress_json)
        : undefined,
    gems: normalizeGemAmount(row.gems),
    seasonXp: Math.max(0, Math.floor(row.season_xp ?? 0)),
    seasonPassTier: Math.max(1, Math.floor(row.season_pass_tier ?? 1)),
    seasonPassPremium: row.season_pass_premium === true || row.season_pass_premium === 1,
    seasonPassClaimedTiers:
      row.season_pass_claimed_tiers_json != null
        ? parseJsonColumn<number[]>(row.season_pass_claimed_tiers_json)
        : [],
    seasonBadges:
      row.season_badges_json != null
        ? parseJsonColumn<string[]>(row.season_badges_json)
        : [],
    campaignProgress:
      row.campaign_progress_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["campaignProgress"]>>(row.campaign_progress_json)
        : undefined,
    seasonalEventStates:
      row.seasonal_event_states_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["seasonalEventStates"]>>(row.seasonal_event_states_json)
        : undefined,
    mailbox:
      row.mailbox_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["mailbox"]>>(row.mailbox_json)
        : undefined,
    cosmeticInventory:
      row.cosmetic_inventory_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["cosmeticInventory"]>>(row.cosmetic_inventory_json)
        : undefined,
    equippedCosmetics:
      row.equipped_cosmetics_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["equippedCosmetics"]>>(row.equipped_cosmetics_json)
        : undefined,
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
    dailyDungeonState:
      row.daily_dungeon_state_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["dailyDungeonState"]>>(row.daily_dungeon_state_json)
        : undefined,
    leaderboardAbuseState:
      row.leaderboard_abuse_state_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["leaderboardAbuseState"]>>(row.leaderboard_abuse_state_json)
        : undefined,
    leaderboardModerationState:
      row.leaderboard_moderation_state_json != null
        ? parseJsonColumn<NonNullable<PlayerAccountSnapshot["leaderboardModerationState"]>>(
            row.leaderboard_moderation_state_json
          )
        : undefined,
    ...(row.tutorial_step != null ? { tutorialStep: row.tutorial_step } : {}),
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.last_room_id ? { lastRoomId: row.last_room_id } : {}),
    ...(row.login_id ? { loginId: row.login_id } : {}),
    ...(normalizePlayerAgeVerified(row.age_verified) !== undefined
      ? { ageVerified: normalizePlayerAgeVerified(row.age_verified) }
      : {}),
    ...(normalizePlayerIsMinor(row.is_minor) !== undefined ? { isMinor: normalizePlayerIsMinor(row.is_minor) } : {}),
    ...(normalizeDailyPlayMinutes(row.daily_play_minutes) > 0
      ? { dailyPlayMinutes: normalizeDailyPlayMinutes(row.daily_play_minutes) }
      : {}),
    ...(normalizeLastPlayDate(row.last_play_date) ? { lastPlayDate: normalizeLastPlayDate(row.last_play_date) } : {}),
    ...(normalizeLoginStreak(row.login_streak) > 0 ? { loginStreak: normalizeLoginStreak(row.login_streak) } : {}),
    banStatus: normalizePlayerBanStatus(row.ban_status),
    ...(banExpiry ? { banExpiry } : {}),
    ...(row.ban_reason ? { banReason: row.ban_reason } : {}),
    ...(row.account_session_version > 0 ? { accountSessionVersion: row.account_session_version } : {}),
    ...(row.refresh_session_id ? { refreshSessionId: row.refresh_session_id } : {}),
    ...(refreshTokenExpiresAt ? { refreshTokenExpiresAt } : {}),
    ...(wechatOpenId ? { wechatMiniGameOpenId: wechatOpenId } : {}),
    ...(wechatUnionId ? { wechatMiniGameUnionId: wechatUnionId } : {}),
    ...(lastSeenAt ? { lastSeenAt } : {}),
    ...(wechatMiniGameBoundAt ? { wechatMiniGameBoundAt } : {}),
    ...(row.guest_migrated_to_player_id ? { guestMigratedToPlayerId: row.guest_migrated_to_player_id } : {}),
    ...(credentialBoundAt ? { credentialBoundAt } : {}),
    ...(privacyConsentAt ? { privacyConsentAt } : {}),
    ...(row.phone_number ? { phoneNumber: row.phone_number } : {}),
    ...(phoneNumberBoundAt ? { phoneNumberBoundAt } : {}),
    ...(row.notification_preferences_json != null
      ? { notificationPreferences: parseJsonColumn<NotificationPreferences>(row.notification_preferences_json) }
      : {}),
    ...(row.push_tokens_json != null
      ? { pushTokens: parseJsonColumn<MobilePushTokenRegistration[]>(row.push_tokens_json) }
      : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {})
  });
}

function toPlayerBanSnapshot(row: Pick<PlayerAccountRow, "player_id" | "ban_status" | "ban_expiry" | "ban_reason">): PlayerAccountBanSnapshot {
  const banStatus = normalizePlayerBanStatus(row.ban_status);
  const banExpiry = formatTimestamp(row.ban_expiry);

  return {
    playerId: normalizePlayerId(row.player_id),
    banStatus,
    ...(banExpiry ? { banExpiry } : {}),
    ...(row.ban_reason ? { banReason: row.ban_reason } : {})
  };
}

function toPlayerAccountAuthSnapshot(row: PlayerAccountAuthRow): PlayerAccountAuthSnapshot | null {
  if (!row.login_id || !row.password_hash) {
    return null;
  }

  const credentialBoundAt = formatTimestamp(row.credential_bound_at);
  const refreshTokenExpiresAt = formatTimestamp(row.refresh_token_expires_at);
  return {
    playerId: normalizePlayerId(row.player_id),
    displayName: normalizePlayerDisplayName(row.player_id, row.display_name),
    loginId: normalizePlayerLoginId(row.login_id),
    passwordHash: row.password_hash,
    accountSessionVersion: Math.max(0, Math.floor(row.account_session_version ?? 0)),
    ...(row.refresh_session_id ? { refreshSessionId: row.refresh_session_id } : {}),
    ...(row.refresh_token_hash ? { refreshTokenHash: row.refresh_token_hash } : {}),
    ...(refreshTokenExpiresAt ? { refreshTokenExpiresAt } : {}),
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

function toPlayerAccountDeviceSessionSnapshot(
  row: PlayerAccountDeviceSessionRow
): PlayerAccountDeviceSessionSnapshot {
  const refreshTokenExpiresAt = formatTimestamp(row.refresh_token_expires_at);
  const createdAt = formatTimestamp(row.created_at);
  const lastUsedAt = formatTimestamp(row.last_used_at);
  if (!refreshTokenExpiresAt || !createdAt || !lastUsedAt) {
    throw new Error("player account device session timestamps must be present");
  }

  return {
    playerId: normalizePlayerId(row.player_id),
    sessionId: normalizeAuthSessionId(row.session_id),
    provider: row.provider?.trim() || "account-password",
    deviceLabel: normalizeAuthSessionDeviceLabel(row.device_label),
    refreshTokenHash: row.refresh_token_hash,
    refreshTokenExpiresAt,
    createdAt,
    lastUsedAt
  };
}

function toPlayerBanHistoryRecord(row: PlayerBanHistoryRow): PlayerBanHistoryRecord {
  const createdAt = formatTimestamp(row.created_at);
  if (!createdAt) {
    throw new Error("player ban history created_at must be present");
  }

  const banExpiry = formatTimestamp(row.ban_expiry);
  return {
    id: Math.max(0, Math.floor(row.id)),
    playerId: normalizePlayerId(row.player_id),
    action: row.action === "unban" ? "unban" : "ban",
    banStatus: normalizePlayerBanStatus(row.ban_status),
    ...(banExpiry ? { banExpiry } : {}),
    ...(row.ban_reason ? { banReason: row.ban_reason } : {}),
    createdAt
  };
}

function normalizePlayerCompensationCurrency(value: string): PlayerCompensationRecord["currency"] {
  if (value === "gems" || value === "gold" || value === "wood" || value === "ore") {
    return value;
  }
  throw new Error("player compensation currency must be gems, gold, wood, or ore");
}

function toPlayerCompensationRecord(row: PlayerCompensationHistoryRow): PlayerCompensationRecord {
  const createdAt = formatTimestamp(row.created_at);
  if (!createdAt) {
    throw new Error("player compensation history created_at must be present");
  }

  return {
    auditId: row.audit_id,
    playerId: normalizePlayerId(row.player_id),
    type: row.type === "deduct" ? "deduct" : "add",
    currency: normalizePlayerCompensationCurrency(row.currency),
    amount: Math.max(0, Math.floor(row.amount)),
    reason: row.reason.trim(),
    previousBalance: Math.max(0, Math.floor(row.previous_balance)),
    balanceAfter: Math.max(0, Math.floor(row.balance_after)),
    createdAt
  };
}

function toPlayerNameHistoryRecord(row: PlayerNameHistoryRow): PlayerNameHistoryRecord {
  const changedAt = formatTimestamp(row.changed_at) ?? formatTimestamp(row.created_at);
  if (!changedAt) {
    throw new Error("player name history changed_at must be present");
  }

  return {
    id: Math.max(0, Math.floor(row.id)),
    playerId: normalizePlayerId(row.player_id),
    displayName: row.display_name.trim(),
    normalizedName: row.normalized_name.trim(),
    changedAt
  };
}

function toPlayerNameReservationRecord(row: PlayerNameReservationRow): PlayerNameReservationRecord {
  const reservedUntil = formatTimestamp(row.reserved_until);
  const createdAt = formatTimestamp(row.created_at);
  if (!reservedUntil || !createdAt) {
    throw new Error("player name reservation timestamps must be present");
  }

  return {
    id: Math.max(0, Math.floor(row.id)),
    playerId: normalizePlayerId(row.player_id),
    displayName: row.display_name.trim(),
    normalizedName: row.normalized_name.trim(),
    reservedUntil,
    reason: row.reason.trim() || "banned_account",
    createdAt
  };
}

function toPlayerReportRecord(row: PlayerReportRow): PlayerReportRecord {
  return normalizePlayerReportRecord({
    reportId: row.report_id,
    reporterId: row.reporter_id,
    targetId: row.target_id,
    reason: row.reason,
    description: row.description,
    roomId: row.room_id,
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at
  });
}

function toBattleSnapshotRecord(row: BattleSnapshotRow): BattleSnapshotRecord {
  const startedAt = formatTimestamp(row.started_at);
  const createdAt = formatTimestamp(row.created_at);
  const updatedAt = formatTimestamp(row.updated_at);
  if (!startedAt || !createdAt || !updatedAt) {
    throw new Error("battle snapshot timestamps must be present");
  }

  const resolvedAt = formatTimestamp(row.resolved_at);
  const compensation = row.compensation_json
    ? parseJsonColumn<BattleSnapshotCompensation>(row.compensation_json)
    : null;

  return {
    roomId: row.room_id,
    battleId: row.battle_id,
    heroId: row.hero_id,
    attackerPlayerId: normalizePlayerId(row.attacker_player_id),
    ...(row.defender_player_id ? { defenderPlayerId: normalizePlayerId(row.defender_player_id) } : {}),
    ...(row.defender_hero_id ? { defenderHeroId: row.defender_hero_id } : {}),
    ...(row.neutral_army_id ? { neutralArmyId: row.neutral_army_id } : {}),
    encounterKind: row.encounter_kind,
    ...(row.initiator ? { initiator: row.initiator } : {}),
    path: parseJsonColumn<Vec2[]>(row.path_json),
    moveCost: Math.max(0, Math.floor(row.move_cost)),
    playerIds: normalizeBattleSnapshotPlayerIds(parseJsonColumn<string[]>(row.player_ids_json)),
    initialState: parseJsonColumn<BattleState>(row.initial_state_json),
    ...(row.estimated_compensation_grant_json
      ? { estimatedCompensationGrant: parseJsonColumn<PlayerMailboxGrant>(row.estimated_compensation_grant_json) }
      : {}),
    status: normalizeBattleSnapshotStatus(row.status),
    ...(row.result ? { result: row.result } : {}),
    ...(row.resolution_reason ? { resolutionReason: row.resolution_reason } : {}),
    ...(compensation ? { compensation } : {}),
    startedAt,
    ...(resolvedAt ? { resolvedAt } : {}),
    createdAt,
    updatedAt
  };
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

async function appendPlayerBanHistoryEntry(
  queryable: Pick<Pool, "query"> | Pick<PoolConnection, "query">,
  playerId: string,
  entry: {
    action: "ban" | "unban";
    banStatus: PlayerBanStatus;
    banExpiry?: string;
    banReason?: string;
  }
): Promise<void> {
  const banExpiry = entry.banExpiry ? new Date(entry.banExpiry) : null;
  if (entry.banExpiry && (!banExpiry || Number.isNaN(banExpiry.getTime()))) {
    throw new Error("banExpiry must be a valid ISO timestamp");
  }

  await queryable.query(
    `INSERT INTO \`${MYSQL_PLAYER_BAN_HISTORY_TABLE}\` (
       player_id,
       action,
       ban_status,
       ban_expiry,
       ban_reason
     )
     VALUES (?, ?, ?, ?, ?)`,
    [playerId, entry.action, entry.banStatus, banExpiry, entry.banReason ?? null]
  );
}

async function appendPlayerCompensationHistoryEntry(
  queryable: Pick<Pool, "query"> | Pick<PoolConnection, "query">,
  playerId: string,
  input: PlayerCompensationCreateInput
): Promise<PlayerCompensationRecord> {
  const auditId = randomUUID();
  const createdAt = new Date(input.createdAt ?? Date.now());
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error("createdAt must be a valid ISO timestamp");
  }

  const record: PlayerCompensationRecord = {
    auditId,
    playerId: normalizePlayerId(playerId),
    type: input.type,
    currency: input.currency,
    amount: Math.max(1, Math.floor(input.amount)),
    reason: input.reason.trim().slice(0, 512),
    previousBalance: Math.max(0, Math.floor(input.previousBalance)),
    balanceAfter: Math.max(0, Math.floor(input.balanceAfter)),
    createdAt: createdAt.toISOString()
  };

  await queryable.query(
    `INSERT INTO \`${MYSQL_PLAYER_COMPENSATION_HISTORY_TABLE}\` (
       audit_id,
       player_id,
       type,
       currency,
       amount,
       reason,
       previous_balance,
       balance_after,
       created_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.auditId,
      record.playerId,
      record.type,
      record.currency,
      record.amount,
      record.reason,
      record.previousBalance,
      record.balanceAfter,
      createdAt
    ]
  );

  return record;
}

async function appendPlayerNameHistoryEntry(
  queryable: Pick<Pool, "query"> | Pick<PoolConnection, "query">,
  playerId: string,
  displayName: string,
  changedAt = new Date().toISOString()
): Promise<void> {
  const normalizedChangedAt = new Date(changedAt);
  if (Number.isNaN(normalizedChangedAt.getTime())) {
    throw new Error("changedAt must be a valid ISO timestamp");
  }

  await queryable.query(
    `INSERT INTO \`${MYSQL_PLAYER_NAME_HISTORY_TABLE}\` (
       player_id,
       display_name,
       normalized_name,
       changed_at
     )
     VALUES (?, ?, ?, ?)`,
    [playerId, displayName.trim(), normalizePlayerDisplayNameLookup(displayName), normalizedChangedAt]
  );
}

async function reservePlayerNamesForBannedAccount(
  queryable: Pick<Pool, "query"> | Pick<PoolConnection, "query">,
  playerId: string,
  displayNames: string[],
  reservedUntil: string,
  reason = "banned_account"
): Promise<void> {
  const normalizedReservedUntil = new Date(reservedUntil);
  if (Number.isNaN(normalizedReservedUntil.getTime())) {
    throw new Error("reservedUntil must be a valid ISO timestamp");
  }

  for (const displayName of Array.from(new Set(displayNames.map((entry) => entry.trim()).filter(Boolean)))) {
    await queryable.query(
      `INSERT INTO \`${MYSQL_PLAYER_NAME_RESERVATION_TABLE}\` (
         player_id,
         display_name,
         normalized_name,
         reserved_until,
         reason
       )
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         player_id = VALUES(player_id),
         display_name = VALUES(display_name),
         reserved_until = GREATEST(reserved_until, VALUES(reserved_until)),
         reason = VALUES(reason)`,
      [playerId, displayName, normalizePlayerDisplayNameLookup(displayName), normalizedReservedUntil, reason]
    );
  }
}

async function appendGemLedgerEntry(
  queryable: Pick<Pool, "query"> | Pick<PoolConnection, "query">,
  entry: {
    entryId: string;
    playerId: string;
    delta: number;
    reason: GemLedgerReason;
    refId: string;
  }
): Promise<void> {
  await queryable.query(
    `INSERT INTO \`${MYSQL_GEM_LEDGER_TABLE}\` (
       entry_id,
       player_id,
       delta,
       reason,
       ref_id
     )
     VALUES (?, ?, ?, ?, ?)`,
    [entry.entryId, entry.playerId, Math.trunc(entry.delta), normalizeGemLedgerReason(entry.reason), entry.refId]
  );
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
         elo_rating,
         rank_division,
         peak_rank_division,
         promotion_series_json,
         demotion_shield_json,
         season_history_json,
         ranked_weekly_progress_json,
         gems,
         season_xp,
         season_pass_tier,
         season_pass_premium,
         season_pass_claimed_tiers_json,
         season_badges_json,
         campaign_progress_json,
         seasonal_event_states_json,
         mailbox_json,
         cosmetic_inventory_json,
         equipped_cosmetics_json,
         global_resources_json,
         achievements_json,
         recent_event_log_json
         ,
         recent_battle_replays_json,
         daily_dungeon_state_json,
         tutorial_step,
         login_streak
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = COALESCE(display_name, VALUES(display_name)),
         elo_rating = COALESCE(elo_rating, VALUES(elo_rating)),
         rank_division = COALESCE(rank_division, VALUES(rank_division)),
         peak_rank_division = COALESCE(peak_rank_division, VALUES(peak_rank_division)),
         promotion_series_json = COALESCE(promotion_series_json, VALUES(promotion_series_json)),
         demotion_shield_json = COALESCE(demotion_shield_json, VALUES(demotion_shield_json)),
         season_history_json = COALESCE(season_history_json, VALUES(season_history_json)),
         ranked_weekly_progress_json = COALESCE(ranked_weekly_progress_json, VALUES(ranked_weekly_progress_json)),
         gems = VALUES(gems),
         season_xp = VALUES(season_xp),
         season_pass_tier = VALUES(season_pass_tier),
         season_pass_premium = VALUES(season_pass_premium),
         season_pass_claimed_tiers_json = VALUES(season_pass_claimed_tiers_json),
         season_badges_json = COALESCE(season_badges_json, VALUES(season_badges_json)),
         campaign_progress_json = COALESCE(campaign_progress_json, VALUES(campaign_progress_json)),
         seasonal_event_states_json = COALESCE(seasonal_event_states_json, VALUES(seasonal_event_states_json)),
         mailbox_json = COALESCE(mailbox_json, VALUES(mailbox_json)),
         cosmetic_inventory_json = COALESCE(cosmetic_inventory_json, VALUES(cosmetic_inventory_json)),
        equipped_cosmetics_json = COALESCE(equipped_cosmetics_json, VALUES(equipped_cosmetics_json)),
        global_resources_json = VALUES(global_resources_json),
         achievements_json = COALESCE(achievements_json, VALUES(achievements_json)),
         recent_event_log_json = COALESCE(recent_event_log_json, VALUES(recent_event_log_json)),
         recent_battle_replays_json = COALESCE(recent_battle_replays_json, VALUES(recent_battle_replays_json)),
         daily_dungeon_state_json = COALESCE(daily_dungeon_state_json, VALUES(daily_dungeon_state_json)),
         tutorial_step = COALESCE(tutorial_step, VALUES(tutorial_step)),
         login_streak = VALUES(login_streak),
         version = version + 1`,
      [
        normalizedAccount.playerId,
        normalizedAccount.displayName,
        normalizedAccount.eloRating,
        normalizedAccount.rankDivision ?? null,
        normalizedAccount.peakRankDivision ?? null,
        JSON.stringify(normalizedAccount.promotionSeries ?? null),
        JSON.stringify(normalizedAccount.demotionShield ?? null),
        JSON.stringify(normalizedAccount.seasonHistory ?? []),
        JSON.stringify(normalizedAccount.rankedWeeklyProgress ?? null),
        normalizedAccount.gems,
        Math.max(0, Math.floor(normalizedAccount.seasonXp ?? 0)),
        Math.max(1, Math.floor(normalizedAccount.seasonPassTier ?? 1)),
        normalizedAccount.seasonPassPremium === true ? 1 : 0,
        JSON.stringify(normalizedAccount.seasonPassClaimedTiers ?? []),
        JSON.stringify(normalizedAccount.seasonBadges ?? []),
        JSON.stringify(normalizedAccount.campaignProgress ?? null),
        JSON.stringify(normalizedAccount.seasonalEventStates ?? null),
        JSON.stringify(normalizedAccount.mailbox ?? null),
        JSON.stringify(normalizedAccount.cosmeticInventory ?? { ownedIds: [] }),
        JSON.stringify(normalizedAccount.equippedCosmetics ?? {}),
        JSON.stringify(normalizedAccount.globalResources),
        JSON.stringify(normalizedAccount.achievements),
        JSON.stringify(normalizedAccount.recentEventLog),
        JSON.stringify(normalizedAccount.recentBattleReplays),
        JSON.stringify(normalizedAccount.dailyDungeonState ?? null),
        normalizedAccount.tutorialStep,
        normalizeLoginStreak(normalizedAccount.loginStreak)
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

function buildGuestMigrationTargetAccount(input: {
  progressAccount: PlayerAccountSnapshot;
  targetAccount: PlayerAccountSnapshot;
  targetPlayerId: string;
  wechatIdentity: PlayerAccountWechatMiniGameIdentityInput;
}): PlayerAccountSnapshot {
  const progressAccount = normalizePlayerAccountSnapshot({
    ...input.progressAccount,
    playerId: input.targetPlayerId
  });
  const targetAccount = normalizePlayerAccountSnapshot({
    ...input.targetAccount,
    playerId: input.targetPlayerId
  });

  return normalizePlayerAccountSnapshot({
    ...targetAccount,
    ...progressAccount,
    playerId: input.targetPlayerId,
    displayName: input.wechatIdentity.displayName?.trim() ? input.wechatIdentity.displayName : progressAccount.displayName,
    avatarUrl:
      input.wechatIdentity.avatarUrl !== undefined
        ? input.wechatIdentity.avatarUrl
        : progressAccount.avatarUrl ?? targetAccount.avatarUrl,
    loginId: targetAccount.loginId,
    credentialBoundAt: targetAccount.credentialBoundAt,
    privacyConsentAt: progressAccount.privacyConsentAt ?? targetAccount.privacyConsentAt,
    phoneNumber: targetAccount.phoneNumber,
    phoneNumberBoundAt: targetAccount.phoneNumberBoundAt,
    notificationPreferences: progressAccount.notificationPreferences ?? targetAccount.notificationPreferences,
    accountSessionVersion: targetAccount.accountSessionVersion,
    refreshSessionId: targetAccount.refreshSessionId,
    refreshTokenExpiresAt: targetAccount.refreshTokenExpiresAt,
    wechatMiniGameOpenId: input.wechatIdentity.openId,
    wechatMiniGameUnionId: input.wechatIdentity.unionId ?? targetAccount.wechatMiniGameUnionId,
    wechatMiniGameBoundAt: targetAccount.wechatMiniGameBoundAt ?? new Date().toISOString(),
    ageVerified:
      input.wechatIdentity.ageVerified !== undefined
        ? input.wechatIdentity.ageVerified
        : progressAccount.ageVerified ?? targetAccount.ageVerified,
    isMinor:
      input.wechatIdentity.isMinor !== undefined
        ? input.wechatIdentity.isMinor
        : progressAccount.isMinor ?? targetAccount.isMinor,
    guestMigratedToPlayerId: undefined
  });
}

function buildMigratedGuestAccountTombstone(
  account: PlayerAccountSnapshot,
  targetPlayerId: string
): PlayerAccountSnapshot {
  return normalizePlayerAccountSnapshot({
    playerId: account.playerId,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    globalResources: normalizeResourceLedger(),
    achievements: [],
    recentEventLog: account.recentEventLog,
    recentBattleReplays: [],
    gems: 0,
    seasonXp: 0,
    seasonPassTier: 1,
    seasonPassPremium: false,
    seasonPassClaimedTiers: [],
    seasonBadges: [],
    campaignProgress: undefined,
    seasonalEventStates: undefined,
    mailbox: undefined,
    cosmeticInventory: { ownedIds: [] },
    equippedCosmetics: {},
    eloRating: normalizeEloRating(undefined),
    rankDivision: getRankDivisionForRating(undefined),
    peakRankDivision: getRankDivisionForRating(undefined),
    promotionSeries: undefined,
    demotionShield: undefined,
    seasonHistory: [],
    rankedWeeklyProgress: undefined,
    dailyDungeonState: undefined,
    leaderboardAbuseState: undefined,
    leaderboardModerationState: undefined,
    tutorialStep: DEFAULT_TUTORIAL_STEP,
    lastRoomId: undefined,
    lastSeenAt: account.lastSeenAt,
    loginId: undefined,
    credentialBoundAt: undefined,
    privacyConsentAt: account.privacyConsentAt,
    phoneNumber: undefined,
    phoneNumberBoundAt: undefined,
    notificationPreferences: undefined,
    ageVerified: undefined,
    isMinor: undefined,
    dailyPlayMinutes: 0,
    lastPlayDate: undefined,
    loginStreak: 0,
    banStatus: "none",
    banExpiry: undefined,
    banReason: undefined,
    wechatMiniGameOpenId: undefined,
    wechatMiniGameUnionId: undefined,
    wechatMiniGameBoundAt: undefined,
    guestMigratedToPlayerId: targetPlayerId
  });
}

async function upsertPlayerAccountForMigration(
  connection: PoolConnection,
  existingAccount: PlayerAccountSnapshot,
  nextAccount: PlayerAccountSnapshot
): Promise<void> {
  await connection.query(
    `INSERT INTO \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (
       player_id,
       display_name,
       avatar_url,
       elo_rating,
       rank_division,
       peak_rank_division,
       promotion_series_json,
       demotion_shield_json,
       season_history_json,
       ranked_weekly_progress_json,
       gems,
       season_xp,
       season_pass_tier,
       season_pass_premium,
       season_pass_claimed_tiers_json,
       season_badges_json,
       campaign_progress_json,
       seasonal_event_states_json,
       mailbox_json,
       cosmetic_inventory_json,
       equipped_cosmetics_json,
       global_resources_json,
       achievements_json,
       recent_event_log_json,
       recent_battle_replays_json,
       daily_dungeon_state_json,
       leaderboard_abuse_state_json,
       leaderboard_moderation_state_json,
       tutorial_step,
       last_room_id,
       last_seen_at,
       age_verified,
       is_minor,
       daily_play_minutes,
       last_play_date,
       login_streak,
       wechat_open_id,
       wechat_union_id,
       wechat_mini_game_open_id,
       wechat_mini_game_union_id,
       wechat_mini_game_bound_at,
       guest_migrated_to_player_id,
       privacy_consent_at,
       phone_number,
       phone_number_bound_at,
       notification_preferences_json,
       push_tokens_json
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name),
       avatar_url = VALUES(avatar_url),
       elo_rating = VALUES(elo_rating),
       rank_division = VALUES(rank_division),
       peak_rank_division = VALUES(peak_rank_division),
       promotion_series_json = VALUES(promotion_series_json),
       demotion_shield_json = VALUES(demotion_shield_json),
       season_history_json = VALUES(season_history_json),
       ranked_weekly_progress_json = VALUES(ranked_weekly_progress_json),
       gems = VALUES(gems),
       season_xp = VALUES(season_xp),
       season_pass_tier = VALUES(season_pass_tier),
       season_pass_premium = VALUES(season_pass_premium),
       season_pass_claimed_tiers_json = VALUES(season_pass_claimed_tiers_json),
       season_badges_json = VALUES(season_badges_json),
       campaign_progress_json = VALUES(campaign_progress_json),
       seasonal_event_states_json = VALUES(seasonal_event_states_json),
       mailbox_json = VALUES(mailbox_json),
       cosmetic_inventory_json = VALUES(cosmetic_inventory_json),
       equipped_cosmetics_json = VALUES(equipped_cosmetics_json),
       global_resources_json = VALUES(global_resources_json),
       achievements_json = VALUES(achievements_json),
       recent_event_log_json = VALUES(recent_event_log_json),
       recent_battle_replays_json = VALUES(recent_battle_replays_json),
       daily_dungeon_state_json = VALUES(daily_dungeon_state_json),
       leaderboard_abuse_state_json = VALUES(leaderboard_abuse_state_json),
       leaderboard_moderation_state_json = VALUES(leaderboard_moderation_state_json),
       tutorial_step = VALUES(tutorial_step),
       last_room_id = VALUES(last_room_id),
       last_seen_at = COALESCE(last_seen_at, VALUES(last_seen_at)),
       age_verified = VALUES(age_verified),
       is_minor = VALUES(is_minor),
       daily_play_minutes = VALUES(daily_play_minutes),
       last_play_date = VALUES(last_play_date),
       login_streak = VALUES(login_streak),
       wechat_open_id = VALUES(wechat_open_id),
       wechat_union_id = VALUES(wechat_union_id),
       wechat_mini_game_open_id = VALUES(wechat_mini_game_open_id),
       wechat_mini_game_union_id = VALUES(wechat_mini_game_union_id),
       wechat_mini_game_bound_at = VALUES(wechat_mini_game_bound_at),
       guest_migrated_to_player_id = VALUES(guest_migrated_to_player_id),
       privacy_consent_at = VALUES(privacy_consent_at),
       phone_number = VALUES(phone_number),
       phone_number_bound_at = VALUES(phone_number_bound_at),
       notification_preferences_json = VALUES(notification_preferences_json),
       push_tokens_json = VALUES(push_tokens_json),
       version = version + 1`,
    [
      nextAccount.playerId,
      nextAccount.displayName,
      nextAccount.avatarUrl ?? null,
      nextAccount.eloRating,
      nextAccount.rankDivision ?? null,
      nextAccount.peakRankDivision ?? null,
      JSON.stringify(nextAccount.promotionSeries ?? null),
      JSON.stringify(nextAccount.demotionShield ?? null),
      JSON.stringify(nextAccount.seasonHistory ?? []),
      JSON.stringify(nextAccount.rankedWeeklyProgress ?? null),
      nextAccount.gems,
      Math.max(0, Math.floor(nextAccount.seasonXp ?? 0)),
      Math.max(1, Math.floor(nextAccount.seasonPassTier ?? 1)),
      nextAccount.seasonPassPremium === true ? 1 : 0,
      JSON.stringify(nextAccount.seasonPassClaimedTiers ?? []),
      JSON.stringify(nextAccount.seasonBadges ?? []),
      JSON.stringify(nextAccount.campaignProgress ?? null),
      JSON.stringify(nextAccount.seasonalEventStates ?? null),
      JSON.stringify(nextAccount.mailbox ?? null),
      JSON.stringify(nextAccount.cosmeticInventory ?? { ownedIds: [] }),
      JSON.stringify(nextAccount.equippedCosmetics ?? {}),
      JSON.stringify(nextAccount.globalResources),
      JSON.stringify(nextAccount.achievements),
      JSON.stringify(nextAccount.recentEventLog),
      JSON.stringify(nextAccount.recentBattleReplays),
      JSON.stringify(nextAccount.dailyDungeonState ?? null),
      JSON.stringify(nextAccount.leaderboardAbuseState ?? null),
      JSON.stringify(nextAccount.leaderboardModerationState ?? null),
      nextAccount.tutorialStep,
      nextAccount.lastRoomId ?? null,
      existingAccount.lastSeenAt ? new Date(existingAccount.lastSeenAt) : null,
      nextAccount.ageVerified === true ? 1 : 0,
      nextAccount.isMinor === true ? 1 : 0,
      normalizeDailyPlayMinutes(nextAccount.dailyPlayMinutes),
      nextAccount.lastPlayDate ? new Date(nextAccount.lastPlayDate) : null,
      normalizeLoginStreak(nextAccount.loginStreak),
      nextAccount.wechatMiniGameOpenId ?? null,
      nextAccount.wechatMiniGameUnionId ?? null,
      nextAccount.wechatMiniGameOpenId ?? null,
      nextAccount.wechatMiniGameUnionId ?? null,
      nextAccount.wechatMiniGameBoundAt ? new Date(nextAccount.wechatMiniGameBoundAt) : null,
      nextAccount.guestMigratedToPlayerId ?? null,
      nextAccount.privacyConsentAt ? new Date(nextAccount.privacyConsentAt) : null,
      nextAccount.phoneNumber ?? null,
      nextAccount.phoneNumberBoundAt ? new Date(nextAccount.phoneNumberBoundAt) : null,
      JSON.stringify(nextAccount.notificationPreferences ?? null),
      JSON.stringify(nextAccount.pushTokens ?? null)
    ]
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
    const pool = createTrackedMySqlPool("room_snapshot", config);
    await pool.query("SELECT 1");

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

  async loadGuild(guildId: string): Promise<GuildState | null> {
    const normalizedGuildId = normalizeGuildId(guildId);
    const [rows] = await this.pool.query<GuildRow[]>(
      `SELECT
         guild_id,
         name,
         tag,
         description,
         owner_player_id,
         member_count,
         state_json,
         created_at,
         updated_at
       FROM \`${MYSQL_GUILD_TABLE}\`
       WHERE guild_id = ?
       LIMIT 1`,
      [normalizedGuildId]
    );

    const row = rows[0];
    return row ? toGuildState(row) : null;
  }

  async loadGuildByMemberPlayerId(playerId: string): Promise<GuildState | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const [rows] = await this.pool.query<GuildRow[]>(
      `SELECT
         guild.guild_id,
         guild.name,
         guild.tag,
         guild.description,
         guild.owner_player_id,
         guild.member_count,
         guild.state_json,
         guild.created_at,
         guild.updated_at
       FROM \`${MYSQL_GUILD_TABLE}\` guild
       INNER JOIN \`${MYSQL_GUILD_MEMBERSHIP_TABLE}\` membership
         ON membership.guild_id = guild.guild_id
       WHERE membership.player_id = ?
       LIMIT 1`,
      [normalizedPlayerId]
    );

    const row = rows[0];
    return row ? toGuildState(row) : null;
  }

  async listGuildAuditLogs(options: GuildAuditLogListOptions = {}): Promise<GuildAuditLogRecord[]> {
    const clauses: string[] = [];
    const params: Array<string | Date | number> = [];
    const safeLimit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));

    if (options.guildId?.trim()) {
      clauses.push("guild_id = ?");
      params.push(normalizeGuildId(options.guildId));
    }
    if (options.actorPlayerId?.trim()) {
      clauses.push("actor_player_id = ?");
      params.push(normalizePlayerId(options.actorPlayerId));
    }
    if (options.since?.trim()) {
      const since = new Date(options.since);
      if (Number.isNaN(since.getTime())) {
        throw new Error("since must be a valid ISO timestamp");
      }
      clauses.push("occurred_at >= ?");
      params.push(since);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await this.pool.query<GuildAuditLogRow[]>(
      `SELECT
         audit_id,
         guild_id,
         action,
         actor_player_id,
         occurred_at,
         name,
         tag,
         reason
       FROM \`${MYSQL_GUILD_AUDIT_LOG_TABLE}\`
       ${whereClause}
       ORDER BY occurred_at DESC, audit_id DESC
       LIMIT ?`,
      [...params, safeLimit]
    );

    return rows.map((row) => toGuildAuditLogRecord(row));
  }

  async listGuildChatMessages(options: GuildChatMessageListOptions): Promise<GuildChatMessageRecord[]> {
    const safeLimit = Math.max(1, Math.min(50, Math.floor(options.limit ?? 50)));
    const cursor = parseGuildChatCursor(options.beforeCursor);
    const params: Array<string | Date | number> = [normalizeGuildId(options.guildId)];
    let cursorClause = "";

    if (cursor) {
      cursorClause = "AND (created_at < ? OR (created_at = ? AND message_id < ?))";
      params.push(new Date(cursor.createdAt), new Date(cursor.createdAt), cursor.messageId);
    }

    const [rows] = await this.pool.query<GuildChatMessageRow[]>(
      `SELECT
         message_id,
         guild_id,
         author_player_id,
         author_display_name,
         content,
         created_at,
         expires_at
       FROM \`${MYSQL_GUILD_MESSAGE_TABLE}\`
       WHERE guild_id = ?
         AND expires_at > CURRENT_TIMESTAMP
         ${cursorClause}
       ORDER BY created_at DESC, message_id DESC
       LIMIT ?`,
      [...params, safeLimit]
    );

    return rows.map((row) => toGuildChatMessageRecord(row));
  }

  async loadGuildChatMessage(guildId: string, messageId: string): Promise<GuildChatMessageRecord | null> {
    const [rows] = await this.pool.query<GuildChatMessageRow[]>(
      `SELECT
         message_id,
         guild_id,
         author_player_id,
         author_display_name,
         content,
         created_at,
         expires_at
       FROM \`${MYSQL_GUILD_MESSAGE_TABLE}\`
       WHERE guild_id = ?
         AND message_id = ?
         AND expires_at > CURRENT_TIMESTAMP
       LIMIT 1`,
      [normalizeGuildId(guildId), normalizeGuildChatMessageId(messageId)]
    );

    const row = rows[0];
    return row ? toGuildChatMessageRecord(row) : null;
  }

  async appendGuildAuditLog(input: GuildAuditLogCreateInput): Promise<GuildAuditLogRecord> {
    const auditId = randomUUID();
    const occurredAt = new Date(input.occurredAt ?? Date.now());
    const normalizedReason = normalizeGuildAuditReason(input.reason);
    if (Number.isNaN(occurredAt.getTime())) {
      throw new Error("occurredAt must be a valid ISO timestamp");
    }
    const record: GuildAuditLogRecord = {
      auditId,
      guildId: normalizeGuildId(input.guildId),
      action: input.action,
      actorPlayerId: normalizePlayerId(input.actorPlayerId),
      occurredAt: occurredAt.toISOString(),
      name: input.name.trim().slice(0, 40),
      tag: input.tag.trim().toUpperCase().slice(0, 4),
      ...(normalizedReason ? { reason: normalizedReason } : {})
    };

    await this.pool.query(
      `INSERT INTO \`${MYSQL_GUILD_AUDIT_LOG_TABLE}\` (
         audit_id,
         guild_id,
         action,
         actor_player_id,
         occurred_at,
         name,
         tag,
         reason
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.auditId,
        record.guildId,
        record.action,
        record.actorPlayerId,
        occurredAt,
        record.name,
        record.tag,
        record.reason ?? null
      ]
    );

    return record;
  }

  async createGuildChatMessage(input: GuildChatMessageCreateInput): Promise<GuildChatMessageRecord> {
    const messageId = randomUUID();
    const createdAt = new Date(input.createdAt ?? Date.now());
    const expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(createdAt.getTime())) {
      throw new Error("createdAt must be a valid ISO timestamp");
    }
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error("expiresAt must be a valid ISO timestamp");
    }

    const record: GuildChatMessageRecord = {
      messageId,
      guildId: normalizeGuildId(input.guildId),
      authorPlayerId: normalizePlayerId(input.authorPlayerId),
      authorDisplayName: normalizeGuildChatAuthorDisplayName(input.authorDisplayName),
      content: normalizeGuildChatContent(input.content),
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    };

    await this.pool.query(
      `INSERT INTO \`${MYSQL_GUILD_MESSAGE_TABLE}\` (
         message_id,
         guild_id,
         author_player_id,
         author_display_name,
         content,
         created_at,
         expires_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.messageId,
        record.guildId,
        record.authorPlayerId,
        record.authorDisplayName,
        record.content,
        new Date(record.createdAt),
        new Date(record.expiresAt)
      ]
    );

    return record;
  }

  async deleteGuildChatMessage(guildId: string, messageId: string): Promise<boolean> {
    const [result] = await this.pool.query<ResultSetHeader>(
      `DELETE FROM \`${MYSQL_GUILD_MESSAGE_TABLE}\`
       WHERE guild_id = ?
         AND message_id = ?`,
      [normalizeGuildId(guildId), normalizeGuildChatMessageId(messageId)]
    );

    return result.affectedRows > 0;
  }

  async loadPlayerAccount(playerId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const accounts = await this.loadPlayerAccounts([normalizedPlayerId]);
    return accounts[0] ?? null;
  }

  async loadPaymentOrder(orderId: string): Promise<PaymentOrderSnapshot | null> {
    const normalizedOrderId = normalizePaymentOrderId(orderId);
    const [rows] = await this.pool.query<PaymentOrderRow[]>(
      `SELECT
         order_id,
         player_id,
         product_id,
         wechat_order_id,
         status,
         amount,
         gem_amount,
         created_at,
         paid_at,
         last_grant_attempt_at,
         next_grant_retry_at,
         settled_at,
         dead_lettered_at,
         grant_attempt_count,
         last_grant_error,
         updated_at
       FROM \`${MYSQL_PAYMENT_ORDER_TABLE}\`
       WHERE order_id = ?
       LIMIT 1`,
      [normalizedOrderId]
    );

    const row = rows[0];
    return row ? toPaymentOrderSnapshot(row) : null;
  }

  async listPaymentOrders(options: PaymentOrderListOptions = {}): Promise<PaymentOrderSnapshot[]> {
    const normalizedStatuses = Array.from(new Set((options.statuses ?? []).map((status) => normalizePaymentOrderStatus(status))));
    const safeLimit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
    const dueBefore =
      options.dueBefore && !Number.isNaN(new Date(options.dueBefore).getTime()) ? new Date(options.dueBefore) : null;
    const whereClauses = [];
    const params: Array<string | number | Date> = [];

    if (normalizedStatuses.length > 0) {
      whereClauses.push(`status IN (${normalizedStatuses.map(() => "?").join(", ")})`);
      params.push(...normalizedStatuses);
    }
    if (dueBefore) {
      whereClauses.push("next_grant_retry_at IS NOT NULL");
      whereClauses.push("next_grant_retry_at <= ?");
      params.push(dueBefore);
    }

    const [rows] = await this.pool.query<PaymentOrderRow[]>(
      `SELECT
         order_id,
         player_id,
         product_id,
         wechat_order_id,
         status,
         amount,
         gem_amount,
         created_at,
         paid_at,
         last_grant_attempt_at,
         next_grant_retry_at,
         settled_at,
         dead_lettered_at,
         grant_attempt_count,
         last_grant_error,
         updated_at
       FROM \`${MYSQL_PAYMENT_ORDER_TABLE}\`
       ${whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : ""}
       ORDER BY
         CASE WHEN next_grant_retry_at IS NULL THEN 1 ELSE 0 END ASC,
         next_grant_retry_at ASC,
         updated_at DESC
       LIMIT ?`,
      [...params, safeLimit]
    );

    return rows.map((row) => toPaymentOrderSnapshot(row));
  }

  async loadPaymentReceiptByOrderId(orderId: string): Promise<PaymentReceiptSnapshot | null> {
    const normalizedOrderId = normalizePaymentOrderId(orderId);
    const [rows] = await this.pool.query<PaymentReceiptRow[]>(
      `SELECT
         transaction_id,
         order_id,
         player_id,
         product_id,
         amount,
         verified_at
       FROM \`${MYSQL_PAYMENT_RECEIPT_TABLE}\`
       WHERE order_id = ?
       LIMIT 1`,
      [normalizedOrderId]
    );

    const row = rows[0];
    return row ? toPaymentReceiptSnapshot(row) : null;
  }

  async countVerifiedPaymentReceiptsSince(playerId: string, since: string): Promise<number> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const sinceDate = new Date(since);
    if (Number.isNaN(sinceDate.getTime())) {
      throw new Error("since must be a valid ISO timestamp");
    }

    const [rows] = await this.pool.query<Array<RowDataPacket & { total: number }>>(
      `SELECT COUNT(*) AS total
       FROM \`${MYSQL_PAYMENT_RECEIPT_TABLE}\`
       WHERE player_id = ?
         AND verified_at >= ?`,
      [normalizedPlayerId, sinceDate]
    );

    return Math.max(0, Math.floor(rows[0]?.total ?? 0));
  }

  async loadPlayerBan(playerId: string): Promise<PlayerAccountBanSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const [rows] = await this.pool.query<PlayerAccountRow[]>(
      `SELECT
         player_id,
         ban_status,
         ban_expiry,
         ban_reason
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE player_id = ?
       LIMIT 1`,
      [normalizedPlayerId]
    );

    const row = rows[0];
    return row ? toPlayerBanSnapshot(row) : null;
  }

  async createPlayerReport(input: PlayerReportCreateInput): Promise<PlayerReportRecord> {
    const reporterId = normalizePlayerId(input.reporterId);
    const targetId = normalizePlayerId(input.targetId);
    const roomId = input.roomId.trim();
    if (!roomId) {
      throw new Error("roomId must not be empty");
    }
    if (reporterId === targetId) {
      throw new Error("reporterId must not match targetId");
    }

    const reason = normalizePlayerReportReason(input.reason);
    const description = normalizePlayerReportDescription(input.description);

    try {
      const [result] = await this.pool.query<ResultSetHeader>(
        `INSERT INTO \`${MYSQL_PLAYER_REPORT_TABLE}\` (
           reporter_id,
           target_id,
           reason,
           description,
           room_id,
           status
         )
         VALUES (?, ?, ?, ?, ?, 'pending')`,
        [reporterId, targetId, reason, description ?? null, roomId]
      );
      const [rows] = await this.pool.query<PlayerReportRow[]>(
        `SELECT
           report_id,
           reporter_id,
           target_id,
           reason,
           description,
           room_id,
           status,
           created_at,
           resolved_at
         FROM \`${MYSQL_PLAYER_REPORT_TABLE}\`
         WHERE report_id = ?
         LIMIT 1`,
        [result.insertId]
      );

      const row = rows[0];
      if (!row) {
        throw new Error("player report insert failed");
      }

      return toPlayerReportRecord(row);
    } catch (error) {
      if (isMySqlDuplicateEntryError(error)) {
        throw new Error("duplicate_player_report");
      }

      throw error;
    }
  }

  async loadPlayerAccountByLoginId(loginId: string): Promise<PlayerAccountSnapshot | null> {
    const normalizedLoginId = normalizePlayerLoginId(loginId);
    const [rows] = await this.pool.query<PlayerAccountRow[]>(
      `SELECT
         player_id,
         display_name,
         avatar_url,
         elo_rating,
         rank_division,
         peak_rank_division,
         promotion_series_json,
         demotion_shield_json,
         season_history_json,
         ranked_weekly_progress_json,
         gems,
         season_xp,
         season_pass_tier,
         season_pass_premium,
         season_pass_claimed_tiers_json,
         season_badges_json,
         campaign_progress_json,
         seasonal_event_states_json,
         mailbox_json,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         daily_dungeon_state_json,
         tutorial_step,
         last_room_id,
         last_seen_at,
         login_id,
         age_verified,
         is_minor,
         daily_play_minutes,
         last_play_date,
         login_streak,
         ban_status,
         ban_expiry,
         ban_reason,
         account_session_version,
         refresh_session_id,
         refresh_token_hash,
         refresh_token_expires_at,
         wechat_open_id,
         wechat_union_id,
         wechat_mini_game_open_id,
         wechat_mini_game_union_id,
         wechat_mini_game_bound_at,
         guest_migrated_to_player_id,
         credential_bound_at,
         privacy_consent_at,
         phone_number,
         phone_number_bound_at,
         notification_preferences_json,
         push_tokens_json,
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
         elo_rating,
         rank_division,
         peak_rank_division,
         promotion_series_json,
         demotion_shield_json,
         season_history_json,
         ranked_weekly_progress_json,
         gems,
         season_xp,
         season_pass_tier,
         season_pass_premium,
         season_pass_claimed_tiers_json,
         season_badges_json,
         campaign_progress_json,
         seasonal_event_states_json,
         mailbox_json,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         daily_dungeon_state_json,
         tutorial_step,
         last_room_id,
         last_seen_at,
         login_id,
         age_verified,
         is_minor,
         daily_play_minutes,
         last_play_date,
         login_streak,
         ban_status,
         ban_expiry,
         ban_reason,
         account_session_version,
         refresh_session_id,
         refresh_token_hash,
         refresh_token_expires_at,
         wechat_open_id,
         wechat_union_id,
         wechat_mini_game_open_id,
         wechat_mini_game_union_id,
         wechat_mini_game_bound_at,
         guest_migrated_to_player_id,
         credential_bound_at,
         privacy_consent_at,
         phone_number,
         phone_number_bound_at,
         notification_preferences_json,
         push_tokens_json,
         created_at,
         updated_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE wechat_open_id = ?
          OR wechat_mini_game_open_id = ?
       LIMIT 1`,
      [normalizedOpenId, normalizedOpenId]
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

  async loadPlayerQuestState(playerId: string): Promise<PlayerQuestState | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const [rows] = await this.pool.query<PlayerQuestStateRow[]>(
      `SELECT
         player_id,
         current_date_key,
         active_quest_ids_json,
         rotations_json,
         updated_at
       FROM \`${MYSQL_PLAYER_QUEST_STATE_TABLE}\`
       WHERE player_id = ?
       LIMIT 1`,
      [normalizedPlayerId]
    );

    const row = rows[0];
    return row ? toPlayerQuestState(row) : null;
  }

  async saveBattleSnapshotStart(input: BattleSnapshotStartInput): Promise<BattleSnapshotRecord> {
    const startedAt = input.startedAt ? new Date(input.startedAt) : new Date();
    if (Number.isNaN(startedAt.getTime())) {
      throw new Error("startedAt must be a valid ISO timestamp");
    }

    const normalizedPlayerIds = normalizeBattleSnapshotPlayerIds(input.playerIds);
    await this.pool.query(
      `INSERT INTO \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\` (
         room_id,
         battle_id,
         hero_id,
         attacker_player_id,
         defender_player_id,
         defender_hero_id,
         neutral_army_id,
         encounter_kind,
         initiator,
         path_json,
         move_cost,
         player_ids_json,
         initial_state_json,
         estimated_compensation_grant_json,
         status,
         started_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
       ON DUPLICATE KEY UPDATE
         hero_id = VALUES(hero_id),
         attacker_player_id = VALUES(attacker_player_id),
         defender_player_id = VALUES(defender_player_id),
         defender_hero_id = VALUES(defender_hero_id),
         neutral_army_id = VALUES(neutral_army_id),
         encounter_kind = VALUES(encounter_kind),
         initiator = VALUES(initiator),
         path_json = VALUES(path_json),
         move_cost = VALUES(move_cost),
         player_ids_json = VALUES(player_ids_json),
         initial_state_json = VALUES(initial_state_json),
         estimated_compensation_grant_json = VALUES(estimated_compensation_grant_json),
         status = 'active',
         result = NULL,
         resolution_reason = NULL,
         compensation_json = NULL,
         started_at = VALUES(started_at),
         resolved_at = NULL`,
      [
        input.roomId,
        input.battleId,
        input.heroId,
        normalizePlayerId(input.attackerPlayerId),
        input.defenderPlayerId ? normalizePlayerId(input.defenderPlayerId) : null,
        input.defenderHeroId ?? null,
        input.neutralArmyId ?? null,
        input.encounterKind,
        input.initiator ?? null,
        JSON.stringify(input.path),
        Math.max(0, Math.floor(input.moveCost)),
        JSON.stringify(normalizedPlayerIds),
        JSON.stringify(input.initialState),
        JSON.stringify(input.estimatedCompensationGrant ?? null),
        startedAt
      ]
    );

    const [rows] = await this.pool.query<BattleSnapshotRow[]>(
      `SELECT *
       FROM \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\`
       WHERE room_id = ?
         AND battle_id = ?
       LIMIT 1`,
      [input.roomId, input.battleId]
    );

    return toBattleSnapshotRecord(rows[0]!);
  }

  async saveBattleSnapshotResolution(input: BattleSnapshotResolutionInput): Promise<BattleSnapshotRecord | null> {
    const resolvedAt = input.resolvedAt ? new Date(input.resolvedAt) : new Date();
    if (Number.isNaN(resolvedAt.getTime())) {
      throw new Error("resolvedAt must be a valid ISO timestamp");
    }

    await this.pool.query(
      `UPDATE \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\`
       SET status = 'resolved',
           result = ?,
           resolution_reason = ?,
           compensation_json = NULL,
           resolved_at = ?
       WHERE room_id = ?
         AND battle_id = ?`,
      [input.result, input.resolutionReason ?? "battle_resolved", resolvedAt, input.roomId, input.battleId]
    );

    const [rows] = await this.pool.query<BattleSnapshotRow[]>(
      `SELECT *
       FROM \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\`
       WHERE room_id = ?
         AND battle_id = ?
       LIMIT 1`,
      [input.roomId, input.battleId]
    );

    return rows[0] ? toBattleSnapshotRecord(rows[0]) : null;
  }

  async settleInterruptedBattleSnapshot(
    input: BattleSnapshotInterruptedSettlementInput
  ): Promise<BattleSnapshotRecord | null> {
    const resolvedAt = input.resolvedAt ? new Date(input.resolvedAt) : new Date();
    if (Number.isNaN(resolvedAt.getTime())) {
      throw new Error("resolvedAt must be a valid ISO timestamp");
    }

    if (input.compensation && this.deliverPlayerMailbox) {
      const message: PlayerMailboxMessage = normalizePlayerMailboxMessage(
        {
          id: input.compensation.mailboxMessageId,
          kind: input.compensation.kind,
          title: input.compensation.title,
          body: input.compensation.body,
          ...(input.compensation.grant ? { grant: input.compensation.grant } : {})
        },
        resolvedAt
      );
      await this.deliverPlayerMailbox({
        playerIds: input.compensation.playerIds,
        message
      });
    }

    await this.pool.query(
      `UPDATE \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\`
       SET status = ?,
           resolution_reason = ?,
           compensation_json = ?,
           resolved_at = ?
       WHERE room_id = ?
         AND battle_id = ?
         AND status = 'active'`,
      [
        normalizeBattleSnapshotStatus(input.status),
        input.resolutionReason,
        JSON.stringify(input.compensation ?? null),
        resolvedAt,
        input.roomId,
        input.battleId
      ]
    );

    const [rows] = await this.pool.query<BattleSnapshotRow[]>(
      `SELECT *
       FROM \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\`
       WHERE room_id = ?
         AND battle_id = ?
       LIMIT 1`,
      [input.roomId, input.battleId]
    );

    return rows[0] ? toBattleSnapshotRecord(rows[0]) : null;
  }

  async listBattleSnapshotsForPlayer(
    playerId: string,
    options: BattleSnapshotListOptions = {}
  ): Promise<BattleSnapshotRecord[]> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const safeLimit = Math.max(1, Math.min(200, Math.floor(options.limit ?? 50)));
    const normalizedStatuses = Array.from(
      new Set((options.statuses ?? []).map((status) => normalizeBattleSnapshotStatus(status)))
    );
    const whereClauses = ["JSON_CONTAINS(player_ids_json, JSON_QUOTE(?), '$')"];
    const params: Array<string | number> = [normalizedPlayerId];

    if (normalizedStatuses.length > 0) {
      whereClauses.push(`status IN (${normalizedStatuses.map(() => "?").join(", ")})`);
      params.push(...normalizedStatuses);
    }

    params.push(safeLimit);
    const [rows] = await this.pool.query<BattleSnapshotRow[]>(
      `SELECT *
       FROM \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\`
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY started_at DESC, battle_id ASC
       LIMIT ?`,
      params
    );

    return rows.map((row) => toBattleSnapshotRecord(row));
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
         elo_rating,
         rank_division,
         peak_rank_division,
         promotion_series_json,
         demotion_shield_json,
         season_history_json,
         ranked_weekly_progress_json,
         gems,
         season_xp,
         season_pass_tier,
         season_pass_premium,
         season_pass_claimed_tiers_json,
         season_badges_json,
         campaign_progress_json,
         seasonal_event_states_json,
         mailbox_json,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         daily_dungeon_state_json,
         tutorial_step,
         last_room_id,
         last_seen_at,
         login_id,
         age_verified,
         is_minor,
         daily_play_minutes,
         last_play_date,
         login_streak,
         ban_status,
         ban_expiry,
         ban_reason,
         account_session_version,
         refresh_session_id,
         refresh_token_hash,
         refresh_token_expires_at,
         wechat_open_id,
         wechat_union_id,
         wechat_mini_game_open_id,
         wechat_mini_game_union_id,
         wechat_mini_game_bound_at,
         guest_migrated_to_player_id,
         credential_bound_at,
         privacy_consent_at,
         phone_number,
         phone_number_bound_at,
         notification_preferences_json,
         push_tokens_json,
         created_at,
         updated_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE player_id IN (${placeholders})`,
      safePlayerIds
    );

    return rows.map((row) => toPlayerAccountSnapshot(row));
  }

  async listGuilds(options: GuildListOptions = {}): Promise<GuildState[]> {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    const safeLimit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));

    if (options.playerId?.trim()) {
      clauses.push(
        `EXISTS (
          SELECT 1
          FROM \`${MYSQL_GUILD_MEMBERSHIP_TABLE}\` membership
          WHERE membership.guild_id = guild.guild_id
            AND membership.player_id = ?
        )`
      );
      params.push(normalizePlayerId(options.playerId));
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await this.pool.query<GuildRow[]>(
      `SELECT
         guild.guild_id,
         guild.name,
         guild.tag,
         guild.description,
         guild.owner_player_id,
         guild.member_count,
         guild.state_json,
         guild.created_at,
         guild.updated_at
       FROM \`${MYSQL_GUILD_TABLE}\` guild
       ${whereClause}
       ORDER BY guild.member_count DESC, guild.updated_at DESC, guild.guild_id ASC
       LIMIT ?`,
      [...params, safeLimit]
    );

    return rows.map((row) => toGuildState(row));
  }

  async listPlayerReports(options: PlayerReportListOptions = {}): Promise<PlayerReportRecord[]> {
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 50));
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (options.status) {
      clauses.push("status = ?");
      params.push(normalizePlayerReportStatus(options.status));
    }
    if (options.roomId?.trim()) {
      clauses.push("room_id = ?");
      params.push(options.roomId.trim());
    }
    if (options.reporterId?.trim()) {
      clauses.push("reporter_id = ?");
      params.push(normalizePlayerId(options.reporterId));
    }
    if (options.targetId?.trim()) {
      clauses.push("target_id = ?");
      params.push(normalizePlayerId(options.targetId));
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const [rows] = await this.pool.query<PlayerReportRow[]>(
      `SELECT
         report_id,
         reporter_id,
         target_id,
         reason,
         description,
         room_id,
         status,
         created_at,
         resolved_at
       FROM \`${MYSQL_PLAYER_REPORT_TABLE}\`
       ${whereClause}
       ORDER BY created_at DESC, report_id DESC
       LIMIT ?`,
      [...params, safeLimit]
    );

    return rows.map((row) => toPlayerReportRecord(row));
  }

  async loadPlayerAccountAuthByLoginId(loginId: string): Promise<PlayerAccountAuthSnapshot | null> {
    const normalizedLoginId = normalizePlayerLoginId(loginId);
    const [rows] = await this.pool.query<PlayerAccountAuthRow[]>(
      `SELECT
         player_id,
         display_name,
         login_id,
         password_hash,
         account_session_version,
         refresh_session_id,
         refresh_token_hash,
         refresh_token_expires_at,
         credential_bound_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE login_id = ?
       LIMIT 1`,
      [normalizedLoginId]
    );

    const row = rows[0];
    return row ? toPlayerAccountAuthSnapshot(row) : null;
  }

  async listPlayerBanHistory(
    playerId: string,
    options: PlayerAccountBanHistoryListOptions = {}
  ): Promise<PlayerBanHistoryRecord[]> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    const [rows] = await this.pool.query<PlayerBanHistoryRow[]>(
      `SELECT
         id,
         player_id,
         action,
         ban_status,
         ban_expiry,
         ban_reason,
         created_at
       FROM \`${MYSQL_PLAYER_BAN_HISTORY_TABLE}\`
       WHERE player_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
      [normalizedPlayerId, safeLimit]
    );

    return rows.map((row) => toPlayerBanHistoryRecord(row));
  }

  async appendPlayerCompensationRecord(
    playerId: string,
    input: PlayerCompensationCreateInput
  ): Promise<PlayerCompensationRecord> {
    return appendPlayerCompensationHistoryEntry(this.pool, normalizePlayerId(playerId), input);
  }

  async listPlayerCompensationHistory(
    playerId: string,
    options: PlayerCompensationListOptions = {}
  ): Promise<PlayerCompensationRecord[]> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    const [rows] = await this.pool.query<PlayerCompensationHistoryRow[]>(
      `SELECT
         audit_id,
         player_id,
         type,
         currency,
         amount,
         reason,
         previous_balance,
         balance_after,
         created_at
       FROM \`${MYSQL_PLAYER_COMPENSATION_HISTORY_TABLE}\`
       WHERE player_id = ?
       ORDER BY created_at DESC, audit_id DESC
       LIMIT ?`,
      [normalizedPlayerId, safeLimit]
    );

    return rows.map((row) => toPlayerCompensationRecord(row));
  }

  async listPlayerPurchaseHistory(
    playerId: string,
    query: PlayerPurchaseHistoryQuery = {}
  ): Promise<PlayerPurchaseHistorySnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const safeLimit = Math.max(1, Math.floor(query.limit ?? 20));
    const safeOffset = Math.max(0, Math.floor(query.offset ?? 0));
    const filters = ["player_id = ?"];
    const filterParams: Array<string | number | Date> = [normalizedPlayerId];

    if (query.from) {
      const fromDate = new Date(query.from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new Error("from must be a valid ISO timestamp");
      }
      filters.push("created_at >= ?");
      filterParams.push(fromDate);
    }

    if (query.to) {
      const toDate = new Date(query.to);
      if (Number.isNaN(toDate.getTime())) {
        throw new Error("to must be a valid ISO timestamp");
      }
      filters.push("created_at <= ?");
      filterParams.push(toDate);
    }

    if (query.from && query.to && new Date(query.from).getTime() > new Date(query.to).getTime()) {
      throw new Error("from must be earlier than or equal to to");
    }

    if (query.itemId?.trim()) {
      filters.push("product_id = ?");
      filterParams.push(normalizeShopProductId(query.itemId));
    }

    const whereClause = filters.join(" AND ");
    const [countRows] = await this.pool.query<CountRow[]>(
      `SELECT COUNT(*) AS total
       FROM \`${MYSQL_SHOP_PURCHASE_TABLE}\`
       WHERE ${whereClause}`,
      filterParams
    );

    const [rows] = await this.pool.query<ShopPurchaseRow[]>(
      `SELECT
         player_id,
         purchase_id,
         product_id,
         quantity,
         unit_price,
         total_price,
         result_json,
         created_at
       FROM \`${MYSQL_SHOP_PURCHASE_TABLE}\`
       WHERE ${whereClause}
       ORDER BY created_at DESC, purchase_id DESC
       LIMIT ?
       OFFSET ?`,
      [...filterParams, safeLimit, safeOffset]
    );

    return {
      items: rows.map((row) => toPlayerPurchaseHistoryRecord(row)),
      total: Math.max(0, Math.floor(countRows[0]?.total ?? 0)),
      limit: safeLimit,
      offset: safeOffset
    };
  }

  async listPlayerNameHistory(
    playerId: string,
    options: PlayerNameHistoryListOptions = {}
  ): Promise<PlayerNameHistoryRecord[]> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    const [rows] = await this.pool.query<PlayerNameHistoryRow[]>(
      `SELECT
         id,
         player_id,
         display_name,
         normalized_name,
         changed_at,
         created_at
       FROM \`${MYSQL_PLAYER_NAME_HISTORY_TABLE}\`
       WHERE player_id = ?
       ORDER BY changed_at DESC, id DESC
       LIMIT ?`,
      [normalizedPlayerId, safeLimit]
    );

    return rows.map((row) => toPlayerNameHistoryRecord(row));
  }

  async findPlayerNameHistoryByDisplayName(
    displayName: string,
    options: PlayerNameLookupOptions = {}
  ): Promise<PlayerNameHistoryRecord[]> {
    const normalizedName = normalizePlayerDisplayNameLookup(displayName);
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    const [rows] = await this.pool.query<PlayerNameHistoryRow[]>(
      `SELECT
         id,
         player_id,
         display_name,
         normalized_name,
         changed_at,
         created_at
       FROM \`${MYSQL_PLAYER_NAME_HISTORY_TABLE}\`
       WHERE normalized_name = ?
       ORDER BY changed_at DESC, id DESC
       LIMIT ?`,
      [normalizedName, safeLimit]
    );

    return rows.map((row) => toPlayerNameHistoryRecord(row));
  }

  async findActivePlayerNameReservation(displayName: string): Promise<PlayerNameReservationRecord | null> {
    const normalizedName = normalizePlayerDisplayNameLookup(displayName);
    const [rows] = await this.pool.query<PlayerNameReservationRow[]>(
      `SELECT
         id,
         player_id,
         display_name,
         normalized_name,
         reserved_until,
         reason,
         created_at
       FROM \`${MYSQL_PLAYER_NAME_RESERVATION_TABLE}\`
       WHERE normalized_name = ?
         AND reserved_until > UTC_TIMESTAMP()
       ORDER BY reserved_until DESC, id DESC
       LIMIT 1`,
      [normalizedName]
    );

    const row = rows[0];
    return row ? toPlayerNameReservationRecord(row) : null;
  }

  async ensurePlayerAccount(input: PlayerAccountEnsureInput): Promise<PlayerAccountSnapshot> {
    const playerId = normalizePlayerId(input.playerId);
    const existing = await this.loadPlayerAccount(playerId);
    const explicitDisplayName = input.displayName?.trim() ? normalizePlayerDisplayName(playerId, input.displayName) : null;
    const insertDisplayName = normalizePlayerDisplayName(playerId, explicitDisplayName);
    const nextDisplayName = explicitDisplayName ?? existing?.displayName ?? insertDisplayName;
    if (!existing || nextDisplayName !== existing.displayName) {
      await assertDisplayNameAvailableOrThrow(this, nextDisplayName, playerId);
    }
    const lastRoomId = input.lastRoomId?.trim() ? input.lastRoomId.trim() : null;
    const lastSeenAt = new Date();

    await this.pool.query(
      `INSERT INTO \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (
         player_id,
         display_name,
         elo_rating,
         rank_division,
         peak_rank_division,
         promotion_series_json,
         demotion_shield_json,
         season_history_json,
         ranked_weekly_progress_json,
         gems,
         season_xp,
         season_pass_tier,
         season_pass_premium,
         season_pass_claimed_tiers_json,
         season_badges_json,
         campaign_progress_json,
         seasonal_event_states_json,
         mailbox_json,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         daily_dungeon_state_json,
         tutorial_step,
         last_room_id,
         last_seen_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = COALESCE(?, display_name),
         last_room_id = COALESCE(?, last_room_id),
         last_seen_at = VALUES(last_seen_at),
         version = version + 1`,
      [
        playerId,
        insertDisplayName,
        normalizeEloRating(undefined),
        getRankDivisionForRating(undefined),
        getRankDivisionForRating(undefined),
        JSON.stringify(null),
        JSON.stringify(null),
        JSON.stringify([]),
        JSON.stringify(null),
        0,
        0,
        1,
        0,
        JSON.stringify(null),
        JSON.stringify(normalizeResourceLedger()),
        JSON.stringify(normalizeAchievementProgress()),
        JSON.stringify(normalizeEventLogEntries()),
        JSON.stringify(appendPlayerBattleReplaySummaries([], [])),
        JSON.stringify(null),
        DEFAULT_TUTORIAL_STEP,
        lastRoomId,
        lastSeenAt,
        explicitDisplayName,
        lastRoomId
      ]
    );

    if (!existing || existing.displayName !== nextDisplayName) {
      await appendPlayerNameHistoryEntry(this.pool, playerId, nextDisplayName, lastSeenAt.toISOString());
    }

    return (
      (await this.loadPlayerAccount(playerId)) ??
      normalizePlayerAccountSnapshot({
        playerId,
        displayName: nextDisplayName,
        eloRating: normalizeEloRating(undefined),
        seasonXp: 0,
        seasonPassTier: 1,
        seasonBadges: [],
        globalResources: normalizeResourceLedger(),
        achievements: normalizeAchievementProgress(),
        recentEventLog: normalizeEventLogEntries(),
        recentBattleReplays: appendPlayerBattleReplaySummaries([], []),
        tutorialStep: DEFAULT_TUTORIAL_STEP,
        ...(lastRoomId ? { lastRoomId } : {}),
        lastSeenAt: lastSeenAt.toISOString()
      })
    );
  }

  async savePlayerBan(playerId: string, input: PlayerAccountBanInput): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existingAccount = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const banStatus = normalizePlayerBanStatus(input.banStatus);
    const banReason = normalizePlayerBanReason(input.banReason);
    const banExpiry = normalizePlayerBanExpiry(input.banExpiry);
    if (banStatus === "none") {
      throw new Error("banStatus must be temporary or permanent");
    }
    if (!banReason) {
      throw new Error("banReason must not be empty");
    }
    if (banStatus === "temporary") {
      if (!banExpiry) {
        throw new Error("temporary bans require banExpiry");
      }
      if (new Date(banExpiry).getTime() <= Date.now()) {
        throw new Error("banExpiry must be in the future");
      }
    }

    await this.pool.query(
      `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       SET ban_status = ?,
           ban_expiry = ?,
           ban_reason = ?,
           version = version + 1
       WHERE player_id = ?`,
      [banStatus, banStatus === "temporary" ? new Date(banExpiry!) : null, banReason, normalizedPlayerId]
    );
    await appendPlayerBanHistoryEntry(this.pool, normalizedPlayerId, {
      action: "ban",
      banStatus,
      ...(banStatus === "temporary" && banExpiry ? { banExpiry } : {}),
      banReason
    });
    const historicalNames = await this.listPlayerNameHistory(normalizedPlayerId, { limit: 100 });
    await reservePlayerNamesForBannedAccount(
      this.pool,
      normalizedPlayerId,
      Array.from(new Set([existingAccount.displayName, ...historicalNames.map((entry) => entry.displayName)])),
      buildBannedAccountNameReservationExpiry()
    );

    return (
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        ...existingAccount,
        banStatus,
        ...(banStatus === "temporary" && banExpiry ? { banExpiry } : {}),
        banReason
      })
    );
  }

  async clearPlayerBan(playerId: string, input: PlayerAccountUnbanInput = {}): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existingAccount = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const reason = normalizePlayerBanReason(input.reason);

    await this.pool.query(
      `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       SET ban_status = 'none',
           ban_expiry = NULL,
           ban_reason = NULL,
           version = version + 1
       WHERE player_id = ?`,
      [normalizedPlayerId]
    );
    await appendPlayerBanHistoryEntry(this.pool, normalizedPlayerId, {
      action: "unban",
      banStatus: "none",
      ...(reason ? { banReason: reason } : {})
    });

    return (
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        ...existingAccount,
        banStatus: "none"
      })
    );
  }

  async loadPlayerAccountAuthByPlayerId(playerId: string): Promise<PlayerAccountAuthSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const [rows] = await this.pool.query<PlayerAccountAuthRow[]>(
      `SELECT
         player_id,
         display_name,
         login_id,
         password_hash,
         account_session_version,
         refresh_session_id,
         refresh_token_hash,
         refresh_token_expires_at,
         credential_bound_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE player_id = ?
       LIMIT 1`,
      [normalizedPlayerId]
    );

    const row = rows[0];
    return row ? toPlayerAccountAuthSnapshot(row) : null;
  }

  async loadPlayerAccountAuthSession(
    playerId: string,
    sessionId: string
  ): Promise<PlayerAccountDeviceSessionSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedSessionId = normalizeAuthSessionId(sessionId);
    const [rows] = await this.pool.query<PlayerAccountDeviceSessionRow[]>(
      `SELECT
         player_id,
         session_id,
         provider,
         device_label,
         refresh_token_hash,
         refresh_token_expires_at,
         created_at,
         last_used_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\`
       WHERE player_id = ?
         AND session_id = ?
       LIMIT 1`,
      [normalizedPlayerId, normalizedSessionId]
    );

    const row = rows[0];
    return row ? toPlayerAccountDeviceSessionSnapshot(row) : null;
  }

  async listPlayerAccountAuthSessions(playerId: string): Promise<PlayerAccountDeviceSessionSnapshot[]> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const [rows] = await this.pool.query<PlayerAccountDeviceSessionRow[]>(
      `SELECT
         player_id,
         session_id,
         provider,
         device_label,
         refresh_token_hash,
         refresh_token_expires_at,
         created_at,
         last_used_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\`
       WHERE player_id = ?
       ORDER BY last_used_at DESC, created_at DESC, session_id ASC`,
      [normalizedPlayerId]
    );

    return rows.map((row) => toPlayerAccountDeviceSessionSnapshot(row));
  }

  async touchPlayerAccountAuthSession(playerId: string, sessionId: string, lastUsedAt?: string): Promise<void> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedSessionId = normalizeAuthSessionId(sessionId);
    const normalizedLastUsedAt = lastUsedAt ? new Date(lastUsedAt) : new Date();
    if (Number.isNaN(normalizedLastUsedAt.getTime())) {
      throw new Error("lastUsedAt must be a valid ISO timestamp");
    }

    await this.pool.query(
      `UPDATE \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\`
       SET last_used_at = ?
       WHERE player_id = ?
         AND session_id = ?`,
      [normalizedLastUsedAt, normalizedPlayerId, normalizedSessionId]
    );
  }

  async revokePlayerAccountAuthSession(playerId: string, sessionId: string): Promise<boolean> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedSessionId = normalizeAuthSessionId(sessionId);
    const [result] = await this.pool.query<ResultSetHeader>(
      `DELETE FROM \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\`
       WHERE player_id = ?
         AND session_id = ?`,
      [normalizedPlayerId, normalizedSessionId]
    );

    return result.affectedRows > 0;
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

  async creditGems(playerId: string, amount: number, reason: GemLedgerReason, refId: string): Promise<PlayerAccountSnapshot> {
    const normalizedReason = normalizeGemLedgerReason(reason);
    if (normalizedReason === "spend") {
      throw new Error("credit reason must be purchase or reward");
    }

    return this.mutateGems(playerId, normalizePositiveGemDelta(amount), normalizedReason, refId);
  }

  async debitGems(playerId: string, amount: number, reason: GemLedgerReason, refId: string): Promise<PlayerAccountSnapshot> {
    const normalizedReason = normalizeGemLedgerReason(reason);
    if (normalizedReason !== "spend") {
      throw new Error("debit reason must be spend");
    }

    return this.mutateGems(playerId, -normalizePositiveGemDelta(amount), normalizedReason, refId);
  }

  async claimPlayerReferral(
    referrerId: string,
    newPlayerId: string,
    rewardGems: number
  ): Promise<PlayerReferralClaimResult> {
    const normalizedReferrerId = normalizePlayerId(referrerId);
    const normalizedNewPlayerId = normalizePlayerId(newPlayerId);
    const normalizedRewardGems = normalizePositiveGemDelta(rewardGems);
    if (normalizedReferrerId === normalizedNewPlayerId) {
      throw new Error("self_referral_forbidden");
    }

    await this.ensurePlayerAccount({ playerId: normalizedReferrerId });
    await this.ensurePlayerAccount({ playerId: normalizedNewPlayerId });

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query<RowDataPacket[]>(
        `SELECT player_id
         FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         WHERE player_id IN (?, ?)
         FOR UPDATE`,
        [normalizedReferrerId, normalizedNewPlayerId]
      );

      const referralId = randomUUID();
      try {
        await connection.query(
          `INSERT INTO \`${MYSQL_PLAYER_REFERRAL_TABLE}\`
             (id, referrer_id, new_player_id, reward_gems)
           VALUES (?, ?, ?, ?)`,
          [referralId, normalizedReferrerId, normalizedNewPlayerId, normalizedRewardGems]
        );
      } catch (error) {
        if (isMySqlDuplicateEntryError(error)) {
          throw new Error("duplicate_referral");
        }
        throw error;
      }

      const rewardedPlayers = [
        {
          playerId: normalizedReferrerId,
          refId: `referral:${referralId}:referrer`
        },
        {
          playerId: normalizedNewPlayerId,
          refId: `referral:${referralId}:new-player`
        }
      ];

      for (const player of rewardedPlayers) {
        await connection.query(
          `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
           SET gems = gems + ?,
               version = version + 1
           WHERE player_id = ?`,
          [normalizedRewardGems, player.playerId]
        );
        await appendGemLedgerEntry(connection, {
          entryId: randomUUID(),
          playerId: player.playerId,
          delta: normalizedRewardGems,
          reason: "reward",
          refId: player.refId
        });
      }

      await connection.commit();
      return {
        claimed: true,
        rewardGems: normalizedRewardGems,
        referrerId: normalizedReferrerId,
        newPlayerId: normalizedNewPlayerId
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async deliverPlayerMailbox(input: PlayerMailboxDeliveryInput): Promise<PlayerMailboxDeliveryResult> {
    const playerIds = Array.from(new Set(input.playerIds.map((playerId) => normalizePlayerId(playerId)).filter(Boolean)));
    if (playerIds.length === 0) {
      throw new Error("playerIds must not be empty");
    }

    const message = normalizePlayerMailboxMessage(input.message);
    const deliveredPlayerIds: string[] = [];
    const skippedPlayerIds: string[] = [];

    for (const playerId of playerIds) {
      const account = await this.ensurePlayerAccount({ playerId });
      const mailboxResult = deliverPlayerMailboxMessage(account.mailbox, message);
      if (!mailboxResult.delivered) {
        skippedPlayerIds.push(playerId);
        continue;
      }

      await this.savePlayerAccountProgress(playerId, {
        mailbox: mailboxResult.mailbox
      });
      deliveredPlayerIds.push(playerId);
    }

    return {
      deliveredPlayerIds,
      skippedPlayerIds,
      message
    };
  }

  async claimPlayerMailboxMessage(
    playerId: string,
    messageId: string,
    claimedAt?: string
  ): Promise<PlayerMailboxClaimResult> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const claimedAtDate = claimedAt ? new Date(claimedAt) : new Date();
    if (Number.isNaN(claimedAtDate.getTime())) {
      throw new Error("claimedAt must be a valid ISO timestamp");
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<PlayerAccountRow[]>(
        `SELECT *
         FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         WHERE player_id = ?
         LIMIT 1
         FOR UPDATE`,
        [normalizedPlayerId]
      );
      const currentAccount = rows[0] ? toPlayerAccountSnapshot(rows[0]) : null;
      if (!currentAccount) {
        throw new Error("player account not found");
      }

      const result = claimPlayerMailboxMessage(currentAccount.mailbox, messageId, claimedAtDate);
      if (!result.claimed || !result.message || !result.granted) {
        await connection.commit();
        return result;
      }

      await applyMailboxClaimsToAccount(connection, currentAccount, {
        playerId: normalizedPlayerId,
        mailbox: result.mailbox,
        claims: [{ message: result.message, granted: result.granted }]
      });
      await connection.commit();
      return {
        ...result,
        mailbox: (await this.loadPlayerAccount(normalizedPlayerId))?.mailbox ?? result.mailbox,
        summary: summarizePlayerMailbox((await this.loadPlayerAccount(normalizedPlayerId))?.mailbox ?? result.mailbox)
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async claimAllPlayerMailboxMessages(playerId: string, claimedAt?: string): Promise<PlayerMailboxClaimAllResult> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const claimedAtDate = claimedAt ? new Date(claimedAt) : new Date();
    if (Number.isNaN(claimedAtDate.getTime())) {
      throw new Error("claimedAt must be a valid ISO timestamp");
    }

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query<PlayerAccountRow[]>(
        `SELECT *
         FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         WHERE player_id = ?
         LIMIT 1
         FOR UPDATE`,
        [normalizedPlayerId]
      );
      const currentAccount = rows[0] ? toPlayerAccountSnapshot(rows[0]) : null;
      if (!currentAccount) {
        throw new Error("player account not found");
      }

      const result = claimAllPlayerMailboxMessages(currentAccount.mailbox, claimedAtDate);
      if (!result.claimed) {
        await connection.commit();
        return result;
      }

      const claimedMessages = result.claimedMessageIds
        .map((messageId) => result.mailbox.find((entry) => entry.id === messageId))
        .filter((message): message is PlayerMailboxMessage => Boolean(message))
        .map((message, index) => ({
          message,
          granted: result.granted[index] ?? normalizePlayerMailboxGrant(message.grant)
        }));

      await applyMailboxClaimsToAccount(connection, currentAccount, {
        playerId: normalizedPlayerId,
        mailbox: result.mailbox,
        claims: claimedMessages
      });
      await connection.commit();
      return {
        ...result,
        mailbox: (await this.loadPlayerAccount(normalizedPlayerId))?.mailbox ?? result.mailbox,
        summary: summarizePlayerMailbox((await this.loadPlayerAccount(normalizedPlayerId))?.mailbox ?? result.mailbox)
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async createPaymentOrder(input: PaymentOrderCreateInput): Promise<PaymentOrderSnapshot> {
    const orderId = normalizePaymentOrderId(input.orderId);
    const playerId = normalizePlayerId(input.playerId);
    const productId = normalizeShopProductId(input.productId);
    const amount = normalizePaymentAmount(input.amount);
    const gemAmount = normalizeGemAmount(input.gemAmount);

    await this.ensurePlayerAccount({ playerId });

    await this.pool.query(
      `INSERT INTO \`${MYSQL_PAYMENT_ORDER_TABLE}\`
         (order_id, player_id, product_id, status, amount, gem_amount)
       VALUES (?, ?, ?, 'created', ?, ?)`,
      [orderId, playerId, productId, amount, gemAmount]
    );

    const now = new Date().toISOString();
    return {
      orderId,
      playerId,
      productId,
      status: "created",
      amount,
      gemAmount,
      createdAt: now,
      updatedAt: now,
      grantAttemptCount: 0
    };
  }

  async completePaymentOrder(orderId: string, input: PaymentOrderCompleteInput): Promise<PaymentOrderSettlement> {
    const normalizedOrderId = normalizePaymentOrderId(orderId);
    const normalizedWechatOrderId = normalizeWechatOrderId(input.wechatOrderId);
    const paidAt = input.paidAt ? new Date(input.paidAt) : new Date();
    const verifiedAt = input.verifiedAt ? new Date(input.verifiedAt) : paidAt;
    const normalizedProductName = normalizeShopProductName(input.productName);
    if (Number.isNaN(paidAt.getTime())) {
      throw new Error("paidAt must be a valid ISO timestamp");
    }
    if (Number.isNaN(verifiedAt.getTime())) {
      throw new Error("verifiedAt must be a valid ISO timestamp");
    }
    const retryPolicy = normalizePaymentGrantRetryPolicy(input.retryPolicy);

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [orderRows] = await connection.query<PaymentOrderRow[]>(
        `SELECT
           order_id,
           player_id,
           product_id,
           wechat_order_id,
           status,
           amount,
           gem_amount,
           created_at,
           paid_at,
           last_grant_attempt_at,
           next_grant_retry_at,
           settled_at,
           dead_lettered_at,
           grant_attempt_count,
           last_grant_error,
           updated_at
         FROM \`${MYSQL_PAYMENT_ORDER_TABLE}\`
         WHERE order_id = ?
         LIMIT 1
         FOR UPDATE`,
        [normalizedOrderId]
      );
      const currentOrderRow = orderRows[0];
      if (!currentOrderRow) {
        throw new Error("payment_order_not_found");
      }

      const currentOrder = toPaymentOrderSnapshot(currentOrderRow);
      const [accountRows] = await connection.query<PlayerAccountRow[]>(
        `SELECT *
         FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         WHERE player_id = ?
         LIMIT 1
         FOR UPDATE`,
        [currentOrder.playerId]
      );
      const currentAccount =
        accountRows[0] != null
          ? toPlayerAccountSnapshot(accountRows[0])
          : normalizePlayerAccountSnapshot({
              playerId: currentOrder.playerId,
              displayName: currentOrder.playerId,
              globalResources: normalizeResourceLedger()
            });

      if (currentOrder.status !== "created") {
        const [receiptRows] = await connection.query<PaymentReceiptRow[]>(
          `SELECT
             transaction_id,
             order_id,
             player_id,
             product_id,
             amount,
             verified_at
           FROM \`${MYSQL_PAYMENT_RECEIPT_TABLE}\`
           WHERE order_id = ?
           LIMIT 1`,
          [currentOrder.orderId]
        );
        await connection.commit();
        return {
          order: {
            ...currentOrder,
            ...(currentOrder.wechatOrderId ? { wechatOrderId: currentOrder.wechatOrderId } : { wechatOrderId: normalizedWechatOrderId }),
            ...(currentOrder.paidAt ? { paidAt: currentOrder.paidAt } : { paidAt: paidAt.toISOString() })
          },
          account: currentAccount,
          credited: false,
            ...(receiptRows[0] ? { receipt: toPaymentReceiptSnapshot(receiptRows[0]) } : {})
        };
      }

      let receipt: PaymentReceiptSnapshot;
      try {
        await connection.query(
          `INSERT INTO \`${MYSQL_PAYMENT_RECEIPT_TABLE}\`
             (transaction_id, order_id, player_id, product_id, amount, verified_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [normalizedWechatOrderId, currentOrder.orderId, currentOrder.playerId, currentOrder.productId, currentOrder.amount, verifiedAt]
        );
        receipt = {
          transactionId: normalizedWechatOrderId,
          orderId: currentOrder.orderId,
          playerId: currentOrder.playerId,
          productId: currentOrder.productId,
          amount: currentOrder.amount,
          verifiedAt: verifiedAt.toISOString()
        };
      } catch (error) {
        if (!isMySqlDuplicateEntryError(error)) {
          throw error;
        }

        const [receiptRows] = await connection.query<PaymentReceiptRow[]>(
          `SELECT
             transaction_id,
             order_id,
             player_id,
             product_id,
             amount,
             verified_at
           FROM \`${MYSQL_PAYMENT_RECEIPT_TABLE}\`
           WHERE order_id = ?
              OR transaction_id = ?
           LIMIT 1`,
          [currentOrder.orderId, normalizedWechatOrderId]
        );
        const existingReceipt = receiptRows[0];
        await connection.commit();
        return {
          order: currentOrder,
          account: currentAccount,
          credited: false,
          ...(existingReceipt ? { receipt: toPaymentReceiptSnapshot(existingReceipt) } : {})
        };
      }

      await connection.query(
        `UPDATE \`${MYSQL_PAYMENT_ORDER_TABLE}\`
         SET wechat_order_id = ?,
             status = 'paid',
             paid_at = ?,
             last_grant_attempt_at = ?,
             next_grant_retry_at = NULL,
             settled_at = NULL,
             dead_lettered_at = NULL,
             grant_attempt_count = 1,
             last_grant_error = NULL
         WHERE order_id = ?`,
        [normalizedWechatOrderId, paidAt, paidAt, currentOrder.orderId]
      );

      try {
        const nextAccount = await applyVerifiedPaymentGrantToAccount(connection, currentAccount, {
          playerId: currentOrder.playerId,
          productId: currentOrder.productId,
          productName: normalizedProductName,
          grant: input.grant,
          refId: currentOrder.orderId,
          processedAt: paidAt.toISOString()
        });

        await connection.query(
          `UPDATE \`${MYSQL_PAYMENT_ORDER_TABLE}\`
           SET status = 'settled',
               settled_at = ?,
               next_grant_retry_at = NULL,
               dead_lettered_at = NULL,
               last_grant_error = NULL
           WHERE order_id = ?`,
          [paidAt, currentOrder.orderId]
        );

        await connection.commit();

        return {
          order: {
            ...currentOrder,
            status: "settled",
            wechatOrderId: normalizedWechatOrderId,
            paidAt: paidAt.toISOString(),
            lastGrantAttemptAt: paidAt.toISOString(),
            grantAttemptCount: 1,
            settledAt: paidAt.toISOString(),
            updatedAt: paidAt.toISOString()
          },
          account: nextAccount,
          credited: true,
          receipt
        };
      } catch (error) {
        const grantError = normalizePaymentGrantError(error instanceof Error ? error.message : String(error)) ?? "grant_failed";
        const nextDelayMs = computePaymentGrantRetryDelayMs(1, retryPolicy.baseDelayMs);
        const nextRetryAt = new Date(paidAt.getTime() + nextDelayMs);
        const deadLetter = 1 >= retryPolicy.maxAttempts;

        await connection.query(
          `UPDATE \`${MYSQL_PAYMENT_ORDER_TABLE}\`
           SET status = ?,
               next_grant_retry_at = ?,
               dead_lettered_at = ?,
               last_grant_error = ?
           WHERE order_id = ?`,
          [
            deadLetter ? "dead_letter" : "grant_pending",
            deadLetter ? null : nextRetryAt,
            deadLetter ? paidAt : null,
            grantError,
            currentOrder.orderId
          ]
        );

        await connection.commit();

        return {
          order: {
            ...currentOrder,
            status: deadLetter ? "dead_letter" : "grant_pending",
            wechatOrderId: normalizedWechatOrderId,
            paidAt: paidAt.toISOString(),
            lastGrantAttemptAt: paidAt.toISOString(),
            grantAttemptCount: 1,
            lastGrantError: grantError,
            ...(deadLetter ? { deadLetteredAt: paidAt.toISOString() } : { nextGrantRetryAt: nextRetryAt.toISOString() }),
            updatedAt: paidAt.toISOString()
          },
          account: currentAccount,
          credited: false,
          receipt
        };
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async retryPaymentOrderGrant(orderId: string, input: PaymentOrderGrantRetryInput): Promise<PaymentOrderSettlement> {
    const normalizedOrderId = normalizePaymentOrderId(orderId);
    const retriedAt = input.retriedAt ? new Date(input.retriedAt) : new Date();
    const normalizedProductName = normalizeShopProductName(input.productName);
    if (Number.isNaN(retriedAt.getTime())) {
      throw new Error("retriedAt must be a valid ISO timestamp");
    }
    const retryPolicy = normalizePaymentGrantRetryPolicy(input.retryPolicy);

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [orderRows] = await connection.query<PaymentOrderRow[]>(
        `SELECT
           order_id,
           player_id,
           product_id,
           wechat_order_id,
           status,
           amount,
           gem_amount,
           created_at,
           paid_at,
           last_grant_attempt_at,
           next_grant_retry_at,
           settled_at,
           dead_lettered_at,
           grant_attempt_count,
           last_grant_error,
           updated_at
         FROM \`${MYSQL_PAYMENT_ORDER_TABLE}\`
         WHERE order_id = ?
         LIMIT 1
         FOR UPDATE`,
        [normalizedOrderId]
      );
      const currentOrderRow = orderRows[0];
      if (!currentOrderRow) {
        throw new Error("payment_order_not_found");
      }

      const currentOrder = toPaymentOrderSnapshot(currentOrderRow);
      if (currentOrder.status === "settled") {
        const account = (await this.loadPlayerAccount(currentOrder.playerId)) ?? (await this.ensurePlayerAccount({ playerId: currentOrder.playerId }));
        const receipt = await this.loadPaymentReceiptByOrderId(currentOrder.orderId);
        await connection.commit();
        return {
          order: currentOrder,
          account,
          credited: false,
          ...(receipt ? { receipt } : {})
        };
      }
      if (currentOrder.status !== "grant_pending" && currentOrder.status !== "dead_letter" && currentOrder.status !== "paid") {
        throw new Error("payment_order_not_retryable");
      }
      if (currentOrder.status === "dead_letter" && input.allowDeadLetter !== true) {
        throw new Error("payment_order_retry_requires_override");
      }

      const [accountRows] = await connection.query<PlayerAccountRow[]>(
        `SELECT *
         FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         WHERE player_id = ?
         LIMIT 1
         FOR UPDATE`,
        [currentOrder.playerId]
      );
      const currentAccount =
        accountRows[0] != null
          ? toPlayerAccountSnapshot(accountRows[0])
          : normalizePlayerAccountSnapshot({
              playerId: currentOrder.playerId,
              displayName: currentOrder.playerId,
              globalResources: normalizeResourceLedger()
            });
      const [receiptRows] = await connection.query<PaymentReceiptRow[]>(
        `SELECT
           transaction_id,
           order_id,
           player_id,
           product_id,
           amount,
           verified_at
         FROM \`${MYSQL_PAYMENT_RECEIPT_TABLE}\`
         WHERE order_id = ?
         LIMIT 1`,
        [currentOrder.orderId]
      );
      const receiptRow = receiptRows[0];
      if (!receiptRow) {
        throw new Error("payment_receipt_not_found");
      }
      const receipt = toPaymentReceiptSnapshot(receiptRow);
      const attemptCount = currentOrder.grantAttemptCount + 1;
      const {
        nextGrantRetryAt: _previousNextGrantRetryAt,
        lastGrantError: _previousLastGrantError,
        deadLetteredAt: _previousDeadLetteredAt,
        settledAt: _previousSettledAt,
        ...retryBaseOrder
      } = currentOrder;

      try {
        const nextAccount = await applyVerifiedPaymentGrantToAccount(connection, currentAccount, {
          playerId: currentOrder.playerId,
          productId: currentOrder.productId,
          productName: normalizedProductName,
          grant: input.grant,
          refId: currentOrder.orderId,
          processedAt: retriedAt.toISOString()
        });

        await connection.query(
          `UPDATE \`${MYSQL_PAYMENT_ORDER_TABLE}\`
           SET status = 'settled',
               last_grant_attempt_at = ?,
               next_grant_retry_at = NULL,
               settled_at = ?,
               dead_lettered_at = NULL,
               grant_attempt_count = ?,
               last_grant_error = NULL
           WHERE order_id = ?`,
          [retriedAt, retriedAt, attemptCount, currentOrder.orderId]
        );

        await connection.commit();

        return {
          order: {
            ...retryBaseOrder,
            status: "settled",
            lastGrantAttemptAt: retriedAt.toISOString(),
            settledAt: retriedAt.toISOString(),
            grantAttemptCount: attemptCount,
            updatedAt: retriedAt.toISOString()
          },
          account: nextAccount,
          credited: true,
          receipt
        };
      } catch (error) {
        const grantError = normalizePaymentGrantError(error instanceof Error ? error.message : String(error)) ?? "grant_failed";
        const deadLetter = attemptCount >= retryPolicy.maxAttempts;
        const nextDelayMs = computePaymentGrantRetryDelayMs(attemptCount, retryPolicy.baseDelayMs);
        const nextRetryAt = new Date(retriedAt.getTime() + nextDelayMs);

        await connection.query(
          `UPDATE \`${MYSQL_PAYMENT_ORDER_TABLE}\`
           SET status = ?,
               last_grant_attempt_at = ?,
               next_grant_retry_at = ?,
               settled_at = NULL,
               dead_lettered_at = ?,
               grant_attempt_count = ?,
               last_grant_error = ?
           WHERE order_id = ?`,
          [
            deadLetter ? "dead_letter" : "grant_pending",
            retriedAt,
            deadLetter ? null : nextRetryAt,
            deadLetter ? retriedAt : null,
            attemptCount,
            grantError,
            currentOrder.orderId
          ]
        );

        await connection.commit();

        return {
          order: {
            ...retryBaseOrder,
            status: deadLetter ? "dead_letter" : "grant_pending",
            lastGrantAttemptAt: retriedAt.toISOString(),
            grantAttemptCount: attemptCount,
            lastGrantError: grantError,
            updatedAt: retriedAt.toISOString(),
            ...(deadLetter ? { deadLetteredAt: retriedAt.toISOString() } : { nextGrantRetryAt: nextRetryAt.toISOString() })
          },
          account: currentAccount,
          credited: false,
          receipt
        };
      }
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async purchaseShopProduct(playerId: string, input: ShopPurchaseMutationInput): Promise<ShopPurchaseResult> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedPurchaseId = normalizeShopPurchaseId(input.purchaseId);
    const normalizedProductId = normalizeShopProductId(input.productId);
    const normalizedProductName = normalizeShopProductName(input.productName);
    const normalizedQuantity = normalizeShopPurchaseQuantity(input.quantity);
    const normalizedUnitPrice = normalizeGemAmount(input.unitPrice);
    const normalizedGrant = multiplyShopPurchaseGrant(normalizeShopPurchaseGrant(input.grant), normalizedQuantity);
    const totalPrice = normalizedUnitPrice * normalizedQuantity;

    await this.ensurePlayerAccount({ playerId: normalizedPlayerId });

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [existingPurchaseRows] = await connection.query<ShopPurchaseRow[]>(
        `SELECT player_id, purchase_id, product_id, quantity, unit_price, total_price, result_json, created_at
         FROM \`${MYSQL_SHOP_PURCHASE_TABLE}\`
         WHERE player_id = ? AND purchase_id = ?
         LIMIT 1
         FOR UPDATE`,
        [normalizedPlayerId, normalizedPurchaseId]
      );
      const existingPurchase = existingPurchaseRows[0];
      if (existingPurchase) {
        await connection.commit();
        return toShopPurchaseResult(existingPurchase);
      }

      const [accountRows] = await connection.query<PlayerAccountRow[]>(
        `SELECT *
         FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         WHERE player_id = ?
         LIMIT 1
         FOR UPDATE`,
        [normalizedPlayerId]
      );
      const currentAccount =
        accountRows[0] != null
          ? toPlayerAccountSnapshot(accountRows[0])
          : normalizePlayerAccountSnapshot({
              playerId: normalizedPlayerId,
              displayName: normalizedPlayerId,
              globalResources: normalizeResourceLedger()
            });
      const currentGems = normalizeGemAmount(currentAccount.gems);

      if (currentGems < totalPrice) {
        throw new Error("insufficient gems");
      }

      let grantedHeroId: string | undefined;
      let nextHeroArchive: PlayerHeroArchiveSnapshot | null = null;
      if (normalizedGrant.equipmentIds.length > 0) {
        const [heroArchiveRows] = await connection.query<PlayerHeroArchiveRow[]>(
          `SELECT player_id, hero_id, hero_json, army_template_id, army_count, learned_skills_json, equipment_json, inventory_json, updated_at
           FROM \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\`
           WHERE player_id = ?
           ORDER BY updated_at DESC, hero_id ASC
           LIMIT 1
           FOR UPDATE`,
          [normalizedPlayerId]
        );
        const currentArchive = heroArchiveRows[0] ? toPlayerHeroArchiveSnapshot(heroArchiveRows[0]) : null;
        if (!currentArchive) {
          throw new Error("player hero archive not found");
        }

        let nextInventory = [...currentArchive.hero.loadout.inventory];
        for (const equipmentId of normalizedGrant.equipmentIds) {
          const inventoryUpdate = tryAddEquipmentToInventory(nextInventory, equipmentId);
          if (!inventoryUpdate.stored) {
            throw new Error("equipment inventory full");
          }
          nextInventory = inventoryUpdate.inventory;
        }

        grantedHeroId = currentArchive.heroId;
        nextHeroArchive = {
          ...currentArchive,
          hero: normalizeHeroState({
            ...currentArchive.hero,
            loadout: {
              ...currentArchive.hero.loadout,
              inventory: nextInventory
            }
          })
        };
      }

      const processedAt = new Date().toISOString();
      const nextRecentEventLog = appendEventLogEntries(
        currentAccount.recentEventLog,
        [
          createShopPurchaseEventLogEntry(normalizedPlayerId, {
            productId: normalizedProductId,
            productName: normalizedProductName,
            quantity: normalizedQuantity,
            granted: normalizedGrant,
            processedAt
          })
        ]
      );
      const nextGlobalResources = addResourceLedgers(currentAccount.globalResources, normalizedGrant.resources);
      const nextGems = currentGems - totalPrice + normalizedGrant.gems;
      const nextSeasonPassPremium = currentAccount.seasonPassPremium === true || normalizedGrant.seasonPassPremium;
      const nextCosmeticInventory = applyOwnedCosmetics(currentAccount.cosmeticInventory, normalizedGrant.cosmeticIds);

      await connection.query(
        `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         SET gems = ?,
             season_pass_premium = ?,
             cosmetic_inventory_json = ?,
             global_resources_json = ?,
             recent_event_log_json = ?,
             version = version + 1
         WHERE player_id = ?`,
        [
          nextGems,
          nextSeasonPassPremium ? 1 : 0,
          JSON.stringify(nextCosmeticInventory),
          JSON.stringify(nextGlobalResources),
          JSON.stringify(nextRecentEventLog),
          normalizedPlayerId
        ]
      );
      await appendGemLedgerEntry(connection, {
        entryId: randomUUID(),
        playerId: normalizedPlayerId,
        delta: -totalPrice,
        reason: "spend",
        refId: normalizedPurchaseId
      });
      if (normalizedGrant.gems > 0) {
        await appendGemLedgerEntry(connection, {
          entryId: randomUUID(),
          playerId: normalizedPlayerId,
          delta: normalizedGrant.gems,
          reason: "reward",
          refId: normalizedPurchaseId
        });
      }

      if (nextHeroArchive) {
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
             updated_at = CURRENT_TIMESTAMP`,
          [
            nextHeroArchive.playerId,
            nextHeroArchive.heroId,
            JSON.stringify(nextHeroArchive.hero),
            nextHeroArchive.hero.armyTemplateId,
            nextHeroArchive.hero.armyCount,
            JSON.stringify(nextHeroArchive.hero.loadout.learnedSkills),
            JSON.stringify(nextHeroArchive.hero.loadout.equipment),
            JSON.stringify(nextHeroArchive.hero.loadout.inventory)
          ]
        );
      }

      const result: ShopPurchaseResult = {
        purchaseId: normalizedPurchaseId,
        productId: normalizedProductId,
        quantity: normalizedQuantity,
        unitPrice: normalizedUnitPrice,
        totalPrice,
        granted: {
          gems: normalizedGrant.gems,
          resources: normalizedGrant.resources,
          equipmentIds: normalizedGrant.equipmentIds,
          cosmeticIds: normalizedGrant.cosmeticIds,
          ...(grantedHeroId ? { heroId: grantedHeroId } : {}),
          ...(normalizedGrant.seasonPassPremium ? { seasonPassPremium: true } : {})
        },
        gemsBalance: nextGems,
        processedAt
      };

      await connection.query(
        `INSERT INTO \`${MYSQL_SHOP_PURCHASE_TABLE}\`
           (player_id, purchase_id, product_id, quantity, unit_price, total_price, result_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          normalizedPlayerId,
          normalizedPurchaseId,
          normalizedProductId,
          normalizedQuantity,
          normalizedUnitPrice,
          totalPrice,
          JSON.stringify(result)
        ]
      );
      await appendPlayerEventHistoryEntries(connection, normalizedPlayerId, nextRecentEventLog.slice(0, 1));

      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async claimBattlePassTier(playerId: string, tier: number): Promise<BattlePassClaimResult> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedTier = Math.max(1, Math.floor(tier));
    const battlePassConfig = resolveBattlePassConfig();
    const tierConfig = resolveBattlePassTier(battlePassConfig, normalizedTier);
    if (!tierConfig) {
      throw new Error("battle_pass_tier_not_found");
    }

    await this.ensurePlayerAccount({ playerId: normalizedPlayerId });

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [accountRows] = await connection.query<PlayerAccountRow[]>(
        `SELECT *
         FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         WHERE player_id = ?
         LIMIT 1
         FOR UPDATE`,
        [normalizedPlayerId]
      );
      const currentAccount =
        accountRows[0] != null
          ? toPlayerAccountSnapshot(accountRows[0])
          : normalizePlayerAccountSnapshot({
              playerId: normalizedPlayerId,
              displayName: normalizedPlayerId,
              globalResources: normalizeResourceLedger()
            });

      if ((currentAccount.seasonPassTier ?? 1) < normalizedTier) {
        throw new Error("battle_pass_tier_locked");
      }
      if ((currentAccount.seasonPassClaimedTiers ?? []).includes(normalizedTier)) {
        throw new Error("battle_pass_tier_already_claimed");
      }

      const granted = toBattlePassRewardGrant(
        tierConfig.freeReward,
        currentAccount.seasonPassPremium ? tierConfig.premiumReward : undefined
      );

      let grantedHeroId: string | undefined;
      let nextHeroArchive: PlayerHeroArchiveSnapshot | null = null;
      if (granted.equipmentIds.length > 0) {
        const [heroArchiveRows] = await connection.query<PlayerHeroArchiveRow[]>(
          `SELECT player_id, hero_id, hero_json, army_template_id, army_count, learned_skills_json, equipment_json, inventory_json, updated_at
           FROM \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\`
           WHERE player_id = ?
           ORDER BY updated_at DESC, hero_id ASC
           LIMIT 1
           FOR UPDATE`,
          [normalizedPlayerId]
        );
        const currentArchive = heroArchiveRows[0] ? toPlayerHeroArchiveSnapshot(heroArchiveRows[0]) : null;
        if (!currentArchive) {
          throw new Error("player hero archive not found");
        }

        let nextInventory = [...currentArchive.hero.loadout.inventory];
        for (const equipmentId of granted.equipmentIds) {
          const inventoryUpdate = tryAddEquipmentToInventory(nextInventory, equipmentId);
          if (!inventoryUpdate.stored) {
            throw new Error("equipment inventory full");
          }
          nextInventory = inventoryUpdate.inventory;
        }

        grantedHeroId = currentArchive.heroId;
        nextHeroArchive = {
          ...currentArchive,
          hero: normalizeHeroState({
            ...currentArchive.hero,
            loadout: {
              ...currentArchive.hero.loadout,
              inventory: nextInventory
            }
          })
        };
      }

      const processedAt = new Date().toISOString();
      const nextRecentEventLog = appendEventLogEntries(currentAccount.recentEventLog, [
        createBattlePassClaimEventLogEntry(normalizedPlayerId, {
          tier: normalizedTier,
          granted,
          processedAt
        })
      ]);
      const nextGlobalResources = addResourceLedgers(currentAccount.globalResources, granted.resources);
      const nextGems = normalizeGemAmount(currentAccount.gems) + granted.gems;
      const nextClaimedTiers = [...(currentAccount.seasonPassClaimedTiers ?? []), normalizedTier].sort((a, b) => a - b);

      await connection.query(
        `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         SET gems = ?,
             season_pass_claimed_tiers_json = ?,
             global_resources_json = ?,
             recent_event_log_json = ?,
             version = version + 1
         WHERE player_id = ?`,
        [
          nextGems,
          JSON.stringify(nextClaimedTiers),
          JSON.stringify(nextGlobalResources),
          JSON.stringify(nextRecentEventLog),
          normalizedPlayerId
        ]
      );
      if (granted.gems > 0) {
        await appendGemLedgerEntry(connection, {
          entryId: randomUUID(),
          playerId: normalizedPlayerId,
          delta: granted.gems,
          reason: "reward",
          refId: `battle-pass:${normalizedTier}`
        });
      }

      if (nextHeroArchive) {
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
             updated_at = CURRENT_TIMESTAMP`,
          [
            nextHeroArchive.playerId,
            nextHeroArchive.heroId,
            JSON.stringify(nextHeroArchive.hero),
            nextHeroArchive.hero.armyTemplateId,
            nextHeroArchive.hero.armyCount,
            JSON.stringify(nextHeroArchive.hero.loadout.learnedSkills),
            JSON.stringify(nextHeroArchive.hero.loadout.equipment),
            JSON.stringify(nextHeroArchive.hero.loadout.inventory)
          ]
        );
      }

      await appendPlayerEventHistoryEntries(connection, normalizedPlayerId, nextRecentEventLog.slice(0, 1));
      await connection.commit();

      return {
        tier: normalizedTier,
        granted: {
          ...granted,
          equipmentIds: [...granted.equipmentIds]
        },
        seasonPassPremiumApplied: currentAccount.seasonPassPremium === true,
        account:
          (await this.loadPlayerAccount(normalizedPlayerId)) ??
          normalizePlayerAccountSnapshot({
            ...currentAccount,
            gems: nextGems,
            seasonPassClaimedTiers: nextClaimedTiers,
            globalResources: nextGlobalResources,
            recentEventLog: nextRecentEventLog,
            ...(grantedHeroId ? {} : {})
          })
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  private async mutateGems(
    playerId: string,
    delta: number,
    reason: GemLedgerReason,
    refId: string
  ): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const normalizedRefId = normalizeGemLedgerRefId(refId);
    let nextGems = 0;
    await this.ensurePlayerAccount({ playerId: normalizedPlayerId });

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT gems
         FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         WHERE player_id = ?
         LIMIT 1
         FOR UPDATE`,
        [normalizedPlayerId]
      );

      const currentGems = normalizeGemAmount((rows[0] as { gems?: number } | undefined)?.gems);
      nextGems = currentGems + delta;
      if (nextGems < 0) {
        throw new Error("insufficient gems");
      }

      await connection.query(
        `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         SET gems = ?,
             version = version + 1
         WHERE player_id = ?`,
        [nextGems, normalizedPlayerId]
      );
      await appendGemLedgerEntry(connection, {
        entryId: randomUUID(),
        playerId: normalizedPlayerId,
        delta,
        reason,
        refId: normalizedRefId
      });

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return (
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        playerId: normalizedPlayerId,
        gems: nextGems
      })
    );
  }

  async savePlayerAccountPrivacyConsent(
    playerId: string,
    input: PlayerAccountPrivacyConsentInput = {}
  ): Promise<PlayerAccountSnapshot> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existingAccount = await this.ensurePlayerAccount({ playerId: normalizedPlayerId });
    const privacyConsentAt = normalizePrivacyConsentAt(input.privacyConsentAt) ?? new Date().toISOString();

    await this.pool.query(
      `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       SET privacy_consent_at = COALESCE(privacy_consent_at, ?),
           version = version + 1
       WHERE player_id = ?`,
      [new Date(privacyConsentAt), normalizedPlayerId]
    );

    return (
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        ...existingAccount,
        privacyConsentAt
      })
    );
  }

  async savePlayerAccountAuthSession(
    playerId: string,
    input: PlayerAccountAuthSessionInput
  ): Promise<PlayerAccountAuthSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const refreshSessionId = normalizeAuthSessionId(input.refreshSessionId);
    const refreshTokenHash = input.refreshTokenHash.trim();
    const refreshTokenExpiresAt = new Date(input.refreshTokenExpiresAt);
    const lastUsedAt = input.lastUsedAt ? new Date(input.lastUsedAt) : new Date();
    const provider = input.provider?.trim() || "account-password";
    const deviceLabel = normalizeAuthSessionDeviceLabel(input.deviceLabel);
    if (!refreshSessionId) {
      throw new Error("refreshSessionId must not be empty");
    }
    if (!refreshTokenHash) {
      throw new Error("refreshTokenHash must not be empty");
    }
    if (Number.isNaN(refreshTokenExpiresAt.getTime())) {
      throw new Error("refreshTokenExpiresAt must be a valid ISO timestamp");
    }
    if (Number.isNaN(lastUsedAt.getTime())) {
      throw new Error("lastUsedAt must be a valid ISO timestamp");
    }

    await this.pool.query(
      `INSERT INTO \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\` (
         player_id,
         session_id,
         provider,
         device_label,
         refresh_token_hash,
         refresh_token_expires_at,
         last_used_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         provider = VALUES(provider),
         device_label = VALUES(device_label),
         refresh_token_hash = VALUES(refresh_token_hash),
         refresh_token_expires_at = VALUES(refresh_token_expires_at),
         last_used_at = VALUES(last_used_at)`,
      [normalizedPlayerId, refreshSessionId, provider, deviceLabel, refreshTokenHash, refreshTokenExpiresAt, lastUsedAt]
    );

    await this.pool.query(
      `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       SET refresh_session_id = ?,
           refresh_token_hash = ?,
           refresh_token_expires_at = ?,
           version = version + 1
       WHERE player_id = ?`,
      [refreshSessionId, refreshTokenHash, refreshTokenExpiresAt, normalizedPlayerId]
    );

    return this.loadPlayerAccountAuthByPlayerId(normalizedPlayerId);
  }

  async revokePlayerAccountAuthSessions(
    playerId: string,
    input: PlayerAccountAuthRevokeInput = {}
  ): Promise<PlayerAccountAuthSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const passwordHash = input.passwordHash?.trim() ?? null;
    const credentialBoundAt = input.credentialBoundAt ? new Date(input.credentialBoundAt) : null;
    if (input.passwordHash !== undefined && !passwordHash) {
      throw new Error("passwordHash must not be empty");
    }
    if (input.credentialBoundAt !== undefined && (!credentialBoundAt || Number.isNaN(credentialBoundAt.getTime()))) {
      throw new Error("credentialBoundAt must be a valid ISO timestamp");
    }

    await this.pool.query(
      `DELETE FROM \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\`
       WHERE player_id = ?`,
      [normalizedPlayerId]
    );

    await this.pool.query(
      `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       SET account_session_version = account_session_version + 1,
           refresh_session_id = NULL,
           refresh_token_hash = NULL,
           refresh_token_expires_at = NULL,
           password_hash = COALESCE(?, password_hash),
           credential_bound_at = COALESCE(?, credential_bound_at),
           version = version + 1
       WHERE player_id = ?`,
      [passwordHash, credentialBoundAt, normalizedPlayerId]
    );

    return this.loadPlayerAccountAuthByPlayerId(normalizedPlayerId);
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
    if (displayName && displayName !== existingAccount.displayName) {
      await assertDisplayNameAvailableOrThrow(this, displayName, normalizedPlayerId);
    }
    const boundAt = existingAccount.wechatMiniGameBoundAt ?? new Date().toISOString();
    const ageVerified =
      input.ageVerified !== undefined ? normalizePlayerAgeVerified(input.ageVerified) : existingAccount.ageVerified;
    const isMinor = input.isMinor !== undefined ? normalizePlayerIsMinor(input.isMinor) : existingAccount.isMinor;

    try {
      await this.pool.query(
        `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         SET display_name = COALESCE(?, display_name),
             avatar_url = COALESCE(?, avatar_url),
             wechat_open_id = ?,
             wechat_union_id = COALESCE(?, wechat_union_id),
             wechat_mini_game_open_id = ?,
             wechat_mini_game_union_id = COALESCE(?, wechat_mini_game_union_id),
             wechat_mini_game_bound_at = COALESCE(wechat_mini_game_bound_at, ?),
             guest_migrated_to_player_id = NULL,
             age_verified = COALESCE(?, age_verified),
             is_minor = COALESCE(?, is_minor),
             version = version + 1
         WHERE player_id = ?`,
        [
          displayName,
          normalizedAvatarUrl ?? null,
          normalizedOpenId,
          normalizedUnionId ?? null,
          normalizedOpenId,
          normalizedUnionId ?? null,
          new Date(boundAt),
          ageVerified != null ? (ageVerified ? 1 : 0) : null,
          isMinor != null ? (isMinor ? 1 : 0) : null,
          normalizedPlayerId
        ]
      );
    } catch (error) {
      if (isMySqlDuplicateEntryError(error)) {
        throw new Error("wechatMiniGameOpenId is already taken");
      }

      throw error;
    }

    if (displayName && displayName !== existingAccount.displayName) {
      await appendPlayerNameHistoryEntry(this.pool, normalizedPlayerId, displayName);
    }

    return (
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        ...existingAccount,
        ...(displayName ? { displayName } : {}),
        ...(normalizedAvatarUrl ? { avatarUrl: normalizedAvatarUrl } : {}),
        wechatMiniGameOpenId: normalizedOpenId,
        ...(normalizedUnionId ? { wechatMiniGameUnionId: normalizedUnionId } : {}),
        ...(ageVerified !== undefined ? { ageVerified } : {}),
        ...(isMinor !== undefined ? { isMinor } : {}),
        wechatMiniGameBoundAt: boundAt
      })
    );
  }

  async migrateGuestToRegistered(input: GuestAccountMigrationInput): Promise<GuestAccountMigrationResult> {
    const guestPlayerId = normalizePlayerId(input.guestPlayerId);
    const targetPlayerId = normalizePlayerId(input.targetPlayerId);
    if (!guestPlayerId.startsWith("guest-")) {
      throw new Error("guestPlayerId must be an ephemeral guest account");
    }
    if (guestPlayerId === targetPlayerId) {
      throw new Error("guestPlayerId must not match targetPlayerId");
    }

    const guestAccount = await this.loadPlayerAccount(guestPlayerId);
    if (!guestAccount) {
      throw new Error("guest account not found");
    }
    if (guestAccount.guestMigratedToPlayerId) {
      throw new Error("guest account already migrated");
    }

    const targetAccount =
      (await this.loadPlayerAccount(targetPlayerId)) ??
      normalizePlayerAccountSnapshot({
        playerId: targetPlayerId,
        displayName: targetPlayerId,
        globalResources: normalizeResourceLedger()
      });
    const guestHeroArchives = await this.loadPlayerHeroArchives([guestPlayerId]);
    const guestQuestState = await this.loadPlayerQuestState?.(guestPlayerId);
    const nextTargetAccount = buildGuestMigrationTargetAccount({
      progressAccount: input.progressSource === "guest" ? guestAccount : targetAccount,
      targetAccount,
      targetPlayerId,
      wechatIdentity: input.wechatIdentity
    });
    const migratedGuestAccount = buildMigratedGuestAccountTombstone(guestAccount, targetPlayerId);
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      await upsertPlayerAccountForMigration(connection, targetAccount, nextTargetAccount);
      await upsertPlayerAccountForMigration(connection, guestAccount, migratedGuestAccount);

      await connection.query(
        `DELETE FROM \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\`
         WHERE player_id IN (?, ?)`,
        [guestPlayerId, targetPlayerId]
      );
      if (input.progressSource === "guest" && guestHeroArchives.length > 0) {
        await savePlayerHeroArchives(
          connection,
          guestHeroArchives.map((archive) => ({
            ...archive,
            playerId: targetPlayerId,
            hero: {
              ...archive.hero,
              playerId: targetPlayerId
            }
          }))
        );
      }

      await connection.query(
        `DELETE FROM \`${MYSQL_PLAYER_QUEST_STATE_TABLE}\`
         WHERE player_id IN (?, ?)`,
        [guestPlayerId, targetPlayerId]
      );
      if (input.progressSource === "guest" && guestQuestState) {
        const nextQuestState = normalizePlayerQuestState({
          ...guestQuestState,
          playerId: targetPlayerId
        });
        await connection.query(
          `INSERT INTO \`${MYSQL_PLAYER_QUEST_STATE_TABLE}\` (
             player_id,
             current_date_key,
             active_quest_ids_json,
             rotations_json,
             updated_at
           )
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             current_date_key = VALUES(current_date_key),
             active_quest_ids_json = VALUES(active_quest_ids_json),
             rotations_json = VALUES(rotations_json),
             updated_at = VALUES(updated_at)`,
          [
            nextQuestState.playerId,
            nextQuestState.currentDateKey ?? null,
            JSON.stringify(nextQuestState.activeQuestIds),
            JSON.stringify(nextQuestState.rotations),
            new Date(nextQuestState.updatedAt)
          ]
        );
      }

      await connection.query(
        `DELETE FROM \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\`
         WHERE player_id = ?`,
        [guestPlayerId]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return {
      account: (await this.loadPlayerAccount(targetPlayerId)) ?? nextTargetAccount,
      guestAccount: (await this.loadPlayerAccount(guestPlayerId)) ?? migratedGuestAccount
    };
  }

  async deletePlayerAccount(
    playerId: string,
    input: PlayerAccountDeleteInput = {}
  ): Promise<PlayerAccountSnapshot | null> {
    const normalizedPlayerId = normalizePlayerId(playerId);
    const existingAccount = await this.loadPlayerAccount(normalizedPlayerId);
    if (!existingAccount) {
      return null;
    }

    const deletedAt = normalizePrivacyConsentAt(input.deletedAt) ?? new Date().toISOString();
    const anonymizedDisplayName = `deleted-${normalizedPlayerId}`;
    const retainedFinancialPlayerToken = createDeletedFinancialRecordPseudonym();

    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `DELETE FROM \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\`
         WHERE player_id = ?`,
        [normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\`
         WHERE player_id = ?`,
        [normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_PLAYER_QUEST_STATE_TABLE}\`
         WHERE player_id = ?`,
        [normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_PLAYER_COMPENSATION_HISTORY_TABLE}\`
         WHERE player_id = ?`,
        [normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\`
         WHERE player_id = ?`,
        [normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_PLAYER_NAME_HISTORY_TABLE}\`
         WHERE player_id = ?`,
        [normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_GUILD_MEMBERSHIP_TABLE}\`
         WHERE player_id = ?`,
        [normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_GUILD_MESSAGE_TABLE}\`
         WHERE author_player_id = ?`,
        [normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_PLAYER_REFERRAL_TABLE}\`
         WHERE referrer_id = ? OR new_player_id = ?`,
        [normalizedPlayerId, normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\`
         WHERE attacker_player_id = ? OR defender_player_id = ?`,
        [normalizedPlayerId, normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_LEADERBOARD_SEASON_ARCHIVE_TABLE}\`
         WHERE player_id = ?`,
        [normalizedPlayerId]
      );
      await connection.query(
        `DELETE FROM \`${MYSQL_SEASON_REWARD_LOG_TABLE}\`
         WHERE player_id = ?`,
        [normalizedPlayerId]
      );
      await connection.query(
        `UPDATE \`${MYSQL_PAYMENT_RECEIPT_TABLE}\`
         INNER JOIN \`${MYSQL_PAYMENT_ORDER_TABLE}\`
           ON \`${MYSQL_PAYMENT_ORDER_TABLE}\`.order_id = \`${MYSQL_PAYMENT_RECEIPT_TABLE}\`.order_id
         SET \`${MYSQL_PAYMENT_RECEIPT_TABLE}\`.player_id = ?
         WHERE \`${MYSQL_PAYMENT_RECEIPT_TABLE}\`.player_id = ?
           AND \`${MYSQL_PAYMENT_ORDER_TABLE}\`.player_id = ?
           AND \`${MYSQL_PAYMENT_ORDER_TABLE}\`.status IN (?, ?)`,
        [retainedFinancialPlayerToken, normalizedPlayerId, normalizedPlayerId, "settled", "dead_letter"]
      );
      await connection.query(
        `UPDATE \`${MYSQL_PAYMENT_ORDER_TABLE}\`
         SET player_id = ?
         WHERE player_id = ?
           AND status IN (?, ?)`,
        [retainedFinancialPlayerToken, normalizedPlayerId, "settled", "dead_letter"]
      );

      const verificationChecks = [
        {
          label: MYSQL_PLAYER_ACCOUNT_SESSION_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_PLAYER_ACCOUNT_SESSION_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_PLAYER_HERO_ARCHIVE_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_PLAYER_HERO_ARCHIVE_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_PLAYER_QUEST_STATE_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_PLAYER_QUEST_STATE_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_PLAYER_COMPENSATION_HISTORY_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_PLAYER_COMPENSATION_HISTORY_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_PLAYER_EVENT_HISTORY_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_PLAYER_EVENT_HISTORY_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_PLAYER_NAME_HISTORY_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_PLAYER_NAME_HISTORY_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_GUILD_MEMBERSHIP_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_GUILD_MEMBERSHIP_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_GUILD_MESSAGE_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_GUILD_MESSAGE_TABLE}\` WHERE author_player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_PLAYER_REFERRAL_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_PLAYER_REFERRAL_TABLE}\` WHERE referrer_id = ? OR new_player_id = ?`,
          params: [normalizedPlayerId, normalizedPlayerId]
        },
        {
          label: MYSQL_BATTLE_SNAPSHOT_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_BATTLE_SNAPSHOT_TABLE}\` WHERE attacker_player_id = ? OR defender_player_id = ?`,
          params: [normalizedPlayerId, normalizedPlayerId]
        },
        {
          label: MYSQL_LEADERBOARD_SEASON_ARCHIVE_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_LEADERBOARD_SEASON_ARCHIVE_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_SEASON_REWARD_LOG_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_SEASON_REWARD_LOG_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_PAYMENT_ORDER_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_PAYMENT_ORDER_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        },
        {
          label: MYSQL_PAYMENT_RECEIPT_TABLE,
          sql: `SELECT COUNT(*) AS total FROM \`${MYSQL_PAYMENT_RECEIPT_TABLE}\` WHERE player_id = ?`,
          params: [normalizedPlayerId]
        }
      ];

      for (const check of verificationChecks) {
        const [rows] = await connection.query<Array<RowDataPacket & { total: number }>>(check.sql, check.params);
        if ((rows[0]?.total ?? 0) > 0) {
          throw new Error(`gdpr_delete_verification_failed:${check.label}`);
        }
      }

      await connection.query(
        `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         SET display_name = ?,
             avatar_url = NULL,
             elo_rating = NULL,
             rank_division = NULL,
             peak_rank_division = NULL,
             promotion_series_json = NULL,
             demotion_shield_json = NULL,
             season_history_json = ?,
             ranked_weekly_progress_json = NULL,
             gems = 0,
             season_xp = 0,
             season_pass_tier = 1,
             season_pass_premium = 0,
             season_pass_claimed_tiers_json = ?,
             season_badges_json = ?,
             campaign_progress_json = NULL,
             seasonal_event_states_json = NULL,
             mailbox_json = NULL,
             cosmetic_inventory_json = ?,
             equipped_cosmetics_json = ?,
             global_resources_json = ?,
             achievements_json = ?,
             recent_event_log_json = ?,
             recent_battle_replays_json = ?,
             daily_dungeon_state_json = NULL,
             leaderboard_abuse_state_json = NULL,
             leaderboard_moderation_state_json = ?,
             tutorial_step = ?,
             last_room_id = NULL,
             last_seen_at = NULL,
             login_id = NULL,
             age_verified = 0,
             is_minor = 0,
             daily_play_minutes = 0,
             last_play_date = NULL,
             login_streak = 0,
             ban_status = 'none',
             ban_expiry = NULL,
             ban_reason = NULL,
             wechat_open_id = NULL,
             wechat_union_id = NULL,
             wechat_mini_game_open_id = NULL,
             wechat_mini_game_union_id = NULL,
             wechat_mini_game_bound_at = NULL,
             guest_migrated_to_player_id = NULL,
             password_hash = NULL,
             credential_bound_at = NULL,
             privacy_consent_at = NULL,
             phone_number = NULL,
             phone_number_bound_at = NULL,
             notification_preferences_json = NULL,
             account_session_version = account_session_version + 1,
             refresh_session_id = NULL,
             refresh_token_hash = NULL,
             refresh_token_expires_at = NULL,
             version = version + 1
         WHERE player_id = ?`,
        [
          anonymizedDisplayName,
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify({ ownedIds: [] }),
          JSON.stringify({}),
          JSON.stringify(normalizeResourceLedger()),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify([]),
          JSON.stringify({
            hiddenAt: deletedAt,
            hiddenByPlayerId: "system:gdpr-delete"
          }),
          DEFAULT_TUTORIAL_STEP,
          normalizedPlayerId
        ]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return this.loadPlayerAccount(normalizedPlayerId);
  }

  async resolvePlayerReport(reportId: string, input: PlayerReportResolveInput): Promise<PlayerReportRecord | null> {
    const normalizedReportId = reportId.trim();
    if (!normalizedReportId) {
      throw new Error("reportId must not be empty");
    }

    const status = normalizePlayerReportStatus(input.status);
    if (status === "pending") {
      throw new Error("resolved report status must not be pending");
    }

    const [result] = await this.pool.query<ResultSetHeader>(
      `UPDATE \`${MYSQL_PLAYER_REPORT_TABLE}\`
       SET status = ?,
           resolved_at = ?
       WHERE report_id = ?`,
      [status, new Date(), normalizedReportId]
    );

    if (result.affectedRows === 0) {
      return null;
    }

    const [rows] = await this.pool.query<PlayerReportRow[]>(
      `SELECT
         report_id,
         reporter_id,
         target_id,
         reason,
         description,
         room_id,
         status,
         created_at,
         resolved_at
       FROM \`${MYSQL_PLAYER_REPORT_TABLE}\`
       WHERE report_id = ?
       LIMIT 1`,
      [normalizedReportId]
    );

    const row = rows[0];
    return row ? toPlayerReportRecord(row) : null;
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
    const requestedDisplayName =
      patch.displayName !== undefined ? normalizePlayerDisplayName(normalizedPlayerId, patch.displayName) : existing.displayName;
    if (requestedDisplayName !== existing.displayName) {
      await assertDisplayNameAvailableOrThrow(this, requestedDisplayName, normalizedPlayerId);
    }

    const nextAccount = normalizePlayerAccountSnapshot({
      ...existing,
      playerId: normalizedPlayerId,
      ...(patch.displayName !== undefined
        ? { displayName: requestedDisplayName }
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
          : {}),
      ...(patch.phoneNumber !== undefined
        ? patch.phoneNumber
          ? { phoneNumber: patch.phoneNumber.trim() }
          : {}
        : existing.phoneNumber
          ? { phoneNumber: existing.phoneNumber }
          : {}),
      ...(patch.phoneNumberBoundAt !== undefined
        ? patch.phoneNumberBoundAt
          ? { phoneNumberBoundAt: new Date(patch.phoneNumberBoundAt).toISOString() }
          : {}
        : existing.phoneNumberBoundAt
          ? { phoneNumberBoundAt: existing.phoneNumberBoundAt }
          : {}),
      ...(patch.notificationPreferences !== undefined
        ? patch.notificationPreferences
          ? { notificationPreferences: patch.notificationPreferences }
          : {}
        : existing.notificationPreferences
          ? { notificationPreferences: existing.notificationPreferences }
          : {}),
      ...(patch.pushTokens !== undefined
        ? { pushTokens: patch.pushTokens ?? null }
        : existing.pushTokens?.length
          ? { pushTokens: existing.pushTokens }
          : {})
    });

    await this.pool.query(
      `INSERT INTO \`${MYSQL_PLAYER_ACCOUNT_TABLE}\` (
         player_id,
         display_name,
         avatar_url,
         elo_rating,
         rank_division,
         peak_rank_division,
         promotion_series_json,
         demotion_shield_json,
         season_history_json,
         ranked_weekly_progress_json,
         gems,
         season_xp,
         season_pass_tier,
         season_pass_premium,
         season_pass_claimed_tiers_json,
         season_badges_json,
         campaign_progress_json,
         seasonal_event_states_json,
         mailbox_json,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         daily_dungeon_state_json,
         tutorial_step,
         last_room_id,
         last_seen_at,
         phone_number,
         phone_number_bound_at,
         notification_preferences_json,
         push_tokens_json
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         avatar_url = VALUES(avatar_url),
         elo_rating = VALUES(elo_rating),
         rank_division = VALUES(rank_division),
         peak_rank_division = VALUES(peak_rank_division),
         promotion_series_json = VALUES(promotion_series_json),
         demotion_shield_json = VALUES(demotion_shield_json),
         season_history_json = VALUES(season_history_json),
         ranked_weekly_progress_json = VALUES(ranked_weekly_progress_json),
         season_xp = VALUES(season_xp),
         season_pass_tier = VALUES(season_pass_tier),
         season_pass_premium = VALUES(season_pass_premium),
         season_pass_claimed_tiers_json = VALUES(season_pass_claimed_tiers_json),
         season_badges_json = COALESCE(season_badges_json, VALUES(season_badges_json)),
         campaign_progress_json = COALESCE(campaign_progress_json, VALUES(campaign_progress_json)),
         seasonal_event_states_json = COALESCE(seasonal_event_states_json, VALUES(seasonal_event_states_json)),
         mailbox_json = COALESCE(mailbox_json, VALUES(mailbox_json)),
         global_resources_json = VALUES(global_resources_json),
         achievements_json = VALUES(achievements_json),
         recent_event_log_json = VALUES(recent_event_log_json),
         recent_battle_replays_json = VALUES(recent_battle_replays_json),
         daily_dungeon_state_json = COALESCE(daily_dungeon_state_json, VALUES(daily_dungeon_state_json)),
         tutorial_step = COALESCE(tutorial_step, VALUES(tutorial_step)),
         last_room_id = VALUES(last_room_id),
         phone_number = VALUES(phone_number),
         phone_number_bound_at = VALUES(phone_number_bound_at),
         notification_preferences_json = COALESCE(VALUES(notification_preferences_json), notification_preferences_json),
         push_tokens_json = COALESCE(VALUES(push_tokens_json), push_tokens_json),
         last_seen_at = COALESCE(last_seen_at, VALUES(last_seen_at)),
         version = version + 1`,
      [
        nextAccount.playerId,
        nextAccount.displayName,
        nextAccount.avatarUrl ?? null,
        nextAccount.eloRating,
        nextAccount.rankDivision ?? null,
        nextAccount.peakRankDivision ?? null,
        JSON.stringify(nextAccount.promotionSeries ?? null),
        JSON.stringify(nextAccount.demotionShield ?? null),
        JSON.stringify(nextAccount.seasonHistory ?? []),
        JSON.stringify(nextAccount.rankedWeeklyProgress ?? null),
        nextAccount.gems,
        Math.max(0, Math.floor(nextAccount.seasonXp ?? 0)),
        Math.max(1, Math.floor(nextAccount.seasonPassTier ?? 1)),
        nextAccount.seasonPassPremium === true ? 1 : 0,
        JSON.stringify(nextAccount.seasonPassClaimedTiers ?? []),
        JSON.stringify(nextAccount.seasonBadges ?? []),
        JSON.stringify(nextAccount.campaignProgress ?? null),
        JSON.stringify(nextAccount.seasonalEventStates ?? null),
        JSON.stringify(nextAccount.mailbox ?? null),
        JSON.stringify(nextAccount.globalResources),
        JSON.stringify(nextAccount.achievements),
        JSON.stringify(nextAccount.recentEventLog),
        JSON.stringify(nextAccount.recentBattleReplays),
        JSON.stringify(nextAccount.dailyDungeonState ?? null),
        nextAccount.tutorialStep,
        nextAccount.lastRoomId ?? null,
        existing.lastSeenAt ? new Date(existing.lastSeenAt) : null,
        nextAccount.phoneNumber ?? null,
        nextAccount.phoneNumberBoundAt ? new Date(nextAccount.phoneNumberBoundAt) : null,
        JSON.stringify(nextAccount.notificationPreferences ?? null),
        JSON.stringify(nextAccount.pushTokens ?? null)
      ]
    );

    if (requestedDisplayName !== existing.displayName) {
      await appendPlayerNameHistoryEntry(this.pool, normalizedPlayerId, requestedDisplayName);
    }

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
    const battlePassConfig = resolveBattlePassConfig();
    const existing =
      (await this.loadPlayerAccount(normalizedPlayerId)) ??
      normalizePlayerAccountSnapshot({
        playerId: normalizedPlayerId,
        displayName: normalizedPlayerId,
        globalResources: normalizeResourceLedger()
      });
    const battlePassProgress = applyBattlePassXp(battlePassConfig, existing, patch.seasonXpDelta ?? 0);
    const mergedReplays = appendPlayerBattleReplaySummaries([], patch.recentBattleReplays ?? existing.recentBattleReplays);
    const competitiveProgression = resolveCompetitiveProgression(
      existing,
      patch,
      mergedReplays,
      patch.eloRating ?? existing.eloRating ?? 1000
    );

    const nextAccount = normalizePlayerAccountSnapshot({
      ...existing,
      playerId: normalizedPlayerId,
      ...(patch.gems !== undefined ? { gems: patch.gems } : {}),
      seasonXp: battlePassProgress.seasonXp,
      seasonPassTier: battlePassProgress.seasonPassTier,
      seasonPassPremium: patch.seasonPassPremium ?? existing.seasonPassPremium,
      cosmeticInventory: patch.cosmeticInventory ?? existing.cosmeticInventory,
      equippedCosmetics: patch.equippedCosmetics ?? existing.equippedCosmetics,
      seasonPassClaimedTiers: patch.seasonPassClaimedTiers ?? existing.seasonPassClaimedTiers,
      seasonBadges: patch.seasonBadges ?? existing.seasonBadges,
      campaignProgress: patch.campaignProgress ?? existing.campaignProgress,
      seasonalEventStates: patch.seasonalEventStates ?? existing.seasonalEventStates,
      mailbox: patch.mailbox ?? existing.mailbox,
      globalResources: patch.globalResources ?? existing.globalResources,
      achievements: patch.achievements ?? existing.achievements,
      recentEventLog: patch.recentEventLog ?? existing.recentEventLog,
      recentBattleReplays: mergedReplays,
      rankDivision: patch.rankDivision ?? competitiveProgression.rankDivision,
      peakRankDivision: patch.peakRankDivision ?? competitiveProgression.peakRankDivision,
      promotionSeries: patch.promotionSeries ?? competitiveProgression.promotionSeries,
      demotionShield: patch.demotionShield ?? competitiveProgression.demotionShield,
      seasonHistory: patch.seasonHistory ?? existing.seasonHistory,
      rankedWeeklyProgress: patch.rankedWeeklyProgress ?? competitiveProgression.rankedWeeklyProgress,
      dailyDungeonState: patch.dailyDungeonState ?? existing.dailyDungeonState,
      leaderboardAbuseState: patch.leaderboardAbuseState ?? existing.leaderboardAbuseState,
      leaderboardModerationState: patch.leaderboardModerationState ?? existing.leaderboardModerationState,
      tutorialStep: patch.tutorialStep !== undefined ? patch.tutorialStep : existing.tutorialStep,
      dailyPlayMinutes:
        patch.dailyPlayMinutes !== undefined ? normalizeDailyPlayMinutes(patch.dailyPlayMinutes) : existing.dailyPlayMinutes,
      lastPlayDate:
        patch.lastPlayDate !== undefined ? normalizeLastPlayDate(patch.lastPlayDate) : existing.lastPlayDate,
      loginStreak: patch.loginStreak !== undefined ? normalizeLoginStreak(patch.loginStreak) : existing.loginStreak,
      ...(patch.eloRating !== undefined ? { eloRating: patch.eloRating } : {}),
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
         elo_rating,
         rank_division,
         peak_rank_division,
         promotion_series_json,
         demotion_shield_json,
         season_history_json,
         ranked_weekly_progress_json,
         gems,
         season_xp,
         season_pass_tier,
         season_pass_premium,
         season_pass_claimed_tiers_json,
         season_badges_json,
         campaign_progress_json,
         seasonal_event_states_json,
         mailbox_json,
         cosmetic_inventory_json,
         equipped_cosmetics_json,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         daily_dungeon_state_json,
         leaderboard_abuse_state_json,
         leaderboard_moderation_state_json,
         tutorial_step,
         last_room_id,
         last_seen_at,
         age_verified,
         is_minor,
         daily_play_minutes,
         last_play_date,
         login_streak
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         display_name = VALUES(display_name),
         avatar_url = COALESCE(avatar_url, VALUES(avatar_url)),
         gems = VALUES(gems),
         season_xp = VALUES(season_xp),
         season_pass_tier = VALUES(season_pass_tier),
         season_pass_premium = VALUES(season_pass_premium),
         season_pass_claimed_tiers_json = VALUES(season_pass_claimed_tiers_json),
         season_badges_json = VALUES(season_badges_json),
         campaign_progress_json = VALUES(campaign_progress_json),
         cosmetic_inventory_json = VALUES(cosmetic_inventory_json),
         equipped_cosmetics_json = VALUES(equipped_cosmetics_json),
         seasonal_event_states_json = VALUES(seasonal_event_states_json),
         mailbox_json = VALUES(mailbox_json),
         elo_rating = VALUES(elo_rating),
         rank_division = VALUES(rank_division),
         peak_rank_division = VALUES(peak_rank_division),
         promotion_series_json = VALUES(promotion_series_json),
         demotion_shield_json = VALUES(demotion_shield_json),
         season_history_json = VALUES(season_history_json),
         ranked_weekly_progress_json = VALUES(ranked_weekly_progress_json),
         global_resources_json = VALUES(global_resources_json),
         achievements_json = VALUES(achievements_json),
         recent_event_log_json = VALUES(recent_event_log_json),
         recent_battle_replays_json = VALUES(recent_battle_replays_json),
         daily_dungeon_state_json = VALUES(daily_dungeon_state_json),
         leaderboard_abuse_state_json = VALUES(leaderboard_abuse_state_json),
         leaderboard_moderation_state_json = VALUES(leaderboard_moderation_state_json),
         tutorial_step = VALUES(tutorial_step),
         last_room_id = VALUES(last_room_id),
         last_seen_at = COALESCE(last_seen_at, VALUES(last_seen_at)),
         age_verified = VALUES(age_verified),
         is_minor = VALUES(is_minor),
         daily_play_minutes = VALUES(daily_play_minutes),
         last_play_date = VALUES(last_play_date),
         login_streak = VALUES(login_streak),
         version = version + 1`,
      [
        nextAccount.playerId,
        nextAccount.displayName,
        nextAccount.avatarUrl ?? null,
        nextAccount.eloRating,
        nextAccount.rankDivision ?? null,
        nextAccount.peakRankDivision ?? null,
        JSON.stringify(nextAccount.promotionSeries ?? null),
        JSON.stringify(nextAccount.demotionShield ?? null),
        JSON.stringify(nextAccount.seasonHistory ?? []),
        JSON.stringify(nextAccount.rankedWeeklyProgress ?? null),
        nextAccount.gems,
        Math.max(0, Math.floor(nextAccount.seasonXp ?? 0)),
        Math.max(1, Math.floor(nextAccount.seasonPassTier ?? 1)),
        nextAccount.seasonPassPremium === true ? 1 : 0,
        JSON.stringify(nextAccount.seasonPassClaimedTiers ?? []),
        JSON.stringify(nextAccount.seasonBadges ?? []),
        JSON.stringify(nextAccount.campaignProgress ?? null),
        JSON.stringify(nextAccount.seasonalEventStates ?? null),
        JSON.stringify(nextAccount.mailbox ?? null),
        JSON.stringify(nextAccount.cosmeticInventory ?? { ownedIds: [] }),
        JSON.stringify(nextAccount.equippedCosmetics ?? {}),
        JSON.stringify(nextAccount.globalResources),
        JSON.stringify(nextAccount.achievements),
        JSON.stringify(nextAccount.recentEventLog),
        JSON.stringify(nextAccount.recentBattleReplays),
        JSON.stringify(nextAccount.dailyDungeonState ?? null),
        JSON.stringify(nextAccount.leaderboardAbuseState ?? null),
        JSON.stringify(nextAccount.leaderboardModerationState ?? null),
        nextAccount.tutorialStep,
        nextAccount.lastRoomId ?? null,
        existing.lastSeenAt ? new Date(existing.lastSeenAt) : null,
        nextAccount.ageVerified === true ? 1 : 0,
        nextAccount.isMinor === true ? 1 : 0,
        normalizeDailyPlayMinutes(nextAccount.dailyPlayMinutes),
        nextAccount.lastPlayDate ? new Date(nextAccount.lastPlayDate) : null,
        normalizeLoginStreak(nextAccount.loginStreak)
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

  async savePlayerQuestState(playerId: string, state: PlayerQuestState): Promise<PlayerQuestState> {
    const nextState = normalizePlayerQuestState({
      ...state,
      playerId
    });

    await this.pool.query(
      `INSERT INTO \`${MYSQL_PLAYER_QUEST_STATE_TABLE}\` (
         player_id,
         current_date_key,
         active_quest_ids_json,
         rotations_json,
         updated_at
       ) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         current_date_key = VALUES(current_date_key),
         active_quest_ids_json = VALUES(active_quest_ids_json),
         rotations_json = VALUES(rotations_json),
         updated_at = VALUES(updated_at)`,
      [
        nextState.playerId,
        nextState.currentDateKey ?? null,
        JSON.stringify(nextState.activeQuestIds),
        JSON.stringify(nextState.rotations),
        nextState.updatedAt
      ]
    );

    return nextState;
  }

  async listPlayerAccounts(options: PlayerAccountListOptions = {}): Promise<PlayerAccountSnapshot[]> {
    const safeLimit = Math.max(1, Math.floor(options.limit ?? 20));
    const safeOffset = Math.max(0, Math.floor(options.offset ?? 0));
    const clauses: string[] = [];
    const params: Array<string | number> = [];

    if (options.playerId?.trim()) {
      clauses.push("player_id = ?");
      params.push(options.playerId.trim());
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const orderByClause = options.orderBy === "eloRating" ? "ORDER BY elo_rating DESC" : "ORDER BY updated_at DESC";
    const [rows] = await this.pool.query<PlayerAccountRow[]>(
      `SELECT
         player_id,
         display_name,
         avatar_url,
         elo_rating,
         rank_division,
         peak_rank_division,
         promotion_series_json,
         demotion_shield_json,
         season_history_json,
         ranked_weekly_progress_json,
         gems,
         season_xp,
         season_pass_tier,
         season_pass_premium,
         season_pass_claimed_tiers_json,
         season_badges_json,
         campaign_progress_json,
         seasonal_event_states_json,
         mailbox_json,
         global_resources_json,
         achievements_json,
         recent_event_log_json,
         recent_battle_replays_json,
         daily_dungeon_state_json,
         leaderboard_abuse_state_json,
         leaderboard_moderation_state_json,
         tutorial_step,
         last_room_id,
         last_seen_at,
         login_id,
         age_verified,
         is_minor,
         daily_play_minutes,
         last_play_date,
         ban_status,
         ban_expiry,
         ban_reason,
         wechat_open_id,
         wechat_union_id,
         wechat_mini_game_open_id,
         wechat_mini_game_union_id,
         wechat_mini_game_bound_at,
         guest_migrated_to_player_id,
         credential_bound_at,
         privacy_consent_at,
         phone_number,
         phone_number_bound_at,
         notification_preferences_json,
         push_tokens_json,
         created_at,
         updated_at
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       ${whereClause}
       ${orderByClause}
       LIMIT ?
       OFFSET ?`,
      [...params, safeLimit, safeOffset]
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

  async saveGuild(guildInput: GuildState): Promise<GuildState> {
    const guild = normalizeGuildState(guildInput);
    const guildId = normalizeGuildId(guild.id);
    const owner = guild.members.find((member) => member.role === "owner");
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      await connection.query(
        `INSERT INTO \`${MYSQL_GUILD_TABLE}\` (
           guild_id,
           name,
           tag,
           description,
           owner_player_id,
           member_count,
           state_json
         )
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           tag = VALUES(tag),
           description = VALUES(description),
           owner_player_id = VALUES(owner_player_id),
           member_count = VALUES(member_count),
           state_json = VALUES(state_json)`,
        [
          guildId,
          guild.name,
          guild.tag,
          guild.description ?? null,
          owner?.playerId ?? null,
          guild.members.length,
          JSON.stringify(guild)
        ]
      );
      await connection.query(`DELETE FROM \`${MYSQL_GUILD_MEMBERSHIP_TABLE}\` WHERE guild_id = ?`, [guildId]);
      if (guild.members.length > 0) {
        await connection.query(
          `INSERT INTO \`${MYSQL_GUILD_MEMBERSHIP_TABLE}\` (guild_id, player_id, role)
           VALUES ${guild.members.map(() => "(?, ?, ?)").join(", ")}`,
          guild.members.flatMap((member) => [guildId, normalizePlayerId(member.playerId), member.role])
        );
      }
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return (await this.loadGuild(guildId)) ?? guild;
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

  async deleteGuild(guildId: string): Promise<void> {
    const normalizedGuildId = normalizeGuildId(guildId);
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();
      await connection.query(`DELETE FROM \`${MYSQL_GUILD_MESSAGE_TABLE}\` WHERE guild_id = ?`, [normalizedGuildId]);
      await connection.query(`DELETE FROM \`${MYSQL_GUILD_MEMBERSHIP_TABLE}\` WHERE guild_id = ?`, [normalizedGuildId]);
      await connection.query(`DELETE FROM \`${MYSQL_GUILD_TABLE}\` WHERE guild_id = ?`, [normalizedGuildId]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async pruneExpired(referenceTime = new Date()): Promise<number> {
    const [roomCount, profileCount, mailboxCount, guildMessageCount] = await Promise.all([
      this.pruneExpiredRoomSnapshots(referenceTime),
      this.pruneExpiredPlayerProfiles(referenceTime),
      this.pruneExpiredPlayerMailboxEntries(referenceTime),
      this.pruneExpiredGuildChatMessages(referenceTime)
    ]);

    return roomCount + profileCount + mailboxCount + guildMessageCount;
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

  async pruneExpiredPlayerMailboxEntries(referenceTime = new Date()): Promise<number> {
    const [rows] = await this.pool.query<Array<RowDataPacket & { player_id: string; mailbox_json: string | null }>>(
      `SELECT player_id, mailbox_json
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE mailbox_json IS NOT NULL`
    );

    let removedCount = 0;
    for (const row of rows) {
      const mailbox = row.mailbox_json ? parseJsonColumn<PlayerMailboxMessage[]>(row.mailbox_json) : [];
      const pruned = pruneExpiredPlayerMailboxMessages(mailbox, referenceTime);
      if (pruned.removedCount === 0) {
        continue;
      }

      removedCount += pruned.removedCount;
      await this.pool.query(
        `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         SET mailbox_json = ?,
             version = version + 1
         WHERE player_id = ?`,
        [JSON.stringify(pruned.mailbox), row.player_id]
      );
    }

    return removedCount;
  }

  async pruneExpiredGuildChatMessages(referenceTime = new Date()): Promise<number> {
    const [result] = await this.pool.query<ResultSetHeader>(
      `DELETE FROM \`${MYSQL_GUILD_MESSAGE_TABLE}\`
       WHERE expires_at <= ?`,
      [referenceTime]
    );

    return result.affectedRows;
  }

  async pruneExpiredBattleReplays(referenceTime = new Date()): Promise<number> {
    const replayRetention = readBattleReplayRetentionPolicy();
    if (replayRetention.ttlDays == null) {
      return 0;
    }

    const [rows] = await this.pool.query<Array<RowDataPacket & { player_id: string; recent_battle_replays_json: string | null }>>(
      `SELECT player_id, recent_battle_replays_json
       FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
       WHERE recent_battle_replays_json IS NOT NULL
       LIMIT ?`,
      [replayRetention.cleanupBatchSize]
    );

    let removedCount = 0;
    for (const row of rows) {
      const replayJson = row.recent_battle_replays_json;
      const existingReplays = replayJson ? parseJsonColumn<PlayerBattleReplaySummary[]>(replayJson) : [];
      const pruned = prunePlayerBattleReplaysForRetention(existingReplays, replayRetention, referenceTime);
      if (pruned.removedCount === 0 && pruned.updatedCount === 0) {
        continue;
      }

      removedCount += pruned.removedCount;
      await this.pool.query(
        `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         SET recent_battle_replays_json = ?,
             version = version + 1
         WHERE player_id = ?`,
        [JSON.stringify(pruned.replays), row.player_id]
      );
    }

    return removedCount;
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

  async getCurrentSeason(): Promise<SeasonSnapshot | null> {
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT season_id, status, started_at, ended_at, reward_distributed_at
       FROM \`${MYSQL_SEASON_TABLE}\`
       WHERE status = 'active'
       ORDER BY started_at DESC
       LIMIT 1`
    );
    const row = rows[0];
    if (!row) return null;
    const endedAtTimestamp = row.ended_at ? formatTimestamp(row.ended_at as Date | string) : undefined;
    const rewardDistributedAt = row.reward_distributed_at ? formatTimestamp(row.reward_distributed_at as Date | string) : undefined;
    const base: SeasonSnapshot = {
      seasonId: String(row.season_id),
      status: row.status as "active" | "closed",
      startedAt: formatTimestamp(row.started_at as Date | string) ?? new Date().toISOString(),
      ...(rewardDistributedAt ? { rewardDistributedAt } : {})
    };
    return endedAtTimestamp ? { ...base, endedAt: endedAtTimestamp } : base;
  }

  async listSeasons(options: SeasonListOptions = {}): Promise<SeasonSnapshot[]> {
    const status = options.status ?? "closed";
    const rawLimit = options.limit ?? 20;
    const limit = Math.min(100, Math.max(1, Math.floor(rawLimit)));
    const clauses = status === "all" ? "" : "WHERE status = ?";
    const params = status === "all" ? [limit] : [status, limit];
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT season_id, status, started_at, ended_at, reward_distributed_at
       FROM \`${MYSQL_SEASON_TABLE}\`
       ${clauses}
       ORDER BY started_at DESC
       LIMIT ?`,
      params
    );

    return rows.map((row) => {
      const endedAtTimestamp = row.ended_at ? formatTimestamp(row.ended_at as Date | string) : undefined;
      const rewardDistributedAt = row.reward_distributed_at ? formatTimestamp(row.reward_distributed_at as Date | string) : undefined;
      const season: SeasonSnapshot = {
        seasonId: String(row.season_id),
        status: row.status as "active" | "closed",
        startedAt: formatTimestamp(row.started_at as Date | string) ?? new Date().toISOString(),
        ...(rewardDistributedAt ? { rewardDistributedAt } : {})
      };
      return endedAtTimestamp ? { ...season, endedAt: endedAtTimestamp } : season;
    });
  }

  async createSeason(seasonId: string): Promise<SeasonSnapshot> {
    const normalizedId = seasonId.trim();
    if (!normalizedId) throw new Error("seasonId must not be empty");
    const startedAt = new Date();
    await this.pool.query(
      `INSERT INTO \`${MYSQL_SEASON_TABLE}\` (season_id, status, started_at) VALUES (?, 'active', ?)`,
      [normalizedId, startedAt]
    );
    return {
      seasonId: normalizedId,
      status: "active",
      startedAt: startedAt.toISOString()
    };
  }

  async listLeaderboardSeasonArchive(seasonId: string, limit = MAX_LEADERBOARD_SEASON_ARCHIVE_SIZE): Promise<LeaderboardSeasonArchiveEntry[]> {
    const normalizedId = seasonId.trim();
    if (!normalizedId) {
      throw new Error("seasonId must not be empty");
    }

    const normalizedLimit = Math.min(MAX_LEADERBOARD_SEASON_ARCHIVE_SIZE, Math.max(1, Math.floor(limit)));
    const [rows] = await this.pool.query<RowDataPacket[]>(
      `SELECT season_id, rank_position, player_id, display_name, final_rating, tier, archived_at
       FROM \`${MYSQL_LEADERBOARD_SEASON_ARCHIVE_TABLE}\`
       WHERE season_id = ?
       ORDER BY rank_position ASC
       LIMIT ?`,
      [normalizedId, normalizedLimit]
    );

    return rows.map((row) => ({
      seasonId: String(row.season_id),
      rank: Math.max(1, Math.floor(Number(row.rank_position) || 0)),
      playerId: String(row.player_id),
      displayName: String(row.display_name || row.player_id),
      finalRating: normalizeEloRating(Number(row.final_rating)),
      tier: String(row.tier),
      archivedAt: formatTimestamp(row.archived_at as Date | string) ?? new Date(0).toISOString()
    }));
  }

  async closeSeason(seasonId: string): Promise<SeasonCloseSummary> {
    const normalizedId = seasonId.trim();
    if (!normalizedId) {
      throw new Error("seasonId must not be empty");
    }

    const rewardConfig = resolveSeasonRewardConfig();
    const now = new Date();
    const connection = await this.pool.getConnection();

    try {
      await connection.beginTransaction();

      const [seasonRows] = await connection.query<RowDataPacket[]>(
        `SELECT season_id, status, reward_distributed_at
         FROM \`${MYSQL_SEASON_TABLE}\`
         WHERE season_id = ?
         LIMIT 1
         FOR UPDATE`,
        [normalizedId]
      );
      const seasonRow = seasonRows[0] as
        | { season_id: string; status: "active" | "closed"; reward_distributed_at?: Date | string | null }
        | undefined;
      if (!seasonRow) {
        await connection.rollback();
        return {
          seasonId: normalizedId,
          playersRewarded: 0,
          totalGemsGranted: 0
        };
      }
      if (seasonRow.status === "closed" && seasonRow.reward_distributed_at) {
        await connection.rollback();
        return {
          seasonId: normalizedId,
          playersRewarded: 0,
          totalGemsGranted: 0
        };
      }

      const [existingArchiveRows] = await connection.query<RowDataPacket[]>(
        `SELECT player_id, rank_position
         FROM \`${MYSQL_LEADERBOARD_SEASON_ARCHIVE_TABLE}\`
         WHERE season_id = ?
         ORDER BY rank_position ASC`,
        [normalizedId]
      );

      const [accountRows] = await connection.query<RowDataPacket[]>(
        `SELECT player_id, display_name, elo_rating
         FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
         WHERE elo_rating IS NOT NULL
         ORDER BY elo_rating DESC, player_id ASC
         FOR UPDATE`
      );
      const rankedPlayers = accountRows.map((row, index) => {
        const playerId = String(row.player_id);
        const finalRating = normalizeEloRating(Number(row.elo_rating));
        return {
          playerId,
          displayName: String(row.display_name || row.player_id),
          finalRating,
          rankPosition: index + 1
        };
      });

      if (existingArchiveRows.length === 0) {
        const archiveValues: Array<[string, number, string, string, number, string, Date]> = rankedPlayers
          .slice(0, MAX_LEADERBOARD_SEASON_ARCHIVE_SIZE)
          .map((rankedPlayer) => [
            normalizedId,
            rankedPlayer.rankPosition,
            rankedPlayer.playerId,
            rankedPlayer.displayName,
            rankedPlayer.finalRating,
            getTierForRating(rankedPlayer.finalRating),
            now
          ]);

        if (archiveValues.length > 0) {
          await connection.query(
            `INSERT INTO \`${MYSQL_LEADERBOARD_SEASON_ARCHIVE_TABLE}\` (
               season_id,
               rank_position,
               player_id,
               display_name,
               final_rating,
               tier,
               archived_at
             ) VALUES ?`,
            [archiveValues]
          );
        }
      }

      let playersRewarded = 0;
      let totalGemsGranted = 0;
      const rewardedPlayerIds = new Set<string>();
      for (const rankedPlayer of rankedPlayers) {
        const reward = computeSeasonReward(rankedPlayer.rankPosition, rankedPlayers.length, rewardConfig);
        if (!reward) {
          continue;
        }

        const [rewardLogResult] = await connection.query<ResultSetHeader>(
          `INSERT IGNORE INTO \`${MYSQL_SEASON_REWARD_LOG_TABLE}\` (
             season_id,
             player_id,
             gems,
             badge,
             distributed_at
           )
           VALUES (?, ?, ?, ?, ?)`,
          [normalizedId, rankedPlayer.playerId, reward.gems, reward.badge, now]
        );
        if (rewardLogResult.affectedRows === 0) {
          continue;
        }

        const [accountRows] = await connection.query<PlayerAccountRow[]>(
          `SELECT *
           FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
           WHERE player_id = ?
           LIMIT 1
           FOR UPDATE`,
          [rankedPlayer.playerId]
        );
        const currentAccount =
          accountRows[0] != null
            ? toPlayerAccountSnapshot(accountRows[0])
            : normalizePlayerAccountSnapshot({
                playerId: rankedPlayer.playerId,
                displayName: rankedPlayer.playerId,
                globalResources: normalizeResourceLedger()
              });
        const seasonBadges = Array.from(new Set([...(currentAccount.seasonBadges ?? []), reward.badge]));

        await connection.query(
          `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
           SET gems = ?,
               season_badges_json = ?,
               version = version + 1
           WHERE player_id = ?`,
          [normalizeGemAmount(currentAccount.gems) + reward.gems, JSON.stringify(seasonBadges), rankedPlayer.playerId]
        );

        playersRewarded += 1;
        totalGemsGranted += reward.gems;
        rewardedPlayerIds.add(rankedPlayer.playerId);
      }

      for (const rankedPlayer of rankedPlayers) {
        const [accountRows] = await connection.query<PlayerAccountRow[]>(
          `SELECT *
           FROM \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
           WHERE player_id = ?
           LIMIT 1
           FOR UPDATE`,
          [rankedPlayer.playerId]
        );
        const currentAccount =
          accountRows[0] != null
            ? toPlayerAccountSnapshot(accountRows[0])
            : normalizePlayerAccountSnapshot({
                playerId: rankedPlayer.playerId,
                displayName: rankedPlayer.playerId,
                globalResources: normalizeResourceLedger()
              });
        const currentDivision = currentAccount.rankDivision ?? getRankDivisionForRating(currentAccount.eloRating ?? rankedPlayer.finalRating);
        const peakDivision = currentAccount.peakRankDivision ?? currentDivision;
        const decay = applySeasonSoftDecay(currentAccount);
        const seasonHistory = [
          {
            seasonId: normalizedId,
            rankPosition: rankedPlayer.rankPosition,
            totalPlayers: rankedPlayers.length,
            finalRating: rankedPlayer.finalRating,
            peakDivision,
            finalDivision: currentDivision,
            rewardTier: getTierForRating(rankedPlayer.finalRating),
            rankPercentile: rankedPlayers.length > 0 ? rankedPlayer.rankPosition / rankedPlayers.length : 1,
            rewardClaimed: rewardedPlayerIds.has(rankedPlayer.playerId),
            archivedAt: now.toISOString(),
            ...(rewardedPlayerIds.has(rankedPlayer.playerId) ? { rewardsGrantedAt: now.toISOString() } : {})
          },
          ...(currentAccount.seasonHistory ?? [])
        ].slice(0, 20);

        await connection.query(
          `UPDATE \`${MYSQL_PLAYER_ACCOUNT_TABLE}\`
           SET elo_rating = ?,
               rank_division = ?,
               peak_rank_division = ?,
               promotion_series_json = ?,
               demotion_shield_json = ?,
               season_history_json = ?,
               version = version + 1
           WHERE player_id = ?`,
          [
            decayDivisionToRating(decay.rankDivision ?? currentDivision),
            decay.rankDivision ?? currentDivision,
            decay.peakRankDivision ?? decay.rankDivision ?? currentDivision,
            JSON.stringify(null),
            JSON.stringify(null),
            JSON.stringify(seasonHistory),
            rankedPlayer.playerId
          ]
        );
      }

      await connection.query(
        `UPDATE \`${MYSQL_SEASON_TABLE}\`
         SET status = 'closed',
             ended_at = COALESCE(ended_at, ?),
             reward_distributed_at = COALESCE(reward_distributed_at, ?)
         WHERE season_id = ?`,
        [now, now, normalizedId]
      );

      await connection.commit();
      return {
        seasonId: normalizedId,
        playersRewarded,
        totalGemsGranted
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
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
