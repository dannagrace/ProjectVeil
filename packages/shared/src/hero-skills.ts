import type {
  HeroAttributeBonuses,
  BattleSkillId,
  HeroSkillBranchConfig,
  HeroSkillConfig,
  HeroSkillRankConfig,
  HeroSkillTreeConfig,
  HeroState,
  ValidationResult
} from "./models.ts";
import { normalizeHeroState } from "./models.ts";
import { getDefaultHeroSkillTreeConfig } from "./world-config.ts";

export interface HeroSkillRankView extends HeroSkillRankConfig {
  unlocked: boolean;
}

export interface HeroSkillView {
  id: string;
  branchId: string;
  branchName: string;
  tier: number;
  name: string;
  description: string;
  requiredLevel: number;
  prerequisites: string[];
  currentRank: number;
  maxRank: number;
  nextRank: number | null;
  canLearn: boolean;
  reason?: string;
  grantedBattleSkillIds: BattleSkillId[];
  nextGrantedBattleSkillIds: BattleSkillId[];
  grantedStatBonuses: HeroAttributeBonuses;
  nextGrantedStatBonuses: HeroAttributeBonuses;
  ranks: HeroSkillRankView[];
}

export interface HeroSkillTierView {
  tier: number;
  requiredLevel: number;
  skills: HeroSkillView[];
}

export interface HeroSkillBranchView {
  id: string;
  name: string;
  description: string;
  skills: HeroSkillView[];
  tiers: HeroSkillTierView[];
}

export interface HeroSkillTreeView {
  availableSkillPoints: number;
  branches: HeroSkillBranchView[];
}

export interface HeroSkillSelectionResult {
  hero: HeroState;
  skill: HeroSkillConfig;
  branch: HeroSkillBranchConfig;
  newRank: number;
  newlyGrantedBattleSkillIds: BattleSkillId[];
}

function clampRank(skill: HeroSkillConfig, rank: number): number {
  return Math.max(0, Math.min(Math.floor(rank), skill.maxRank));
}

function rankConfigFor(skill: HeroSkillConfig, rank: number): HeroSkillRankConfig | null {
  return skill.ranks.find((item) => item.rank === rank) ?? null;
}

function battleSkillIdsGrantedAtRank(skill: HeroSkillConfig, rank: number): BattleSkillId[] {
  return [...new Set(rankConfigFor(skill, rank)?.battleSkillIds ?? [])];
}

function createEmptyHeroAttributeBonuses(): HeroAttributeBonuses {
  return {
    attack: 0,
    defense: 0,
    power: 0,
    knowledge: 0,
    maxHp: 0
  };
}

