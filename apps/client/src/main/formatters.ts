import type { PlayerTileView, PlayerWorldView } from "@veil/shared/models";
import type { RuntimeDiagnosticsConnectionStatus } from "@veil/shared/platform";
import { createHeroProgressMeterView } from "@veil/shared/progression";
import type { StoredAuthSession } from "../auth-session";
import type { PlayerAccountProfile as ClientPlayerAccountProfile } from "../player-account";

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function formatAccountSource(account: ClientPlayerAccountProfile): string {
  return account.source === "remote" ? "云端账号" : "本地游客档";
}

export function formatAuthModeLabel(session: StoredAuthSession | null): string {
  if (!session) {
    return "未登录";
  }

  if (session.authMode === "account") {
    return session.loginId ? `账号模式 · ${session.loginId}` : "账号模式";
  }

  return "游客模式";
}

export function formatCredentialBinding(account: ClientPlayerAccountProfile): string {
  if (!account.loginId) {
    return "尚未绑定口令账号，可把当前游客档升级成长期账号。";
  }

  if (!account.credentialBoundAt) {
    return `已绑定登录 ID：${account.loginId}`;
  }

  const date = new Date(account.credentialBoundAt);
  const label = Number.isNaN(date.getTime()) ? account.credentialBoundAt : date.toLocaleString();
  return `已绑定登录 ID：${account.loginId} · ${label}`;
}

export function formatAccountLastSeen(account: ClientPlayerAccountProfile): string {
  if (!account.lastSeenAt) {
    return account.lastRoomId ? `最近房间 ${account.lastRoomId}` : "尚未记录活跃时间";
  }

  const date = new Date(account.lastSeenAt);
  const label = Number.isNaN(date.getTime()) ? account.lastSeenAt : date.toLocaleString();
  return account.lastRoomId ? `${label} · ${account.lastRoomId}` : label;
}

export function formatGlobalVault(account: ClientPlayerAccountProfile): string {
  return `全局仓库 金币 ${account.globalResources.gold} / 木材 ${account.globalResources.wood} / 矿石 ${account.globalResources.ore}`;
}

export function resolveExperimentVariant(
  account: ClientPlayerAccountProfile,
  experimentKey: string
): string | null {
  return account.experiments?.find((experiment) => experiment.experimentKey === experimentKey)?.variant ?? null;
}

export function formatExperimentAuditLabel(account: ClientPlayerAccountProfile): string | null {
  const experiment = account.experiments?.find((entry) => entry.experimentKey === "account_portal_copy");
  if (!experiment) {
    return null;
  }

  return `${experiment.experimentName} · ${experiment.variant} · bucket ${experiment.bucket} · owner ${experiment.owner}`;
}

export function formatAccountBindingCta(account: ClientPlayerAccountProfile): string {
  if (account.loginId) {
    return "当前档案已可用登录 ID 直接进入";
  }

  return resolveExperimentVariant(account, "account_portal_copy") === "upgrade"
    ? "绑定口令账号，保留当前游客档进度、成就和战报，并支持后续多设备继续。"
    : "把当前游客档升级成可长期登录的账号";
}

export function formatRelativeSessionTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function formatSessionProviderLabel(provider: string): string {
  if (provider === "wechat-mini-game") {
    return "微信小游戏";
  }
  if (provider === "account-password") {
    return "口令登录";
  }
  return provider;
}

export function formatLobbyRoomUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  return Number.isNaN(date.getTime()) ? updatedAt : date.toLocaleString();
}

export function tileLabel(tile: PlayerTileView): string {
  if (tile.fog === "hidden") {
    return "?";
  }

  const terrain = tile.terrain.slice(0, 1).toUpperCase();
  const occupant = tile.occupant?.kind === "neutral" ? "M" : tile.occupant?.kind === "hero" ? "H" : "";
  const resource = tile.resource ? tile.resource.kind.slice(0, 1).toUpperCase() : "";
  const building = tile.building ? "B" : "";
  return `${terrain}${occupant}${resource}${building}`;
}

export function formatPath(path: { x: number; y: number }[]): string {
  return path.map((node) => `(${node.x},${node.y})`).join(" -> ");
}

export function formatHeroProgression(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "Lv 0";
  }

  return `Lv ${hero.progression.level}`;
}

export function formatHeroExperience(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "XP 0/100";
  }

  const meter = createHeroProgressMeterView(hero);
  return `XP ${meter.currentLevelExperience}/${meter.nextLevelExperience}`;
}

export function formatResourceKindLabel(kind: "gold" | "wood" | "ore"): string {
  return kind === "gold" ? "金币" : kind === "wood" ? "木材" : "矿石";
}

export function formatDailyIncome(kind: "gold" | "wood" | "ore", amount: number): string {
  return `${formatResourceKindLabel(kind)} +${amount}/天`;
}

export function formatHeroCoreStats(hero: PlayerWorldView["ownHeroes"][number] | null): string {
  if (!hero) {
    return "ATK 0 · DEF 0 · POW 0 · KNW 0";
  }

  return `ATK ${hero.stats.attack} · DEF ${hero.stats.defense} · POW ${hero.stats.power} · KNW ${hero.stats.knowledge}`;
}

export function formatHeroStatBonus(bonus: {
  attack: number;
  defense: number;
  power: number;
  knowledge: number;
}): string {
  const parts = [
    bonus.attack > 0 ? `攻击 +${bonus.attack}` : "",
    bonus.defense > 0 ? `防御 +${bonus.defense}` : "",
    bonus.power > 0 ? `力量 +${bonus.power}` : "",
    bonus.knowledge > 0 ? `知识 +${bonus.knowledge}` : ""
  ].filter(Boolean);

  return parts.join(" / ") || "属性提升";
}

export function formatEquipmentActionReason(reason: string): string {
  if (reason === "equipment_not_in_inventory") {
    return "背包里没有这件装备";
  }

  if (reason === "equipment_slot_mismatch") {
    return "装备类型和槽位不匹配";
  }

  if (reason === "equipment_definition_missing") {
    return "装备目录缺失，无法装备";
  }

  if (reason === "equipment_slot_empty") {
    return "当前槽位没有可卸下的装备";
  }

  if (reason === "equipment_already_equipped") {
    return "该装备已经穿戴中";
  }

  return reason;
}

export function formatHeroSkillReason(reason: string): string {
  if (reason === "not_enough_skill_points") {
    return "需要可用技能点";
  }

  if (reason === "hero_level_too_low") {
    return "等级未达标";
  }

  if (reason === "skill_max_rank_reached") {
    return "已满级";
  }

  if (reason === "skill_prerequisite_missing") {
    return "前置未满足";
  }

  return reason;
}

export function clampWorldCoordinate(value: number, limit: number): number {
  if (limit <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(limit - 1, Math.floor(value)));
}

export function diagnosticsConnectionStatusLabel(status: RuntimeDiagnosticsConnectionStatus): string {
  if (status === "connected") {
    return "已连接";
  }

  if (status === "reconnecting") {
    return "重连中";
  }

  if (status === "reconnect_failed") {
    return "恢复失败";
  }

  return "连接中";
}

export function sanitizeSnapshotFileSegment(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-");
  return normalized || "unknown";
}
