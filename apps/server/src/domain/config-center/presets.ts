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
import type { BattleBalanceConfig, BattleSkillCatalogConfig, MapObjectsConfig, UnitCatalogConfig, WorldGenerationConfig } from "@veil/shared/models";
import { getDefaultMapObjectsConfig, getDefaultWorldConfig } from "@veil/shared/world";
import type { ConfigDocumentId, ConfigPresetSummary } from "@server/domain/config-center/types";
import {
  BUILTIN_DIFFICULTY_PRESET_IDS,
  BUILTIN_MAP_OBJECT_LAYOUT_PRESETS,
  BUILTIN_WORLD_LAYOUT_PRESETS
} from "@server/domain/config-center/constants";
import { normalizeJsonContent } from "@server/domain/config-center/helpers";
import { parseConfigDocument } from "@server/domain/config-center/preview";

export function buildBuiltinPresetSummary(id: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]): ConfigPresetSummary {
  const title = id === "easy" ? "Easy" : id === "normal" ? "Normal" : "Hard";
  const description =
    id === "easy"
      ? "下调敌对压力并提高资源/生存冗余。"
      : id === "normal"
        ? "恢复默认强度，用于基线平衡。"
        : "提高数值压力，便于验证高难玩法。";

  return {
    id,
    name: title,
    kind: "builtin",
    updatedAt: new Date(0).toISOString(),
    description
  };
}

export function applyWorldPreset(config: WorldGenerationConfig, presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]): WorldGenerationConfig {
  if (presetId === "normal") {
    return structuredClone(config);
  }

  const heroStatScale = presetId === "easy" ? 1.15 : 0.9;
  const armyScale = presetId === "easy" ? 1.25 : 0.85;
  const resourceScale = presetId === "easy" ? 1.2 : 0.85;
  const moveDelta = presetId === "easy" ? 1 : -1;

  return {
    ...structuredClone(config),
    heroes: config.heroes.map((hero) => ({
      ...hero,
      armyCount: Math.max(1, Math.round(hero.armyCount * armyScale)),
      move: {
        total: Math.max(1, hero.move.total + moveDelta),
        remaining: Math.max(0, Math.min(hero.move.total + moveDelta, hero.move.remaining + moveDelta))
      },
      stats: {
        ...hero.stats,
        attack: Math.max(1, Math.round(hero.stats.attack * heroStatScale)),
        defense: Math.max(1, Math.round(hero.stats.defense * heroStatScale)),
        power: Math.max(0, Math.round(hero.stats.power * heroStatScale)),
        knowledge: Math.max(0, Math.round(hero.stats.knowledge * heroStatScale)),
        hp: Math.max(1, Math.round(hero.stats.hp * heroStatScale)),
        maxHp: Math.max(1, Math.round(hero.stats.maxHp * heroStatScale))
      }
    })),
    resourceSpawn: {
      goldChance: Math.min(1, Math.max(0, config.resourceSpawn.goldChance * resourceScale)),
      woodChance: Math.min(1, Math.max(0, config.resourceSpawn.woodChance * resourceScale)),
      oreChance: Math.min(1, Math.max(0, config.resourceSpawn.oreChance * resourceScale))
    }
  };
}

