import assert from "node:assert/strict";
import test from "node:test";
import {
  ANALYTICS_SCHEMA_VERSION,
  ANALYTICS_EVENT_CATALOG,
  createAnalyticsEvent,
  validateAnalyticsEventCatalog
} from "../src/analytics-events.ts";

// ──────────────────────────────────────────────────────────
// ANALYTICS_EVENT_CATALOG integrity
// ──────────────────────────────────────────────────────────

test("ANALYTICS_EVENT_CATALOG: all defined events have a non-empty name", () => {
  for (const [key, event] of Object.entries(ANALYTICS_EVENT_CATALOG)) {
    assert.ok(event.name.length > 0, `catalog key "${key}" has empty name`);
  }
});

test("ANALYTICS_EVENT_CATALOG: all defined events have a positive version", () => {
  for (const [key, event] of Object.entries(ANALYTICS_EVENT_CATALOG)) {
    assert.ok(event.version >= 1, `catalog key "${key}" version must be >= 1`);
  }
});

test("ANALYTICS_EVENT_CATALOG: all defined events have a non-empty description", () => {
  for (const [key, event] of Object.entries(ANALYTICS_EVENT_CATALOG)) {
    assert.ok(event.description.length > 0, `catalog key "${key}" has empty description`);
  }
});

test("ANALYTICS_EVENT_CATALOG: samplePayload is a non-null object for every event", () => {
  for (const [key, event] of Object.entries(ANALYTICS_EVENT_CATALOG)) {
    assert.ok(event.samplePayload !== null && typeof event.samplePayload === "object", `catalog key "${key}" samplePayload must be an object`);
  }
});

// ──────────────────────────────────────────────────────────
// validateAnalyticsEventCatalog
// ──────────────────────────────────────────────────────────

