import { serializeCocosLaunchQuery } from "./cocos-runtime-platform.ts";

export type CocosWechatShareScene = "lobby" | "world" | "battle";

export interface CocosWechatSharePayload {
  title: string;
  query: string;
  imageUrl?: string;
}

export interface CocosWechatShareRuntimeLike {
  showShareMenu?: ((options?: {
    withShareTicket?: boolean;
    success?: () => void;
    fail?: (error: { errMsg?: string }) => void;
  }) => void) | undefined;
  onShareAppMessage?: ((handler: () => CocosWechatSharePayload) => void) | undefined;
  shareAppMessage?: ((payload: CocosWechatSharePayload) => void) | undefined;
}

export interface CocosWechatShareBuildInput {
  roomId: string;
  inviterPlayerId: string;
  displayName?: string | null;
  scene: CocosWechatShareScene;
  day?: number | null;
  battleLabel?: string | null;
  imageUrl?: string | null;
}

export interface CocosWechatShareSyncResult {
  available: boolean;
  menuEnabled: boolean;
  handlerRegistered: boolean;
  canShareDirectly: boolean;
  immediateShared: boolean;
  payload: CocosWechatSharePayload;
  message: string;
}

function normalizeString(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

export function buildCocosWechatSharePayload(input: CocosWechatShareBuildInput): CocosWechatSharePayload {
  const roomId = normalizeString(input.roomId) ?? "room-alpha";
  const inviterPlayerId = normalizeString(input.inviterPlayerId) ?? "guest";
  const displayName = normalizeString(input.displayName) ?? "雾境旅人";
  const dayLabel = input.day != null ? `第 ${Math.max(1, Math.floor(input.day))} 天` : "当前进度";
  const battleLabel = normalizeString(input.battleLabel);
  let title = `${displayName} 邀请你加入 Project Veil 房间 ${roomId}`;

  if (input.scene === "world") {
    title = `${displayName} 正在 Project Veil ${dayLabel} 探索房间 ${roomId}`;
  } else if (input.scene === "battle") {
    title = battleLabel
      ? `${displayName} 在 ${battleLabel} 中等待支援，房间 ${roomId}`
      : `${displayName} 在 Project Veil ${dayLabel} 遭遇战斗，房间 ${roomId}`;
  }

  const imageUrl = normalizeString(input.imageUrl);

  return {
    title,
    query: serializeCocosLaunchQuery({
      roomId,
      inviterId: inviterPlayerId,
      shareScene: input.scene,
      ...(input.day != null ? { day: Math.max(1, Math.floor(input.day)) } : {})
    }).replace(/^\?/, ""),
    ...(imageUrl ? { imageUrl } : {})
  };
}

export function syncCocosWechatShareBridge(
  runtime: CocosWechatShareRuntimeLike | null | undefined,
  payload: CocosWechatSharePayload,
  options?: { immediate?: boolean }
): CocosWechatShareSyncResult {
  const menuEnabled = typeof runtime?.showShareMenu === "function";
  const handlerRegistered = typeof runtime?.onShareAppMessage === "function";
  const canShareDirectly = typeof runtime?.shareAppMessage === "function";
  const available = menuEnabled || handlerRegistered || canShareDirectly;
  let immediateShared = false;

  if (menuEnabled) {
    runtime!.showShareMenu?.({
      withShareTicket: true
    });
  }

  if (handlerRegistered) {
    runtime!.onShareAppMessage?.(() => payload);
  }

  if (options?.immediate && canShareDirectly) {
    runtime!.shareAppMessage?.(payload);
    immediateShared = true;
  }

  let message = "当前小游戏壳未暴露分享能力。";
  if (immediateShared) {
    message = "已拉起当前房间的转发面板。";
  } else if (handlerRegistered || menuEnabled) {
    message = canShareDirectly
      ? "已同步小游戏转发卡片，可直接分享当前房间。"
      : "已同步小游戏转发卡片，请使用右上角菜单分享。";
  } else if (canShareDirectly) {
    message = "当前小游戏壳支持直接转发，但未检测到菜单分享挂接接口。";
  }

  return {
    available,
    menuEnabled,
    handlerRegistered,
    canShareDirectly,
    immediateShared,
    payload,
    message
  };
}
