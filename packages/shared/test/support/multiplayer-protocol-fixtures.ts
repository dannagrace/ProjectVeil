import {
  DEFAULT_FEATURE_FLAGS,
  buildPlayerBattleReportCenter,
  buildPlayerProgressionSnapshot,
  createDefaultHeroLoadout,
  createDefaultHeroProgression,
  createDemoBattleState,
  createPlayerWorldView,
  encodePlayerWorldView,
  type ClientMessage,
  type PlayerAchievementProgress,
  type PlayerProgressionSnapshot,
  type RuntimeDiagnosticsSnapshot,
  type ServerMessage,
  type SessionStatePayload,
  type WorldState
} from "../../src/index.ts";

function createContractWorldState(): WorldState {
  return {
    meta: {
      roomId: "room-contract",
      seed: 328,
      day: 7,
      mapVariantId: "frontier-basin"
    },
    map: {
      width: 3,
      height: 2,
      tiles: [
        {
          position: { x: 0, y: 0 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: { kind: "hero", refId: "hero-1" },
          building: undefined
        },
        {
          position: { x: 1, y: 0 },
          terrain: "sand",
          walkable: true,
          resource: { kind: "wood", amount: 4 },
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 2, y: 0 },
          terrain: "water",
          walkable: false,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 0, y: 1 },
          terrain: "dirt",
          walkable: true,
          resource: undefined,
          occupant: undefined,
          building: undefined
        },
        {
          position: { x: 1, y: 1 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: { kind: "neutral", refId: "neutral-1" },
          building: undefined
        },
        {
          position: { x: 2, y: 1 },
          terrain: "grass",
          walkable: true,
          resource: undefined,
          occupant: { kind: "hero", refId: "hero-2" },
          building: undefined
        }
      ]
    },
    heroes: [
      {
        id: "hero-1",
        playerId: "player-1",
        name: "暮火侦骑",
        position: { x: 0, y: 0 },
        vision: 3,
        move: { total: 6, remaining: 4 },
        stats: { attack: 3, defense: 2, power: 1, knowledge: 1, hp: 26, maxHp: 30 },
        progression: {
          ...createDefaultHeroProgression(),
          level: 2,
          experience: 120,
          skillPoints: 1,
          battlesWon: 2,
          neutralBattlesWon: 2
        },
        loadout: createDefaultHeroLoadout(),
        armyTemplateId: "hero_guard_basic",
        armyCount: 14,
        learnedSkills: []
      },
      {
        id: "hero-2",
        playerId: "player-2",
        name: "霜牙掠影",
        position: { x: 2, y: 1 },
        vision: 2,
        move: { total: 6, remaining: 6 },
        stats: { attack: 2, defense: 3, power: 1, knowledge: 1, hp: 30, maxHp: 30 },
        progression: createDefaultHeroProgression(),
        loadout: createDefaultHeroLoadout(),
        armyTemplateId: "hero_guard_basic",
        armyCount: 12,
        learnedSkills: []
      }
    ],
    neutralArmies: {
      "neutral-1": {
        id: "neutral-1",
        position: { x: 1, y: 1 },
        reward: { kind: "gold", amount: 100 },
        stacks: [{ templateId: "wolf_pack", count: 8 }]
      }
    },
    buildings: {},
    resources: {
      "player-1": { gold: 180, wood: 12, ore: 5 },
      "player-2": { gold: 90, wood: 4, ore: 3 }
    },
    turnDeadlineAt: "2026-03-29T07:01:30.000Z",
    visibilityByPlayer: {
      "player-1": ["visible", "visible", "explored", "visible", "visible", "visible"]
    }
  };
}

export function createSessionStatePayloadFixture(): SessionStatePayload {
  const worldView = createPlayerWorldView(createContractWorldState(), "player-1");

  return {
    world: encodePlayerWorldView(worldView),
    battle: createDemoBattleState(),
    events: [
      {
        type: "hero.moved",
        heroId: "hero-1",
        path: [
          { x: 0, y: 0 },
          { x: 0, y: 1 }
        ],
        moveCost: 1
      },
      {
        type: "battle.started",
        heroId: "hero-1",
        attackerPlayerId: "player-1",
        encounterKind: "neutral",
        neutralArmyId: "neutral-1",
        battleId: "battle-demo",
        path: [
          { x: 0, y: 1 },
          { x: 1, y: 1 }
        ],
        moveCost: 1
      }
    ],
    movementPlan: {
      heroId: "hero-1",
      destination: { x: 1, y: 1 },
      path: [
        { x: 0, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 }
      ],
      travelPath: [
        { x: 0, y: 0 },
        { x: 0, y: 1 }
      ],
      moveCost: 1,
      endsInEncounter: true,
      encounterKind: "neutral",
      encounterRefId: "neutral-1"
    },
    reachableTiles: [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 }
    ],
    featureFlags: DEFAULT_FEATURE_FLAGS,
    reason: "battle.started"
  };
}

