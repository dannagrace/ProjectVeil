import { VeilLobbyPanel } from "../assets/scripts/VeilLobbyPanel";
import assert from "node:assert/strict";
import test from "node:test";
import { createBattleReplayPlaybackState } from "../assets/scripts/project-shared/battle-replay";
import { buildCocosBattleReplayCenterView } from "../assets/scripts/cocos-battle-replay-center";
import {
  buildLobbyAccountIdentityView,
  buildLobbyGuestEntryView,
  buildLobbyRoomCards,
  createLobbyPanelTestAccount,
  summarizeLobbyShowcaseInventory
} from "../assets/scripts/cocos-lobby-panel-model";
import {
  buildLobbySkillPanelView,
  toLobbySkillPanelHeroState
} from "../assets/scripts/cocos-lobby-skill-panel.ts";
import { getRuntimeConfigBundleForRoom } from "../assets/scripts/project-shared/index.ts";
import type { VeilLobbyRenderState } from "../assets/scripts/VeilLobbyPanel";
import {
  createBattleReplaySummary,
  createWorldUpdate,
  createComponentHarness,
  createErroredBattleReplayReviewState,
  createLobbyState,
  findNode,
  pressNode,
  createReplayReadyLobbyState,
  readCardLabel
} from "./helpers/cocos-panel-harness.ts";

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
  const replay = createBattleReplaySummary();
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
      ["turn-back", false],
      ["turn-forward", false],
      ["speed-down", true],
      ["speed-up", true],
      ["reset", false]
    ]
  );
});

test("battle replay center view falls back to battle report detail when replay evidence is unavailable", () => {
  const view = buildCocosBattleReplayCenterView({
    replays: [],
    battleReports: {
      latestReportId: "report-only",
      items: [
        {
          id: "report-only",
          replayId: "report-only",
          roomId: "room-report",
          playerId: "player-1",
          battleId: "battle-report",
          battleKind: "hero",
          playerCamp: "defender",
          heroId: "hero-1",
          opponentHeroId: "hero-9",
          startedAt: "2026-03-27T12:20:00.000Z",
          completedAt: "2026-03-27T12:22:00.000Z",
          result: "defeat",
          turnCount: 3,
          actionCount: 5,
          rewards: [],
          evidence: {
            replay: "missing",
            rewards: "missing"
          }
        }
      ]
    },
    selectedReplayId: "report-only",
    playback: null,
    status: "ready"
  });

  assert.equal(view.state, "ready");
  assert.match(view.title, /失利/);
  assert.match(view.subtitle, /PVP .*摘要模式/);
  assert.match(view.detailLines.join("\n"), /完整回放暂不可用/);
  assert.match(view.detailLines.join("\n"), /回放证据：缺失/);
  assert.equal(view.controls.every((control) => control.enabled === false), true);
});

