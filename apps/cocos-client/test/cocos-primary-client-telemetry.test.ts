import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import {
  appendPrimaryClientTelemetry,
  buildPrimaryClientTelemetryFromUpdate,
  configureClientAnalyticsRuntimeDependencies,
  createPrimaryClientTelemetryEvent,
  emitClientAnalyticsEvent,
  flushClientAnalyticsEventsForTest,
  resetClientAnalyticsRuntimeDependencies
} from "../assets/scripts/cocos-primary-client-telemetry.ts";
import type { PrimaryClientTelemetryEvent } from "../../../packages/shared/src/index.ts";
import { createSessionUpdate } from "./helpers/cocos-session-fixtures.ts";

afterEach(() => {
  resetClientAnalyticsRuntimeDependencies();
});

function parseAnalyticsEnvelope(init?: RequestInit): {
  schemaVersion: number;
  emittedAt: string;
  events: Array<{ name: string; payload: Record<string, unknown> }>;
} {
  return JSON.parse(String(init?.body));
}

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

test("emitClientAnalyticsEvent batches production client events to the analytics endpoint", async () => {
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  configureClientAnalyticsRuntimeDependencies({
    getNodeEnv: () => "production",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return {
        ok: true,
        status: 202
      };
    }
  });

  const event = emitClientAnalyticsEvent(
    "shop_open",
    {
      remoteUrl: "http://127.0.0.1:2567",
      playerId: "player-1",
      sessionId: "session-1",
      roomId: "room-telemetry"
    },
    {
      roomId: "room-telemetry",
      surface: "lobby"
    }
  );
  await flushClientAnalyticsEventsForTest();

  assert.equal(event.source, "cocos-client");
  assert.equal(event.platform, "wechat");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.input, "http://127.0.0.1:2567/api/analytics/events");
  assert.match(String(fetchCalls[0]?.init?.body), /"name":"shop_open"/);
  assert.match(String(fetchCalls[0]?.init?.body), /"sessionId":"session-1"/);
});

test("emitClientAnalyticsEvent flushes queued events after the configured delay", async () => {
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  let scheduledDelayMs: number | null = null;
  let scheduledFlush: (() => void) | null = null;
  configureClientAnalyticsRuntimeDependencies({
    getNodeEnv: () => "production",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return {
        ok: true,
        status: 202
      };
    },
    setTimeout: (handler, delayMs) => {
      scheduledDelayMs = delayMs;
      scheduledFlush = handler;
      return { delayMs } as ReturnType<typeof globalThis.setTimeout>;
    },
    clearTimeout: () => {}
  });

  emitClientAnalyticsEvent(
    "shop_open",
    {
      remoteUrl: "http://127.0.0.1:2567",
      playerId: "player-1",
      sessionId: "session-1",
      roomId: "room-telemetry"
    },
    {
      roomId: "room-telemetry",
      surface: "lobby"
    }
  );

  assert.equal(fetchCalls.length, 0);
  assert.equal(scheduledDelayMs, 250);
  assert.ok(scheduledFlush);

  scheduledFlush();
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0]?.input, "http://127.0.0.1:2567/api/analytics/events");
});

test("emitClientAnalyticsEvent flushes immediately when the batch-size threshold is reached", async () => {
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  const scheduledHandles: Array<ReturnType<typeof globalThis.setTimeout>> = [];
  const clearedHandles: Array<ReturnType<typeof globalThis.setTimeout>> = [];
  configureClientAnalyticsRuntimeDependencies({
    getNodeEnv: () => "production",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return {
        ok: true,
        status: 202
      };
    },
    setTimeout: (_handler, delayMs) => {
      const handle = { delayMs } as ReturnType<typeof globalThis.setTimeout>;
      scheduledHandles.push(handle);
      return handle;
    },
    clearTimeout: (handle) => {
      clearedHandles.push(handle);
    }
  });

  for (let index = 0; index < 20; index += 1) {
    emitClientAnalyticsEvent(
      "shop_open",
      {
        remoteUrl: "http://127.0.0.1:2567",
        playerId: "player-1",
        sessionId: "session-1",
        roomId: "room-telemetry"
      },
      {
        roomId: "room-telemetry",
        surface: `surface-${index}`
      }
    );
  }

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(scheduledHandles.length, 1);
  assert.deepEqual(clearedHandles, scheduledHandles);
  assert.equal(fetchCalls.length, 1);

  const envelope = parseAnalyticsEnvelope(fetchCalls[0]?.init);
  assert.equal(envelope.events.length, 20);
});

