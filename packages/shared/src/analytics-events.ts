export const ANALYTICS_SCHEMA_VERSION = 1 as const;

interface AnalyticsEventDefinition<Name extends string, Payload extends Record<string, unknown>> {
  readonly name: Name;
  readonly version: number;
  readonly description: string;
  readonly samplePayload: Payload;
}

function defineAnalyticsEvent<Name extends string, Payload extends Record<string, unknown>>(
  name: Name,
  version: number,
  description: string,
  samplePayload: Payload
): AnalyticsEventDefinition<Name, Payload> {
  return {
    name,
    version,
    description,
    samplePayload
  };
}

export const ANALYTICS_EVENT_CATALOG = {
  session_start: defineAnalyticsEvent("session_start", 1, "Player session established through the room transport.", {
    roomId: "room-contract",
    authMode: "guest",
    platform: "wechat"
  }),
  session_end: defineAnalyticsEvent("session_end", 1, "Player session ended and recorded disconnect reason plus session duration.", {
    roomId: "room-contract",
    disconnectReason: "transport_closed",
    sessionDurationMs: 12345
  }),
  battle_start: defineAnalyticsEvent("battle_start", 1, "Player entered a battle encounter.", {
    roomId: "room-contract",
    battleId: "battle-demo",
    encounterKind: "neutral",
    heroId: "hero-1"
  }),
  battle_end: defineAnalyticsEvent("battle_end", 1, "Battle resolved for a player.", {
    roomId: "room-contract",
    battleId: "battle-demo",
    result: "attacker_victory",
    heroId: "hero-1",
    battleKind: "neutral"
  }),
  quest_complete: defineAnalyticsEvent("quest_complete", 1, "Daily quest reward claimed by the player.", {
    roomId: "daily-quests",
    questId: "daily_explore_frontier",
    reward: {
      gems: 10,
      gold: 50
    }
  }),
  daily_login: defineAnalyticsEvent("daily_login", 1, "Daily first-login reward was issued to the player.", {
    dateKey: "2026-04-11",
    streak: 3,
    reward: {
      gems: 10,
      gold: 100
    }
  }),
  QuestRotated: defineAnalyticsEvent("QuestRotated", 1, "Server rotated a new daily quest slate for the player.", {
    roomId: "daily-quests",
    dateKey: "2026-04-06",
    questIds: ["daily_scouting_sweep", "daily_dual_conquest", "daily_warpath"],
    tierCounts: {
      common: 1,
      rare: 1,
      epic: 1
    }
  }),
  shop_open: defineAnalyticsEvent("shop_open", 1, "Player opened the shop surface.", {
    roomId: "room-contract",
    surface: "lobby"
  }),
  purchase_initiated: defineAnalyticsEvent("purchase_initiated", 1, "Player initiated a shop purchase from the client.", {
    roomId: "room-contract",
    productId: "gem_pack_small",
    productType: "gem_pack",
    currency: "wechat_fen",
    price: 600
  }),
  purchase_completed: defineAnalyticsEvent(
    "purchase_completed",
    1,
    "Shop purchase completed successfully after rewards were granted.",
    {
      purchaseId: "purchase-1",
      productId: "gem_pack_small",
      paymentMethod: "gems",
      quantity: 1,
      totalPrice: 600
    }
  ),
  purchase_failed: defineAnalyticsEvent(
    "purchase_failed",
    1,
    "Shop purchase failed before rewards were granted or could not finish reward settlement.",
    {
      purchaseId: "purchase-1",
      productId: "gem_pack_small",
      paymentMethod: "wechat_pay",
      failureReason: "grant_failed",
      orderStatus: "grant_pending"
    }
  ),
  purchase_high_value_alert: defineAnalyticsEvent(
    "purchase_high_value_alert",
    1,
    "High-value shop purchase exceeded the configured review threshold.",
    {
      purchaseId: "purchase-1",
      productId: "gem_pack_small",
      quantity: 1,
      totalPrice: 600,
      threshold: 500,
      paymentMethod: "gems",
      status: "completed"
    }
  ),
  purchase: defineAnalyticsEvent("purchase", 1, "Shop purchase completed successfully.", {
    purchaseId: "purchase-1",
    productId: "gem_pack_small",
    quantity: 1,
    totalPrice: 100
  }),
  payment_fraud_signal: defineAnalyticsEvent("payment_fraud_signal", 1, "Potential payment fraud or integrity anomaly detected.", {
    signal: "duplicate_out_trade_no",
    orderId: "wechat-order-1",
    productId: "gem_pack_small"
  }),
  tutorial_step: defineAnalyticsEvent("tutorial_step", 1, "Tutorial milestone advanced by the player.", {
    stepId: "movement_intro",
    status: "completed",
    reason: "advance"
  }),
  experiment_exposure: defineAnalyticsEvent("experiment_exposure", 1, "Experiment assignment was exposed to a player in a product surface.", {
    experimentKey: "account_portal_copy",
    experimentName: "Account Portal Upgrade Copy",
    variant: "upgrade",
    bucket: 42,
    surface: "player_account_profile",
    owner: "growth"
  }),
  experiment_conversion: defineAnalyticsEvent(
    "experiment_conversion",
    1,
    "Player completed a conversion event tied to an experiment assignment.",
    {
      experimentKey: "account_portal_copy",
      experimentName: "Account Portal Upgrade Copy",
      variant: "upgrade",
      bucket: 42,
      conversion: "account_bound",
      owner: "growth"
    }
  ),
  asset_load_failed: defineAnalyticsEvent("asset_load_failed", 1, "Client asset load failed after one or more attempts.", {
    assetType: "sprite",
    assetPath: "pixel/terrain/grass-1",
    retryCount: 3,
    critical: true,
    finalFailure: true,
    errorMessage: "missing sprite"
  }),
  client_perf_degraded: defineAnalyticsEvent(
    "client_perf_degraded",
    1,
    "Client runtime performance remained degraded long enough to cross the FPS or memory budget.",
    {
      reason: "fps",
      fpsAvg: 18.4,
      latencyMsAvg: 54.3,
      memoryUsageRatio: 0.82,
      deviceModel: "iPhone 13 Pro Max",
      wechatVersion: "8.0.50"
    }
  ),
  client_runtime_error: defineAnalyticsEvent(
    "client_runtime_error",
    1,
    "Client runtime captured a severe session or global application error worth operational triage.",
    {
      errorCode: "session_disconnect",
      severity: "error",
      stage: "connection",
      recoverable: true,
      message: "Reconnect failed while restoring the room snapshot."
    }
  ),
} as const;