export function applyMapObjectsPreset(config: MapObjectsConfig, presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]): MapObjectsConfig {
  if (presetId === "normal") {
    return structuredClone(config);
  }

  const enemyScale = presetId === "easy" ? 0.8 : 1.2;
  const rewardScale = presetId === "easy" ? 1.25 : 0.85;

  return {
    ...structuredClone(config),
    neutralArmies: config.neutralArmies.map((army) => ({
      ...army,
      reward: army.reward ? { ...army.reward, amount: Math.max(1, Math.round(army.reward.amount * rewardScale)) } : army.reward,
      stacks: army.stacks.map((stack) => ({
        ...stack,
        count: Math.max(1, Math.round(stack.count * enemyScale))
      }))
    })),
    guaranteedResources: config.guaranteedResources.map((resource) => ({
      ...resource,
      resource: {
        ...resource.resource,
        amount: Math.max(1, Math.round(resource.resource.amount * rewardScale))
      }
    })),
    buildings: config.buildings.map((building) => {
      if (building.kind === "recruitment_post") {
        return {
          ...building,
          recruitCount: Math.max(1, Math.round(building.recruitCount * rewardScale))
        };
      }

      if (building.kind === "attribute_shrine") {
        return {
          ...building,
          bonus: {
            attack: Math.max(0, Math.round(building.bonus.attack * rewardScale)),
            defense: Math.max(0, Math.round(building.bonus.defense * rewardScale)),
            power: Math.max(0, Math.round(building.bonus.power * rewardScale)),
            knowledge: Math.max(0, Math.round(building.bonus.knowledge * rewardScale))
          }
        };
      }

      if (building.kind === "watchtower") {
        return {
          ...building,
          visionBonus: Math.max(1, Math.round(building.visionBonus * rewardScale))
        };
      }

      return {
        ...building,
        income: Math.max(1, Math.round(building.income * rewardScale))
      };
    })
  };
}

export function applyUnitPreset(config: UnitCatalogConfig, presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]): UnitCatalogConfig {
  if (presetId === "normal") {
    return structuredClone(config);
  }

  const scale = presetId === "easy" ? 0.9 : 1.1;

  return {
    ...structuredClone(config),
    templates: config.templates.map((template) => ({
      ...template,
      initiative: Math.max(1, Math.round(template.initiative * scale)),
      attack: Math.max(1, Math.round(template.attack * scale)),
      defense: Math.max(1, Math.round(template.defense * scale)),
      minDamage: Math.max(1, Math.round(template.minDamage * scale)),
      maxDamage: Math.max(1, Math.round(template.maxDamage * scale)),
      maxHp: Math.max(1, Math.round(template.maxHp * scale))
    }))
  };
}

export function applyBattleSkillPreset(
  config: BattleSkillCatalogConfig,
  presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]
): BattleSkillCatalogConfig {
  if (presetId === "normal") {
    return structuredClone(config);
  }

  const cooldownDelta = presetId === "easy" ? -1 : 1;
  const effectScale = presetId === "easy" ? 0.9 : 1.1;

  return {
    ...structuredClone(config),
    skills: config.skills.map((skill) => ({
      ...skill,
      cooldown: skill.kind === "passive" ? 0 : Math.max(0, skill.cooldown + cooldownDelta),
      ...(skill.effects == null
        ? {}
        : {
            effects: {
              ...skill.effects,
              ...(skill.effects.damageMultiplier != null
                ? {
                    damageMultiplier: Math.max(0.1, Number((skill.effects.damageMultiplier * effectScale).toFixed(2)))
                  }
                : {})
            }
          })
    })),
    statuses: config.statuses.map((status) => ({
      ...status,
      duration: Math.max(1, status.duration + cooldownDelta),
      attackModifier: Math.round(status.attackModifier * effectScale),
      defenseModifier: Math.round(status.defenseModifier * effectScale),
      damagePerTurn: Math.max(0, Math.round(status.damagePerTurn * effectScale))
    }))
  };
}

export function clampThreshold(value: number): number {
  return Number(value.toFixed(2));
}

