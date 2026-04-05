import {
  createAnalyticsEvent,
  type AnalyticsEvent,
  type AnalyticsEventName,
  type PrimaryClientTelemetryEvent,
  type PrimaryClientTelemetryStatus
} from "../../../../packages/shared/src/index.ts";
import type { SessionUpdate, WorldEvent } from "./VeilCocosSession.ts";
import type { EquipmentType } from "./project-shared/index.ts";
import { resolveCocosApiBaseUrl } from "./cocos-lobby.ts";

const PRIMARY_CLIENT_TELEMETRY_LIMIT = 12;
const CLIENT_ANALYTICS_FLUSH_SIZE = 20;
const CLIENT_ANALYTICS_FLUSH_DELAY_MS = 250;

export interface ClientAnalyticsContext {
  remoteUrl: string;
  playerId: string;
  sessionId: string;
  roomId?: string;
  platform?: string;
  at?: string;
}

interface PendingClientAnalyticsEvent {
  endpoint: string;
  event: AnalyticsEvent;
}

interface ClientAnalyticsRuntimeDependencies {
  fetch(input: string, init?: RequestInit): Promise<{ ok: boolean; status: number }>;
  error(message: string, error?: unknown): void;
  getNodeEnv(): string | undefined;
  setTimeout(handler: () => void, delayMs: number): ReturnType<typeof globalThis.setTimeout>;
  clearTimeout(handle: ReturnType<typeof globalThis.setTimeout>): void;
}

const defaultClientAnalyticsRuntimeDependencies: ClientAnalyticsRuntimeDependencies = {
  fetch: (input, init) => fetch(input, init),
  error: (message, error) => console.error(message, error),
  getNodeEnv: () => globalThis.process?.env?.NODE_ENV,
  setTimeout: (handler, delayMs) => globalThis.setTimeout(handler, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle)
};

let clientAnalyticsRuntimeDependencies = defaultClientAnalyticsRuntimeDependencies;
let pendingClientAnalyticsEvents: PendingClientAnalyticsEvent[] = [];
let pendingClientAnalyticsTimer: ReturnType<typeof globalThis.setTimeout> | null = null;

export function configureClientAnalyticsRuntimeDependencies(
  overrides: Partial<ClientAnalyticsRuntimeDependencies>
): void {
  clientAnalyticsRuntimeDependencies = {
    ...clientAnalyticsRuntimeDependencies,
    ...overrides
  };
}

export function resetClientAnalyticsRuntimeDependencies(): void {
  clientAnalyticsRuntimeDependencies = defaultClientAnalyticsRuntimeDependencies;
  pendingClientAnalyticsEvents = [];
  if (pendingClientAnalyticsTimer) {
    clientAnalyticsRuntimeDependencies.clearTimeout(pendingClientAnalyticsTimer);
  }
  pendingClientAnalyticsTimer = null;
}

function shouldEmitClientAnalytics(): boolean {
  return clientAnalyticsRuntimeDependencies.getNodeEnv() === "production";
}

async function flushClientAnalyticsEvents(): Promise<void> {
  if (pendingClientAnalyticsEvents.length === 0) {
    return;
  }

  const batch = pendingClientAnalyticsEvents;
  pendingClientAnalyticsEvents = [];
  if (pendingClientAnalyticsTimer) {
    clientAnalyticsRuntimeDependencies.clearTimeout(pendingClientAnalyticsTimer);
    pendingClientAnalyticsTimer = null;
  }

  const batchesByEndpoint = new Map<string, AnalyticsEvent[]>();
  for (const entry of batch) {
    const events = batchesByEndpoint.get(entry.endpoint) ?? [];
    events.push(entry.event);
    batchesByEndpoint.set(entry.endpoint, events);
  }

  await Promise.all(
    Array.from(batchesByEndpoint.entries(), async ([endpoint, events]) => {
      try {
        const response = await clientAnalyticsRuntimeDependencies.fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8"
          },
          body: JSON.stringify({
            schemaVersion: 1,
            emittedAt: new Date().toISOString(),
            events
          })
        });
        if (!response.ok) {
          clientAnalyticsRuntimeDependencies.error(`[Analytics] Failed to flush client analytics batch: ${response.status}`);
        }
      } catch (error) {
        clientAnalyticsRuntimeDependencies.error("[Analytics] Failed to flush client analytics batch", error);
      }
    })
  );
}

