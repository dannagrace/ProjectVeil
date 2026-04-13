import assert from "node:assert/strict";
import test from "node:test";
import {
  appendCompletedBattleReplaysToAccount,
  appendBattleReplayStep,
  buildPlayerBattleReplaySummariesForPlayer,
  buildPlayerBattleReplaySummary,
  createBattleReplayCapture,
  finalizeBattleReplayCapture
} from "../src/battle-replays";
import {
  createEmptyBattleState,
  normalizePlayerBattleReplaySummaries,
  type BattleAction,
  type PlayerAccountSnapshot
} from "../../../packages/shared/src/index";

function createBattleState(overrides: {
  id?: string;
  worldHeroId?: string;
  defenderHeroId?: string;
  neutralArmyId?: string;
} = {}) {
  const battle = createEmptyBattleState();
  battle.id = overrides.id ?? "battle-replay-272";
  if (overrides.worldHeroId) {
    battle.worldHeroId = overrides.worldHeroId;
  }
  if (overrides.defenderHeroId) {
    battle.defenderHeroId = overrides.defenderHeroId;
  }
  if (overrides.neutralArmyId) {
    battle.neutralArmyId = overrides.neutralArmyId;
  }
  return battle;
}

function createAccount(): PlayerAccountSnapshot {
  return {
    playerId: "player-1",
    displayName: "Replay Tester",
    globalResources: { gold: 0, wood: 0, ore: 0 },
    achievements: [],
    recentEventLog: [],
    recentBattleReplays: [],
    createdAt: "2026-03-29T12:00:00.000Z",
    updatedAt: "2026-03-29T12:00:00.000Z"
  };
}

test("battle replay capture creates a stable player replay record from settlement inputs", () => {
  const initialBattle = createBattleState({
    id: "battle-neutral-272",
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1"
  });
  const capture = createBattleReplayCapture(
    "room-272",
    initialBattle,
    { attackerPlayerId: "player-1" },
    "2026-03-29T12:00:00.000Z"
  );
  initialBattle.id = "mutated-after-capture";

  const action: BattleAction = {
    type: "battle.wait",
    unitId: "hero-1-stack"
  };
  const captureWithStep = appendBattleReplayStep(capture, action, "player");
  action.unitId = "mutated-action";

  const settledBattle = createBattleState({
    id: "battle-neutral-272",
    worldHeroId: "hero-1",
    neutralArmyId: "neutral-1"
  });
  const completed = finalizeBattleReplayCapture(
    captureWithStep,
    settledBattle,
    {
      status: "attacker_victory",
      survivingAttackers: ["hero-1-stack"],
      survivingDefenders: []
    },
    "2026-03-29T12:01:00.000Z"
  );
  settledBattle.neutralArmyId = "mutated-after-finalize";

  assert.ok(completed);
  assert.equal(completed.initialState.id, "battle-neutral-272");
  assert.equal(completed.steps[0]?.action.unitId, "hero-1-stack");
  assert.equal(completed.battleState.neutralArmyId, "neutral-1");

  const playerSummaries = buildPlayerBattleReplaySummariesForPlayer(completed, "player-1");
  assert.deepEqual(playerSummaries, [
    {
      id: "room-272:battle-neutral-272:player-1",
      roomId: "room-272",
      playerId: "player-1",
      battleId: "battle-neutral-272",
      battleKind: "neutral",
      playerCamp: "attacker",
      heroId: "hero-1",
      neutralArmyId: "neutral-1",
      startedAt: "2026-03-29T12:00:00.000Z",
      completedAt: "2026-03-29T12:01:00.000Z",
      expiresAt: "2026-06-27T12:01:00.000Z",
      initialState: completed.initialState,
      steps: completed.steps,
      result: "attacker_victory"
    }
  ]);

  const account = appendCompletedBattleReplaysToAccount(createAccount(), playerSummaries);
  assert.equal(account.recentBattleReplays?.[0]?.id, "room-272:battle-neutral-272:player-1");
});

