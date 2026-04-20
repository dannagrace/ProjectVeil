import { readFileSync } from "node:fs";
import path from "node:path";
import type { AnalyticsEventName } from "@veil/shared/platform";
import type { PlayerAccountReadModel, PlayerMailboxMessage } from "@veil/shared/progression";
import { emitAnalyticsEvent } from "@server/domain/ops/analytics";
import { sendMobilePushNotification } from "@server/adapters/mobile-push";
import { sendWechatSubscribeMessage } from "@server/adapters/wechat-subscribe";
import { normalizePlayerMailboxMessage } from "@server/domain/account/player-mailbox";
import type { AdminAuditAction, AdminAuditLogRecord, PlayerAccountSnapshot, RoomSnapshotStore } from "@server/persistence";

export type ReengagementChannel = "mailbox" | "wechat_subscribe" | "mobile_push";

export interface ReengagementPolicy {
  id: string;
  name: string;
  inactiveHours: number;
  maxLookbackHours?: number;
  channels: ReengagementChannel[];
  mailbox: {
    title: string;
    body: string;
  };
  subscribe?: {
    headline?: string;
    chapterName?: string;
  };
}

export interface ReengagementCandidate {
  playerId: string;
  displayName: string;
  policyId: string;
  inactiveHours: number;
  campaignKey: string;
  channels: ReengagementChannel[];
}

export interface ReengagementSweepDelivery {
  playerId: string;
  policyId: string;
  campaignKey: string;
  inactiveHours: number;
  deliveredChannels: ReengagementChannel[];
}

export interface ReengagementSweepResult {
  processedAt: string;
  candidates: ReengagementCandidate[];
  deliveries: ReengagementSweepDelivery[];
  skipped: Array<{ playerId: string; reason: string }>;
}

interface ReengagementRuntimeOptions {
  now?: Date;
  policies?: ReengagementPolicy[];
  sendWechatSubscribeMessageImpl?: typeof sendWechatSubscribeMessage;
  sendMobilePushNotificationImpl?: typeof sendMobilePushNotification;
}

interface ReengagementPolicyConfigDocument {
  policies?: unknown[];
}

interface ReengagementAuditMetadata {
  policyId: string;
  campaignKey: string;
  messageId?: string;
  deliveredChannels?: ReengagementChannel[];
}

const DEFAULT_REENGAGEMENT_POLICIES_PATH = path.resolve(process.cwd(), "configs/reengagement-policies.json");
const REENGAGEMENT_MAILBOX_ID_PREFIX = "reengagement:";
const REENGAGEMENT_AUDIT_LOOKBACK_DAYS = 30;

function normalizeChannel(value: unknown): ReengagementChannel | null {
  if (value === "mailbox" || value === "wechat_subscribe" || value === "mobile_push") {
    return value;
  }
  return null;
}

function normalizePolicy(input: unknown): ReengagementPolicy | null {
  const record = input as Partial<ReengagementPolicy> | null;
  const id = record?.id?.trim();
  const name = record?.name?.trim();
  const inactiveHours = Math.max(0, Math.floor(record?.inactiveHours ?? 0));
  const channels = Array.from(new Set((record?.channels ?? []).map(normalizeChannel).filter((entry): entry is ReengagementChannel => Boolean(entry))));
  const title = record?.mailbox?.title?.trim();
  const body = record?.mailbox?.body?.trim();
  if (!id || !name || inactiveHours <= 0 || channels.length === 0 || !title || !body) {
    return null;
  }

  return {
    id,
    name,
    inactiveHours,
    ...(Number.isFinite(record?.maxLookbackHours) && Math.floor(record!.maxLookbackHours!) > inactiveHours
      ? { maxLookbackHours: Math.floor(record!.maxLookbackHours!) }
      : {}),
    channels,
    mailbox: {
      title,
      body
    },
    ...(record?.subscribe
      ? {
          subscribe: {
            ...(record.subscribe.headline?.trim() ? { headline: record.subscribe.headline.trim() } : {}),
            ...(record.subscribe.chapterName?.trim() ? { chapterName: record.subscribe.chapterName.trim() } : {})
          }
        }
      : {})
  };
}

export function loadReengagementPolicies(env: NodeJS.ProcessEnv = process.env): ReengagementPolicy[] {
  const configuredPath = env.VEIL_REENGAGEMENT_POLICIES_PATH?.trim() || DEFAULT_REENGAGEMENT_POLICIES_PATH;
  const raw = JSON.parse(readFileSync(configuredPath, "utf8")) as ReengagementPolicyConfigDocument;
  return (raw.policies ?? [])
    .map(normalizePolicy)
    .filter((entry): entry is ReengagementPolicy => Boolean(entry))
    .sort((left, right) => right.inactiveHours - left.inactiveHours || left.id.localeCompare(right.id));
}

