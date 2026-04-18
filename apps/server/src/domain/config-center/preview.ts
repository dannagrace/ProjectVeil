import amberFieldsMapObjectsConfig from "../../../../../configs/phase1-map-objects-amber-fields.json";
import amberFieldsWorldConfig from "../../../../../configs/phase1-world-amber-fields.json";
import frontierBasinMapObjectsConfig from "../../../../../configs/phase1-map-objects-frontier-basin.json";
import frontierBasinWorldConfig from "../../../../../configs/phase1-world-frontier-basin.json";
import highlandReachMapObjectsConfig from "../../../../../configs/phase1-map-objects-highland-reach.json";
import highlandReachWorldConfig from "../../../../../configs/phase1-world-highland-reach.json";
import ironpassGorgeMapObjectsConfig from "../../../../../configs/phase1-map-objects-ironpass-gorge.json";
import ironpassGorgeWorldConfig from "../../../../../configs/phase1-world-ironpass-gorge.json";
import splitrockCanyonMapObjectsConfig from "../../../../../configs/phase1-map-objects-splitrock-canyon.json";
import splitrockCanyonWorldConfig from "../../../../../configs/phase1-world-splitrock-canyon.json";
import stonewatchForkMapObjectsConfig from "../../../../../configs/phase1-map-objects-stonewatch-fork.json";
import stonewatchForkWorldConfig from "../../../../../configs/phase1-world-stonewatch-fork.json";
import ridgewayCrossingMapObjectsConfig from "../../../../../configs/phase1-map-objects-ridgeway-crossing.json";
import ridgewayCrossingWorldConfig from "../../../../../configs/phase1-world-ridgeway-crossing.json";
import contestedBasinMapObjectsConfig from "../../../../../configs/phase2-map-objects-contested-basin.json";
import contestedBasinWorldConfig from "../../../../../configs/phase2-contested-basin.json";
import frontierExpandedMapObjectsConfig from "../../../../../configs/phase2-map-objects-frontier-expanded.json";
import frontierExpandedWorldConfig from "../../../../../configs/phase2-frontier-expanded.json";
import {
  createWorldStateFromConfigs,
  getBattleBalanceConfig,
  getDefaultBattleBalanceConfig,
  getDefaultBattleSkillCatalog,
  getDefaultMapObjectsConfig,
  getDefaultUnitCatalog,
  getDefaultWorldConfig,
  validateBattleBalanceConfig,
  validateBattleSkillCatalog,
  validateMapObjectsConfig,
  validateUnitCatalog,
  validateWorldConfig,
  type BattleBalanceConfig,
  type BattleSkillCatalogConfig,
  type MapObjectsConfig,
  type ResourceKind,
  type RuntimeConfigBundle,
  type TerrainType,
  type UnitCatalogConfig,
  type WorldGenerationConfig
} from "../../../../../packages/shared/src/index";
import {
  parseLeaderboardTierThresholdsConfigDocument,
  type LeaderboardTierThresholdsConfigDocument
} from "../../leaderboard-tier-thresholds";
import type {
  ConfigDocumentId,
  ParsedConfigDocument,
  RuntimeConfigDocumentId,
  WorldConfigPreview,
  WorldConfigPreviewTile
} from "./types";
import {
  createResourceCountRecord,
  createTerrainCountRecord,
  normalizePreviewSeed,
  positionKey
} from "./helpers";
import { buildRuntimeConfigBundle } from "./runtime";

export function parseConfigDocument(
  id: ConfigDocumentId,
  content: string
): ParsedConfigDocument {
  if (id === "leaderboardTierThresholds") {
    return parseLeaderboardTierThresholdsConfigDocument(content);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error("Config content is not valid JSON");
  }

  if (id === "world") {
    const nextWorld = parsed as WorldGenerationConfig;
    validateWorldConfig(nextWorld);
    return nextWorld;
  }

  if (id === "mapObjects") {
    return parsed as MapObjectsConfig;
  }

  if (id === "units") {
    const nextCatalog = parsed as UnitCatalogConfig;
    validateUnitCatalog(nextCatalog);
    return nextCatalog;
  }

  if (id === "battleSkills") {
    const nextSkillCatalog = parsed as BattleSkillCatalogConfig;
    validateBattleSkillCatalog(nextSkillCatalog);
    return nextSkillCatalog;
  }

  const nextBattleBalance = parsed as BattleBalanceConfig;
  validateBattleBalanceConfig(nextBattleBalance);
  return nextBattleBalance;
}

export function buildRuntimeBundleWithParsedDocument(id: RuntimeConfigDocumentId, parsed: ParsedConfigDocument): RuntimeConfigBundle {
  switch (id) {
    case "world":
      return buildRuntimeConfigBundle({ world: parsed as WorldGenerationConfig });
    case "mapObjects":
      return buildRuntimeConfigBundle({ mapObjects: parsed as MapObjectsConfig });
    case "units":
      return buildRuntimeConfigBundle({ units: parsed as UnitCatalogConfig });
    case "battleSkills":
      return buildRuntimeConfigBundle({ battleSkills: parsed as BattleSkillCatalogConfig });
    case "battleBalance":
      return buildRuntimeConfigBundle({ battleBalance: parsed as BattleBalanceConfig });
  }
}

