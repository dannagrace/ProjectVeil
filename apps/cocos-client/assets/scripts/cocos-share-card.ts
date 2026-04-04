import assetConfigJson from "../../../../configs/assets.json";
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
  const imageUrl =
    normalizeString((assetConfigJson as ShareCardAssetConfig).shareCard?.battleVictory as string | undefined)
    || "https://cdn.example.com/assets/share-card/battle-victory.png";

  return {
    title: `${displayName} 赢得了天梯对战！`,
    imageUrl,
    path: `?roomId=${encodeURIComponent(roomId)}&referrer=${encodeURIComponent(playerId)}`
  };
}

export function buildBattleResultShareSummary(
  result: PlayerBattleReplaySummary,
  playerDisplayName: string
): string {
  const payload = buildShareCardPayload(result, playerDisplayName);
  return `${payload.title}\n房间 ${result.roomId}\n邀请链接 ${payload.path}`;
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
