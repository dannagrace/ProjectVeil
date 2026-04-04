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
    platform: "colyseus"
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
  purchase: defineAnalyticsEvent("purchase", 1, "Shop purchase completed successfully.", {
    purchaseId: "purchase-1",
    productId: "gem_pack_small",
    quantity: 1,
    totalPrice: 100
  }),
  tutorial_step: defineAnalyticsEvent("tutorial_step", 1, "Tutorial milestone advanced by the player.", {
    stepId: "movement_intro",
    status: "completed"
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
  )
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
  source: "server";
  roomId?: string;
  payload: AnalyticsEventPayloadByName[Name];
};

export function createAnalyticsEvent<Name extends AnalyticsEventName>(
  name: Name,
  input: {
    at?: string;
    playerId: string;
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
    source: "server",
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
