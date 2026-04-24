import fs from "node:fs";
import path from "node:path";
import type { GuildMemberState, GuildState } from "@veil/shared/models";
import { type DisplayNameValidationRules, findDisplayNameModerationViolation, normalizeTextForModeration } from "@veil/shared/platform";
import type { GuildChatMessage } from "@veil/shared/social";
import type { AdminAuditActorRole, AdminAuditLogRecord, AdminAuditAction, PlayerAccountSnapshot, RoomSnapshotStore } from "@server/persistence";
import { loadDisplayNameValidationRules } from "@server/domain/account/display-name-rules";
import { normalizePlayerMailboxMessage } from "@server/domain/account/player-mailbox";

const DEFAULT_UGC_BANNED_KEYWORDS_PATH = path.resolve(process.cwd(), "configs", "ugc-banned-keywords.json");
const UGC_MODERATION_CONFIG_DOCUMENT_ID = "ugcBannedKeywords";

export type UgcReviewItemKind = "display_name" | "guild_name" | "guild_chat_message";
export type UgcReviewStatus = "pending" | "approved" | "rejected";

export interface UgcModerationConfig {
  schemaVersion: number;
  reviewThreshold: number;
  approvedTerms: string[];
  candidateTerms: string[];
}

export interface UgcModerationConfigStorage {
  load(): Promise<Partial<UgcModerationConfig> | UgcModerationConfig | null | undefined>;
  save(config: UgcModerationConfig): Promise<Partial<UgcModerationConfig> | UgcModerationConfig | null | undefined | void>;
}

export interface UgcModerationRuntimeOptions {
  configStorage?: UgcModerationConfigStorage | null;
}

export interface UgcModerationConfigDocumentStore {
  loadDocument(id: typeof UGC_MODERATION_CONFIG_DOCUMENT_ID): Promise<{ content: string }>;
  saveDocument(id: typeof UGC_MODERATION_CONFIG_DOCUMENT_ID, content: string): Promise<{ content: string }>;
}

export interface UgcReviewQueueEntry {
  itemId: string;
  kind: UgcReviewItemKind;
  playerId: string;
  displayName: string;
  submittedValue: string;
  normalizedValue: string;
  score: number;
  reasons: string[];
  reviewStatus: UgcReviewStatus;
  submittedAt: string;
  guildId?: string;
  messageId?: string;
}

export interface UgcReviewDecisionInput {
  itemId: string;
  action: "approve" | "reject";
  reason: string;
  actorPlayerId: string;
  actorRole: AdminAuditActorRole;
  occurredAt?: string;
  candidateKeyword?: string;
}

interface UgcReviewAuditMetadata {
  itemId: string;
  kind: UgcReviewItemKind;
  score: number;
  reasons: string[];
  candidateKeyword?: string;
}

interface ParsedUgcReviewItemId {
  kind: UgcReviewItemKind;
  playerId: string;
  guildId?: string;
  messageId?: string;
}

interface UgcScoreResult {
  score: number;
  reasons: string[];
  normalizedValue: string;
}

function normalizeTerms(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
        .map((entry) => normalizeTextForModeration(entry))
        .filter(Boolean)
    )
  );
}

function normalizeReviewThreshold(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 40;
  }
  return Math.max(10, Math.floor(parsed));
}

export function normalizeUgcModerationConfig(input?: Partial<UgcModerationConfig> | null): UgcModerationConfig {
  return {
    schemaVersion: Math.max(1, Math.floor(Number(input?.schemaVersion ?? 1) || 1)),
    reviewThreshold: normalizeReviewThreshold(input?.reviewThreshold),
    approvedTerms: normalizeTerms(input?.approvedTerms),
    candidateTerms: normalizeTerms(input?.candidateTerms)
  };
}

