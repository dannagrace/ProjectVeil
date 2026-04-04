import type { HeroState } from "./project-shared/models.ts";
import type { RuntimeConfigBundle } from "./project-shared/world-config.ts";
import { createHeroSkillTreeView } from "./project-shared/hero-skills.ts";
import type { HeroView } from "./VeilCocosSession.ts";

const SKILL_POINT_COST = 1;

export interface LobbySkillPanelAction {
  skillId: string;
  label: string;
  canLearn: boolean;
  cost: number;
}

export interface LobbySkillPanelSkillView {
  skillId: string;
  name: string;
  currentRank: number;
  maxRank: number;
  nextRank: number | null;
  canLearn: boolean;
  summary: string;
}

export interface LobbySkillPanelBranchView {
  id: string;
  name: string;
  skills: LobbySkillPanelSkillView[];
}

export interface LobbySkillPanelView {
  heroName: string;
  level: number;
  availableSkillPoints: number;
  branches: LobbySkillPanelBranchView[];
  actions: LobbySkillPanelAction[];
}

function createBattleSkillLabelMap(bundle: RuntimeConfigBundle): Map<string, string> {
  return new Map(bundle.battleSkills.skills.map((skill) => [skill.id, skill.name] as const));
}

function formatNextRankSummary(
  nextRank: number | null,
  nextDescription: string | undefined,
  nextGrantedBattleSkillLabels: string[]
): string {
  if (!nextRank) {
    return "已满级";
  }

  const detail = nextDescription?.trim() || "可提升当前长期技能效果。";
  const unlockLabel = nextGrantedBattleSkillLabels.length > 0
    ? ` · 解锁 ${nextGrantedBattleSkillLabels.join(" / ")}`
    : "";
  return `R${nextRank} · ${detail}${unlockLabel}`;
}

function buildActionLabel(skillName: string, nextRank: number | null): string {
  if (!nextRank || nextRank <= 1) {
    return `学习 ${skillName}`;
  }
  return `升级 ${skillName} R${nextRank}`;
}

export function toLobbySkillPanelHeroState(hero: HeroView): HeroState {
  const loadout = hero.loadout ?? {
    learnedSkills: [],
    equipment: {
      trinketIds: []
    },
    inventory: []
  };
  return {
    id: hero.id,
    playerId: hero.playerId,
    name: hero.name,
    position: { ...hero.position },
    vision: hero.vision,
    move: { ...hero.move },
    stats: { ...hero.stats },
    progression: { ...hero.progression },
    loadout: {
      learnedSkills: loadout.learnedSkills.map((skill) => ({ ...skill })),
      equipment: {
        ...loadout.equipment,
        trinketIds: [...loadout.equipment.trinketIds]
      },
      inventory: [...loadout.inventory]
    },
    armyTemplateId: hero.armyTemplateId,
    armyCount: hero.armyCount,
    learnedSkills: hero.learnedSkills.map((skill) => ({ ...skill }))
  };
}

export function buildLobbySkillPanelView(hero: HeroState, bundle: RuntimeConfigBundle): LobbySkillPanelView {
  const tree = createHeroSkillTreeView(hero);
  const battleSkillNames = createBattleSkillLabelMap(bundle);

  return {
    heroName: hero.name,
    level: hero.progression.level,
    availableSkillPoints: tree.availableSkillPoints,
    branches: tree.branches.map((branch) => ({
      id: branch.id,
      name: branch.name,
      skills: branch.skills.map((skill) => ({
        skillId: skill.id,
        name: skill.name,
        currentRank: skill.currentRank,
        maxRank: skill.maxRank,
        nextRank: skill.nextRank,
        canLearn: skill.canLearn,
        summary: formatNextRankSummary(
          skill.nextRank,
          skill.ranks.find((rank) => rank.rank === skill.nextRank)?.description,
          skill.nextGrantedBattleSkillIds.map((battleSkillId) => battleSkillNames.get(battleSkillId) ?? battleSkillId)
        )
      }))
    })),
    actions: tree.branches.flatMap((branch) =>
      branch.skills.map((skill) => ({
        skillId: skill.id,
        label: buildActionLabel(skill.name, skill.nextRank),
        canLearn: skill.canLearn,
        cost: SKILL_POINT_COST
      }))
    )
  };
}
