import { createHeroSkillTreeView } from "./project-shared/hero-skills.ts";
import type { BattleSkillId, HeroState } from "./project-shared/models.ts";
import { getDefaultBattleSkillCatalog } from "./project-shared/world-config.ts";
import type { HeroView, SessionUpdate } from "./VeilCocosSession.ts";

const SKILL_POINT_COST = 1;

export interface CocosHudSkillPanelAction {
  skillId: string;
  label: string;
  onSelect: (() => void) | null;
}

export interface CocosHudSkillPanelView {
  lines: string[];
  actions: CocosHudSkillPanelAction[];
}

interface LearnableHudSkill {
  id: string;
  name: string;
  branchName: string;
  nextRank: number | null;
  grantedBattleSkillLabels: string[];
}

const battleSkillNameById = new Map<BattleSkillId, string>(
  getDefaultBattleSkillCatalog().skills.map((skill) => [skill.id, skill.name])
);

export function toHudHeroSkillState(hero: HeroView): HeroState {
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
      learnedSkills: hero.loadout.learnedSkills.map((skill) => ({ ...skill })),
      equipment: {
        ...hero.loadout.equipment,
        trinketIds: [...hero.loadout.equipment.trinketIds]
      },
      inventory: [...hero.loadout.inventory]
    },
    armyTemplateId: hero.armyTemplateId,
    armyCount: hero.armyCount,
    learnedSkills: hero.learnedSkills.map((skill) => ({ ...skill }))
  };
}

function listLearnableHeroSkills(hero: HeroView | null): LearnableHudSkill[] {
  if (!hero) {
    return [];
  }

  const tree = createHeroSkillTreeView(toHudHeroSkillState(hero));
  return tree.branches.flatMap((branch) =>
    branch.skills
      .filter((skill) => skill.canLearn)
      .map((skill) => ({
        id: skill.id,
        name: skill.name,
        branchName: branch.name,
        nextRank: skill.nextRank,
        grantedBattleSkillLabels: skill.nextGrantedBattleSkillIds.map(
          (battleSkillId) => battleSkillNameById.get(battleSkillId) ?? battleSkillId
        )
      }))
  );
}

function formatLearnableSkillLine(skill: LearnableHudSkill): string {
  const rankLabel = skill.nextRank && skill.nextRank > 1 ? ` R${skill.nextRank}` : "";
  const unlockLabel = skill.grantedBattleSkillLabels.length > 0
    ? ` · 解锁 ${skill.grantedBattleSkillLabels.join(" / ")}`
    : "";
  return `${skill.name}${rankLabel} · ${skill.branchName} · 消耗 ${SKILL_POINT_COST} 技能点${unlockLabel}`;
}

export function buildCocosHudSkillPanelView(
  update: SessionUpdate | null,
  onLearnSkill?: (skillId: string) => void
): CocosHudSkillPanelView {
  const hero = update?.world.ownHeroes[0] ?? null;

  if (!hero) {
    return {
      lines: ["学习新技能", "等待房间状态..."],
      actions: []
    };
  }

  const learnableSkills = listLearnableHeroSkills(hero);
  if (learnableSkills.length === 0) {
    return {
      lines: hero.progression.skillPoints > 0
        ? ["学习新技能", "当前没有满足等级或前置要求的技能。"]
        : ["学习新技能", "英雄升级后获得技能点，可在这里学习新的战斗能力。"],
      actions: []
    };
  }

  return {
    lines: [
      `学习新技能  ${learnableSkills.length} 项`,
      ...learnableSkills.map(formatLearnableSkillLine)
    ],
    actions: learnableSkills.map((skill) => ({
      skillId: skill.id,
      label: `学习 ${skill.name}`,
      onSelect: onLearnSkill ? () => onLearnSkill(skill.id) : null
    }))
  };
}
