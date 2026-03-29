import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLobbyAccountIdentityView,
  buildLobbyGuestEntryView,
  buildLobbyRoomCards,
  createLobbyPanelTestAccount,
  summarizeLobbyShowcaseInventory
} from "../assets/scripts/cocos-lobby-panel-model";
import type { VeilLobbyRenderState } from "../assets/scripts/VeilLobbyPanel";

function createLobbyState(overrides: Partial<VeilLobbyRenderState> = {}): VeilLobbyRenderState {
  return {
    playerId: "guest-1001",
    displayName: "",
    roomId: "",
    authMode: "guest",
    loginId: "",
    loginHint: "游客模式",
    loginActionLabel: "账号登录并进入",
    shareHint: "共享存档未启用",
    vaultSummary: "本地存档",
    account: createLobbyPanelTestAccount(),
    sessionSource: "none",
    loading: false,
    entering: false,
    status: "等待操作...",
    rooms: [],
    accountFlow: null,
    presentationReadiness: {
      ready: false,
      summary: "等待表现资源",
      nextStep: "等待资源包"
    },
    ...overrides
  };
}

test("lobby panel room cards render active room summaries from the server response", () => {
  const cards = buildLobbyRoomCards([
    {
      roomId: "room-alpha",
      seed: 1001,
      day: 3,
      connectedPlayers: 1,
      heroCount: 2,
      activeBattles: 1,
      updatedAt: "2026-03-29T12:00:00.000Z"
    }
  ]);

  assert.deepEqual(cards, [
    {
      roomId: "room-alpha",
      title: "room-alpha",
      meta: "Day 3 · Seed 1001 · 玩家 1 · 英雄 2 · 战斗 1"
    }
  ]);
});

test("guest login view resolves displayName and room ID from account and lobby state", () => {
  const view = buildLobbyGuestEntryView(
    createLobbyState({
      playerId: "guest-202503",
      account: createLobbyPanelTestAccount({
        displayName: "晶塔旅人",
        lastRoomId: "room-beta"
      })
    })
  );

  assert.deepEqual(view, {
    displayName: "晶塔旅人",
    roomId: "room-beta"
  });
});

test("account identity view shows the loginId field only when credentials are bound", () => {
  const bound = buildLobbyAccountIdentityView(
    createLobbyState({
      authMode: "account",
      loginId: "veil-ranger",
      account: createLobbyPanelTestAccount({
        loginId: "veil-ranger",
        credentialBoundAt: "2026-03-28T12:34:56.000Z"
      })
    })
  );
  assert.equal(bound.showLoginId, true);
  assert.equal(bound.loginIdValue, "veil-ranger");

  const guest = buildLobbyAccountIdentityView(createLobbyState());
  assert.equal(guest.showLoginId, false);
});

test("showcase gallery inventory stays aligned with the configured hero, terrain, building and unit counts", () => {
  assert.deepEqual(summarizeLobbyShowcaseInventory(), {
    heroes: 4,
    terrain: 5,
    buildings: 4,
    units: 6,
    rotatingUnitPages: 2
  });
});