export function createPlayerProgressionSnapshotFixture(): PlayerProgressionSnapshot {
  const achievements: Partial<PlayerAchievementProgress>[] = [
    {
      id: "first_battle",
      current: 1,
      unlocked: true,
      progressUpdatedAt: "2026-03-29T06:00:00.000Z",
      unlockedAt: "2026-03-29T06:00:00.000Z"
    },
    {
      id: "enemy_slayer",
      current: 2,
      progressUpdatedAt: "2026-03-29T06:30:00.000Z"
    },
    {
      id: "skill_scholar",
      current: 1,
      progressUpdatedAt: "2026-03-29T07:00:00.000Z"
    }
  ];

  return buildPlayerProgressionSnapshot(
    achievements,
    [
      {
        id: "player-1:2026-03-29T07:00:00.000Z:achievement:3:skill_scholar",
        timestamp: "2026-03-29T07:00:00.000Z",
        roomId: "room-contract",
        playerId: "player-1",
        category: "achievement",
        description: "求知者 进度推进至 1/5。",
        achievementId: "skill_scholar",
        rewards: []
      },
      {
        id: "player-1:2026-03-29T06:30:00.000Z:battle.resolved:2",
        timestamp: "2026-03-29T06:30:00.000Z",
        roomId: "room-contract",
        playerId: "player-1",
        category: "combat",
        description: "暮火侦骑 击退了中立守军。",
        heroId: "hero-1",
        worldEventType: "battle.resolved",
        rewards: [{ type: "experience", label: "hero_xp", amount: 120 }]
      },
      {
        id: "player-1:2026-03-29T06:00:00.000Z:achievement:1:first_battle",
        timestamp: "2026-03-29T06:00:00.000Z",
        roomId: "room-contract",
        playerId: "player-1",
        category: "achievement",
        description: "初次交锋 已解锁。",
        achievementId: "first_battle",
        rewards: [{ type: "badge", label: "初次交锋" }]
      }
    ],
    3
  );
}

