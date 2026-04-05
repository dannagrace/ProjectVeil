import assetConfigJson from "../../../../configs/assets.json";
import type { CocosRuntimePlatform } from "./cocos-runtime-platform.ts";
import type { PlayerBattleReplaySummary } from "./project-shared/battle-replay.ts";

export interface WechatSharePayload {
  title: string;
  imageUrl: string;
  path: string;
}

interface ShareCardAssetConfig {
  shareCard?: {
    battleVictory?: unknown;
  };
}

interface ClipboardEnvironmentLike {
  navigator?: {
    clipboard?: {
      writeText?: (text: string) => Promise<void>;
    };
  };
  document?: {
    body?: {
      appendChild?: (node: unknown) => void;
      removeChild?: (node: unknown) => void;
    };
    createElement?: (tagName: string) => {
      value: string;
      style: {
        position: string;
        opacity: string;
      };
      focus: () => void;
      select: () => void;
    };
    execCommand?: (command: string) => boolean;
  };
}

interface WechatBattleShareRuntimeLike {
  shareAppMessage?: ((payload: WechatSharePayload) => void) | undefined;
}

export interface BattleResultShareExecutionResult {
  channel: "wechat" | "h5-stub" | "unavailable";
  copied: boolean;
  payload: WechatSharePayload;
  summary: string;
  message: string;
}

function normalizeString(value?: string | null): string {
  return value?.trim() ?? "";
}

export function shouldOfferBattleResultShare(result: PlayerBattleReplaySummary | null | undefined): boolean {
  return (
    Boolean(result)
    && result?.battleKind === "hero"
    && result.playerCamp === "attacker"
    && result.result === "attacker_victory"
  );
}

export function buildShareCardPayload(
  result: PlayerBattleReplaySummary,
  playerDisplayName: string
): WechatSharePayload {
  const roomId = normalizeString(result.roomId) || "room-alpha";
  const playerId = normalizeString(result.playerId) || "guest";
  const displayName = normalizeString(playerDisplayName) || playerId;
  const imageUrl = buildBattleVictoryShareImageDataUrl(result, displayName);

  return {
    title: `${displayName} 赢得了天梯对战！`,
    imageUrl,
    path: `?roomId=${encodeURIComponent(roomId)}&referrer=${encodeURIComponent(playerId)}`
  };
}

export function buildBattleVictoryShareImageDataUrl(
  result: PlayerBattleReplaySummary,
  playerDisplayName: string
): string {
  const displayName = normalizeString(playerDisplayName) || normalizeString(result.playerId) || "雾境旅人";
  const roomId = normalizeString(result.roomId) || "room-alpha";
  const background =
    normalizeString((assetConfigJson as ShareCardAssetConfig).shareCard?.battleVictory as string | undefined)
    || "linear-gradient(135deg,#162031 0%,#31425e 100%)";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
      <defs>
        <linearGradient id="veil-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#162031" />
          <stop offset="100%" stop-color="#31425e" />
        </linearGradient>
      </defs>
      <rect width="960" height="540" rx="36" fill="url(#veil-bg)" />
      <rect x="42" y="42" width="876" height="456" rx="28" fill="#0f1725" opacity="0.45" stroke="#f3d28b" stroke-width="3" />
      <text x="72" y="112" fill="#f6e7bb" font-size="34" font-family="Arial, sans-serif">Project Veil Victory</text>
      <text x="72" y="182" fill="#ffffff" font-size="56" font-weight="700" font-family="Arial, sans-serif">${escapeXml(displayName)}</text>
      <text x="72" y="248" fill="#cbd6ea" font-size="28" font-family="Arial, sans-serif">Room ${escapeXml(roomId)}</text>
      <text x="72" y="310" fill="#cbd6ea" font-size="28" font-family="Arial, sans-serif">Attacker Victory</text>
      <rect x="72" y="356" width="300" height="88" rx="22" fill="#f3d28b" opacity="0.15" stroke="#f3d28b" stroke-width="2" />
      <text x="96" y="408" fill="#f9e8bf" font-size="30" font-family="Arial, sans-serif">Share to WeChat Moments</text>
      <text x="72" y="486" fill="#8ea2c5" font-size="18" font-family="Arial, sans-serif">${escapeXml(background)}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildBattleResultShareSummary(
  result: PlayerBattleReplaySummary,
  playerDisplayName: string
): string {
  const payload = buildShareCardPayload(result, playerDisplayName);
  return `${payload.title}\n房间 ${result.roomId}\n邀请链接 ${payload.path}`;
}

export async function shareBattleResultForRuntime(
  result: PlayerBattleReplaySummary,
  playerDisplayName: string,
  options?: {
    runtimePlatform?: CocosRuntimePlatform;
    wechatRuntime?: WechatBattleShareRuntimeLike | null;
    clipboardEnvironment?: ClipboardEnvironmentLike;
  }
): Promise<BattleResultShareExecutionResult> {
  const payload = buildShareCardPayload(result, playerDisplayName);
  const summary = buildBattleResultShareSummary(result, playerDisplayName);

  if (options?.runtimePlatform === "wechat-game") {
    if (typeof options.wechatRuntime?.shareAppMessage === "function") {
      options.wechatRuntime.shareAppMessage(payload);
      return {
        channel: "wechat",
        copied: false,
        payload,
        summary,
        message: "已拉起微信分享面板。"
      };
    }

    return {
      channel: "unavailable",
      copied: false,
      payload,
      summary,
      message: "当前微信小游戏环境未提供 shareAppMessage。"
    };
  }

  const copied = await copyTextToClipboard(summary, options?.clipboardEnvironment);
  return {
    channel: copied ? "h5-stub" : "unavailable",
    copied,
    payload,
    summary,
    message: copied ? "已复制战绩摘要，可直接粘贴分享。" : "当前 H5 运行环境不支持剪贴板复制。"
  };
}

export function readLaunchReferrerId(search?: string | null): string | null {
  const normalizedSearch = normalizeString(search);
  const params = new URLSearchParams(
    normalizedSearch.startsWith("?") ? normalizedSearch : normalizedSearch ? `?${normalizedSearch}` : ""
  );
  const referrerId = normalizeString(params.get("referrer"));
  return referrerId || null;
}

export async function copyTextToClipboard(
  text: string,
  environment: ClipboardEnvironmentLike = globalThis as ClipboardEnvironmentLike
): Promise<boolean> {
  const normalizedText = normalizeString(text);
  if (!normalizedText) {
    return false;
  }

  if (typeof environment.navigator?.clipboard?.writeText === "function") {
    await environment.navigator.clipboard.writeText(normalizedText);
    return true;
  }

  const documentRef = environment.document;
  if (
    typeof documentRef?.createElement !== "function"
    || typeof documentRef.body?.appendChild !== "function"
    || typeof documentRef.body?.removeChild !== "function"
    || typeof documentRef.execCommand !== "function"
  ) {
    return false;
  }

  const textarea = documentRef.createElement("textarea");
  textarea.value = normalizedText;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  documentRef.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return documentRef.execCommand("copy");
  } finally {
    documentRef.body.removeChild(textarea);
  }
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
}
