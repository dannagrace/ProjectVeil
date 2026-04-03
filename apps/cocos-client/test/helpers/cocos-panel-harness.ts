import assert from "node:assert/strict";
import { Label, Node, UITransform } from "cc";
import {
  buildCocosAccountReviewPage,
  createCocosAccountReviewState,
  transitionCocosAccountReviewState,
  type CocosAccountReviewAction,
  type CocosAccountReviewPage
} from "../../assets/scripts/cocos-account-review.ts";
import { buildCocosBattleReplayCenterView } from "../../assets/scripts/cocos-battle-replay-center.ts";
import { createLobbyPanelTestAccount } from "../../assets/scripts/cocos-lobby-panel-model.ts";
import { createBattleReplayPlaybackState, type PlayerBattleReplaySummary } from "../../assets/scripts/project-shared/battle-replay.ts";
import type { BattlePanelInput } from "../../assets/scripts/cocos-battle-panel-model.ts";
import type { VeilLobbyRenderState } from "../../assets/scripts/VeilLobbyPanel.ts";
import type { BattleAction } from "../../assets/scripts/VeilCocosSession.ts";
import type { PlayerTileView, SessionUpdate, TerrainType } from "../../assets/scripts/VeilCocosSession.ts";

export function createComponentHarness<T extends { node: Node }>(
  ComponentType: new () => T,
  options: { name: string; width?: number; height?: number }
): { node: Node; component: T } {
  const node = new Node(options.name);
  const transform = node.addComponent(UITransform);
  transform.setContentSize(options.width ?? 760, options.height ?? 620);
  const component = node.addComponent(ComponentType);
  return { node, component };
}

export function pressNode(node: Node | { node?: Node | null } | null): void {
  const target =
    node && typeof (node as Node).emit === "function"
      ? (node as Node)
      : node && (node as { node?: Node | null }).node && typeof (node as { node?: Node | null }).node?.emit === "function"
        ? ((node as { node?: Node | null }).node as Node)
        : null;
  assert.ok(target, "UI interaction regression: expected a pressable Cocos node.");
  target.emit(Node.EventType.TOUCH_END);
}

export function findNode(root: Node, name: string): Node | null {
  if (root.name === name) {
    return root;
  }

  for (const child of root.children) {
    const match = findNode(child, name);
    if (match) {
      return match;
    }
  }

  return null;
}

export function readLabelString(node: Node | null): string {
  if (!node) {
    return "";
  }

  const directComponents = (node as unknown as { components?: Map<unknown, unknown> }).components;
  if (directComponents instanceof Map) {
    for (const component of directComponents.values()) {
      if (component && typeof component === "object" && "string" in (component as Record<string, unknown>)) {
        return String((component as { string?: unknown }).string ?? "");
      }
    }
  }

  const childLabelNode = node.getChildByName("Label") ?? null;
  const childComponents = (childLabelNode as unknown as { components?: Map<unknown, unknown> } | null)?.components;
  if (childComponents instanceof Map) {
    for (const component of childComponents.values()) {
      if (component && typeof component === "object" && "string" in (component as Record<string, unknown>)) {
        return String((component as { string?: unknown }).string ?? "");
      }
    }
  }

  return node.getComponent(Label)?.string ?? childLabelNode?.getComponent(Label)?.string ?? "";
}

export function readCardLabel(root: Node, cardName: string): string {
  return readLabelString(findNode(root, cardName)?.getChildByName("Label"));
}

export function createTile(
  position: { x: number; y: number },
  overrides: Partial<PlayerTileView> = {}
): PlayerTileView {
  return {
    position,
    fog: "visible",
    terrain: "grass",
    walkable: true,
    resource: undefined,
    occupant: undefined,
    building: undefined,
    ...overrides
  };
}

export function createWorldUpdate(): SessionUpdate {
  return {
    world: {
      meta: {
        roomId: "room-alpha",
        seed: 1001,
        day: 1
      },
      map: {
        width: 3,
        height: 3,
        tiles: [
          createTile({ x: 0, y: 0 }, { fog: "explored" }),
          createTile({ x: 1, y: 1 }, { resource: { kind: "wood", amount: 5 } }),
          createTile({ x: 2, y: 2 }, { terrain: "sand" })
        ]
      },
      ownHeroes: [
        {
          id: "hero-1",
          playerId: "player-1",
          name: "Katherine",
          position: { x: 1, y: 1 },
          vision: 4,
          move: { total: 6, remaining: 4 },
          stats: {
            attack: 2,
            defense: 2,
            power: 1,
            knowledge: 1,
            hp: 30,
            maxHp: 30
          },
          progression: {
            level: 2,
            experience: 40,
            skillPoints: 1,
            battlesWon: 1,
            neutralBattlesWon: 1,
            pvpBattlesWon: 0
          },
          armyCount: 11,
          armyTemplateId: "hero_guard_basic",
          learnedSkills: []
        }
      ],
      visibleHeroes: [],
      resources: {
        gold: 0,
        wood: 0,
        ore: 0
      },
      playerId: "player-1"
    },
    battle: null,
    events: [],
    movementPlan: null,
    reachableTiles: [{ x: 1, y: 1 }, { x: 2, y: 2 }]
  };
}