export function loadUgcModerationConfig(configPath = process.env.VEIL_UGC_BANNED_KEYWORDS_PATH || DEFAULT_UGC_BANNED_KEYWORDS_PATH): UgcModerationConfig {
  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return normalizeUgcModerationConfig(JSON.parse(raw) as Partial<UgcModerationConfig>);
  } catch {
    return normalizeUgcModerationConfig();
  }
}

function saveUgcModerationConfig(config: UgcModerationConfig, configPath = process.env.VEIL_UGC_BANNED_KEYWORDS_PATH || DEFAULT_UGC_BANNED_KEYWORDS_PATH): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(`${configPath}`, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function appendUgcCandidateKeyword(term: string, configPath?: string): UgcModerationConfig {
  const normalized = normalizeTextForModeration(term);
  const current = loadUgcModerationConfig(configPath);
  if (!normalized || current.candidateTerms.includes(normalized) || current.approvedTerms.includes(normalized)) {
    return current;
  }
  const next = normalizeUgcModerationConfig({
    ...current,
    candidateTerms: [...current.candidateTerms, normalized]
  });
  saveUgcModerationConfig(next, configPath);
  return next;
}

async function loadUgcModerationConfigForRuntime(options: UgcModerationRuntimeOptions = {}): Promise<UgcModerationConfig> {
  if (!options.configStorage) {
    return loadUgcModerationConfig();
  }
  return normalizeUgcModerationConfig(await options.configStorage.load());
}

export async function appendUgcCandidateKeywordForRuntime(
  term: string,
  options: UgcModerationRuntimeOptions = {}
): Promise<UgcModerationConfig> {
  const normalized = normalizeTextForModeration(term);
  const current = await loadUgcModerationConfigForRuntime(options);
  if (!normalized || current.candidateTerms.includes(normalized) || current.approvedTerms.includes(normalized)) {
    return current;
  }
  const next = normalizeUgcModerationConfig({
    ...current,
    candidateTerms: [...current.candidateTerms, normalized]
  });
  if (!options.configStorage) {
    saveUgcModerationConfig(next);
    return next;
  }
  return normalizeUgcModerationConfig((await options.configStorage.save(next)) ?? next);
}

export function createUgcModerationConfigStorageFromConfigCenter(
  store: UgcModerationConfigDocumentStore | null | undefined
): UgcModerationConfigStorage | null {
  if (!store) {
    return null;
  }

  return {
    async load() {
      const document = await store.loadDocument(UGC_MODERATION_CONFIG_DOCUMENT_ID);
      return JSON.parse(document.content) as Partial<UgcModerationConfig>;
    },
    async save(config) {
      const document = await store.saveDocument(UGC_MODERATION_CONFIG_DOCUMENT_ID, `${JSON.stringify(config, null, 2)}\n`);
      return JSON.parse(document.content) as Partial<UgcModerationConfig>;
    }
  };
}

export function scoreUgcContent(
  value: string,
  config: UgcModerationConfig = loadUgcModerationConfig(),
  rules: DisplayNameValidationRules = loadDisplayNameValidationRules()
): UgcScoreResult {
  const normalizedValue = normalizeTextForModeration(value);
  if (!normalizedValue) {
    return { score: 0, reasons: [], normalizedValue };
  }

  if (findDisplayNameModerationViolation(value, rules)) {
    return { score: 0, reasons: [], normalizedValue };
  }

  let score = 0;
  const reasons = new Set<string>();

  for (const term of config.candidateTerms) {
    if (term && normalizedValue.includes(term)) {
      score += 45;
      reasons.add(`命中候选敏感词 ${term}`);
    }
  }

  if (/(vx|wx|qq|tg|telegram|discord|v信|微信)/iu.test(value)) {
    score += 25;
    reasons.add("包含联系方式线索");
  }
  if (/\d{5,}/.test(value)) {
    score += 20;
    reasons.add("包含长数字串");
  }
  if (/[a-zA-Z].*\d|\d.*[a-zA-Z]/.test(value) && normalizedValue.length >= 8) {
    score += 10;
    reasons.add("字母数字混排异常");
  }
  if (config.approvedTerms.some((term) => term && normalizedValue.includes(term))) {
    score = Math.max(0, score - 25);
    reasons.add("包含白名单词，降低风险");
  }

  return { score, reasons: Array.from(reasons), normalizedValue };
}

function parseAuditMetadata(record: Pick<AdminAuditLogRecord, "metadataJson"> | null | undefined): UgcReviewAuditMetadata | null {
  if (!record?.metadataJson?.trim()) {
    return null;
  }
  try {
    return JSON.parse(record.metadataJson) as UgcReviewAuditMetadata;
  } catch {
    return null;
  }
}

function parseUgcReviewItemId(itemId: string): ParsedUgcReviewItemId {
  const [kind, primary, secondary] = itemId.split(":");
  if (kind === "display_name" && primary) {
    return { kind, playerId: primary };
  }
  if (kind === "guild_name" && primary) {
    return { kind, playerId: primary, guildId: primary };
  }
  if (kind === "guild_chat_message" && primary && secondary) {
    return { kind, guildId: primary, messageId: secondary, playerId: "" };
  }
  throw new Error("ugc_review_item_not_found");
}

function buildReviewStatus(audits: AdminAuditLogRecord[], itemId: string): UgcReviewStatus {
  for (const audit of audits) {
    const metadata = parseAuditMetadata(audit);
    if (metadata?.itemId !== itemId) {
      continue;
    }
    if (audit.action === "ugc_review_rejected") {
      return "rejected";
    }
    if (audit.action === "ugc_review_approved") {
      return "approved";
    }
  }
  return "pending";
}

async function listUgcAudits(store: RoomSnapshotStore): Promise<AdminAuditLogRecord[]> {
  if (!store.listAdminAuditLogs) {
    return [];
  }
  return store.listAdminAuditLogs({ targetScope: "ugc-review", limit: 500 });
}

function fallbackDisplayName(playerId: string): string {
  return `旅人${playerId.slice(-4).padStart(4, "0")}`;
}

function createDisplayNameQueueEntry(
  account: PlayerAccountSnapshot,
  score: UgcScoreResult,
  reviewStatus: UgcReviewStatus
): UgcReviewQueueEntry {
  return {
    itemId: `display_name:${account.playerId}`,
    kind: "display_name",
    playerId: account.playerId,
    displayName: account.displayName,
    submittedValue: account.displayName,
    normalizedValue: score.normalizedValue,
    score: score.score,
    reasons: score.reasons,
    reviewStatus,
    submittedAt: account.updatedAt ?? account.createdAt ?? new Date().toISOString()
  };
}

function createGuildQueueEntry(
  guild: GuildState,
  score: UgcScoreResult,
  reviewStatus: UgcReviewStatus
): UgcReviewQueueEntry {
  const owner = guild.members.find((member: GuildMemberState) => member.role === "owner") ?? guild.members[0];
  return {
    itemId: `guild_name:${guild.id}`,
    kind: "guild_name",
    playerId: owner?.playerId ?? guild.id,
    displayName: owner?.displayName ?? guild.name,
    guildId: guild.id,
    submittedValue: guild.name,
    normalizedValue: score.normalizedValue,
    score: score.score,
    reasons: score.reasons,
    reviewStatus,
    submittedAt: guild.updatedAt ?? guild.createdAt
  };
}

function createChatQueueEntry(
  message: GuildChatMessage,
  score: UgcScoreResult,
  reviewStatus: UgcReviewStatus
): UgcReviewQueueEntry {
  return {
    itemId: `guild_chat_message:${message.guildId}:${message.messageId}`,
    kind: "guild_chat_message",
    playerId: message.authorPlayerId,
    displayName: message.authorDisplayName,
    guildId: message.guildId,
    messageId: message.messageId,
    submittedValue: message.content,
    normalizedValue: score.normalizedValue,
    score: score.score,
    reasons: score.reasons,
    reviewStatus,
    submittedAt: message.createdAt
  };
}

export async function buildUgcReviewQueue(store: RoomSnapshotStore, options: UgcModerationRuntimeOptions = {}): Promise<UgcReviewQueueEntry[]> {
  const config = await loadUgcModerationConfigForRuntime(options);
  const rules = loadDisplayNameValidationRules();
  const audits = await listUgcAudits(store);
  const entries: UgcReviewQueueEntry[] = [];

  const accounts = await store.listPlayerAccounts({ limit: 10_000, offset: 0 });
  for (const account of accounts) {
    const score = scoreUgcContent(account.displayName, config, rules);
    if (score.score < config.reviewThreshold) {
      continue;
    }
    const itemId = `display_name:${account.playerId}`;
    entries.push(createDisplayNameQueueEntry(account, score, buildReviewStatus(audits, itemId)));
  }

  if (store.listGuilds) {
    const guilds = await store.listGuilds();
    for (const guild of guilds) {
      const score = scoreUgcContent(guild.name, config, rules);
      if (score.score >= config.reviewThreshold) {
        const itemId = `guild_name:${guild.id}`;
        entries.push(createGuildQueueEntry(guild, score, buildReviewStatus(audits, itemId)));
      }

      if (!store.listGuildChatMessages) {
        continue;
      }
      const messages = await store.listGuildChatMessages({ guildId: guild.id, limit: 50 });
      for (const message of messages) {
        const score = scoreUgcContent(message.content, config, rules);
        if (score.score < config.reviewThreshold) {
          continue;
        }
        const itemId = `guild_chat_message:${message.guildId}:${message.messageId}`;
        entries.push(createChatQueueEntry(message, score, buildReviewStatus(audits, itemId)));
      }
    }
  }

  return entries.sort((left, right) => right.score - left.score || right.submittedAt.localeCompare(left.submittedAt) || left.itemId.localeCompare(right.itemId));
}

async function appendReviewAudit(
  store: RoomSnapshotStore,
  action: AdminAuditAction,
  input: UgcReviewDecisionInput,
  metadata: UgcReviewAuditMetadata
): Promise<void> {
  if (!store.appendAdminAuditLog) {
    return;
  }
  await store.appendAdminAuditLog({
    actorPlayerId: input.actorPlayerId,
    actorRole: input.actorRole,
    action,
    targetScope: "ugc-review",
    summary: `${input.action} UGC review entry ${input.itemId}`,
    metadataJson: JSON.stringify(metadata),
    ...(metadata.kind !== "guild_name" ? { targetPlayerId: input.itemId.split(":")[1] } : {}),
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {})
  });
}