export function contentForDocumentId(bundle: RuntimeConfigBundle, id: RuntimeConfigDocumentId): ParsedConfigDocument {
  switch (id) {
    case "world":
      return bundle.world;
    case "mapObjects":
      return bundle.mapObjects;
    case "units":
      return bundle.units;
    case "battleSkills":
      return bundle.battleSkills;
    case "battleBalance":
      return bundle.battleBalance ?? getBattleBalanceConfig();
  }
}

export function createWorldConfigPreview(
  worldConfig: WorldGenerationConfig,
  mapObjectsConfig: MapObjectsConfig,
  seed = 1001
): WorldConfigPreview {
  const normalizedSeed = normalizePreviewSeed(seed);
  const previewState = createWorldStateFromConfigs(worldConfig, mapObjectsConfig, normalizedSeed, "config-preview");
  const heroById = new Map(previewState.heroes.map((hero) => [hero.id, hero]));
  const guaranteedResourceKeys = new Set(
    mapObjectsConfig.guaranteedResources.map((resource) => positionKey(resource.position))
  );
  const terrainCounts = createTerrainCountRecord();
  const resourceTileCounts = createResourceCountRecord();
  const resourceAmountTotals = createResourceCountRecord();
  let walkableCount = 0;
  let blockedCount = 0;
  let guaranteedResourceCount = 0;
  let randomResourceCount = 0;

  const tiles: WorldConfigPreviewTile[] = previewState.map.tiles.map((tile) => {
    terrainCounts[tile.terrain] += 1;
    if (tile.walkable) {
      walkableCount += 1;
    } else {
      blockedCount += 1;
    }

    const resourceSource = tile.resource
      ? guaranteedResourceKeys.has(positionKey(tile.position))
        ? "guaranteed"
        : "random"
      : undefined;
    if (tile.resource) {
      resourceTileCounts[tile.resource.kind] += 1;
      resourceAmountTotals[tile.resource.kind] += tile.resource.amount;
      if (resourceSource === "guaranteed") {
        guaranteedResourceCount += 1;
      } else {
        randomResourceCount += 1;
      }
    }

    let occupant: WorldConfigPreviewTile["occupant"];
    if (tile.occupant?.kind === "hero") {
      const hero = heroById.get(tile.occupant.refId);
      occupant = {
        kind: "hero",
        refId: tile.occupant.refId,
        label: hero?.name ?? tile.occupant.refId,
        ...(hero ? { playerId: hero.playerId } : {})
      };
    } else if (tile.occupant?.kind === "neutral") {
      occupant = {
        kind: "neutral",
        refId: tile.occupant.refId,
        label: `中立 ${tile.occupant.refId}`
      };
    }

    const building = !tile.building
      ? undefined
      : tile.building.kind === "recruitment_post"
        ? {
            kind: tile.building.kind,
            refId: tile.building.id,
            label: tile.building.label,
            unitTemplateId: tile.building.unitTemplateId,
            availableCount: tile.building.availableCount
          }
        : tile.building.kind === "attribute_shrine"
          ? {
              kind: tile.building.kind,
              refId: tile.building.id,
              label: tile.building.label,
              bonus: {
                attack: tile.building.bonus.attack,
                defense: tile.building.bonus.defense,
                power: tile.building.bonus.power,
                knowledge: tile.building.bonus.knowledge
              },
              ...(typeof tile.building.lastUsedDay === "number" ? { lastUsedDay: tile.building.lastUsedDay } : {})
            }
          : tile.building.kind === "resource_mine"
            ? {
              kind: tile.building.kind,
              refId: tile.building.id,
              label: tile.building.label,
              resourceKind: tile.building.resourceKind,
              income: tile.building.income,
              ...(typeof tile.building.lastHarvestDay === "number"
                ? { lastHarvestDay: tile.building.lastHarvestDay }
                : {})
            }
            : {
              kind: tile.building.kind,
              refId: tile.building.id,
              label: tile.building.label,
              visionBonus: tile.building.visionBonus,
              ...(typeof tile.building.lastUsedDay === "number" ? { lastUsedDay: tile.building.lastUsedDay } : {})
            };

    return {
      position: tile.position,
      terrain: tile.terrain,
      walkable: tile.walkable,
      ...(tile.resource
        ? {
            resource: {
              ...tile.resource,
              source: resourceSource ?? "random"
            }
          }
        : {}),
      ...(building ? { building } : {}),
      ...(occupant ? { occupant } : {})
    };
  });

  return {
    seed: normalizedSeed,
    roomId: previewState.meta.roomId,
    width: previewState.map.width,
    height: previewState.map.height,
    counts: {
      walkable: walkableCount,
      blocked: blockedCount,
      terrain: terrainCounts,
      resourceTiles: resourceTileCounts,
      resourceAmounts: resourceAmountTotals,
      guaranteedResources: guaranteedResourceCount,
      randomResources: randomResourceCount,
      heroes: previewState.heroes.length,
      neutralArmies: Object.keys(previewState.neutralArmies).length,
      buildings: Object.keys(previewState.buildings).length
    },
    tiles
  };
}