export function assertWorldUpdateFixture(update: SessionUpdate): void {
  assert.ok(update.world, "Transport/data-shape regression: expected panel fixture to include world data.");
  assert.ok(update.world.map.tiles.length > 0, "Transport/data-shape regression: expected panel fixture to include map tiles.");
}

export function createBattleUpdate(terrain: TerrainType = "sand"): SessionUpdate {
  const update = createWorldUpdate();
  update.world.map.width = 2;
  update.world.map.height = 2;
  update.world.map.tiles = [createTile({ x: 0, y: 0 }, { terrain: "grass" }), createTile({ x: 1, y: 1 }, { terrain })];
  update.world.ownHeroes[0]!.position = { x: 1, y: 1 };
  update.world.ownHeroes[0]!.move = { total: 6, remaining: 6 };
  update.world.ownHeroes[0]!.progression = {
    level: 1,
    experience: 0,
    skillPoints: 0,
    battlesWon: 0,
    neutralBattlesWon: 0,
    pvpBattlesWon: 0
  };
  update.battle = {
    id: "battle-1",
    round: 2,
    lanes: 1,
    activeUnitId: "hero-1-stack",
    turnOrder: ["hero-1-stack", "neutral-1-stack"],
    units: {
      "hero-1-stack": {
        id: "hero-1-stack",
        templateId: "hero_guard_basic",
        camp: "attacker",
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
        templateId: "orc_warrior",
        camp: "defender",
        lane: 0,
        stackName: "Orc",
        initiative: 5,
        attack: 3,
        defense: 3,
        minDamage: 1,
        maxDamage: 3,
        count: 8,
        currentHp: 9,
        maxHp: 9,
        hasRetaliated: true,
        defending: false,
        skills: [],
        statusEffects: []
      }
    },
    environment: [],
    log: [],
    rng: { seed: 1, cursor: 0 },
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1"
  };
  update.reachableTiles = [];
  return update;
}

export function createBattlePanelState(overrides: Partial<BattlePanelInput> = {}): BattlePanelInput {
  return {
    update: createBattleUpdate(),
    timelineEntries: [],
    controlledCamp: "attacker",
    selectedTargetId: "neutral-1-stack",
    actionPending: false,
    feedback: null,
    presentationState: null,
    recovery: null,
    ...overrides
  };
}

export function assertBattlePanelFixture(state: BattlePanelInput): void {
  assert.ok(state.update?.battle, "Transport/data-shape regression: expected battle-panel fixture to include battle data.");
  assert.ok(state.update.battle.units["hero-1-stack"], "Transport/data-shape regression: expected attacker unit in battle fixture.");
  assert.ok(state.update.battle.units["neutral-1-stack"], "Transport/data-shape regression: expected defender unit in battle fixture.");
}

export function createLobbyState(overrides: Partial<VeilLobbyRenderState> = {}): VeilLobbyRenderState {
  const account = createLobbyPanelTestAccount();
  const accountReviewState = createCocosAccountReviewState(account);
  return {
    playerId: "guest-1001",
    displayName: "",
    roomId: "",
    authMode: "guest",
    loginId: "",
    privacyConsentAccepted: false,
    loginHint: "游客模式",
    loginActionLabel: "账号登录并进入",
    shareHint: "共享存档未启用",
    vaultSummary: "本地存档",
    account,
    accountReview: buildCocosAccountReviewPage(accountReviewState),
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

export function createErroredBattleReplayReviewState(message: string) {
  const account = createLobbyPanelTestAccount();
  const reviewState = transitionCocosAccountReviewState(createCocosAccountReviewState(account), {
    type: "section.selected",
    section: "battle-replays"
  });
  return buildCocosAccountReviewPage(
    transitionCocosAccountReviewState(reviewState, {
      type: "section.failed",
      section: "battle-replays",
      message
    })
  );
}

export function createBattleReplaySummary(): PlayerBattleReplaySummary {
  return {
    id: "replay-1",
    roomId: "room-alpha",
    playerId: "player-1",
    battleId: "battle-1",
    battleKind: "neutral",
    playerCamp: "attacker",
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
          camp: "attacker",
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
          camp: "defender",
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
        source: "player",
        action: {
          type: "battle.wait",
          unitId: "hero-1-stack"
        }
      },
      {
        index: 2,
        source: "automated",
        action: {
          type: "battle.defend",
          unitId: "neutral-1-stack"
        }
      }
    ],
    result: "attacker_victory"
  };
}