test("battle replay emitted summaries stay compatible with normalized replay payload consumers", () => {
  const completed = finalizeBattleReplayCapture(
    appendBattleReplayStep(
      createBattleReplayCapture(
        "room-hero-272",
        createBattleState({
          id: "battle-hero-272",
          worldHeroId: "hero-1",
          defenderHeroId: "hero-2"
        }),
        {
          attackerPlayerId: "player-1",
          defenderPlayerId: "player-2"
        },
        "2026-03-29T13:00:00.000Z"
      ),
      {
        type: "battle.defend",
        unitId: "hero-2-stack"
      },
      "automated"
    ),
    createBattleState({
      id: "battle-hero-272",
      worldHeroId: "hero-1",
      defenderHeroId: "hero-2"
    }),
    {
      status: "defender_victory",
      survivingAttackers: [],
      survivingDefenders: ["hero-2-stack"]
    },
    "2026-03-29T13:02:00.000Z"
  );

  assert.ok(completed);
  const emittedPayload = JSON.parse(
    JSON.stringify(buildPlayerBattleReplaySummary(completed, "player-2", "hero-2", "defender", "hero-1"))
  );
  const normalized = normalizePlayerBattleReplaySummaries([emittedPayload]);

  assert.equal(normalized.length, 1);
  assert.deepEqual(normalized[0], {
    id: "room-hero-272:battle-hero-272:player-2",
    roomId: "room-hero-272",
    playerId: "player-2",
    battleId: "battle-hero-272",
    battleKind: "hero",
    playerCamp: "defender",
    heroId: "hero-2",
    opponentHeroId: "hero-1",
    startedAt: "2026-03-29T13:00:00.000Z",
    completedAt: "2026-03-29T13:02:00.000Z",
    expiresAt: "2026-06-27T13:02:00.000Z",
    initialState: completed.initialState,
    steps: [
      {
        index: 1,
        source: "automated",
        action: {
          type: "battle.defend",
          unitId: "hero-2-stack"
        }
      }
    ],
    result: "defender_victory"
  });
});

test("battle replay capture skips unresolved outcomes and empty replay appends", () => {
  const capture = createBattleReplayCapture(
    "room-empty-272",
    createBattleState({
      id: "battle-empty-272",
      worldHeroId: "hero-1",
      neutralArmyId: "neutral-1"
    }),
    { attackerPlayerId: "player-1" },
    "2026-03-29T14:00:00.000Z"
  );

  assert.equal(
    finalizeBattleReplayCapture(
      capture,
      createBattleState({
        id: "battle-empty-272",
        worldHeroId: "hero-1",
        neutralArmyId: "neutral-1"
      }),
      { status: "in_progress" },
      "2026-03-29T14:01:00.000Z"
    ),
    null
  );

  const account = createAccount();
  assert.equal(appendCompletedBattleReplaysToAccount(account, []), account);
});

test("battle replay capture records sequential immutable steps for each action appended", () => {
  const capture = createBattleReplayCapture(
    "room-steps-272",
    createBattleState({
      id: "battle-steps-272",
      worldHeroId: "hero-replay"
    }),
    { attackerPlayerId: "player-step" },
    "2026-03-29T15:00:00.000Z"
  );

  const firstAction: BattleAction = {
    type: "battle.attack",
    attackerId: "hero-stack",
    defenderId: "wolf-stack"
  };
  const withFirstStep = appendBattleReplayStep(capture, firstAction, "player");
  firstAction.attackerId = "mutated-after-append";

  const secondAction: BattleAction = {
    type: "battle.wait",
    unitId: "hero-stack"
  };
  const withSecondStep = appendBattleReplayStep(withFirstStep, secondAction, "automated");
  secondAction.unitId = "mutated-after-append";

  assert.equal(withSecondStep.steps.length, 2);
  assert.deepEqual(withSecondStep.steps[0], {
    index: 1,
    source: "player",
    action: {
      type: "battle.attack",
      attackerId: "hero-stack",
      defenderId: "wolf-stack"
    }
  });
  assert.deepEqual(withSecondStep.steps[1], {
    index: 2,
    source: "automated",
    action: {
      type: "battle.wait",
      unitId: "hero-stack"
    }
  });
});