function scheduleClientAnalyticsFlush(): void {
  if (pendingClientAnalyticsEvents.length >= CLIENT_ANALYTICS_FLUSH_SIZE) {
    void flushClientAnalyticsEvents();
    return;
  }

  if (pendingClientAnalyticsTimer) {
    return;
  }

  pendingClientAnalyticsTimer = clientAnalyticsRuntimeDependencies.setTimeout(() => {
    pendingClientAnalyticsTimer = null;
    void flushClientAnalyticsEvents();
  }, CLIENT_ANALYTICS_FLUSH_DELAY_MS);
}

export function emitClientAnalyticsEvent<Name extends AnalyticsEventName>(
  name: Name,
  context: ClientAnalyticsContext,
  payload: Parameters<typeof createAnalyticsEvent<Name>>[1]["payload"]
): AnalyticsEvent<Name> {
  const event = createAnalyticsEvent(name, {
    ...(context.at ? { at: context.at } : {}),
    playerId: context.playerId,
    source: "cocos-client",
    sessionId: context.sessionId,
    platform: context.platform ?? "wechat",
    ...(context.roomId ? { roomId: context.roomId } : {}),
    payload
  });

  if (!shouldEmitClientAnalytics()) {
    return event;
  }

  pendingClientAnalyticsEvents.push({
    endpoint: `${resolveCocosApiBaseUrl(context.remoteUrl)}/api/analytics/events`,
    event
  });
  scheduleClientAnalyticsFlush();
  return event;
}

export function flushClientAnalyticsEventsForTest(): Promise<void> {
  return flushClientAnalyticsEvents();
}

interface PrimaryClientTelemetryContext {
  roomId: string;
  playerId: string;
  heroId?: string | null;
  at?: string;
}

interface PrimaryClientTelemetryDraft {
  category: PrimaryClientTelemetryEvent["category"];
  checkpoint: string;
  status: PrimaryClientTelemetryStatus;
  detail: string;
  battleId?: string;
  battleKind?: "neutral" | "hero";
  result?: "attacker_victory" | "defender_victory";
  reason?: string;
  slot?: EquipmentType;
  equipmentId?: string;
  equipmentName?: string;
  itemCount?: number;
  level?: number;
  experienceGained?: number;
  levelsGained?: number;
  skillPointsAwarded?: number;
}

export function appendPrimaryClientTelemetry(
  entries: PrimaryClientTelemetryEvent[],
  next: PrimaryClientTelemetryEvent | PrimaryClientTelemetryEvent[] | null | undefined
): PrimaryClientTelemetryEvent[] {
  const incoming = Array.isArray(next) ? next : next ? [next] : [];
  if (incoming.length === 0) {
    return entries;
  }

  return [...incoming.reverse(), ...entries].slice(0, PRIMARY_CLIENT_TELEMETRY_LIMIT);
}

export function createPrimaryClientTelemetryEvent(
  context: PrimaryClientTelemetryContext,
  draft: PrimaryClientTelemetryDraft
): PrimaryClientTelemetryEvent {
  return {
    at: context.at ?? new Date().toISOString(),
    category: draft.category,
    checkpoint: draft.checkpoint,
    status: draft.status,
    detail: draft.detail,
    roomId: context.roomId,
    playerId: context.playerId,
    ...(context.heroId ? { heroId: context.heroId } : {}),
    ...(draft.battleId ? { battleId: draft.battleId } : {}),
    ...(draft.battleKind ? { battleKind: draft.battleKind } : {}),
    ...(draft.result ? { result: draft.result } : {}),
    ...(draft.reason ? { reason: draft.reason } : {}),
    ...(draft.slot ? { slot: draft.slot } : {}),
    ...(draft.equipmentId ? { equipmentId: draft.equipmentId } : {}),
    ...(draft.equipmentName ? { equipmentName: draft.equipmentName } : {}),
    ...(draft.itemCount != null ? { itemCount: draft.itemCount } : {}),
    ...(draft.level != null ? { level: draft.level } : {}),
    ...(draft.experienceGained != null ? { experienceGained: draft.experienceGained } : {}),
    ...(draft.levelsGained != null ? { levelsGained: draft.levelsGained } : {}),
    ...(draft.skillPointsAwarded != null ? { skillPointsAwarded: draft.skillPointsAwarded } : {})
  };
}