test("emitClientAnalyticsEvent stays quiet outside production mode", async () => {
  let fetchCalls = 0;
  configureClientAnalyticsRuntimeDependencies({
    getNodeEnv: () => "test",
    fetch: async () => {
      fetchCalls += 1;
      return {
        ok: true,
        status: 202
      };
    }
  });

  emitClientAnalyticsEvent(
    "battle_start",
    {
      remoteUrl: "http://127.0.0.1:2567",
      playerId: "player-1",
      sessionId: "session-1",
      roomId: "room-telemetry"
    },
    {
      roomId: "room-telemetry",
      battleId: "battle-1",
      encounterKind: "neutral",
      heroId: "hero-1"
    }
  );
  await flushClientAnalyticsEventsForTest();

  assert.equal(fetchCalls, 0);
});

test("emitClientAnalyticsEvent flush groups pending events by analytics endpoint", async () => {
  const fetchCalls: Array<{ input: string; init?: RequestInit }> = [];
  configureClientAnalyticsRuntimeDependencies({
    getNodeEnv: () => "production",
    fetch: async (input, init) => {
      fetchCalls.push({ input, init });
      return {
        ok: true,
        status: 202
      };
    }
  });

  emitClientAnalyticsEvent(
    "shop_open",
    {
      remoteUrl: "http://127.0.0.1:2567",
      playerId: "player-1",
      sessionId: "session-1",
      roomId: "room-telemetry"
    },
    {
      roomId: "room-telemetry",
      surface: "lobby"
    }
  );
  emitClientAnalyticsEvent(
    "battle_start",
    {
      remoteUrl: "http://127.0.0.1:2567/",
      playerId: "player-1",
      sessionId: "session-1",
      roomId: "room-telemetry"
    },
    {
      roomId: "room-telemetry",
      battleId: "battle-1",
      encounterKind: "neutral",
      heroId: "hero-1"
    }
  );
  emitClientAnalyticsEvent(
    "shop_open",
    {
      remoteUrl: "https://analytics.projectveil.example/game",
      playerId: "player-2",
      sessionId: "session-2",
      roomId: "room-secondary"
    },
    {
      roomId: "room-secondary",
      surface: "post_battle"
    }
  );

  await flushClientAnalyticsEventsForTest();

  assert.equal(fetchCalls.length, 2);
  assert.deepEqual(
    fetchCalls.map((call) => call.input).sort(),
    [
      "http://127.0.0.1:2567/api/analytics/events",
      "https://analytics.projectveil.example/api/analytics/events"
    ]
  );

  const localBatch = fetchCalls.find((call) => call.input === "http://127.0.0.1:2567/api/analytics/events");
  const remoteBatch = fetchCalls.find((call) => call.input === "https://analytics.projectveil.example/api/analytics/events");
  const localEnvelope = parseAnalyticsEnvelope(localBatch?.init);
  const remoteEnvelope = parseAnalyticsEnvelope(remoteBatch?.init);

  assert.equal(localEnvelope.schemaVersion, 1);
  assert.match(localEnvelope.emittedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    localEnvelope.events.map((event) => event.name),
    ["shop_open", "battle_start"]
  );
  assert.deepEqual(
    remoteEnvelope.events.map((event) => event.name),
    ["shop_open"]
  );
});

test("flushClientAnalyticsEventsForTest logs non-ok analytics flush responses without throwing", async () => {
  const errors: Array<{ message: string; error?: unknown }> = [];
  configureClientAnalyticsRuntimeDependencies({
    getNodeEnv: () => "production",
    fetch: async () => ({
      ok: false,
      status: 503
    }),
    error: (message, error) => {
      errors.push({ message, error });
    }
  });

  emitClientAnalyticsEvent(
    "shop_open",
    {
      remoteUrl: "http://127.0.0.1:2567",
      playerId: "player-1",
      sessionId: "session-1",
      roomId: "room-telemetry"
    },
    {
      roomId: "room-telemetry",
      surface: "lobby"
    }
  );

  await assert.doesNotReject(() => flushClientAnalyticsEventsForTest());

  assert.deepEqual(errors, [
    {
      message: "[Analytics] Failed to flush client analytics batch: 503",
      error: undefined
    }
  ]);
});

test("flushClientAnalyticsEventsForTest logs thrown analytics flush errors without throwing", async () => {
  const errors: Array<{ message: string; error?: unknown }> = [];
  const fetchError = new Error("network unavailable");
  configureClientAnalyticsRuntimeDependencies({
    getNodeEnv: () => "production",
    fetch: async () => {
      throw fetchError;
    },
    error: (message, error) => {
      errors.push({ message, error });
    }
  });

  emitClientAnalyticsEvent(
    "shop_open",
    {
      remoteUrl: "http://127.0.0.1:2567",
      playerId: "player-1",
      sessionId: "session-1",
      roomId: "room-telemetry"
    },
    {
      roomId: "room-telemetry",
      surface: "lobby"
    }
  );

  await assert.doesNotReject(() => flushClientAnalyticsEventsForTest());

  assert.deepEqual(errors, [
    {
      message: "[Analytics] Failed to flush client analytics batch",
      error: fetchError
    }
  ]);
});
