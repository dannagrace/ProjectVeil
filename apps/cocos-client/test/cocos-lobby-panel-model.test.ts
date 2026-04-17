import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLobbyAnnouncementBannerView,
  buildLobbyAccountIdentityView,
  buildLobbyGuestEntryView,
  buildLobbyRoomCards,
  createLobbyPanelTestAccount,
  summarizeLobbyShowcaseInventory
} from "../assets/scripts/cocos-lobby-panel-model";
import {
  getLobbyShowcaseUnitPageCount,
  lobbyBuildingShowcaseEntries,
  lobbyHeroShowcaseEntries,
  lobbyShowcaseUnitEntries,
  lobbyTerrainShowcaseEntries
} from "../assets/scripts/cocos-showcase-gallery";
import type { CocosLobbyRoomSummary } from "../assets/scripts/cocos-lobby";
import { createLobbyState } from "./helpers/cocos-panel-harness";

function createRoom(index: number): CocosLobbyRoomSummary {
  return {
    roomId: `room-${index}`,
    seed: 1000 + index,
    day: index,
    connectedPlayers: index + 1,
    disconnectedPlayers: 0,
    heroCount: index + 2,
    activeBattles: index + 3,
    statusLabel: index % 2 === 0 ? "探索中" : "PVP 进行中",
    updatedAt: `2026-03-${String(index).padStart(2, "0")}T12:00:00.000Z`
  };
}

test("buildLobbyRoomCards returns an empty list when there are no rooms", () => {
  assert.deepEqual(buildLobbyRoomCards([]), []);
});

test("buildLobbyAnnouncementBannerView prioritizes active maintenance mode over normal announcements", () => {
  const banner = buildLobbyAnnouncementBannerView(
    createLobbyState({
      announcements: [
        {
          id: "notice-1",
          title: "停服预告",
          message: "20 分钟后维护。",
          tone: "warning",
          startsAt: "2026-04-17T08:00:00.000Z"
        }
      ],
      maintenanceMode: {
        active: true,
        title: "停服维护中",
        message: "服务器正在热更新。",
        nextOpenAt: "2026-04-17T10:00:00.000Z"
      }
    })
  );

  assert.deepEqual(banner, {
    title: "停服维护中",
    detailLines: ["服务器正在热更新。", "预计恢复：2026-04-17T10:00:00.000Z"],
    tone: "critical"
  });
});

test("buildLobbyAnnouncementBannerView summarizes the current public announcement feed", () => {
  const banner = buildLobbyAnnouncementBannerView(
    createLobbyState({
      announcements: [
        {
          id: "notice-1",
          title: "活动预告",
          message: "今日 20:00 开启双倍掉落。",
          tone: "info",
          startsAt: "2026-04-17T08:00:00.000Z"
        },
        {
          id: "notice-2",
          title: "停服预告",
          message: "今晚 23:00 维护 15 分钟。",
          tone: "warning",
          startsAt: "2026-04-17T18:00:00.000Z"
        }
      ]
    })
  );

  assert.deepEqual(banner, {
    title: "全服公告 · 2 条",
    detailLines: [
      "活动预告：今日 20:00 开启双倍掉落。",
      "停服预告：今晚 23:00 维护 15 分钟。"
    ],
    tone: "warning"
  });
});

test("buildLobbyRoomCards keeps exactly four rooms without truncating", () => {
  const cards = buildLobbyRoomCards([createRoom(1), createRoom(2), createRoom(3), createRoom(4)]);

  assert.equal(cards.length, 4);
  assert.deepEqual(
    cards.map((card) => card.roomId),
    ["room-1", "room-2", "room-3", "room-4"]
  );
});

test("buildLobbyRoomCards truncates any room list beyond four entries", () => {
  const cards = buildLobbyRoomCards([createRoom(1), createRoom(2), createRoom(3), createRoom(4), createRoom(5)]);

  assert.equal(cards.length, 4);
  assert.deepEqual(
    cards.map((card) => card.roomId),
    ["room-1", "room-2", "room-3", "room-4"]
  );
});

