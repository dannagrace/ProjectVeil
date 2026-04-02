import assert from "node:assert/strict";
import test from "node:test";
import {
  appendPrimaryClientTelemetry,
  buildPrimaryClientTelemetryFromUpdate,
  createPrimaryClientTelemetryEvent
} from "../assets/scripts/cocos-primary-client-telemetry.ts";
import type { PrimaryClientTelemetryEvent } from "../../../packages/shared/src/index.ts";
import { createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";

function createTelemetryEntry(checkpoint: string): PrimaryClientTelemetryEvent {
  return {
    at: `2026-04-02T00:00:${checkpoint.padStart(2, "0")}.000Z`,
    category: "combat",
    checkpoint,
    status: "info",
    detail: `entry-${checkpoint}`,
    roomId: "room-telemetry",
    playerId: "player-1"
  };
}

test("appendPrimaryClientTelemetry prepends incoming entries in call order and enforces the limit", () => {
  const existing = Array.from({ length: 11 }, (_, index) => createTelemetryEntry(`${index + 1}`));
  const nextBatch = [createTelemetryEntry("12"), createTelemetryEntry("13")];

  const merged = appendPrimaryClientTelemetry(existing, nextBatch);

  assert.equal(merged.length, 12);
  assert.deepEqual(
    merged.map((entry) => entry.checkpoint),
    ["13", "12", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]
  );
  assert.equal(appendPrimaryClientTelemetry(existing, null), existing);
});

test("createPrimaryClientTelemetryEvent keeps explicit zero values and omits absent optional fields", () => {
  const event = createPrimaryClientTelemetryEvent(
    {
      roomId: "room-telemetry",
      playerId: "player-1",
      heroId: null,
      at: "2026-04-02T10:00:00.000Z"
    },
    {
      category: "progression",
      checkpoint: "hero.progressed",
      status: "success",
      detail: "Hero gained XP +0.",
      level: 1,
      experienceGained: 0,
      levelsGained: 0,
      skillPointsAwarded: 0,
      itemCount: 0
    }
  );

  assert.deepEqual(event, {
    at: "2026-04-02T10:00:00.000Z",
    category: "progression",
    checkpoint: "hero.progressed",
    status: "success",
    detail: "Hero gained XP +0.",
    roomId: "room-telemetry",
    playerId: "player-1",
    level: 1,
    experienceGained: 0,
    levelsGained: 0,
    skillPointsAwarded: 0,
    itemCount: 0
  });
  assert.equal("heroId" in event, false);
  assert.equal("battleId" in event, false);
});

test("buildPrimaryClientTelemetryFromUpdate maps supported world events with hero context and inventory counts", () => {
  const update = createSessionUpdate(2, "room-telemetry", "player-1");
  update.world.ownHeroes[0]!.id = "hero-update";
  update.world.ownHeroes[0]!.loadout.inventory = ["travel_boots", "militia_pike"];
  update.events = [
    {
      type: "hero.progressed",
      heroId: "hero-update",
      battleId: "battle-telemetry",
      battleKind: "neutral",
      experienceGained: 0,
      totalExperience: 100,
      level: 1,
      levelsGained: 0,
      skillPointsAwarded: 0,
      availableSkillPoints: 1
    },
    {
      type: "hero.equipmentChanged",
      heroId: "hero-update",
      slot: "weapon",
      unequippedItemId: "militia_pike"
    },
    {
      type: "hero.equipmentFound",
      heroId: "hero-update",
      battleId: "battle-telemetry",
      battleKind: "neutral",
      equipmentId: "militia_pike",
      equipmentName: "Militia Pike",
      rarity: "common",
      overflowed: true
    },
    {
      type: "battle.started",
      heroId: "hero-update",
      encounterKind: "neutral",
      neutralArmyId: "neutral-1",
      battleId: "battle-telemetry",
      path: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
      moveCost: 1
    },
    {
      type: "battle.resolved",
      heroId: "hero-update",
      battleId: "battle-telemetry",
      result: "attacker_victory"
    },
    {
      type: "turn.advanced",
      day: 3
    }
  ];

  const entries = buildPrimaryClientTelemetryFromUpdate(update, {
    roomId: "room-telemetry",
    playerId: "player-1",
    heroId: "hero-context",
    at: "2026-04-02T12:00:00.000Z"
  });

  assert.equal(entries.length, 5);
  assert.deepEqual(
    entries.map((entry) => ({
      checkpoint: entry.checkpoint,
      status: entry.status,
      heroId: entry.heroId
    })),
    [
      { checkpoint: "hero.progressed", status: "success", heroId: "hero-update" },
      { checkpoint: "equipment.unequipped", status: "success", heroId: "hero-update" },
      { checkpoint: "loot.overflowed", status: "blocked", heroId: "hero-update" },
      { checkpoint: "encounter.started", status: "info", heroId: "hero-update" },
      { checkpoint: "encounter.resolved", status: "success", heroId: "hero-update" }
    ]
  );
  assert.equal(entries[0]?.detail, "Hero gained XP +0.");
  assert.equal(entries[0]?.levelsGained, 0);
  assert.equal(entries[1]?.equipmentId, "militia_pike");
  assert.equal(entries[1]?.itemCount, 2);
  assert.equal(entries[2]?.equipmentName, "Militia Pike");
  assert.equal(entries[2]?.itemCount, 2);
  assert.equal(entries[4]?.result, "attacker_victory");
  assert.equal(entries[4]?.battleKind, undefined);
  assert(entries.every((entry) => entry.at === "2026-04-02T12:00:00.000Z"));
});
