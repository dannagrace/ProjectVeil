import type { LeaderboardAbuseState, PlayerBanStatus } from "@veil/shared/progression";
import type { AdminAuditAction, AdminAuditLogRecord, AdminAuditActorRole, PlayerAccountSnapshot, RoomSnapshotStore } from "./persistence";
import { normalizePlayerMailboxMessage } from "./player-mailbox";

export interface RiskQueueEntry {
  playerId: string;
  displayName: string;
  score: number;
  severity: "medium" | "high";
  reasons: string[];
  reviewStatus: "pending" | "warned" | "cleared" | "banned";
  lastAlertAt?: string;
  recentBattleIds?: string[];
}

export interface RiskReviewInput {
  playerId: string;
  action: "warn" | "clear" | "ban";
  reason: string;
  actorPlayerId: string;
  actorRole: AdminAuditActorRole;
  occurredAt?: string;
  banStatus?: Extract<PlayerBanStatus, "temporary" | "permanent">;
  banExpiry?: string;
}

interface RiskAuditMetadata {
  score: number;
  reasons: string[];
}

function parseAuditMetadata(record: Pick<AdminAuditLogRecord, "metadataJson"> | null | undefined): RiskAuditMetadata | null {
  if (!record?.metadataJson?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(record.metadataJson) as Partial<RiskAuditMetadata>;
    return {
      score: Math.max(0, Math.floor(parsed.score ?? 0)),
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons.map((reason) => reason?.trim()).filter((reason): reason is string => Boolean(reason)) : []
    };
  } catch {
    return null;
  }
}

function buildReasons(state?: LeaderboardAbuseState): string[] {
  if (!state) {
    return [];
  }
  const reasons = new Set<string>();
  if (state.status === "flagged") {
    reasons.add("leaderboard 状态已标记 flagged");
  } else if (state.status === "watch") {
    reasons.add("leaderboard 状态已进入 watch");
  }
  for (const reason of state.lastAlertReasons ?? []) {
    reasons.add(reason);
  }
  if ((state.dailyEloGain ?? 0) >= 300) {
    reasons.add(`单日 Elo 增长偏高（${state.dailyEloGain}）`);
  }
  if ((state.opponentStats ?? []).some((entry) => entry.matchCount >= 5)) {
    reasons.add("存在高频重复对手记录");
  }
  return Array.from(reasons);
}

export function scoreRiskState(state?: LeaderboardAbuseState): { score: number; reasons: string[] } {
  if (!state) {
    return { score: 0, reasons: [] };
  }
  let score = 0;
  const reasons = buildReasons(state);
  if (state.status === "watch") {
    score += 25;
  }
  if (state.status === "flagged") {
    score += 45;
  }
  score += Math.min(25, (state.lastAlertReasons?.length ?? 0) * 8);
  score += Math.min(20, (state.opponentStats ?? []).filter((entry) => entry.matchCount >= 5).length * 10);
  if ((state.dailyEloGain ?? 0) >= 200) {
    score += 10;
  }
  if ((state.dailyEloGain ?? 0) >= 400) {
    score += 10;
  }
  return {
    score,
    reasons
  };
}

async function listRiskAudits(store: RoomSnapshotStore, playerId: string): Promise<AdminAuditLogRecord[]> {
  if (!store.listAdminAuditLogs) {
    return [];
  }
  return store.listAdminAuditLogs({
    targetPlayerId: playerId,
    targetScope: "risk-review",
    limit: 20
  });
}

function resolveReviewStatus(audits: AdminAuditLogRecord[]): RiskQueueEntry["reviewStatus"] {
  for (const audit of audits) {
    if (audit.action === "risk_review_banned") {
      return "banned";
    }
    if (audit.action === "risk_review_warned") {
      return "warned";
    }
    if (audit.action === "risk_review_cleared") {
      return "cleared";
    }
  }
  return "pending";
}