function resolveCandidateKeyword(input: UgcReviewDecisionInput, entry: UgcReviewQueueEntry): string {
  return normalizeTextForModeration(input.candidateKeyword?.trim() || entry.submittedValue);
}

async function findQueueEntry(store: RoomSnapshotStore, itemId: string, options: UgcModerationRuntimeOptions): Promise<UgcReviewQueueEntry> {
  const queue = await buildUgcReviewQueue(store, options);
  const entry = queue.find((item) => item.itemId === itemId);
  if (!entry) {
    throw new Error("ugc_review_item_not_found");
  }
  return entry;
}

async function rejectDisplayName(store: RoomSnapshotStore, entry: UgcReviewQueueEntry, input: UgcReviewDecisionInput): Promise<unknown> {
  const account = await store.savePlayerAccountProfile(entry.playerId, { displayName: fallbackDisplayName(entry.playerId) });
  if (store.deliverPlayerMailbox) {
    await store.deliverPlayerMailbox({
      playerIds: [entry.playerId],
      message: normalizePlayerMailboxMessage({
        id: `ugc-review:display-name:${entry.playerId}:${input.occurredAt ?? Date.now()}`,
        kind: "system",
        title: "昵称已被重置",
        body: `你的昵称因人工复核未通过，已重置。原因：${input.reason}`
      })
    });
  }
  return account;
}