test("battle replay summary rejects payloads larger than the configured byte budget", () => {
  const previousMaxBytes = process.env.VEIL_BATTLE_REPLAY_MAX_BYTES;
  process.env.VEIL_BATTLE_REPLAY_MAX_BYTES = "200";

  try {
    const completed = finalizeBattleReplayCapture(
      appendBattleReplayStep(
        createBattleReplayCapture(
          "room-large-272",
          createBattleState({
            id: "battle-large-272",
            worldHeroId: "hero-1"
          }),
          { attackerPlayerId: "player-1" },
          "2026-03-29T13:00:00.000Z"
        ),
        {
          type: "battle.wait",
          unitId: "hero-stack-".repeat(32)
        },
        "player"
      ),
      createBattleState({
        id: "battle-large-272",
        worldHeroId: "hero-1"
      }),
      {
        status: "attacker_victory",
        survivingAttackers: ["hero-1-stack"],
        survivingDefenders: []
      },
      "2026-03-29T13:02:00.000Z"
    );

    assert.ok(completed);
    assert.equal(buildPlayerBattleReplaySummary(completed, "player-1", "hero-1", "attacker"), null);
  } finally {
    if (previousMaxBytes === undefined) {
      delete process.env.VEIL_BATTLE_REPLAY_MAX_BYTES;
    } else {
      process.env.VEIL_BATTLE_REPLAY_MAX_BYTES = previousMaxBytes;
    }
  }
});

test("battle replay capture preserves structured rejections for invalid appended actions", () => {
  const capture = createBattleReplayCapture(
    "room-rejected-272",
    createBattleState({
      id: "battle-rejected-272",
      worldHeroId: "hero-replay"
    }),
    { attackerPlayerId: "player-step" },
    "2026-03-29T15:20:00.000Z"
  );

  const withRejectedStep = appendBattleReplayStep(
    capture,
    {
      type: "battle.skill",
      unitId: "hero-stack",
      skillId: "power_shot",
      targetId: "wolf-stack"
    },
    "player",
    {
      scope: "battle",
      actionType: "battle.skill",
      reason: "skill_on_cooldown"
    }
  );

  assert.deepEqual(withRejectedStep.steps[0], {
    index: 1,
    source: "player",
    action: {
      type: "battle.skill",
      unitId: "hero-stack",
      skillId: "power_shot",
      targetId: "wolf-stack"
    },
    rejection: {
      scope: "battle",
      actionType: "battle.skill",
      reason: "skill_on_cooldown"
    }
  });
});

test("battle replay emission requires hero identifiers before generating summaries", () => {
  const attackerCapture = finalizeBattleReplayCapture(
    createBattleReplayCapture(
      "room-prereq-272",
      createBattleState({
        id: "battle-prereq-272"
      }),
      { attackerPlayerId: "player-hero-prereq" },
      "2026-03-29T15:10:00.000Z"
    ),
    createBattleState({
      id: "battle-prereq-272"
    }),
    {
      status: "attacker_victory",
      survivingAttackers: [],
      survivingDefenders: []
    },
    "2026-03-29T15:11:00.000Z"
  );

  assert.ok(attackerCapture);
  assert.deepEqual(buildPlayerBattleReplaySummariesForPlayer(attackerCapture, "player-hero-prereq"), []);

  const defenderBattle = createBattleState({
    id: "battle-prereq-defender-272",
    worldHeroId: "hero-attacker-prereq"
  });
  const defenderCapture = finalizeBattleReplayCapture(
    createBattleReplayCapture(
      "room-prereq-272",
      defenderBattle,
      {
        attackerPlayerId: "player-hero-prereq",
        defenderPlayerId: "player-hero-prereq-defender"
      },
      "2026-03-29T15:12:00.000Z"
    ),
    defenderBattle,
    {
      status: "defender_victory",
      survivingAttackers: [],
      survivingDefenders: []
    },
    "2026-03-29T15:13:00.000Z"
  );

  assert.ok(defenderCapture);
  assert.deepEqual(
    buildPlayerBattleReplaySummariesForPlayer(defenderCapture, "player-hero-prereq-defender"),
    []
  );
});