export async function buildRiskQueue(store: RoomSnapshotStore): Promise<RiskQueueEntry[]> {
  const accounts = await store.listPlayerAccounts({ limit: 10_000, offset: 0 });
  const entries: RiskQueueEntry[] = [];

  for (const account of accounts) {
    const risk = scoreRiskState(account.leaderboardAbuseState);
    if (risk.score < 25 && risk.reasons.length === 0) {
      continue;
    }
    const audits = await listRiskAudits(store, account.playerId);
    const recentBattleIds = store.listBattleSnapshotsForPlayer
      ? (await store.listBattleSnapshotsForPlayer(account.playerId, { limit: 3 })).map((snapshot) => snapshot.battleId)
      : [];
    entries.push({
      playerId: account.playerId,
      displayName: account.displayName,
      score: risk.score,
      severity: risk.score >= 60 ? "high" : "medium",
      reasons: risk.reasons,
      reviewStatus: resolveReviewStatus(audits),
      ...(account.leaderboardAbuseState?.lastAlertAt ? { lastAlertAt: account.leaderboardAbuseState.lastAlertAt } : {}),
      ...(recentBattleIds.length > 0 ? { recentBattleIds } : {})
    });
  }

  return entries.sort((left, right) => right.score - left.score || left.playerId.localeCompare(right.playerId));
}

async function appendRiskAudit(
  store: RoomSnapshotStore,
  action: AdminAuditAction,
  input: RiskReviewInput,
  metadata: RiskAuditMetadata
): Promise<void> {
  if (!store.appendAdminAuditLog) {
    return;
  }
  await store.appendAdminAuditLog({
    actorPlayerId: input.actorPlayerId,
    actorRole: input.actorRole,
    action,
    targetPlayerId: input.playerId,
    targetScope: "risk-review",
    summary: `${input.action} risk queue entry for ${input.playerId}`,
    metadataJson: JSON.stringify(metadata),
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {})
  });
}

export async function reviewRiskQueueEntry(store: RoomSnapshotStore, input: RiskReviewInput): Promise<PlayerAccountSnapshot> {
  const account = await store.loadPlayerAccount(input.playerId);
  if (!account) {
    throw new Error("player_not_found");
  }
  const risk = scoreRiskState(account.leaderboardAbuseState);
  const occurredAt = input.occurredAt ?? new Date().toISOString();

  if (input.action === "clear") {
    const nextAccount = await store.savePlayerAccountProgress(input.playerId, {
      leaderboardAbuseState: {
        ...(account.leaderboardAbuseState ?? {}),
        status: "clear",
        lastAlertReasons: [],
        lastAlertAt: occurredAt
      }
    });
    await appendRiskAudit(store, "risk_review_cleared", { ...input, occurredAt }, { score: risk.score, reasons: risk.reasons });
    return nextAccount;
  }

  if (input.action === "warn") {
    if (store.deliverPlayerMailbox) {
      await store.deliverPlayerMailbox({
        playerIds: [input.playerId],
        message: normalizePlayerMailboxMessage({
          id: `risk-review:warn:${input.playerId}:${occurredAt}`,
          kind: "system",
          title: "异常行为提醒",
          body: `系统检测到你的近期行为需要人工复核：${input.reason}`,
          sentAt: occurredAt
        })
      });
    }
    const nextAccount = await store.savePlayerAccountProgress(input.playerId, {
      leaderboardAbuseState: {
        ...(account.leaderboardAbuseState ?? {}),
        status: "watch",
        lastAlertAt: occurredAt,
        lastAlertReasons: Array.from(new Set([...(account.leaderboardAbuseState?.lastAlertReasons ?? []), input.reason]))
      }
    });
    await appendRiskAudit(store, "risk_review_warned", { ...input, occurredAt }, { score: risk.score, reasons: risk.reasons });
    return nextAccount;
  }

  if (!store.savePlayerBan) {
    throw new Error("ban_store_unavailable");
  }

  const banStatus = input.banStatus ?? "temporary";
  const nextAccount = await store.savePlayerBan(input.playerId, {
    banStatus,
    banReason: input.reason,
    ...(banStatus === "temporary"
      ? {
          banExpiry:
            input.banExpiry ??
            new Date(new Date(occurredAt).getTime() + 1000 * 60 * 60 * 24 * 7).toISOString()
        }
      : {})
  });
  await appendRiskAudit(store, "risk_review_banned", { ...input, occurredAt, banStatus }, { score: risk.score, reasons: risk.reasons });
  return nextAccount;
}