async function rejectGuildName(store: RoomSnapshotStore, entry: UgcReviewQueueEntry, input: UgcReviewDecisionInput): Promise<unknown> {
  if (!entry.guildId || !store.loadGuild || !store.saveGuild) {
    throw new Error("ugc_review_guild_store_unavailable");
  }
  const guild = await store.loadGuild(entry.guildId);
  if (!guild) {
    throw new Error("ugc_review_item_not_found");
  }
  const nextGuild = await store.saveGuild({
    ...guild,
    moderation: {
      isHidden: true,
      hiddenAt: input.occurredAt ?? new Date().toISOString(),
      hiddenByPlayerId: input.actorPlayerId,
      hiddenReason: input.reason
    }
  });
  if (store.deliverPlayerMailbox) {
    const owner = guild.members.find((member: GuildMemberState) => member.role === "owner") ?? guild.members[0];
    if (owner) {
      await store.deliverPlayerMailbox({
        playerIds: [owner.playerId],
        message: normalizePlayerMailboxMessage({
          id: `ugc-review:guild-name:${guild.id}:${input.occurredAt ?? Date.now()}`,
          kind: "system",
          title: "公会名已被下架",
          body: `公会名称因人工复核未通过，当前已隐藏。原因：${input.reason}`
        })
      });
    }
  }
  return nextGuild;
}

