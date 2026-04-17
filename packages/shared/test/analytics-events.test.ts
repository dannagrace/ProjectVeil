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

test("createAnalyticsEvent: session_end event carries duration and reason payload", () => {
  const event = createAnalyticsEvent("session_end", {
    playerId: "player-1",
    sessionId: "session-xyz",
    payload: {
      roomId: "room-1",
      disconnectReason: "transport_closed",
      sessionDurationMs: 12345
    }
  });

  assert.equal(event.payload.roomId, "room-1");
  assert.equal(event.payload.disconnectReason, "transport_closed");
  assert.equal(event.payload.sessionDurationMs, 12345);
  assert.equal(event.sessionId, "session-xyz");
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

test("createAnalyticsEvent: purchase_completed event carries monetization funnel fields", () => {
  const event = createAnalyticsEvent("purchase_completed", {
    playerId: "player-1",
    payload: {
      purchaseId: "purchase-42",
      productId: "gem_pack_small",
      paymentMethod: "wechat",
      quantity: 1,
      totalPrice: 600
    }
  });

  assert.equal(event.payload.purchaseId, "purchase-42");
  assert.equal(event.payload.paymentMethod, "wechat");
  assert.equal(event.payload.quantity, 1);
  assert.equal(event.payload.totalPrice, 600);
});

test("createAnalyticsEvent: purchase_attempt carries surface and pricing fields", () => {
  const event = createAnalyticsEvent("purchase_attempt", {
    playerId: "player-1",
    payload: {
      roomId: "room-1",
      productId: "gem_pack_small",
      productType: "gem_pack",
      currency: "wechat_fen",
      price: 600,
      surface: "lobby"
    }
  });

  assert.equal(event.payload.productId, "gem_pack_small");
  assert.equal(event.payload.surface, "lobby");
  assert.equal(event.payload.price, 600);
});

test("createAnalyticsEvent: purchase_failed event carries failure reason and status", () => {
  const event = createAnalyticsEvent("purchase_failed", {
    playerId: "player-1",
    payload: {
      purchaseId: "purchase-42",
      productId: "gem_pack_small",
      paymentMethod: "wechat_pay",
      failureReason: "grant_failed",
      orderStatus: "dead_letter"
    }
  });

  assert.equal(event.payload.purchaseId, "purchase-42");
  assert.equal(event.payload.paymentMethod, "wechat_pay");
  assert.equal(event.payload.failureReason, "grant_failed");
  assert.equal(event.payload.orderStatus, "dead_letter");
});

test("createAnalyticsEvent: quest_complete event carries correct payload structure", () => {
  const event = createAnalyticsEvent("quest_complete", {
    playerId: "player-1",
    payload: { roomId: "daily", questId: "daily_explore_frontier", reward: { gems: 5, gold: 60 } }
  });
  assert.equal(event.payload.questId, "daily_explore_frontier");
  assert.equal(event.payload.reward.gems, 5);
});

test("createAnalyticsEvent: mission_started event carries campaign handoff payload", () => {
  const event = createAnalyticsEvent("mission_started", {
    playerId: "player-1",
    payload: {
      campaignId: "chapter1",
      missionId: "chapter1-ember-watch",
      mapId: "veil-frontier",
      chapterOrder: 1
    }
  });
  assert.equal(event.payload.campaignId, "chapter1");
  assert.equal(event.payload.missionId, "chapter1-ember-watch");
  assert.equal(event.payload.mapId, "veil-frontier");
  assert.equal(event.payload.chapterOrder, 1);
});

test("createAnalyticsEvent: daily_login event carries streak and reward payload", () => {
  const event = createAnalyticsEvent("daily_login", {
    playerId: "player-1",
    payload: { dateKey: "2026-04-11", streak: 2, reward: { gems: 5, gold: 75 } }
  });
  assert.equal(event.payload.dateKey, "2026-04-11");
  assert.equal(event.payload.streak, 2);
  assert.equal(event.payload.reward.gold, 75);
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

test("createAnalyticsEvent: asset_load_failed includes retry metadata and path", () => {
  const event = createAnalyticsEvent("asset_load_failed", {
    playerId: "player-1",
    source: "cocos-client",
    payload: {
      assetType: "sprite",
      assetPath: "pixel/terrain/grass-1",
      retryCount: 3,
      critical: true,
      finalFailure: true,
      errorMessage: "missing sprite"
    }
  });

  assert.equal(event.payload.assetPath, "pixel/terrain/grass-1");
  assert.equal(event.payload.retryCount, 3);
  assert.equal(event.payload.finalFailure, true);
  assert.equal(event.source, "cocos-client");
});

test("createAnalyticsEvent: client_perf_degraded includes fps, latency, memory, and runtime metadata", () => {
  const event = createAnalyticsEvent("client_perf_degraded", {
    playerId: "player-1",
    source: "cocos-client",
    payload: {
      reason: "fps_and_memory",
      fpsAvg: 16.8,
      latencyMsAvg: 59.5,
      memoryUsageRatio: 0.84,
      deviceModel: "iPhone 13 Pro Max",
      wechatVersion: "8.0.50"
    }
  });

  assert.equal(event.payload.reason, "fps_and_memory");
  assert.equal(event.payload.fpsAvg, 16.8);
  assert.equal(event.payload.latencyMsAvg, 59.5);
  assert.equal(event.payload.memoryUsageRatio, 0.84);
  assert.equal(event.payload.deviceModel, "iPhone 13 Pro Max");
  assert.equal(event.payload.wechatVersion, "8.0.50");
});
