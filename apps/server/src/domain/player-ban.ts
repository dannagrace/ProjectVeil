import type { PlayerBanStatus } from "@veil/shared/progression";

export interface PlayerBanStateLike {
  banStatus?: PlayerBanStatus | null;
  banExpiry?: string | null;
}

export function isPlayerBanActive(ban: PlayerBanStateLike | null | undefined): boolean {
  if (!ban || (ban.banStatus ?? "none") === "none") {
    return false;
  }

  if (ban.banStatus === "permanent") {
    return true;
  }

  const expiry = ban.banExpiry ? new Date(ban.banExpiry) : null;
  return Boolean(expiry && !Number.isNaN(expiry.getTime()) && expiry.getTime() > Date.now());
}
