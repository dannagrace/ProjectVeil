import assert from "node:assert/strict";
import test from "node:test";
import { createCocosAccountReviewState } from "../assets/scripts/cocos-account-review.ts";
import { createFallbackCocosPlayerAccountProfile } from "../assets/scripts/cocos-lobby.ts";
import {
  buildBattleSettlementRecoveryStateForRoot,
  buildHudPresentationStateForRoot,
  buildHudSessionIndicatorsForRoot,
  renderViewForRoot
} from "../assets/scripts/root/render-state-composer.ts";
import {
  BATTLE_NODE_NAME,
  HUD_NODE_NAME,
  LOBBY_NODE_NAME,
  MAP_NODE_NAME,
  TIMELINE_NODE_NAME
} from "../assets/scripts/root/constants.ts";

test("buildBattleSettlementRecoveryStateForRoot describes reconnect and replay recovery states", () => {
  const baseSnapshot = {
    label: "首战告捷",
    summaryLines: ["获得金币 20"],
    detail: "detail",
    badge: "WIN",
    tone: "victory"
  };

  const reconnecting = buildBattleSettlementRecoveryStateForRoot({
    lastBattleSettlementSnapshot: baseSnapshot,
    lastUpdate: null,
    diagnosticsConnectionStatus: "reconnecting",
    lastRoomUpdateSource: "live",
    lastRoomUpdateReason: null
  });
  assert.equal(reconnecting?.badge, "RECOVER");
  assert.match(String(reconnecting?.detail), /等待权威房间/);

  const replaying = buildBattleSettlementRecoveryStateForRoot({
    lastBattleSettlementSnapshot: baseSnapshot,
    lastUpdate: null,
    diagnosticsConnectionStatus: "connected",
    lastRoomUpdateSource: "replay",
    lastRoomUpdateReason: "cached_snapshot"
  });
  assert.equal(replaying?.badge, "REPLAY");
  assert.match(String(replaying?.detail), /缓存的结算快照/);
});

test("buildHudSessionIndicatorsForRoot surfaces reconnect, replay, and fallback indicators", () => {
  const indicators = buildHudSessionIndicatorsForRoot({
    diagnosticsConnectionStatus: "reconnect_failed",
    lastRoomUpdateSource: "replay",
    lastRoomUpdateReason: "cached_snapshot",
    lastUpdate: {
      world: {
        meta: {
          roomId: "room-1"
        }
      },
      battle: {
        id: "battle-1",
        defenderHeroId: "enemy-1"
      }
    }
  });

  assert.deepEqual(
    indicators.map((entry) => entry.kind),
    ["replaying_cached_snapshot", "awaiting_authoritative_resync", "degraded_offline_fallback"]
  );
});

test("buildHudPresentationStateForRoot returns audio, pixel assets, and readiness snapshot", () => {
  const presentation = buildHudPresentationStateForRoot({
    audioRuntime: {
      getState() {
        return { unlocked: true, scene: "explore" };
      }
    }
  });

  assert.equal(presentation.audio.unlocked, true);
  assert.equal(typeof presentation.pixelAssets.loadedResourceCount, "number");
  assert.equal(typeof presentation.readiness.summary, "string");
});

test("renderViewForRoot activates lobby chrome and forwards lobby render input in lobby mode", () => {
  const nodeMap = new Map<string, { active: boolean }>([
    [LOBBY_NODE_NAME, { active: false }],
    [HUD_NODE_NAME, { active: true }],
    [MAP_NODE_NAME, { active: true }],
    [BATTLE_NODE_NAME, { active: true }],
    [TIMELINE_NODE_NAME, { active: true }]
  ]);
  let renderedLobbyStatus = "";
  let ensuredBoot = 0;
  let layoutUpdated = 0;
  let musicSyncs = 0;

  const account = createFallbackCocosPlayerAccountProfile("player-1", "room-1", "旅人");
  const state = {
    levelUpNotice: null,
    achievementNotice: null,
    battleFeedback: null,
    lastUpdate: null,
    showLobby: true,
    playerId: "player-1",
    displayName: "",
    roomId: "room-1",
    authMode: "guest",
    loginId: "",
    privacyConsentAccepted: false,
    lobbyAccountProfile: account,
    gameplayCampaign: null,
    gameplayCampaignStatus: "战役待同步",
    dailyDungeonSummary: null,
    dailyDungeonStatus: "地城待同步",
    lobbyAccountReviewState: createCocosAccountReviewState(account),
    lobbyLeaderboardEntries: [],
    lobbyLeaderboardStatus: "idle",
    lobbyLeaderboardError: null,
    sessionSource: "none",
    lobbyLoading: false,
    lobbyEntering: false,
    lobbyStatus: "请选择房间",
    lobbyAnnouncements: [],
    lobbyMaintenanceMode: null,
    matchmakingView: { status: "idle" },
    dailyQuestClaimingId: null,
    mailboxClaimingMessageId: null,
    mailboxClaimAllInFlight: false,
    activeSeasonalEvent: null,
    seasonProgress: null,
    lobbyShopProducts: [],
    lobbyShopStatus: "shop",
    lobbyShopLoading: false,
    pendingShopProductId: null,
    moveInFlight: false,
    battleActionInFlight: false,
    settingsView: { open: false },
    node: {
      getChildByName(name: string) {
        return nodeMap.get(name) ?? null;
      }
    },
    ensurePixelSpriteGroup(group: string) {
      if (group === "boot") {
        ensuredBoot += 1;
      }
    },
    syncMusicScene() {
      musicSyncs += 1;
    },
    updateLayout() {
      layoutUpdated += 1;
    },
    activeHero() {
      return null;
    },
    describeLobbyLoginHint() {
      return "hint";
    },
    primaryLoginProvider() {
      return { label: "登录" };
    },
    describeLobbyShareHint() {
      return "share";
    },
    formatLobbyVaultSummary() {
      return "vault";
    },
    isMatchmakingActive() {
      return false;
    },
    buildActiveAccountFlowPanelView() {
      return null;
    },
    lobbyPanel: {
      render(input: { status: string }) {
        renderedLobbyStatus = input.status;
      }
    },
    buildTutorialOverlayView() {
      return null;
    },
    tutorialOverlay: {
      render() {}
    },
    renderSettingsOverlay() {}
  };

  renderViewForRoot(state);

  assert.equal(nodeMap.get(LOBBY_NODE_NAME)?.active, true);
  assert.equal(nodeMap.get(HUD_NODE_NAME)?.active, false);
  assert.equal(renderedLobbyStatus, "请选择房间");
  assert.equal(ensuredBoot, 1);
  assert.equal(layoutUpdated, 1);
  assert.equal(musicSyncs, 1);
});
