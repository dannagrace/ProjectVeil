import { createHmac, randomUUID } from "node:crypto";
import type { FriendLeaderboardEntry, GroupChallenge, GroupChallengeType, NotificationPreferences } from "@veil/shared/models";
import type { PlayerAccountSnapshot } from "@server/persistence";

export const GROUP_CHALLENGE_TTL_MS = 24 * 60 * 60 * 1000;

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

  const expectedSignature = createHmac("sha256", secret).update(payload).digest("base64url");
  if (signature !== expectedSignature) {
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
