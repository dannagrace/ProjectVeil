import { createHeroEquipmentBonusSummary } from "./equipment";
import type { HeroState, PlayerWorldView } from "./models";
import { experienceRequiredForNextLevel, totalExperienceRequiredForLevel } from "./models";

export interface HeroProgressMeterView {
  level: number;
  totalExperience: number;
  currentLevelExperience: number;
  nextLevelExperience: number;
  remainingExperience: number;
  progressRatio: number;
}

export type HeroAttributeKey = "attack" | "defense" | "power" | "knowledge" | "maxHp";

export interface HeroAttributeBreakdownRow {
  key: HeroAttributeKey;
  label: string;
  total: number;
  base: number;
  progression: number;
  buildings: number;
  equipment: number;
  skills: number;
  other: number;
  formula: string;
}

interface HeroAttributeSourceSet {
  progression: Record<HeroAttributeKey, number>;
  buildings: Record<HeroAttributeKey, number>;
  equipment: Record<HeroAttributeKey, number>;
  skills: Record<HeroAttributeKey, number>;
}

const ATTRIBUTE_ROWS: Array<{ key: HeroAttributeKey; label: string }> = [
  { key: "attack", label: "攻击" },
  { key: "defense", label: "防御" },
  { key: "power", label: "力量" },
  { key: "knowledge", label: "知识" },
  { key: "maxHp", label: "生命上限" }
];

function createEmptyAttributeValues(): Record<HeroAttributeKey, number> {
  return {
    attack: 0,
    defense: 0,
    power: 0,
    knowledge: 0,
    maxHp: 0
  };
}

function heroTotalForKey(hero: Pick<HeroState, "stats">, key: HeroAttributeKey): number {
  return key === "maxHp" ? hero.stats.maxHp : hero.stats[key];
}

function buildProgressionContribution(hero: Pick<HeroState, "progression">): Record<HeroAttributeKey, number> {
  const gainedLevels = Math.max(0, Math.floor(hero.progression.level) - 1);
  return {
    attack: gainedLevels,
    defense: gainedLevels,
    power: 0,
    knowledge: 0,
    maxHp: gainedLevels * 2
  };
}

function buildBuildingContribution(
  world: Pick<PlayerWorldView, "map"> | null | undefined,
  heroId: string
): Record<HeroAttributeKey, number> {
  const totals = createEmptyAttributeValues();
  if (!world) {
    return totals;
  }

  for (const tile of world.map.tiles) {
    if (tile.building?.kind !== "attribute_shrine" || !tile.building.visitedHeroIds.includes(heroId)) {
      continue;
    }

    totals.attack += tile.building.bonus.attack;
    totals.defense += tile.building.bonus.defense;
    totals.power += tile.building.bonus.power;
    totals.knowledge += tile.building.bonus.knowledge;
  }

  return totals;
}

function formatContribution(label: string, value: number): string {
  return `${label}${value >= 0 ? ` +${value}` : ` ${value}`}`;
}

export function createHeroProgressMeterView(
  hero: Pick<HeroState, "progression">
): HeroProgressMeterView {
  const currentLevelBase = totalExperienceRequiredForLevel(hero.progression.level);
  const currentLevelExperience = Math.max(0, hero.progression.experience - currentLevelBase);
  const nextLevelExperience = Math.max(1, experienceRequiredForNextLevel(hero.progression.level));
  const remainingExperience = Math.max(0, nextLevelExperience - currentLevelExperience);

  return {
    level: hero.progression.level,
    totalExperience: hero.progression.experience,
    currentLevelExperience,
    nextLevelExperience,
    remainingExperience,
    progressRatio: Math.max(0, Math.min(1, currentLevelExperience / nextLevelExperience))
  };
}

export function createHeroAttributeBreakdown(
  hero: Pick<HeroState, "id" | "stats" | "progression" | "loadout">,
  world?: Pick<PlayerWorldView, "map"> | null
): HeroAttributeBreakdownRow[] {
  const equipment = createHeroEquipmentBonusSummary(hero);
  const sources: HeroAttributeSourceSet = {
    progression: buildProgressionContribution(hero),
    buildings: buildBuildingContribution(world, hero.id),
    equipment: {
      attack: equipment.attack,
      defense: equipment.defense,
      power: equipment.power,
      knowledge: equipment.knowledge,
      maxHp: equipment.maxHp
    },
    skills: createEmptyAttributeValues()
  };

  return ATTRIBUTE_ROWS.map(({ key, label }) => {
    const total = heroTotalForKey(hero, key) + sources.equipment[key];
    const progression = sources.progression[key];
    const buildings = sources.buildings[key];
    const equipment = sources.equipment[key];
    const skills = sources.skills[key];
    const knownBonuses = progression + buildings + equipment + skills;
    const base = Math.max(0, total - knownBonuses);
    const other = total - base - knownBonuses;
    const parts = [
      `${label} ${total} = 基础 ${base}`,
      progression !== 0 ? formatContribution("成长", progression) : "",
      buildings !== 0 ? formatContribution("建筑", buildings) : "",
      equipment !== 0 ? formatContribution("装备", equipment) : "",
      skills !== 0 ? formatContribution("技能", skills) : "",
      other !== 0 ? formatContribution("其他", other) : ""
    ].filter(Boolean);

    return {
      key,
      label,
      total,
      base,
      progression,
      buildings,
      equipment,
      skills,
      other,
      formula: parts.join(" ")
    };
  });
}
