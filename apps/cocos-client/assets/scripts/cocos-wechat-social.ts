import type {
  GroupChallenge,
  GroupChallengeType,
  NotificationPreferences
} from "./project-shared/models.ts";

export interface CocosWechatCloudStorageRuntimeLike {
  getFriendCloudStorage?: ((options: {
    keyList: string[];
    success?: (result: { data?: Array<{ KVDataList?: Array<{ key?: string; value?: string }> }> }) => void;
    fail?: (error: { errMsg?: string }) => void;
  }) => void) | undefined;
  setUserCloudStorage?: ((options: {
    KVDataList: Array<{ key: string; value: string }>;
    success?: () => void;
    fail?: (error: { errMsg?: string }) => void;
  }) => void) | undefined;
}

export interface CocosWechatFriendCloudEntry {
  playerId: string;
  eloRating: number;
}

export interface CocosWechatSocialAuthOptions {
  authToken?: string | null;
}

export interface CocosWechatSocialFetchOptions extends CocosWechatSocialAuthOptions {
  fetchImpl?: typeof fetch;
}

export interface CreateCocosGroupChallengeInput {
  roomId: string;
  challengeType?: GroupChallengeType;
  scoreTarget?: number;
}

export interface CocosWechatFriendLeaderboardSummary {
  headline: string;
  detail: string;
  isFallback: boolean;
}

function buildSocialFetch(fetchImpl?: typeof fetch): typeof fetch {
  return fetchImpl ?? fetch;
}

function buildSocialAuthHeaders(authToken?: string | null): HeadersInit {
  const normalized = authToken?.trim();
  return normalized ? { Authorization: `Bearer ${normalized}` } : {};
}

function normalizeRemoteUrl(remoteUrl?: string | null): string {
  return remoteUrl?.replace(/\/+$/, "") ?? "";
}

function normalizeScoreTarget(scoreTarget?: number | null): number | undefined {
  if (typeof scoreTarget !== "number" || !Number.isFinite(scoreTarget)) {
    return undefined;
  }

  return Math.max(1, Math.floor(scoreTarget));
}

async function readSocialJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorCode = "unknown";
    try {
      const payload = (await response.json()) as { error?: { code?: string } };
      errorCode = payload.error?.code?.trim() || errorCode;
    } catch {
      errorCode = "unknown";
    }
    throw new Error(`cocos_social_request_failed:${response.status}:${errorCode}`);
  }

  return (await response.json()) as T;
}

export async function readCocosWechatFriendCloudEntries(
  runtime: CocosWechatCloudStorageRuntimeLike | null | undefined
): Promise<CocosWechatFriendCloudEntry[]> {
  if (typeof runtime?.getFriendCloudStorage !== "function") {
    return [];
  }

  return await new Promise((resolve) => {
    try {
      runtime.getFriendCloudStorage?.({
        keyList: ["playerId", "eloRating"],
        success: (result) => {
          const items = (result.data ?? [])
            .map((entry) => {
              const kvData = new Map(
                (entry.KVDataList ?? [])
                  .map((pair) => [pair.key?.trim() ?? "", pair.value?.trim() ?? ""] as const)
                  .filter(([key]) => key.length > 0)
              );
              const playerId = kvData.get("playerId") ?? kvData.get("veilPlayerId") ?? "";
              const eloRating = Number(kvData.get("eloRating") ?? "1000");
              return playerId
                ? {
                    playerId,
                    eloRating: Number.isFinite(eloRating) ? Math.max(0, Math.floor(eloRating)) : 1000
                  }
                : null;
            })
            .filter((entry): entry is CocosWechatFriendCloudEntry => Boolean(entry));
          resolve(items);
        },
        fail: () => resolve([])
      });
    } catch {
      resolve([]);
    }
  });
}

export async function syncCocosWechatFriendCloudStorage(
  runtime: CocosWechatCloudStorageRuntimeLike | null | undefined,
  input: { playerId: string; eloRating: number }
): Promise<boolean> {
  if (typeof runtime?.setUserCloudStorage !== "function") {
    return false;
  }

  return await new Promise((resolve) => {
    try {
      runtime.setUserCloudStorage?.({
        KVDataList: [
          { key: "playerId", value: input.playerId.trim() || "guest" },
          { key: "eloRating", value: String(Math.max(0, Math.floor(input.eloRating))) }
        ],
        success: () => resolve(true),
        fail: () => resolve(false)
      });
    } catch {
      resolve(false);
    }
  });
}

export function normalizeCocosNotificationPreferences(
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

export function buildCocosFriendLeaderboardSummary(
  entries: Array<{ displayName: string; eloRating: number }> | null | undefined,
  friendCount: number
): CocosWechatFriendLeaderboardSummary {
  const normalizedEntries = entries ?? [];
  if (friendCount <= 0) {
    return {
      headline: "暂无可展示的微信好友战绩",
      detail: "当前账号还没有同步好友云存档，已自动回退到常规天梯视图。",
      isFallback: true
    };
  }

  if (normalizedEntries.length === 0) {
    return {
      headline: "好友榜尚未生成",
      detail: "微信好友已识别，但还没有可用的 ELO 数据。",
      isFallback: true
    };
  }

  const leader = normalizedEntries[0]!;
  return {
    headline: `${leader.displayName} 当前领跑好友榜`,
    detail: `共同步 ${friendCount} 位好友，榜首积分 ${Math.max(0, Math.floor(leader.eloRating))}。`,
    isFallback: false
  };
}

export async function createCocosGroupChallenge(
  remoteUrl: string | undefined,
  input: CreateCocosGroupChallengeInput,
  options?: CocosWechatSocialFetchOptions
): Promise<{ challenge: GroupChallenge; token: string }> {
  const response = await buildSocialFetch(options?.fetchImpl)(
    `${normalizeRemoteUrl(remoteUrl)}/api/social/group-challenge`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildSocialAuthHeaders(options?.authToken)
      },
      body: JSON.stringify({
        action: "create",
        roomId: input.roomId.trim() || "room-alpha",
        ...(input.challengeType ? { challengeType: input.challengeType } : {}),
        ...(normalizeScoreTarget(input.scoreTarget) ? { scoreTarget: normalizeScoreTarget(input.scoreTarget) } : {})
      })
    }
  );

  return await readSocialJson<{ challenge: GroupChallenge; token: string }>(response);
}

export async function redeemCocosGroupChallenge(
  remoteUrl: string | undefined,
  token: string,
  options?: CocosWechatSocialFetchOptions
): Promise<GroupChallenge> {
  const response = await buildSocialFetch(options?.fetchImpl)(
    `${normalizeRemoteUrl(remoteUrl)}/api/social/group-challenge`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildSocialAuthHeaders(options?.authToken)
      },
      body: JSON.stringify({
        action: "redeem",
        token: token.trim()
      })
    }
  );

  const payload = await readSocialJson<{ challenge: GroupChallenge }>(response);
  return payload.challenge;
}

export async function updateCocosNotificationPreferences(
  remoteUrl: string | undefined,
  preferences: Partial<NotificationPreferences>,
  options?: CocosWechatSocialFetchOptions
): Promise<NotificationPreferences> {
  const response = await buildSocialFetch(options?.fetchImpl)(
    `${normalizeRemoteUrl(remoteUrl)}/api/account/notification-prefs`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        ...buildSocialAuthHeaders(options?.authToken)
      },
      body: JSON.stringify(preferences)
    }
  );

  const payload = await readSocialJson<{ notificationPreferences: NotificationPreferences }>(response);
  return normalizeCocosNotificationPreferences(payload.notificationPreferences);
}