export type AnalyticsEventName = keyof typeof ANALYTICS_EVENT_CATALOG;

type AnalyticsEventPayloadByName = {
  [Name in AnalyticsEventName]: (typeof ANALYTICS_EVENT_CATALOG)[Name]["samplePayload"];
};

export type AnalyticsEvent<Name extends AnalyticsEventName = AnalyticsEventName> = {
  schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
  name: Name;
  version: (typeof ANALYTICS_EVENT_CATALOG)[Name]["version"];
  at: string;
  playerId: string;
  source: "server" | "cocos-client";
  sessionId?: string;
  platform?: string;
  roomId?: string;
  payload: AnalyticsEventPayloadByName[Name];
};

export function createAnalyticsEvent<Name extends AnalyticsEventName>(
  name: Name,
  input: {
    at?: string;
    playerId: string;
    source?: AnalyticsEvent<Name>["source"];
    sessionId?: string;
    platform?: string;
    roomId?: string;
    payload: AnalyticsEventPayloadByName[Name];
  }
): AnalyticsEvent<Name> {
  return {
    schemaVersion: ANALYTICS_SCHEMA_VERSION,
    name,
    version: ANALYTICS_EVENT_CATALOG[name].version,
    at: input.at ?? new Date().toISOString(),
    playerId: input.playerId,
    source: input.source ?? "server",
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    ...(input.platform ? { platform: input.platform } : {}),
    ...(input.roomId ? { roomId: input.roomId } : {}),
    payload: input.payload
  };
}

export function validateAnalyticsEventCatalog(): {
  valid: boolean;
  errors: string[];
} {
  const seen = new Set<string>();
  const errors: string[] = [];

  for (const event of Object.values(ANALYTICS_EVENT_CATALOG)) {
    const key = `${event.name}@${event.version}`;
    if (seen.has(key)) {
      errors.push(`Duplicate analytics event definition: ${key}`);
    }
    seen.add(key);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