export function createReplayReadyLobbyState(): VeilLobbyRenderState {
  const replay = createBattleReplaySummary();
  const account = createLobbyPanelTestAccount({
    recentBattleReplays: [replay]
  });
  const reviewState = transitionCocosAccountReviewState(createCocosAccountReviewState(account), {
    type: "section.selected",
    section: "battle-replays"
  });
  assert.equal(
    buildCocosBattleReplayCenterView({
      replays: [replay],
      selectedReplayId: replay.id,
      playback: createBattleReplayPlaybackState(replay),
      status: "ready"
    }).state,
    "ready",
    "Transport/data-shape regression: replay fixture should build a ready replay center state."
  );
  return createLobbyState({
    account,
    accountReview: buildCocosAccountReviewPage(reviewState),
    battleReplayItems: [replay],
    battleReplaySectionStatus: "ready",
    selectedBattleReplayId: replay.id
  });
}

export function createProgressionPanelPage(
  actions: CocosAccountReviewAction[] = []
): CocosAccountReviewPage {
  const account = createLobbyPanelTestAccount({
    achievements: [
      {
        id: "first_battle",
        title: "初次交锋",
        description: "首次进入战斗。",
        metric: "battles_started",
        current: 1,
        target: 1,
        unlocked: true,
        unlockedAt: "2026-03-28T12:05:00.000Z"
      },
      {
        id: "enemy_slayer",
        title: "猎敌者",
        description: "击败 3 名敌人或中立守军。",
        metric: "battles_won",
        current: 2,
        target: 3,
        unlocked: false,
        progressUpdatedAt: "2026-03-28T12:03:00.000Z"
      },
      {
        id: "skill_scholar",
        title: "秘法学徒",
        description: "学习 3 个长期技能。",
        metric: "skills_learned",
        current: 0,
        target: 3,
        unlocked: false
      }
    ],
    recentEventLog: [
      {
        id: "event-new",
        timestamp: "2026-03-28T12:06:00.000Z",
        roomId: "room-alpha",
        playerId: "guest-1001",
        category: "achievement",
        description: "解锁成就：初次交锋",
        achievementId: "first_battle",
        rewards: [{ type: "badge", label: "初次交锋" }]
      },
      {
        id: "event-mid",
        timestamp: "2026-03-28T12:04:00.000Z",
        roomId: "room-alpha",
        playerId: "guest-1001",
        category: "combat",
        description: "击退了北侧守军",
        worldEventType: "battle.resolved",
        rewards: []
      },
      {
        id: "event-old",
        timestamp: "2026-03-28T12:02:00.000Z",
        roomId: "room-alpha",
        playerId: "guest-1001",
        category: "movement",
        description: "向东移动 1 格",
        worldEventType: "hero.moved",
        rewards: []
      }
    ],
    recentBattleReplays: [
      createBattleReplaySummary(),
      {
        ...createBattleReplaySummary(),
        id: "replay-2",
        roomId: "room-beta",
        battleId: "battle-2",
        battleKind: "hero",
        playerCamp: "defender",
        opponentHeroId: "hero-9",
        neutralArmyId: undefined,
        completedAt: "2026-03-28T11:52:00.000Z",
        result: "defender_victory",
        steps: []
      }
    ]
  });
  const state = actions.reduce(
    (currentState, action) => transitionCocosAccountReviewState(currentState, action),
    createCocosAccountReviewState(account)
  );

  return buildCocosAccountReviewPage(state);
}

export function assertLobbyFixture(state: VeilLobbyRenderState): void {
  assert.ok(state.account, "Transport/data-shape regression: expected lobby-panel fixture to include an account snapshot.");
  assert.ok(state.accountReview, "Transport/data-shape regression: expected lobby-panel fixture to include account review data.");
}

export function assertBattleAction(action: BattleAction | null | undefined, expectedType: BattleAction["type"]): BattleAction {
  assert.ok(action, `UI interaction regression: expected battle action "${expectedType}" to be emitted.`);
  assert.equal(action.type, expectedType);
  return action;
}