function isActiveBan(account: Pick<PlayerAccountReadModel, "banStatus" | "banExpiry">, now = new Date()): boolean {
  if (account.banStatus === "permanent") {
    return true;
  }
  if (account.banStatus !== "temporary") {
    return false;
  }
  const expiresAt = account.banExpiry ? new Date(account.banExpiry).getTime() : Number.NaN;
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

function toHoursInactive(account: Pick<PlayerAccountSnapshot, "lastSeenAt" | "updatedAt" | "createdAt">, now = new Date()): number | null {
  const candidate = account.lastSeenAt ?? account.updatedAt ?? account.createdAt;
  if (!candidate) {
    return null;
  }
  const timestamp = new Date(candidate).getTime();
  if (!Number.isFinite(timestamp) || timestamp >= now.getTime()) {
    return null;
  }
  return Math.max(0, Math.floor((now.getTime() - timestamp) / (1000 * 60 * 60)));
}

function resolvePolicyForAccount(account: PlayerAccountSnapshot, policies: ReengagementPolicy[], now = new Date()): { policy: ReengagementPolicy; inactiveHours: number } | null {
  if (isActiveBan(account, now)) {
    return null;
  }
  const inactiveHours = toHoursInactive(account, now);
  if (inactiveHours === null) {
    return null;
  }

  for (const policy of policies) {
    if (inactiveHours < policy.inactiveHours) {
      continue;
    }
    if (policy.maxLookbackHours !== undefined && inactiveHours >= policy.maxLookbackHours) {
      continue;
    }
    return { policy, inactiveHours };
  }
  return null;
}

function buildCampaignKey(policyId: string, now = new Date()): string {
  return `${policyId}:${now.toISOString().slice(0, 10)}`;
}

function buildMailboxMessage(policy: ReengagementPolicy, campaignKey: string, sentAt: string): PlayerMailboxMessage {
  return normalizePlayerMailboxMessage({
    id: `${REENGAGEMENT_MAILBOX_ID_PREFIX}${campaignKey}`,
    kind: "announcement",
    title: policy.mailbox.title,
    body: policy.mailbox.body,
    sentAt,
    expiresAt: new Date(new Date(sentAt).getTime() + 1000 * 60 * 60 * 24 * 7).toISOString()
  });
}

function parseAuditMetadata(record: Pick<AdminAuditLogRecord, "metadataJson"> | null | undefined): ReengagementAuditMetadata | null {
  if (!record?.metadataJson?.trim()) {
    return null;
  }
  try {
    const payload = JSON.parse(record.metadataJson) as Partial<ReengagementAuditMetadata>;
    const policyId = payload.policyId?.trim();
    const campaignKey = payload.campaignKey?.trim();
    if (!policyId || !campaignKey) {
      return null;
    }
    return {
      policyId,
      campaignKey,
      ...(payload.messageId?.trim() ? { messageId: payload.messageId.trim() } : {}),
      ...(Array.isArray(payload.deliveredChannels)
        ? {
            deliveredChannels: payload.deliveredChannels
              .map(normalizeChannel)
              .filter((entry): entry is ReengagementChannel => Boolean(entry))
          }
        : {})
    };
  } catch {
    return null;
  }
}

async function listRecentReengagementAudits(
  store: RoomSnapshotStore,
  action: AdminAuditAction,
  playerId: string,
  now = new Date()
): Promise<AdminAuditLogRecord[]> {
  if (!store.listAdminAuditLogs) {
    return [];
  }
  const since = new Date(now.getTime() - REENGAGEMENT_AUDIT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  return store.listAdminAuditLogs({
    action,
    targetPlayerId: playerId,
    since,
    limit: 200
  });
}

async function appendReengagementAudit(
  store: RoomSnapshotStore,
  action: AdminAuditAction,
  playerId: string,
  summary: string,
  metadata: ReengagementAuditMetadata,
  occurredAt: string
): Promise<void> {
  if (!store.appendAdminAuditLog) {
    return;
  }
  await store.appendAdminAuditLog({
    actorPlayerId: "ops:reengagement",
    actorRole: "admin",
    action,
    targetPlayerId: playerId,
    targetScope: "reengagement",
    summary,
    metadataJson: JSON.stringify(metadata),
    occurredAt
  });
}

function emitReengagementEvent<Name extends Extract<AnalyticsEventName, "reengagement_sent" | "reengagement_opened" | "reengagement_returned">>(
  name: Name,
  playerId: string,
  payload: Parameters<typeof emitAnalyticsEvent<Name>>[1]["payload"],
  at: string
): void {
  emitAnalyticsEvent(name, {
    playerId,
    at,
    roomId: "reengagement",
    payload
  });
}

export async function previewReengagementCandidates(
  store: RoomSnapshotStore,
  options: { now?: Date; policies?: ReengagementPolicy[] } = {}
): Promise<ReengagementCandidate[]> {
  const now = options.now ?? new Date();
  const policies = options.policies ?? loadReengagementPolicies();
  const accounts = await store.listPlayerAccounts({ limit: 10_000, offset: 0 });
  return accounts
    .map((account) => {
      const resolved = resolvePolicyForAccount(account, policies, now);
      if (!resolved) {
        return null;
      }
      const campaignKey = buildCampaignKey(resolved.policy.id, now);
      return {
        playerId: account.playerId,
        displayName: account.displayName,
        policyId: resolved.policy.id,
        inactiveHours: resolved.inactiveHours,
        campaignKey,
        channels: resolved.policy.channels
      } satisfies ReengagementCandidate;
    })
    .filter((entry): entry is ReengagementCandidate => Boolean(entry))
    .sort((left, right) => right.inactiveHours - left.inactiveHours || left.playerId.localeCompare(right.playerId));
}

export async function runReengagementSweep(
  store: RoomSnapshotStore,
  options: ReengagementRuntimeOptions = {}
): Promise<ReengagementSweepResult> {
  const now = options.now ?? new Date();
  const processedAt = now.toISOString();
  const policies = options.policies ?? loadReengagementPolicies();
  const sendWechatSubscribeMessageImpl = options.sendWechatSubscribeMessageImpl ?? sendWechatSubscribeMessage;
  const sendMobilePushNotificationImpl = options.sendMobilePushNotificationImpl ?? sendMobilePushNotification;
  const candidates = await previewReengagementCandidates(store, { now, policies });
  const deliveries: ReengagementSweepDelivery[] = [];
  const skipped: Array<{ playerId: string; reason: string }> = [];

  for (const candidate of candidates) {
    const alreadySent = (await listRecentReengagementAudits(store, "reengagement_sent", candidate.playerId, now)).some((entry) => {
      const metadata = parseAuditMetadata(entry);
      return metadata?.campaignKey === candidate.campaignKey;
    });
    if (alreadySent) {
      skipped.push({ playerId: candidate.playerId, reason: "already_sent_for_campaign" });
      continue;
    }

    const policy = policies.find((entry) => entry.id === candidate.policyId);
    if (!policy) {
      skipped.push({ playerId: candidate.playerId, reason: "policy_not_found" });
      continue;
    }

    const deliveredChannels: ReengagementChannel[] = [];
    const mailboxMessage = buildMailboxMessage(policy, candidate.campaignKey, processedAt);

    if (policy.channels.includes("mailbox") && store.deliverPlayerMailbox) {
      const delivery = await store.deliverPlayerMailbox({
        playerIds: [candidate.playerId],
        message: mailboxMessage
      });
      if (delivery.deliveredPlayerIds.includes(candidate.playerId)) {
        deliveredChannels.push("mailbox");
      }
    }

    if (policy.channels.includes("wechat_subscribe")) {
      const sent = await sendWechatSubscribeMessageImpl(candidate.playerId, "reengagement", {
        headline: policy.subscribe?.headline ?? policy.mailbox.title,
        chapterName: policy.subscribe?.chapterName ?? "今日主线"
      }, {
        store
      });
      if (sent) {
        deliveredChannels.push("wechat_subscribe");
      }
    }

    if (policy.channels.includes("mobile_push")) {
      const sent = await sendMobilePushNotificationImpl(candidate.playerId, "reengagement", {
        headline: policy.subscribe?.headline ?? policy.mailbox.title,
        chapterName: policy.subscribe?.chapterName ?? "今日主线"
      }, {
        store
      });
      if (sent) {
        deliveredChannels.push("mobile_push");
      }
    }

    if (deliveredChannels.length === 0) {
      skipped.push({ playerId: candidate.playerId, reason: "no_delivery_channel_succeeded" });
      continue;
    }

    emitReengagementEvent("reengagement_sent", candidate.playerId, {
      policyId: candidate.policyId,
      inactivityHours: candidate.inactiveHours,
      channels: deliveredChannels,
      campaignKey: candidate.campaignKey
    }, processedAt);
    await appendReengagementAudit(
      store,
      "reengagement_sent",
      candidate.playerId,
      `Sent reengagement campaign ${candidate.campaignKey} via ${deliveredChannels.join(", ")}`,
      {
        policyId: candidate.policyId,
        campaignKey: candidate.campaignKey,
        messageId: mailboxMessage.id,
        deliveredChannels
      },
      processedAt
    );
    deliveries.push({
      playerId: candidate.playerId,
      policyId: candidate.policyId,
      campaignKey: candidate.campaignKey,
      inactiveHours: candidate.inactiveHours,
      deliveredChannels
    });
  }

  return {
    processedAt,
    candidates,
    deliveries,
    skipped
  };
}

function isUnreadReengagementMessage(message: PlayerMailboxMessage): boolean {
  return message.id.startsWith(REENGAGEMENT_MAILBOX_ID_PREFIX) && !message.readAt;
}

function extractPolicyFromMailboxMessage(messageId: string): { policyId: string; campaignKey: string } | null {
  const normalized = messageId.trim();
  if (!normalized.startsWith(REENGAGEMENT_MAILBOX_ID_PREFIX)) {
    return null;
  }
  const campaignKey = normalized.slice(REENGAGEMENT_MAILBOX_ID_PREFIX.length);
  const [policyId] = campaignKey.split(":");
  if (!policyId || !campaignKey) {
    return null;
  }
  return { policyId, campaignKey };
}

export async function acknowledgeReengagementMailboxOpen(
  store: RoomSnapshotStore,
  account: PlayerAccountSnapshot,
  openedAt = new Date().toISOString()
): Promise<PlayerAccountSnapshot> {
  const unreadMessages = (account.mailbox ?? []).filter(isUnreadReengagementMessage);
  if (unreadMessages.length === 0) {
    return account;
  }

  const nextMailbox = (account.mailbox ?? []).map((message) =>
    isUnreadReengagementMessage(message) ? { ...message, readAt: openedAt } : message
  );
  const nextAccount = await store.savePlayerAccountProgress(account.playerId, {
    mailbox: nextMailbox
  });

  for (const message of unreadMessages) {
    const metadata = extractPolicyFromMailboxMessage(message.id);
    if (!metadata) {
      continue;
    }
    const existingOpenAudit = (await listRecentReengagementAudits(store, "reengagement_opened", account.playerId, new Date(openedAt))).some((entry) => {
      const auditMetadata = parseAuditMetadata(entry);
      return auditMetadata?.campaignKey === metadata.campaignKey;
    });
    if (existingOpenAudit) {
      continue;
    }
    emitReengagementEvent("reengagement_opened", account.playerId, {
      policyId: metadata.policyId,
      campaignKey: metadata.campaignKey,
      messageId: message.id
    }, openedAt);
    await appendReengagementAudit(
      store,
      "reengagement_opened",
      account.playerId,
      `Opened reengagement mailbox ${metadata.campaignKey}`,
      {
        policyId: metadata.policyId,
        campaignKey: metadata.campaignKey,
        messageId: message.id
      },
      openedAt
    );
  }

  return nextAccount;
}

export async function recordReengagementReturn(
  store: RoomSnapshotStore,
  account: PlayerAccountSnapshot,
  returnedAt = new Date().toISOString()
): Promise<void> {
  const sentAudits = await listRecentReengagementAudits(store, "reengagement_sent", account.playerId, new Date(returnedAt));
  if (sentAudits.length === 0) {
    return;
  }

  const returnedAudits = await listRecentReengagementAudits(store, "reengagement_returned", account.playerId, new Date(returnedAt));
  for (const audit of sentAudits) {
    const metadata = parseAuditMetadata(audit);
    if (!metadata) {
      continue;
    }
    const alreadyReturned = returnedAudits.some((entry) => parseAuditMetadata(entry)?.campaignKey === metadata.campaignKey);
    if (alreadyReturned) {
      continue;
    }

    const hoursSinceSend = Math.max(0, Math.floor((new Date(returnedAt).getTime() - new Date(audit.occurredAt).getTime()) / (1000 * 60 * 60)));
    emitReengagementEvent("reengagement_returned", account.playerId, {
      policyId: metadata.policyId,
      campaignKey: metadata.campaignKey,
      hoursSinceSend
    }, returnedAt);
    await appendReengagementAudit(
      store,
      "reengagement_returned",
      account.playerId,
      `Returned after reengagement campaign ${metadata.campaignKey}`,
      metadata,
      returnedAt
    );
    return;
  }
}