test("validateAnalyticsEventCatalog: built-in catalog passes validation with no errors", () => {
  const result = validateAnalyticsEventCatalog();
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

// ──────────────────────────────────────────────────────────
// createAnalyticsEvent — required fields
// ──────────────────────────────────────────────────────────

test("createAnalyticsEvent: sets schemaVersion to ANALYTICS_SCHEMA_VERSION", () => {
  const event = createAnalyticsEvent("session_start", {
    playerId: "player-1",
    payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
  });
  assert.equal(event.schemaVersion, ANALYTICS_SCHEMA_VERSION);
});

test("createAnalyticsEvent: sets name from first argument", () => {
  const event = createAnalyticsEvent("battle_start", {
    playerId: "player-1",
    payload: { roomId: "room-1", battleId: "battle-1", encounterKind: "neutral", heroId: "hero-1" }
  });
  assert.equal(event.name, "battle_start");
});

test("createAnalyticsEvent: sets version from catalog entry", () => {
  const event = createAnalyticsEvent("battle_end", {
    playerId: "player-1",
    payload: { roomId: "room-1", battleId: "battle-1", result: "attacker_victory", heroId: "hero-1", battleKind: "neutral" }
  });
  assert.equal(event.version, ANALYTICS_EVENT_CATALOG.battle_end.version);
});

test("createAnalyticsEvent: sets playerId from input", () => {
  const event = createAnalyticsEvent("session_start", {
    playerId: "player-abc",
    payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
  });
  assert.equal(event.playerId, "player-abc");
});

test("createAnalyticsEvent: defaults source to server when not provided", () => {
  const event = createAnalyticsEvent("session_start", {
    playerId: "player-1",
    payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
  });
  assert.equal(event.source, "server");
});

test("createAnalyticsEvent: respects explicit source override", () => {
  const event = createAnalyticsEvent("session_start", {
    playerId: "player-1",
    source: "cocos-client",
    payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
  });
  assert.equal(event.source, "cocos-client");
});

test("createAnalyticsEvent: sets at to a valid ISO timestamp when not provided", () => {
  const before = Date.now();
  const event = createAnalyticsEvent("session_start", {
    playerId: "player-1",
    payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
  });
  const after = Date.now();
  const ts = new Date(event.at).getTime();
  assert.ok(ts >= before && ts <= after, `at timestamp ${event.at} should be within test range`);
});

test("createAnalyticsEvent: respects explicit at override", () => {
  const fixedAt = "2026-04-09T12:00:00.000Z";
  const event = createAnalyticsEvent("session_start", {
    at: fixedAt,
    playerId: "player-1",
    payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
  });
  assert.equal(event.at, fixedAt);
});

// ──────────────────────────────────────────────────────────
// createAnalyticsEvent — optional fields
// ──────────────────────────────────────────────────────────

test("createAnalyticsEvent: sessionId is included when provided", () => {
  const event = createAnalyticsEvent("session_start", {
    playerId: "player-1",
    sessionId: "session-xyz",
    payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
  });
  assert.equal(event.sessionId, "session-xyz");
});

test("createAnalyticsEvent: sessionId is absent when not provided", () => {
  const event = createAnalyticsEvent("session_start", {
    playerId: "player-1",
    payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
  });
  assert.ok(!("sessionId" in event), "sessionId should not be present");
});

test("createAnalyticsEvent: platform is included when provided", () => {
  const event = createAnalyticsEvent("session_start", {
    playerId: "player-1",
    platform: "wechat",
    payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
  });
  assert.equal(event.platform, "wechat");
});

test("createAnalyticsEvent: platform is absent when not provided", () => {
  const event = createAnalyticsEvent("session_start", {
    playerId: "player-1",
    payload: { roomId: "room-1", authMode: "guest", platform: "wechat" }
  });
  assert.ok(!("platform" in event), "platform should not be present");
});

test("createAnalyticsEvent: roomId is included when provided", () => {
  const event = createAnalyticsEvent("battle_start", {
    playerId: "player-1",
    roomId: "room-battle-42",
    payload: { roomId: "room-battle-42", battleId: "b-1", encounterKind: "pvp", heroId: "hero-1" }
  });
  assert.equal(event.roomId, "room-battle-42");
});

test("createAnalyticsEvent: roomId is absent when not provided", () => {
  const event = createAnalyticsEvent("purchase", {
    playerId: "player-1",
    payload: { purchaseId: "p-1", productId: "gem_pack_small", quantity: 1, totalPrice: 100 }
  });
  assert.ok(!("roomId" in event), "roomId should not be present");
});

// ──────────────────────────────────────────────────────────
// createAnalyticsEvent — payload passthrough
// ──────────────────────────────────────────────────────────

test("createAnalyticsEvent: payload is passed through unchanged", () => {
  const payload = { purchaseId: "p-42", productId: "gem_pack_large", quantity: 2, totalPrice: 598 };
  const event = createAnalyticsEvent("purchase", { playerId: "player-1", payload });
  assert.deepEqual(event.payload, payload);
});

test("createAnalyticsEvent: quest_complete event carries correct payload structure", () => {
  const event = createAnalyticsEvent("quest_complete", {
    playerId: "player-1",
    payload: { roomId: "daily", questId: "daily_explore_frontier", reward: { gems: 5, gold: 60 } }
  });
  assert.equal(event.payload.questId, "daily_explore_frontier");
  assert.equal(event.payload.reward.gems, 5);
});

test("createAnalyticsEvent: experiment_exposure event carries all required fields", () => {
  const event = createAnalyticsEvent("experiment_exposure", {
    playerId: "player-1",
    payload: {
      experimentKey: "lobby_cta",
      experimentName: "Lobby CTA Test",
      variant: "control",
      bucket: 17,
      surface: "lobby",
      owner: "growth"
    }
  });
  assert.equal(event.payload.experimentKey, "lobby_cta");
  assert.equal(event.payload.variant, "control");
  assert.equal(event.payload.bucket, 17);
});