test("VeilLobbyPanel retains the loading lobby snapshot and creates base panel chrome", () => {
  const { component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const state = createLobbyState({
    loading: true,
    rooms: [
      {
        roomId: "room-alpha",
        seed: 1001,
        day: 3,
        connectedPlayers: 1,
        heroCount: 2,
        activeBattles: 1,
        updatedAt: "2026-03-29T12:00:00.000Z"
      }
    ]
  });

  component.configure({});
  component.scheduleOnce = () => undefined;
  component.render(state);
  const statefulComponent = component as VeilLobbyPanel & Record<string, unknown>;

  assert.equal(statefulComponent.currentState, state);
  assert.equal((statefulComponent.currentState as VeilLobbyRenderState).rooms[0]?.roomId, "room-alpha");
  assert.equal((statefulComponent.currentState as VeilLobbyRenderState).loading, true);
  component.onDestroy();
});

test("VeilLobbyPanel advances replay playback when the replay control state transitions", () => {
  const { component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const state = createReplayReadyLobbyState();

  component.configure({});
  component.scheduleOnce = () => undefined;
  (component as VeilLobbyPanel & Record<string, unknown>).showAccountReview = true;
  component.render(state);
  const statefulComponent = component as VeilLobbyPanel & Record<string, unknown>;
  assert.equal((statefulComponent.replayPlayback as { currentStepIndex?: number } | null)?.currentStepIndex, 0);
  (statefulComponent.applyReplayControl as (action: "step-forward") => void)("step-forward");

  assert.equal((statefulComponent.replayPlayback as { currentStepIndex?: number } | null)?.currentStepIndex, 1);
  component.onDestroy();
});

test("VeilLobbyPanel renders a playback-aware replay timeline card alongside the replay center", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const state = createReplayReadyLobbyState();

  component.configure({});
  component.scheduleOnce = () => undefined;
  const statefulComponent = component as VeilLobbyPanel & Record<string, unknown>;
  statefulComponent.showAccountReview = true;
  component.render(state);

  assert.match(readCardLabel(node, "LobbyBattleReplayCenter"), /战报回放中心/);
  assert.match(readCardLabel(node, "LobbyBattleReplayTimeline"), /播放游标 0\/2 .*倍率 1x/);
  assert.match(readCardLabel(node, "LobbyBattleReplayTimeline"), /当前 · 第 1 步/);

  (statefulComponent.applyReplayControl as (action: "step-forward") => void)("step-forward");

  assert.match(readCardLabel(node, "LobbyBattleReplayTimeline"), /播放游标 1\/2/);
  assert.match(readCardLabel(node, "LobbyBattleReplayTimeline"), /已执行 · 第 1 步/);
  assert.match(readCardLabel(node, "LobbyBattleReplayTimeline"), /当前 · 第 2 步/);
  component.onDestroy();
});

test("VeilLobbyPanel keeps empty-room rendering separate from replay transport failures", () => {
  const { component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const erroredState = createLobbyState({
    accountReview: createErroredBattleReplayReviewState("Lobby transport failure: 502 Bad Gateway"),
    battleReplaySectionStatus: "error",
    battleReplaySectionError: "Lobby transport failure: 502 Bad Gateway"
  });

  component.configure({});
  component.scheduleOnce = () => undefined;
  component.render(createLobbyState());
  const statefulComponent = component as VeilLobbyPanel & Record<string, unknown>;
  assert.equal((statefulComponent.currentState as VeilLobbyRenderState).rooms.length, 0);
  statefulComponent.showAccountReview = true;
  component.render(erroredState);

  assert.equal((statefulComponent.currentState as VeilLobbyRenderState).battleReplaySectionStatus, "error");
  assert.match(String(statefulComponent.replayPlaybackStatus ?? ""), /502 Bad Gateway/);
  component.onDestroy();
});

test("VeilLobbyPanel renders leaderboard rows and highlights the current player summary", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const state = createLobbyState({
    playerId: "player-2",
    leaderboardStatus: "ready",
    leaderboardEntries: [
      { playerId: "player-1", rank: 1, displayName: "Alpha", eloRating: 1688, tier: "platinum" },
      { playerId: "player-2", rank: 2, displayName: "Bravo", eloRating: 1524, tier: "platinum" },
      { playerId: "player-3", rank: 3, displayName: "Charlie", eloRating: 1499, tier: "gold" }
    ]
  });

  component.configure({});
  component.scheduleOnce = () => undefined;
  component.render(state);

  assert.match(readCardLabel(node, "LobbyLeaderboardStatus"), /当前徽记 铂金/);
  assert.match(readCardLabel(node, "LobbyLeaderboardList"), /#2 Bravo · 我 · ELO 1524 · 铂金/);
  assert.match(readCardLabel(node, "LobbyLeaderboardMyRank"), /我的排名/);
  assert.match(readCardLabel(node, "LobbyLeaderboardMyRank"), /#2 Bravo/);
  component.onDestroy();
});

test("VeilLobbyPanel opens the lobby skill modal and wires skill selections", () => {
  const { node, component } = createComponentHarness(VeilLobbyPanel, { name: "LobbyPanelRoot", width: 760, height: 620 });
  const update = createWorldUpdate();
  const hero = update.world.ownHeroes[0]!;
  const selectedSkillIds: string[] = [];

  component.configure({
    onLearnLobbySkill: (skillId) => {
      selectedSkillIds.push(skillId);
    }
  });
  component.scheduleOnce = () => undefined;
  component.render(createLobbyState({
    activeHero: hero,
    lobbySkillPanel: buildLobbySkillPanelView(
      toLobbySkillPanelHeroState(hero),
      getRuntimeConfigBundleForRoom(update.world.meta.roomId, update.world.meta.seed)
    )
  }));

  pressNode(findNode(node, "LobbyHeroSkillButton"));
  assert.match(readCardLabel(node, "LobbySkillPanelHeader"), /技能规划/);

  pressNode(findNode(node, "LobbySkillPanelAction-0"));
  assert.deepEqual(selectedSkillIds, ["war_banner"]);
  component.onDestroy();
});