export function applyBattleBalancePreset(
  config: BattleBalanceConfig,
  presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]
): BattleBalanceConfig {
  if (presetId === "normal") {
    return structuredClone(config);
  }

  const easier = presetId === "easy";

  return {
    damage: {
      defendingDefenseBonus: config.damage.defendingDefenseBonus + (easier ? -1 : 1),
      offenseAdvantageStep: Number((config.damage.offenseAdvantageStep * (easier ? 0.92 : 1.08)).toFixed(3)),
      minimumOffenseMultiplier: Number(
        Math.max(0.1, config.damage.minimumOffenseMultiplier * (easier ? 1.05 : 0.9)).toFixed(2)
      ),
      varianceBase: Number(config.damage.varianceBase.toFixed(2)),
      varianceRange: Number(Math.max(0, config.damage.varianceRange * (easier ? 0.9 : 1.1)).toFixed(2))
    },
    environment: {
      blockerSpawnThreshold: clampThreshold(
        Math.min(1, Math.max(0, config.environment.blockerSpawnThreshold + (easier ? 0.08 : -0.08)))
      ),
      blockerDurability: Math.max(1, config.environment.blockerDurability + (easier ? -1 : 1)),
      trapSpawnThreshold: clampThreshold(
        Math.min(1, Math.max(0, config.environment.trapSpawnThreshold + (easier ? 0.08 : -0.08)))
      ),
      trapDamage: Math.max(0, config.environment.trapDamage + (easier ? -1 : 1)),
      trapCharges: Math.max(1, config.environment.trapCharges + (easier ? -1 : 1)),
      ...(config.environment.trapGrantedStatusId
        ? { trapGrantedStatusId: config.environment.trapGrantedStatusId }
        : {})
    },
    turnTimerSeconds: config.turnTimerSeconds,
    afkStrikesBeforeForfeit: config.afkStrikesBeforeForfeit,
    pvp: {
      eloK: Math.max(1, config.pvp.eloK + (easier ? -4 : 4))
    }
  };
}

export function applyBuiltinPresetToContent(
  id: ConfigDocumentId,
  content: string,
  presetId: typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]
): string {
  if (id === "leaderboardTierThresholds") {
    return content;
  }

  const parsed = parseConfigDocument(id, content);
  const next =
    id === "world"
      ? applyWorldPreset(parsed as WorldGenerationConfig, presetId)
      : id === "mapObjects"
        ? applyMapObjectsPreset(parsed as MapObjectsConfig, presetId)
        : id === "units"
          ? applyUnitPreset(parsed as UnitCatalogConfig, presetId)
          : id === "battleSkills"
            ? applyBattleSkillPreset(parsed as BattleSkillCatalogConfig, presetId)
            : applyBattleBalancePreset(parsed as BattleBalanceConfig, presetId);

  return normalizeJsonContent(next);
}

export function buildLayoutPresetSummary(id: typeof BUILTIN_WORLD_LAYOUT_PRESETS[number]): ConfigPresetSummary {
  const name =
    id === "layout_frontier_basin"
      ? "Frontier Basin"
      : id === "layout_stonewatch_fork"
        ? "Stonewatch Fork"
      : id === "layout_ridgeway_crossing"
        ? "Ridgeway Crossing"
      : id === "layout_highland_reach"
        ? "Highland Reach"
      : id === "layout_amber_fields"
        ? "Amber Fields"
      : id === "layout_ironpass_gorge"
        ? "Ironpass Gorge"
      : id === "layout_splitrock_canyon"
        ? "Splitrock Canyon"
      : id === "layout_contested_basin"
        ? "Contested Basin"
      : id === "layout_phase2_frontier_expanded"
        ? "Phase 2 Frontier Expanded"
        : "Phase 1";
  const description =
    id === "layout_frontier_basin"
      ? "切换为首个峡谷盆地布局，适合验证水域与矿点分布。"
      : id === "layout_stonewatch_fork"
        ? "切换为石望岔路布局，适合验证双招募点、分叉矿线与南北奖励节奏。"
      : id === "layout_ridgeway_crossing"
        ? "切换为第二个 Phase 1 岭桥布局，适合验证中央渡口争夺、双招募点和木矿/矿井分流。"
      : id === "layout_highland_reach"
        ? "切换为高地平原布局，适合验证大尺寸对称开阔地与中央高台争夺。"
      : id === "layout_amber_fields"
        ? "切换为琥珀田布局，适合验证多资源点分布与中路高地争夺。"
      : id === "layout_ironpass_gorge"
        ? "切换为铁关峡谷布局，适合验证狭窄通道、峡口守军与双侧矿线。"
      : id === "layout_splitrock_canyon"
        ? "切换为裂岩峡谷布局，适合验证非对称出生点与双线路径压迫。"
      : id === "layout_contested_basin"
        ? "切换为争夺盆地布局，包含新巡逻守军与瞭望塔。"
      : id === "layout_phase2_frontier_expanded"
        ? "切换为 Phase 2 Frontier Expanded 32×32 布局，适合验证大地图分块渲染、Boss 阶段切换与新建筑/中立怪组合。"
        : "恢复默认 Phase 1 地图布局。";

  return {
    id,
    name,
    kind: "builtin",
    updatedAt: new Date(0).toISOString(),
    description
  };
}

