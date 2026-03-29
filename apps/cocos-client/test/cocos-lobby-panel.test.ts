import assert from "node:assert/strict";
import test from "node:test";
import { createBattleReplayPlaybackState } from "../assets/scripts/project-shared/battle-replay";
import { buildCocosBattleReplayCenterView } from "../assets/scripts/cocos-battle-replay-center";
import { buildCocosAccountReviewPage, createCocosAccountReviewState } from "../assets/scripts/cocos-account-review.ts";
import {
  buildLobbyAccountIdentityView,
  buildLobbyGuestEntryView,
  buildLobbyRoomCards,
  createLobbyPanelTestAccount,
  summarizeLobbyShowcaseInventory
} from "../assets/scripts/cocos-lobby-panel-model";
import type { VeilLobbyRenderState } from "../assets/scripts/VeilLobbyPanel";

function createLobbyState(overrides: Partial<VeilLobbyRenderState> = {}): VeilLobbyRenderState {
  const account = createLobbyPanelTestAccount();
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
    account,
    accountReview: buildCocosAccountReviewPage(createCocosAccountReviewState(account)),
    battleReplayItems: account.recentBattleReplays,
    battleReplaySectionStatus: "idle",
    battleReplaySectionError: null,
    selectedBattleReplayId: null,
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

test("battle replay center view exposes controls and a loaded replay snapshot for account review", () => {
  const replay = {
    id: "replay-1",
    roomId: "room-alpha",
    playerId: "player-1",
    battleId: "battle-1",
    battleKind: "neutral" as const,
    playerCamp: "attacker" as const,
    heroId: "hero-1",
    neutralArmyId: "neutral-1",
    startedAt: "2026-03-27T12:00:00.000Z",
    completedAt: "2026-03-27T12:03:00.000Z",
    initialState: {
      id: "battle-1",
      round: 1,
      lanes: 1,
      activeUnitId: "hero-1-stack",
      turnOrder: ["hero-1-stack", "neutral-1-stack"],
      units: {
        "hero-1-stack": {
          id: "hero-1-stack",
          templateId: "hero_guard_basic",
          camp: "attacker" as const,
          lane: 0,
          stackName: "Guard",
          initiative: 7,
          attack: 4,
          defense: 4,
          minDamage: 1,
          maxDamage: 2,
          count: 12,
          currentHp: 10,
          maxHp: 10,
          hasRetaliated: false,
          defending: false,
          skills: [],
          statusEffects: []
        },
        "neutral-1-stack": {
          id: "neutral-1-stack",
          templateId: "wolf_pack",
          camp: "defender" as const,
          lane: 0,
          stackName: "Wolf",
          initiative: 5,
          attack: 3,
          defense: 3,
          minDamage: 1,
          maxDamage: 2,
          count: 8,
          currentHp: 9,
          maxHp: 9,
          hasRetaliated: false,
          defending: false,
          skills: [],
          statusEffects: []
        }
      },
      environment: [],
      log: [],
      rng: { seed: 1, cursor: 0 },
      encounterPosition: { x: 0, y: 0 }
    },
    steps: [
      {
        index: 1,
        source: "player" as const,
        action: {
          type: "battle.wait" as const,
          unitId: "hero-1-stack"
        }
      },
      {
        index: 2,
        source: "automated" as const,
        action: {
          type: "battle.defend" as const,
          unitId: "neutral-1-stack"
        }
      }
    ],
    result: "attacker_victory" as const
  };
  const view = buildCocosBattleReplayCenterView({
    replays: [replay],
    selectedReplayId: replay.id,
    playback: createBattleReplayPlaybackState(replay),
    status: "ready"
  });

  assert.equal(view.state, "ready");
  assert.match(view.title, /战报回放中心/);
  assert.match(view.subtitle, /PVE/);
  assert.match(view.detailLines.join("\n"), /当前动作：暂无动作/);
  assert.match(view.detailLines.join("\n"), /下一动作：hero-1-stack 等待/);
  assert.deepEqual(
    view.controls.map((control) => [control.action, control.enabled]),
    [
      ["play", true],
      ["pause", false],
      ["step-back", false],
      ["step-forward", true],
      ["reset", false]
    ]
  );
});