export function createBattleReportCenterFixture() {
  return buildPlayerBattleReportCenter(
    [
      {
        id: "room-contract:battle-demo:player-1",
        roomId: "room-contract",
        playerId: "player-1",
        battleId: "battle-demo",
        battleKind: "neutral",
        playerCamp: "attacker",
        heroId: "hero-1",
        neutralArmyId: "neutral-1",
        startedAt: "2026-03-29T06:26:00.000Z",
        completedAt: "2026-03-29T06:30:00.000Z",
        initialState: createDemoBattleState(),
        steps: [
          {
            index: 1,
            source: "player",
            action: {
              type: "battle.attack",
              attackerId: "hero-1-stack",
              defenderId: "neutral-1-stack"
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
      }
    ],
    [
      {
        id: "player-1:2026-03-29T06:30:00.000Z:battle.resolved:2",
        timestamp: "2026-03-29T06:30:00.000Z",
        roomId: "room-contract",
        playerId: "player-1",
        category: "combat",
        description: "暮火侦骑 击退了中立守军。",
        heroId: "hero-1",
        worldEventType: "battle.resolved",
        rewards: [{ type: "experience", label: "hero_xp", amount: 120 }]
      }
    ]
  );
}

export function createRuntimeDiagnosticsSnapshotFixture(): RuntimeDiagnosticsSnapshot {
  return {
    schemaVersion: 1,
    exportedAt: "2026-03-29T07:10:00.000Z",
    source: {
      surface: "cocos-runtime-overlay",
      devOnly: true,
      mode: "battle"
    },
    room: {
      roomId: "room-contract",
      playerId: "player-1",
      day: 7,
      connectionStatus: "connected",
      lastUpdateSource: "push",
      lastUpdateReason: "battle.started",
      lastUpdateAt: "2026-03-29T07:09:30.000Z"
    },
    world: {
      map: {
        width: 3,
        height: 2,
        visibleTileCount: 5,
        reachableTileCount: 4
      },
      resources: {
        gold: 180,
        wood: 12,
        ore: 5
      },
      selectedTile: { x: 1, y: 1 },
      hoveredTile: { x: 1, y: 1 },
      keyboardCursor: { x: 0, y: 1 },
      hero: {
        id: "hero-1",
        name: "暮火侦骑",
        position: { x: 0, y: 0 },
        move: { total: 6, remaining: 4 },
        stats: {
          attack: 3,
          defense: 2,
          power: 1,
          knowledge: 1,
          hp: 26,
          maxHp: 30
        },
        armyTemplateId: "hero_guard_basic",
        armyCount: 14,
        progression: {
          level: 2,
          experience: 120,
          skillPoints: 1,
          battlesWon: 2,
          neutralBattlesWon: 2,
          pvpBattlesWon: 0
        }
      },
      visibleHeroes: [{ id: "hero-2", playerId: "player-2", position: { x: 2, y: 1 } }]
    },
    battle: {
      id: "battle-demo",
      round: 1,
      activeUnitId: "wolf-d",
      selectedTargetId: "pikeman-a",
      unitCount: 2,
      environmentCount: 0,
      logTail: ["战斗开始", "恶狼率先行动"]
    },
    account: {
      playerId: "player-1",
      displayName: "暮火侦骑",
      source: "remote",
      loginId: "veil-ranger",
      recentEventCount: 3,
      recentReplayCount: 1
    },
    overview: null,
    diagnostics: {
      eventTypes: ["hero.moved", "battle.started"],
      timelineTail: [
        {
          id: "timeline-1",
          tone: "neutral",
          source: "push",
          text: "Room room-contract entered battle battle-demo"
        },
        {
          id: "timeline-2",
          tone: "warning",
          source: "prediction",
          text: "Predicted path resolved into neutral encounter"
        }
      ],
      logTail: ["Connected to room-contract", "Pushed authoritative battle snapshot"],
      recoverySummary: "权威房间已接管预测结果，战斗态一致。",
      predictionStatus: "server-authoritative",
      primaryClientTelemetry: [
        {
          at: "2026-03-29T07:09:31.000Z",
          category: "combat",
          checkpoint: "encounter.started",
          status: "info",
          detail: "Battle battle-demo started against neutral.",
          roomId: "room-contract",
          playerId: "player-1",
          heroId: "hero-1",
          battleId: "battle-demo",
          battleKind: "neutral"
        },
        {
          at: "2026-03-29T07:09:50.000Z",
          category: "inventory",
          checkpoint: "loot.collected",
          status: "success",
          detail: "Loot Scout Pike added to inventory.",
          roomId: "room-contract",
          playerId: "player-1",
          heroId: "hero-1",
          battleId: "battle-demo",
          battleKind: "neutral",
          equipmentId: "scout_pike",
          equipmentName: "Scout Pike",
          itemCount: 2
        }
      ],
      pendingUiTasks: 1,
      replay: {
        replayId: "room-contract:battle-demo:player-1",
        loading: false,
        status: "paused",
        currentStepIndex: 0,
        totalSteps: 2
      }
    }
  };
}

export function createClientMessageFixtures(): ClientMessage[] {
  return [
    {
      type: "connect",
      requestId: "req-connect-001",
      roomId: "room-contract",
      playerId: "player-1",
      displayName: "暮火侦骑",
      authToken: "token-contract",
      seed: 328
    },
    {
      type: "world.action",
      requestId: "req-world-action-001",
      action: {
        type: "hero.move",
        heroId: "hero-1",
        destination: { x: 1, y: 1 }
      }
    },
    {
      type: "battle.action",
      requestId: "req-battle-action-001",
      action: {
        type: "battle.attack",
        attackerId: "wolf-d",
        defenderId: "pikeman-a"
      }
    },
    {
      type: "world.preview",
      requestId: "req-world-preview-001",
      heroId: "hero-1",
      destination: { x: 1, y: 1 }
    },
    {
      type: "world.reachable",
      requestId: "req-world-reachable-001",
      heroId: "hero-1"
    },
    {
      type: "campaign.dialogue.ack",
      requestId: "req-campaign-dialogue-001",
      action: {
        missionId: "chapter1-ember-watch",
        sequence: "intro",
        dialogueLineId: "c1m1-intro-1"
      }
    }
  ];
}

export function createServerMessageFixtures(): ServerMessage[] {
  const sessionStatePayload = createSessionStatePayloadFixture();

  return [
    {
      type: "session.state",
      requestId: "req-session-state-001",
      delivery: "push",
      payload: sessionStatePayload
    },
    {
      type: "turn.timer",
      requestId: "push",
      delivery: "push",
      remainingMs: 90_000,
      turnOwnerPlayerId: "player-1"
    },
    {
      type: "world.preview",
      requestId: "req-world-preview-001",
      movementPlan: sessionStatePayload.movementPlan
    },
    {
      type: "world.reachable",
      requestId: "req-world-reachable-001",
      reachableTiles: sessionStatePayload.reachableTiles
    },
    {
      type: "error",
      requestId: "req-world-action-002",
      reason: "destination_occupied"
    },
    {
      type: "event.progress.update",
      requestId: "push",
      delivery: "push",
      payload: {
        eventId: "defend-the-bridge",
        points: 40,
        delta: 40,
        objectiveId: "bridge-dungeon-clear"
      }
    }
  ];
}