export function getBuiltinPresetSummaries(id: ConfigDocumentId): ConfigPresetSummary[] {
  if (id === "leaderboardTierThresholds") {
    return [];
  }

  const summaries = BUILTIN_DIFFICULTY_PRESET_IDS.map((presetId) => buildBuiltinPresetSummary(presetId));
  if (id === "world") {
    summaries.push(...BUILTIN_WORLD_LAYOUT_PRESETS.map((presetId) => buildLayoutPresetSummary(presetId)));
  }
  if (id === "mapObjects") {
    summaries.push(...BUILTIN_MAP_OBJECT_LAYOUT_PRESETS.map((presetId) => buildLayoutPresetSummary(presetId)));
  }
  return summaries;
}

export function resolveBuiltinPresetContent(id: ConfigDocumentId, currentContent: string, presetId: string): string | null {
  if (id === "leaderboardTierThresholds") {
    return null;
  }

  if (BUILTIN_DIFFICULTY_PRESET_IDS.includes(presetId as typeof BUILTIN_DIFFICULTY_PRESET_IDS[number])) {
    return applyBuiltinPresetToContent(
      id,
      currentContent,
      presetId as typeof BUILTIN_DIFFICULTY_PRESET_IDS[number]
    );
  }

  if (id === "world") {
    if (presetId === "layout_phase1") {
      return normalizeJsonContent(getDefaultWorldConfig());
    }
    if (presetId === "layout_frontier_basin") {
      return normalizeJsonContent(frontierBasinWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_stonewatch_fork") {
      return normalizeJsonContent(stonewatchForkWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_ridgeway_crossing") {
      return normalizeJsonContent(ridgewayCrossingWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_highland_reach") {
      return normalizeJsonContent(highlandReachWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_amber_fields") {
      return normalizeJsonContent(amberFieldsWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_ironpass_gorge") {
      return normalizeJsonContent(ironpassGorgeWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_splitrock_canyon") {
      return normalizeJsonContent(splitrockCanyonWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_contested_basin") {
      return normalizeJsonContent(contestedBasinWorldConfig as WorldGenerationConfig);
    }
    if (presetId === "layout_phase2_frontier_expanded") {
      return normalizeJsonContent(frontierExpandedWorldConfig as WorldGenerationConfig);
    }
  }

  if (id === "mapObjects") {
    if (presetId === "layout_phase1") {
      return normalizeJsonContent(getDefaultMapObjectsConfig());
    }
    if (presetId === "layout_frontier_basin") {
      return normalizeJsonContent(frontierBasinMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_stonewatch_fork") {
      return normalizeJsonContent(stonewatchForkMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_ridgeway_crossing") {
      return normalizeJsonContent(ridgewayCrossingMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_highland_reach") {
      return normalizeJsonContent(highlandReachMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_amber_fields") {
      return normalizeJsonContent(amberFieldsMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_ironpass_gorge") {
      return normalizeJsonContent(ironpassGorgeMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_splitrock_canyon") {
      return normalizeJsonContent(splitrockCanyonMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_contested_basin") {
      return normalizeJsonContent(contestedBasinMapObjectsConfig as MapObjectsConfig);
    }
    if (presetId === "layout_phase2_frontier_expanded") {
      return normalizeJsonContent(frontierExpandedMapObjectsConfig as MapObjectsConfig);
    }
  }

  return null;
}

