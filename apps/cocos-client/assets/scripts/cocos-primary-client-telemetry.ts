import type { PrimaryClientTelemetryEvent, PrimaryClientTelemetryStatus } from "../../../../packages/shared/src/index.ts";
import type { SessionUpdate, WorldEvent } from "./VeilCocosSession.ts";
import type { EquipmentType } from "./project-shared/index.ts";

const PRIMARY_CLIENT_TELEMETRY_LIMIT = 12;

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