export function buildPrimaryClientTelemetryFromUpdate(
  update: SessionUpdate,
  context: PrimaryClientTelemetryContext
): PrimaryClientTelemetryEvent[] {
  const hero = update.world.ownHeroes[0] ?? null;
  const nextHeroId = hero?.id ?? context.heroId ?? null;
  const nextContext: PrimaryClientTelemetryContext = nextHeroId
    ? {
        ...context,
        heroId: nextHeroId
      }
    : context;
  const entries: PrimaryClientTelemetryEvent[] = [];

  for (const event of update.events) {
    const entry = mapWorldEventToTelemetry(event, nextContext, hero?.loadout.inventory.length ?? undefined);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function mapWorldEventToTelemetry(
  event: WorldEvent,
  context: PrimaryClientTelemetryContext,
  itemCount?: number
): PrimaryClientTelemetryEvent | null {
  switch (event.type) {
    case "hero.progressed":
      return createPrimaryClientTelemetryEvent({ ...context, heroId: event.heroId }, {
        category: "progression",
        checkpoint: "hero.progressed",
        status: "success",
        detail:
          event.levelsGained > 0
            ? `Hero reached level ${event.level} with XP +${event.experienceGained}.`
            : `Hero gained XP +${event.experienceGained}.`,
        battleId: event.battleId,
        battleKind: event.battleKind,
        level: event.level,
        experienceGained: event.experienceGained,
        levelsGained: event.levelsGained,
        skillPointsAwarded: event.skillPointsAwarded
      });
    case "hero.equipmentChanged":
      return createPrimaryClientTelemetryEvent({ ...context, heroId: event.heroId }, {
        category: "inventory",
        checkpoint: event.equippedItemId ? "equipment.equipped" : "equipment.unequipped",
        status: "success",
        detail: event.equippedItemId
          ? `Equipment committed on ${event.slot} slot.`
          : `Equipment removed from ${event.slot} slot.`,
        slot: event.slot,
        ...(event.equippedItemId || event.unequippedItemId
          ? { equipmentId: event.equippedItemId ?? event.unequippedItemId }
          : {}),
        ...(itemCount != null ? { itemCount } : {})
      });
    case "hero.equipmentFound":
      return createPrimaryClientTelemetryEvent({ ...context, heroId: event.heroId }, {
        category: "inventory",
        checkpoint: event.overflowed ? "loot.overflowed" : "loot.collected",
        status: event.overflowed ? "blocked" : "success",
        detail: event.overflowed
          ? `Loot ${event.equipmentName} could not be stored because inventory is full.`
          : `Loot ${event.equipmentName} added to inventory.`,
        battleId: event.battleId,
        battleKind: event.battleKind,
        equipmentId: event.equipmentId,
        equipmentName: event.equipmentName,
        ...(itemCount != null ? { itemCount } : {})
      });
    case "battle.started":
      return createPrimaryClientTelemetryEvent({ ...context, heroId: event.heroId }, {
        category: "combat",
        checkpoint: "encounter.started",
        status: "info",
        detail: `Battle ${event.battleId} started against ${event.encounterKind}.`,
        battleId: event.battleId,
        battleKind: event.encounterKind
      });
    case "battle.resolved":
      return createPrimaryClientTelemetryEvent({ ...context, heroId: event.heroId }, {
        category: "combat",
        checkpoint: "encounter.resolved",
        status: "success",
        detail: `Battle ${event.battleId} resolved as ${event.result}.`,
        battleId: event.battleId,
        ...("battleKind" in event && (event.battleKind === "neutral" || event.battleKind === "hero")
          ? { battleKind: event.battleKind }
          : {}),
        result: event.result
      });
    default:
      return null;
  }
}
