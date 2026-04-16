import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosWorldFocusView } from "../assets/scripts/cocos-world-focus.ts";
import { createLobbyPanelTestAccount } from "../assets/scripts/cocos-lobby-panel-model.ts";
import { createWorldUpdate } from "./helpers/cocos-panel-harness.ts";

test("buildCocosWorldFocusView prioritizes map interaction when the hero stands on an actionable building", () => {
  const update = createWorldUpdate();
  update.world.ownHeroes[0]!.position = { x: 1, y: 1 };
  update.world.map.tiles = [
    {
      position: { x: 1, y: 1 },
      fog: "visible",
      terrain: "grass",
      walkable: true,
      resource: undefined,
      occupant: undefined,
      building: {
        id: "mine-1",
        kind: "resource_mine",
        label: "暮潮矿井",
        resourceKind: "ore",
        income: 2,
        tier: 1
      }
    }
  ];

  const focus = buildCocosWorldFocusView({
    update,
    interaction: {
      title: "矿井管理",
      detail: "当前矿井可占领并开始按天结算收益。",
      actions: [
        {
          id: "claim-mine",
          label: "占领矿井"
        }
      ]
    },
    predictionStatus: "",
    levelUpNotice: null,
    account: createLobbyPanelTestAccount()
  });

  assert.ok(focus);
  assert.equal(focus.badge, "交互");
  assert.equal(focus.headline, "正在处理 矿井管理");
  assert.match(focus.detail, /可占领/);
  assert.match(focus.summaryLines[0]!, /暮潮矿井/);
  assert.match(focus.summaryLines[1]!, /占领矿井/);
});

test("buildCocosWorldFocusView surfaces a world-travel recommendation when no direct interaction is pending", () => {
  const update = createWorldUpdate();
  const focus = buildCocosWorldFocusView({
    update,
    interaction: null,
    predictionStatus: "",
    levelUpNotice: null,
    account: createLobbyPanelTestAccount({
      recentBattleReplays: [
        {
          id: "replay-1",
          roomId: "room-alpha",
          playerId: "player-1",
          battleId: "battle-1",
          battleKind: "neutral",
          playerCamp: "attacker",
          result: "attacker_victory",
          heroId: "hero-1",
          neutralArmyId: "neutral-1",
          startedAt: "2026-04-16T09:00:00.000Z",
          completedAt: "2026-04-16T09:01:00.000Z",
          initialState: {
            id: "battle-1",
            round: 1,
            lanes: 1,
            activeUnitId: null,
            turnOrder: [],
            units: {},
            environment: [],
            log: [],
            rng: {
              seed: 1001,
              cursor: 0
            }
          },
          steps: []
        }
      ]
    })
  });

  assert.ok(focus);
  assert.equal(focus.badge, "采集");
  assert.equal(focus.headline, "脚下有可收集资源");
  assert.match(focus.detail, /木材 5/);
  assert.match(focus.summaryLines[0]!, /木材 5/);
  assert.ok(focus.summaryLines.some((line) => /先采集当前资源/.test(line)));
});

test("buildCocosWorldFocusView yields null when battle is active", () => {
  const update = createWorldUpdate();
  update.battle = {
    id: "battle-1",
    round: 1,
    lanes: 1,
    activeUnitId: null,
    turnOrder: [],
    units: {},
    environment: [],
    log: [],
    rng: {
      seed: 1001,
      cursor: 0
    }
  };

  const focus = buildCocosWorldFocusView({
    update,
    interaction: null,
    predictionStatus: "",
    levelUpNotice: null,
    account: createLobbyPanelTestAccount()
  });

  assert.equal(focus, null);
});