test("buildLobbyRoomCards formats the title and meta fields from room details", () => {
  const [card] = buildLobbyRoomCards([
    {
      roomId: "room-alpha",
      seed: 1001,
      day: 3,
      connectedPlayers: 2,
      disconnectedPlayers: 1,
      heroCount: 4,
      activeBattles: 1,
      statusLabel: "恢复中",
      updatedAt: "2026-03-29T12:00:00.000Z"
    }
  ]);

  assert.deepEqual(card, {
    roomId: "room-alpha",
    title: "room-alpha",
    meta: "Day 3 · Seed 1001 · 恢复中 · 玩家 2（掉线 1） · 英雄 4 · 战斗 1"
  });
});

test("buildLobbyGuestEntryView prefers trimmed lobby state values over account fallbacks", () => {
  const view = buildLobbyGuestEntryView(
    createLobbyState({
      playerId: "guest-202503",
      displayName: "  星港旅人  ",
      roomId: "  room-sigma  ",
      account: createLobbyPanelTestAccount({
        displayName: "账户昵称",
        lastRoomId: "room-account"
      })
    })
  );

  assert.deepEqual(view, {
    displayName: "星港旅人",
    roomId: "room-sigma"
  });
});

test("buildLobbyGuestEntryView falls back to account displayName and lastRoomId when lobby fields are blank", () => {
  const view = buildLobbyGuestEntryView(
    createLobbyState({
      playerId: "guest-202503",
      displayName: "   ",
      roomId: "   ",
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

test("buildLobbyGuestEntryView falls back to playerId and the default room when no names or room ids are available", () => {
  const view = buildLobbyGuestEntryView(
    createLobbyState({
      playerId: "guest-404",
      displayName: "  ",
      roomId: " ",
      account: createLobbyPanelTestAccount({
        displayName: "",
        lastRoomId: ""
      })
    })
  );

  assert.deepEqual(view, {
    displayName: "guest-404",
    roomId: "room-alpha"
  });
});

test("buildLobbyAccountIdentityView keeps guest and unbound identities hidden", () => {
  const view = buildLobbyAccountIdentityView(
    createLobbyState({
      authMode: "guest",
      loginId: "  guest-login  ",
      account: createLobbyPanelTestAccount({
        loginId: "",
        credentialBoundAt: ""
      })
    })
  );

  assert.deepEqual(view, {
    showLoginId: false,
    loginIdValue: "guest-login",
    credentialBound: false
  });
});

test("buildLobbyAccountIdentityView keeps guest identities hidden even when credentials are bound", () => {
  const view = buildLobbyAccountIdentityView(
    createLobbyState({
      authMode: "guest",
      loginId: "",
      account: createLobbyPanelTestAccount({
        loginId: "vault-guest",
        credentialBoundAt: "2026-03-28T12:34:56.000Z"
      })
    })
  );

  assert.deepEqual(view, {
    showLoginId: false,
    loginIdValue: "vault-guest",
    credentialBound: true
  });
});

test("buildLobbyAccountIdentityView keeps account identities hidden until credentials are bound", () => {
  const view = buildLobbyAccountIdentityView(
    createLobbyState({
      authMode: "account",
      loginId: "   ",
      account: createLobbyPanelTestAccount({
        loginId: "veil-ranger",
        credentialBoundAt: ""
      })
    })
  );

  assert.deepEqual(view, {
    showLoginId: false,
    loginIdValue: "veil-ranger",
    credentialBound: false
  });
});

test("buildLobbyAccountIdentityView shows bound account identities and prefers the trimmed lobby loginId", () => {
  const view = buildLobbyAccountIdentityView(
    createLobbyState({
      authMode: "account",
      loginId: "  veil-sentinel  ",
      account: createLobbyPanelTestAccount({
        loginId: "veil-ranger",
        credentialBoundAt: "2026-03-28T12:34:56.000Z"
      })
    })
  );

  assert.deepEqual(view, {
    showLoginId: true,
    loginIdValue: "veil-sentinel",
    credentialBound: true
  });
});

test("summarizeLobbyShowcaseInventory stays consistent with the showcase source collections", () => {
  assert.deepEqual(summarizeLobbyShowcaseInventory(), {
    heroes: lobbyHeroShowcaseEntries.length,
    terrain: lobbyTerrainShowcaseEntries.length,
    buildings: lobbyBuildingShowcaseEntries.length,
    units: lobbyShowcaseUnitEntries.length,
    rotatingUnitPages: getLobbyShowcaseUnitPageCount()
  });
});
