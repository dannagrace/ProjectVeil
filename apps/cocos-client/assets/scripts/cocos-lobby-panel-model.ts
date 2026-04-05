import type { CocosLobbyRoomSummary, CocosPlayerAccountProfile } from "./cocos-lobby.ts";
import type { VeilLobbyRenderState } from "./VeilLobbyPanel.ts";
import {
  getLobbyShowcaseUnitPageCount,
  lobbyBuildingShowcaseEntries,
  lobbyHeroShowcaseEntries,
  lobbyShowcaseUnitEntries,
  lobbyTerrainShowcaseEntries
} from "./cocos-showcase-gallery.ts";

const DEFAULT_LOBBY_ROOM_ID = "room-alpha";

export interface LobbyRoomCardView {
  roomId: string;
  title: string;
  meta: string;
}

export interface LobbyGuestEntryView {
  displayName: string;
  roomId: string;
}

export interface LobbyAccountIdentityView {
  showLoginId: boolean;
  loginIdValue: string;
  credentialBound: boolean;
}

export interface LobbyShowcaseInventorySummary {
  heroes: number;
  terrain: number;
  buildings: number;
  units: number;
  rotatingUnitPages: number;
}

export function buildLobbyRoomCards(rooms: CocosLobbyRoomSummary[]): LobbyRoomCardView[] {
  return rooms.slice(0, 4).map((room) => ({
    roomId: room.roomId,
    title: room.roomId,
    meta: `Day ${room.day} · Seed ${room.seed} · 玩家 ${room.connectedPlayers} · 英雄 ${room.heroCount} · 战斗 ${room.activeBattles}`
  }));
}

export function buildLobbyGuestEntryView(
  state: Pick<VeilLobbyRenderState, "playerId" | "displayName" | "roomId" | "account">
): LobbyGuestEntryView {
  return {
    displayName: state.displayName.trim() || state.account.displayName || state.playerId,
    roomId: state.roomId.trim() || state.account.lastRoomId || DEFAULT_LOBBY_ROOM_ID
  };
}

export function buildLobbyAccountIdentityView(
  state: Pick<VeilLobbyRenderState, "authMode" | "loginId" | "account">
): LobbyAccountIdentityView {
  const loginIdValue = state.loginId.trim() || state.account.loginId || "";
  const credentialBound = Boolean(state.account.credentialBoundAt);
  return {
    showLoginId: state.authMode === "account" && credentialBound,
    loginIdValue,
    credentialBound
  };
}

export function summarizeLobbyShowcaseInventory(): LobbyShowcaseInventorySummary {
  return {
    heroes: lobbyHeroShowcaseEntries.length,
    terrain: lobbyTerrainShowcaseEntries.length,
    buildings: lobbyBuildingShowcaseEntries.length,
    units: lobbyShowcaseUnitEntries.length,
    rotatingUnitPages: getLobbyShowcaseUnitPageCount()
  };
}

export function createLobbyPanelTestAccount(
  overrides: Partial<CocosPlayerAccountProfile> = {}
): CocosPlayerAccountProfile {
  return {
    playerId: overrides.playerId ?? "guest-1001",
    displayName: overrides.displayName ?? "雾行者",
    eloRating: overrides.eloRating ?? 1000,
    globalResources: overrides.globalResources ?? { gold: 0, wood: 0, ore: 0 },
    achievements: overrides.achievements ?? [],
    recentEventLog: overrides.recentEventLog ?? [],
    recentBattleReplays: overrides.recentBattleReplays ?? [],
    source: overrides.source ?? "local",
    ...(overrides.battleReportCenter ? { battleReportCenter: overrides.battleReportCenter } : {}),
    ...(overrides.avatarUrl ? { avatarUrl: overrides.avatarUrl } : {}),
    ...(overrides.mailbox ? { mailbox: overrides.mailbox } : {}),
    ...(overrides.mailboxSummary ? { mailboxSummary: overrides.mailboxSummary } : {}),
    ...(overrides.loginId ? { loginId: overrides.loginId } : {}),
    ...(overrides.credentialBoundAt ? { credentialBoundAt: overrides.credentialBoundAt } : {}),
    ...(overrides.lastRoomId ? { lastRoomId: overrides.lastRoomId } : {}),
    ...(overrides.lastSeenAt ? { lastSeenAt: overrides.lastSeenAt } : {})
  };
}