function numericBonus(value: number | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function statBonusesGrantedAtRank(skill: HeroSkillConfig, rank: number): HeroAttributeBonuses {
  const bonuses = rankConfigFor(skill, rank)?.statBonuses;
  return {
    attack: numericBonus(bonuses?.attack),
    defense: numericBonus(bonuses?.defense),
    power: numericBonus(bonuses?.power),
    knowledge: numericBonus(bonuses?.knowledge),
    maxHp: numericBonus(bonuses?.maxHp)
  };
}

function addHeroAttributeBonuses(
  base: HeroAttributeBonuses,
  delta: HeroAttributeBonuses
): HeroAttributeBonuses {
  return {
    attack: base.attack + delta.attack,
    defense: base.defense + delta.defense,
    power: base.power + delta.power,
    knowledge: base.knowledge + delta.knowledge,
    maxHp: base.maxHp + delta.maxHp
  };
}

function subtractHeroAttributeBonuses(
  left: HeroAttributeBonuses,
  right: HeroAttributeBonuses
): HeroAttributeBonuses {
  return {
    attack: left.attack - right.attack,
    defense: left.defense - right.defense,
    power: left.power - right.power,
    knowledge: left.knowledge - right.knowledge,
    maxHp: left.maxHp - right.maxHp
  };
}

function accumulatedStatBonuses(skill: HeroSkillConfig, rank: number): HeroAttributeBonuses {
  let bonuses = createEmptyHeroAttributeBonuses();
  const clampedRank = clampRank(skill, rank);

  for (let currentRank = 1; currentRank <= clampedRank; currentRank += 1) {
    bonuses = addHeroAttributeBonuses(bonuses, statBonusesGrantedAtRank(skill, currentRank));
  }

  return bonuses;
}

function accumulatedBattleSkillIds(skill: HeroSkillConfig, rank: number): BattleSkillId[] {
  const grantedSkillIds = new Set<BattleSkillId>();
  const clampedRank = clampRank(skill, rank);

  for (let currentRank = 1; currentRank <= clampedRank; currentRank += 1) {
    for (const battleSkillId of battleSkillIdsGrantedAtRank(skill, currentRank)) {
      grantedSkillIds.add(battleSkillId);
    }
  }

  return [...grantedSkillIds];
}

export function heroSkillRankFor(
  hero: HeroState,
  skillId: string
): number {
  return (hero.learnedSkills ?? []).find((skill) => skill.skillId === skillId)?.rank ?? 0;
}

function indexHeroSkillTree(config: HeroSkillTreeConfig): {
  branchById: Map<string, HeroSkillBranchConfig>;
  skillById: Map<string, HeroSkillConfig>;
} {
  return {
    branchById: new Map(config.branches.map((branch) => [branch.id, branch])),
    skillById: new Map(config.skills.map((skill) => [skill.id, skill]))
  };
}

export function validateHeroSkillSelection(
  hero: HeroState,
  skillId: string,
  config: HeroSkillTreeConfig = getDefaultHeroSkillTreeConfig()
): ValidationResult {
  const { branchById, skillById } = indexHeroSkillTree(config);
  const skill = skillById.get(skillId);
  if (!skill) {
    return { valid: false, reason: "hero_skill_not_found" };
  }

  if (!branchById.has(skill.branchId)) {
    return { valid: false, reason: "hero_skill_branch_not_found" };
  }

  if ((hero.progression.skillPoints ?? 0) <= 0) {
    return { valid: false, reason: "not_enough_skill_points" };
  }

  if (hero.progression.level < skill.requiredLevel) {
    return { valid: false, reason: "hero_level_too_low" };
  }

  const currentRank = heroSkillRankFor(hero, skillId);
  if (currentRank >= skill.maxRank) {
    return { valid: false, reason: "skill_max_rank_reached" };
  }

  for (const prerequisite of skill.prerequisites ?? []) {
    if (heroSkillRankFor(hero, prerequisite) <= 0) {
      return { valid: false, reason: "skill_prerequisite_missing" };
    }
  }

  return { valid: true };
}

export function applyHeroSkillSelection(
  hero: HeroState,
  skillId: string,
  config: HeroSkillTreeConfig = getDefaultHeroSkillTreeConfig()
): HeroSkillSelectionResult {
  const validation = validateHeroSkillSelection(hero, skillId, config);
  if (!validation.valid) {
    throw new Error(validation.reason ?? "hero_skill_selection_rejected");
  }

  const { branchById, skillById } = indexHeroSkillTree(config);
  const skill = skillById.get(skillId)!;
  const branch = branchById.get(skill.branchId)!;
  const currentRank = heroSkillRankFor(hero, skillId);
  const newRank = currentRank + 1;
  const previousBattleSkillIds = new Set(accumulatedBattleSkillIds(skill, currentRank));
  const nextBattleSkillIds = accumulatedBattleSkillIds(skill, newRank);
  const previousStatBonuses = accumulatedStatBonuses(skill, currentRank);
  const nextStatBonuses = accumulatedStatBonuses(skill, newRank);
  const gainedStatBonuses = subtractHeroAttributeBonuses(nextStatBonuses, previousStatBonuses);

  const heroWithSkill = normalizeHeroState({
    ...hero,
    stats: {
      ...hero.stats,
      attack: hero.stats.attack + gainedStatBonuses.attack,
      defense: hero.stats.defense + gainedStatBonuses.defense,
      power: hero.stats.power + gainedStatBonuses.power,
      knowledge: hero.stats.knowledge + gainedStatBonuses.knowledge,
      maxHp: hero.stats.maxHp + gainedStatBonuses.maxHp,
      hp: Math.min(hero.stats.maxHp + gainedStatBonuses.maxHp, hero.stats.hp + gainedStatBonuses.maxHp)
    },
    progression: {
      ...hero.progression,
      skillPoints: Math.max(0, (hero.progression.skillPoints ?? 0) - 1)
    },
    learnedSkills: (hero.learnedSkills ?? [])
      .filter((learnedSkill) => learnedSkill.skillId !== skillId)
      .concat({
        skillId,
        rank: newRank
      })
  });

  return {
    hero: heroWithSkill,
    skill,
    branch,
    newRank,
    newlyGrantedBattleSkillIds: nextBattleSkillIds.filter((battleSkillId) => !previousBattleSkillIds.has(battleSkillId))
  };
}

export function grantedHeroBattleSkillIds(
  hero: HeroState,
  config: HeroSkillTreeConfig = getDefaultHeroSkillTreeConfig()
): BattleSkillId[] {
  const { skillById } = indexHeroSkillTree(config);
  const grantedSkillIds = new Set<BattleSkillId>();

  for (const learnedSkill of hero.learnedSkills ?? []) {
    const skill = skillById.get(learnedSkill.skillId);
    if (!skill) {
      continue;
    }

    for (const battleSkillId of accumulatedBattleSkillIds(skill, learnedSkill.rank)) {
      grantedSkillIds.add(battleSkillId);
    }
  }

  return [...grantedSkillIds];
}

export function createHeroSkillBonusSummary(
  hero: Pick<HeroState, "learnedSkills">,
  config: HeroSkillTreeConfig = getDefaultHeroSkillTreeConfig()
): HeroAttributeBonuses {
  const { skillById } = indexHeroSkillTree(config);
  let totals = createEmptyHeroAttributeBonuses();

  for (const learnedSkill of hero.learnedSkills ?? []) {
    const skill = skillById.get(learnedSkill.skillId);
    if (!skill) {
      continue;
    }

    totals = addHeroAttributeBonuses(totals, accumulatedStatBonuses(skill, learnedSkill.rank));
  }

  return totals;
}

export function createHeroSkillTreeView(
  hero: HeroState,
  config: HeroSkillTreeConfig = getDefaultHeroSkillTreeConfig()
): HeroSkillTreeView {
  const { branchById } = indexHeroSkillTree(config);

  return {
    availableSkillPoints: hero.progression.skillPoints ?? 0,
    branches: config.branches.map((branch) => {
      const branchSkills = config.skills.filter((skill) => skill.branchId === branch.id);
      const tierLevels = [...new Set(branchSkills.map((skill) => skill.requiredLevel))].sort((left, right) => left - right);
      const skills = branchSkills.map((skill) => {
        const validation = validateHeroSkillSelection(hero, skill.id, config);
        const currentRank = heroSkillRankFor(hero, skill.id);
        const nextRank = currentRank < skill.maxRank ? currentRank + 1 : null;
        return {
          id: skill.id,
          branchId: skill.branchId,
          branchName: branchById.get(skill.branchId)?.name ?? skill.branchId,
          tier: Math.max(1, tierLevels.indexOf(skill.requiredLevel) + 1),
          name: skill.name,
          description: skill.description,
          requiredLevel: skill.requiredLevel,
          prerequisites: [...(skill.prerequisites ?? [])],
          currentRank,
          maxRank: skill.maxRank,
          nextRank,
          canLearn: validation.valid,
          ...(validation.reason ? { reason: validation.reason } : {}),
          grantedBattleSkillIds: accumulatedBattleSkillIds(skill, currentRank),
          nextGrantedBattleSkillIds: nextRank ? battleSkillIdsGrantedAtRank(skill, nextRank) : [],
          grantedStatBonuses: accumulatedStatBonuses(skill, currentRank),
          nextGrantedStatBonuses: nextRank ? statBonusesGrantedAtRank(skill, nextRank) : createEmptyHeroAttributeBonuses(),
          ranks: skill.ranks
            .slice()
            .sort((left, right) => left.rank - right.rank)
            .map((rank) => ({
              ...rank,
              unlocked: currentRank >= rank.rank
            }))
        };
      });

      return {
        ...branch,
        skills,
        tiers: tierLevels.map((requiredLevel, index) => ({
          tier: index + 1,
          requiredLevel,
          skills: skills.filter((skill) => skill.requiredLevel === requiredLevel)
        }))
      };
    })
  };
}
