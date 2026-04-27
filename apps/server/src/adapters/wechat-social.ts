import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { FriendLeaderboardEntry, GroupChallenge, GroupChallengeType, NotificationPreferences } from "@veil/shared/models";
import type { PlayerAccountSnapshot, RoomSnapshotStore } from "@server/persistence";

export const GROUP_CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_FRIEND_LEADERBOARD_IDS = 100;

export class FriendLeaderboardTooManyIdsError extends Error {
  constructor(maxIds = MAX_FRIEND_LEADERBOARD_IDS) {
    super(`friendIds must include at most ${maxIds} entries`);
    this.name = "friend_leaderboard_too_many_ids";
  }
}

export type GroupChallengeTokenValidation =
  | { ok: true; challenge: GroupChallenge }
  | { ok: false; reason: "invalid" | "expired" };

export interface GroupChallengeCreateInput {
  creatorPlayerId: string;
  creatorDisplayName: string;
  roomId: string;
  challengeType?: GroupChallengeType;
  scoreTarget?: number;
}

export function normalizeNotificationPreferences(
  preferences?: Partial<NotificationPreferences> | null,
  now = new Date().toISOString()
): NotificationPreferences {
  return {
    matchFound: preferences?.matchFound !== false,
    turnReminder: preferences?.turnReminder !== false,
    groupChallenge: preferences?.groupChallenge !== false,
    friendLeaderboard: preferences?.friendLeaderboard !== false,
    reengagement: preferences?.reengagement !== false,
    updatedAt: preferences?.updatedAt?.trim() || now
  };
}

export function getNotificationPreferenceValue(
  preferences: NotificationPreferences | undefined,
  key: keyof NotificationPreferences
): boolean {
  if (key === "updatedAt") {
    return true;
  }

  return preferences?.[key] !== false;
}

export function normalizeFriendLeaderboardIds(friendIds: Iterable<string | null | undefined>): string[] {
  const normalized = Array.from(friendIds)
    .map((entry) => entry?.trim() ?? "")
    .filter(Boolean);
  if (normalized.length > MAX_FRIEND_LEADERBOARD_IDS) {
    throw new FriendLeaderboardTooManyIdsError();
  }
  return Array.from(new Set(normalized));
}

export async function loadAuthorizedFriendLeaderboardAccounts(
  store: Pick<RoomSnapshotStore, "loadPlayerAccount" | "loadPlayerAccountByWechatMiniGameOpenId">,
  currentPlayerId: string,
  rawFriendIds: Iterable<string | null | undefined>
): Promise<{ accounts: PlayerAccountSnapshot[]; friendCount: number }> {
  const friendIds = normalizeFriendLeaderboardIds(rawFriendIds);
  const currentAccount = await store.loadPlayerAccount(currentPlayerId);
  if (!currentAccount) {
    return {
      accounts: [],
      friendCount: 0
    };
  }

  const accountsByPlayerId = new Map<string, PlayerAccountSnapshot>([[currentAccount.playerId, currentAccount]]);
  const currentWechatOpenId = currentAccount.wechatMiniGameOpenId?.trim() ?? "";
  const candidateFriendIds = friendIds.filter((friendId) => friendId !== currentAccount.playerId && friendId !== currentWechatOpenId);
  const friendAccounts = await Promise.all(
    candidateFriendIds.map((friendId) => store.loadPlayerAccountByWechatMiniGameOpenId(friendId))
  );
  let friendCount = 0;
  for (const account of friendAccounts) {
    if (!account || account.playerId === currentAccount.playerId || accountsByPlayerId.has(account.playerId)) {
      continue;
    }
    accountsByPlayerId.set(account.playerId, account);
    friendCount += 1;
  }

  return {
    accounts: Array.from(accountsByPlayerId.values()),
    friendCount
  };
}

export function buildFriendLeaderboard(
  currentPlayerId: string,
  accounts: PlayerAccountSnapshot[]
): FriendLeaderboardEntry[] {
  const uniqueAccounts = Array.from(
    new Map(
      accounts
        .filter((account) => account.playerId.trim())
        .map((account) => [account.playerId, account] as const)
    ).values()
  );
  const currentPlayer = uniqueAccounts.find((account) => account.playerId === currentPlayerId) ?? null;

  return uniqueAccounts
    .map((account) => ({
      playerId: account.playerId,
      displayName: account.displayName || account.playerId,
      eloRating: Math.max(0, Math.floor(account.eloRating ?? 1000)),
      delta: currentPlayer ? Math.floor((account.eloRating ?? 1000) - (currentPlayer.eloRating ?? 1000)) : 0,
      isSelf: account.playerId === currentPlayerId
    }))
    .sort(
      (left, right) =>
        right.eloRating - left.eloRating ||
        Number(right.isSelf) - Number(left.isSelf) ||
        left.displayName.localeCompare(right.displayName) ||
        left.playerId.localeCompare(right.playerId)
    )
    .map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));
}

export function createGroupChallenge(
  input: GroupChallengeCreateInput,
  now = new Date()
): GroupChallenge {
  const createdAt = now.toISOString();
  return {
    challengeId: randomUUID(),
    creatorPlayerId: input.creatorPlayerId.trim(),
    creatorDisplayName: input.creatorDisplayName.trim() || input.creatorPlayerId.trim(),
    roomId: input.roomId.trim() || "room-alpha",
    challengeType: input.challengeType ?? "elo",
    ...(typeof input.scoreTarget === "number" && Number.isFinite(input.scoreTarget)
      ? { scoreTarget: Math.max(1, Math.floor(input.scoreTarget)) }
      : {}),
    createdAt,
    expiresAt: new Date(now.getTime() + GROUP_CHALLENGE_TTL_MS).toISOString()
  };
}

export function encodeGroupChallengeToken(challenge: GroupChallenge, secret: string): string {
  const payload = Buffer.from(JSON.stringify(challenge)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function hasValidGroupChallengeSignature(payload: string, signature: string, secret: string): boolean {
  const expectedDigest = createHmac("sha256", secret).update(payload).digest();
  const providedDigest = Buffer.from(signature, "base64url");
  if (providedDigest.length !== expectedDigest.length) {
    timingSafeEqual(Buffer.alloc(expectedDigest.length), expectedDigest);
    return false;
  }
  return timingSafeEqual(providedDigest, expectedDigest);
}

export function validateGroupChallengeToken(
  token: string,
  secret: string,
  now = new Date()
): GroupChallengeTokenValidation {
  const normalized = token.trim();
  const [payload, signature] = normalized.split(".");
  if (!payload || !signature) {
    return { ok: false, reason: "invalid" };
  }

  if (!hasValidGroupChallengeSignature(payload, signature, secret)) {
    return { ok: false, reason: "invalid" };
  }

  try {
    const challenge = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as GroupChallenge;
    if (!challenge || typeof challenge !== "object" || typeof challenge.expiresAt !== "string") {
      return { ok: false, reason: "invalid" };
    }
    if (new Date(challenge.expiresAt).getTime() <= now.getTime()) {
      return { ok: false, reason: "expired" };
    }
    return { ok: true, challenge };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