async function rejectGuildChatMessage(store: RoomSnapshotStore, entry: UgcReviewQueueEntry, input: UgcReviewDecisionInput): Promise<unknown> {
  if (!entry.guildId || !entry.messageId || !store.deleteGuildChatMessage) {
    throw new Error("ugc_review_chat_store_unavailable");
  }
  const deleted = await store.deleteGuildChatMessage(entry.guildId, entry.messageId);
  if (store.deliverPlayerMailbox) {
    await store.deliverPlayerMailbox({
      playerIds: [entry.playerId],
      message: normalizePlayerMailboxMessage({
        id: `ugc-review:guild-chat:${entry.messageId}:${input.occurredAt ?? Date.now()}`,
        kind: "system",
        title: "聊天内容已被移除",
        body: `你的公会聊天消息因人工复核未通过，已移除。原因：${input.reason}`
      })
    });
  }
  return { deleted };
}

export async function resolveUgcReviewEntry(
  store: RoomSnapshotStore,
  input: UgcReviewDecisionInput,
  options: UgcModerationRuntimeOptions = {}
): Promise<{ entry: UgcReviewQueueEntry; result?: unknown; config: UgcModerationConfig }> {
  const entry = await findQueueEntry(store, input.itemId, options);
  const candidateKeyword = input.action === "reject" ? resolveCandidateKeyword(input, entry) : undefined;
  const metadata: UgcReviewAuditMetadata = {
    itemId: entry.itemId,
    kind: entry.kind,
    score: entry.score,
    reasons: entry.reasons,
    ...(candidateKeyword ? { candidateKeyword } : {})
  };

  if (input.action === "approve") {
    await appendReviewAudit(store, "ugc_review_approved", input, metadata);
    return { entry: { ...entry, reviewStatus: "approved" }, config: await loadUgcModerationConfigForRuntime(options) };
  }

  let result: unknown;
  if (entry.kind === "display_name") {
    result = await rejectDisplayName(store, entry, input);
  } else if (entry.kind === "guild_name") {
    result = await rejectGuildName(store, entry, input);
  } else {
    result = await rejectGuildChatMessage(store, entry, input);
  }

  const config = candidateKeyword
    ? await appendUgcCandidateKeywordForRuntime(candidateKeyword, options)
    : await loadUgcModerationConfigForRuntime(options);
  await appendReviewAudit(store, "ugc_review_rejected", input, metadata);
  return { entry: { ...entry, reviewStatus: "rejected" }, result, config };
}
