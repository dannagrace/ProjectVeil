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