test("buildPlayerBattleReplaySummariesForPlayer produces correct summaries for both PVP participants", () => {
  const battle = createBattleState({
    id: "battle-pvp-dual-272",
    worldHeroId: "hero-attacker",
    defenderHeroId: "hero-defender"
  });

  const capture = createBattleReplayCapture(
    "room-pvp-dual-272",
    battle,
    { attackerPlayerId: "player-attacker", defenderPlayerId: "player-defender" },
    "2026-03-29T16:00:00.000Z"
  );

  const completed = finalizeBattleReplayCapture(
    appendBattleReplayStep(capture, { type: "battle.wait", unitId: "hero-attacker-stack" }, "player"),
    createBattleState({
      id: "battle-pvp-dual-272",
      worldHeroId: "hero-attacker",
      defenderHeroId: "hero-defender"
    }),
    { status: "attacker_victory", survivingAttackers: ["hero-attacker-stack"], survivingDefenders: [] },
    "2026-03-29T16:01:00.000Z"
  );

  assert.ok(completed);

  const attackerSummaries = buildPlayerBattleReplaySummariesForPlayer(completed, "player-attacker");
  assert.equal(attackerSummaries.length, 1);
  const attackerSummary = attackerSummaries[0];
  assert.ok(attackerSummary);
  assert.equal(attackerSummary.battleKind, "hero");
  assert.equal(attackerSummary.playerCamp, "attacker");
  assert.equal(attackerSummary.heroId, "hero-attacker");
  assert.equal(attackerSummary.opponentHeroId, "hero-defender");
  assert.equal(attackerSummary.result, "attacker_victory");

  const defenderSummaries = buildPlayerBattleReplaySummariesForPlayer(completed, "player-defender");
  assert.equal(defenderSummaries.length, 1);
  const defenderSummary = defenderSummaries[0];
  assert.ok(defenderSummary);
  assert.equal(defenderSummary.battleKind, "hero");
  assert.equal(defenderSummary.playerCamp, "defender");
  assert.equal(defenderSummary.heroId, "hero-defender");
  assert.equal(defenderSummary.opponentHeroId, "hero-attacker");
  assert.equal(defenderSummary.result, "attacker_victory");

  const uninvolvedSummaries = buildPlayerBattleReplaySummariesForPlayer(completed, "player-uninvolved");
  assert.equal(uninvolvedSummaries.length, 0);
});

test("appendCompletedBattleReplaysToAccount trims to the five most recent replays", () => {
  let account = createAccount();

  for (let i = 1; i <= 6; i++) {
    const battle = createBattleState({
      id: `battle-trim-${i}`,
      worldHeroId: "hero-1",
      neutralArmyId: `neutral-${i}`
    });

    const completed = finalizeBattleReplayCapture(
      createBattleReplayCapture(
        "room-trim",
        battle,
        { attackerPlayerId: "player-1" },
        `2026-03-29T17:0${i}:00.000Z`
      ),
      createBattleState({ id: `battle-trim-${i}`, worldHeroId: "hero-1", neutralArmyId: `neutral-${i}` }),
      { status: "attacker_victory", survivingAttackers: ["hero-1-stack"], survivingDefenders: [] },
      `2026-03-29T17:0${i}:30.000Z`
    );

    assert.ok(completed);
    const summaries = buildPlayerBattleReplaySummariesForPlayer(completed, "player-1");
    account = appendCompletedBattleReplaysToAccount(account, summaries);
  }

  assert.equal(account.recentBattleReplays?.length, 5, "should trim to RECENT_BATTLE_REPLAY_LIMIT (5)");
  assert.equal(account.recentBattleReplays?.[0]?.battleId, "battle-trim-6", "most recent replay should be first");
  const ids = account.recentBattleReplays?.map((r) => r.battleId) ?? [];
  assert.ok(!ids.includes("battle-trim-1"), "oldest replay should be evicted");
});
