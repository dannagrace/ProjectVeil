import type {
  BattleSkillCatalogConfig,
  HeroLearnedSkillState,
  HeroSkillTreeConfig,
  HeroAttributeBonuses,
  WorldGenerationConfig
} from "./models.ts";

export type CrossFileConfigDocumentId = "world" | "heroSkills";

export interface CrossFileConfigIssue {
  documentId: CrossFileConfigDocumentId;
  path: string;
  code: string;
  message: string;
}

export class CrossFileConfigValidationError extends Error {
  readonly issue: CrossFileConfigIssue;

  constructor(issue: CrossFileConfigIssue) {
    super(`${issue.path}: ${issue.message}`);
    this.name = "CrossFileConfigValidationError";
    this.issue = issue;
  }
}

interface HeroSkillReference {
  requiredLevel: number;
  maxRank: number;
  prerequisites: string[];
}

function pushIssue(
  issues: CrossFileConfigIssue[],
  issue: CrossFileConfigIssue
): void {
  issues.push(issue);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function createHeroSkillIndex(config: HeroSkillTreeConfig): Map<string, HeroSkillReference> {
  return new Map(
    (config.skills ?? []).flatMap((skill) =>
      isNonEmptyString(skill?.id)
        ? [
            [
              skill.id,
              {
                requiredLevel: skill.requiredLevel,
                maxRank: skill.maxRank,
                prerequisites: [...(skill.prerequisites ?? [])]
              }
            ] as const
          ]
        : []
    )
  );
}

function validateHeroSkillStatBonuses(
  bonuses: Partial<HeroAttributeBonuses> | undefined,
  path: string,
  issues: CrossFileConfigIssue[]
): void {
  if (!bonuses) {
    return;
  }

  const allowedKeys = new Set(["attack", "defense", "power", "knowledge", "maxHp"]);
  for (const [key, value] of Object.entries(bonuses)) {
    const bonusPath = `${path}.${key}`;
    if (!allowedKeys.has(key)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: bonusPath,
        code: "unknown_hero_skill_stat_bonus",
        message: `Unknown hero skill stat bonus key ${key}.`
      });
      continue;
    }
    if (!isNonNegativeInteger(value)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: bonusPath,
        code: "hero_skill_stat_bonus_invalid",
        message: `Hero skill stat bonus ${key} must be a non-negative integer.`
      });
    }
  }
}

export function validateHeroSkillTreeCrossReferences(
  config: HeroSkillTreeConfig,
  battleSkillCatalog: BattleSkillCatalogConfig
): CrossFileConfigIssue[] {
  const issues: CrossFileConfigIssue[] = [];

  if (!Array.isArray(config.branches)) {
    pushIssue(issues, {
      documentId: "heroSkills",
      path: "branches",
      code: "hero_skill_branches_missing",
      message: "Hero skill tree config must contain a branches array."
    });
  }
  if (!Array.isArray(config.skills)) {
    pushIssue(issues, {
      documentId: "heroSkills",
      path: "skills",
      code: "hero_skill_skills_missing",
      message: "Hero skill tree config must contain a skills array."
    });
  }
  if (issues.length > 0) {
    return issues;
  }

  const branchIds = new Set<string>();
  for (const [branchIndex, branch] of config.branches.entries()) {
    const branchPath = `branches[${branchIndex}]`;
    if (!isNonEmptyString(branch.id)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${branchPath}.id`,
        code: "hero_skill_branch_id_missing",
        message: "Hero skill branch id must be a non-empty string."
      });
      continue;
    }
    if (branchIds.has(branch.id)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${branchPath}.id`,
        code: "duplicate_hero_skill_branch_id",
        message: `Duplicate hero skill branch id ${branch.id}.`
      });
    }
    if (!isNonEmptyString(branch.name)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${branchPath}.name`,
        code: "hero_skill_branch_name_missing",
        message: `Hero skill branch ${branch.id} must define a name.`
      });
    }
    if (!isNonEmptyString(branch.description)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${branchPath}.description`,
        code: "hero_skill_branch_description_missing",
        message: `Hero skill branch ${branch.id} must define a description.`
      });
    }
    branchIds.add(branch.id);
  }

  const battleSkillIds = new Set((battleSkillCatalog.skills ?? []).map((skill) => skill.id));
  const skillIds = new Set<string>();
  const prerequisiteIndex = new Map<string, Array<{ prerequisite: string; path: string }>>();

  for (const [skillIndex, skill] of config.skills.entries()) {
    const skillPath = `skills[${skillIndex}]`;
    if (!isNonEmptyString(skill.id)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${skillPath}.id`,
        code: "hero_skill_id_missing",
        message: "Hero skill id must be a non-empty string."
      });
      continue;
    }
    if (skillIds.has(skill.id)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${skillPath}.id`,
        code: "duplicate_hero_skill_id",
        message: `Duplicate hero skill id ${skill.id}.`
      });
    }
    if (!branchIds.has(skill.branchId)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${skillPath}.branchId`,
        code: "unknown_hero_skill_branch",
        message: `Hero skill ${skill.id} references unknown branch ${String(skill.branchId)}.`
      });
    }
    if (!isNonEmptyString(skill.name)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${skillPath}.name`,
        code: "hero_skill_name_missing",
        message: `Hero skill ${skill.id} must define a name.`
      });
    }
    if (!isNonEmptyString(skill.description)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${skillPath}.description`,
        code: "hero_skill_description_missing",
        message: `Hero skill ${skill.id} must define a description.`
      });
    }
    if (!isPositiveInteger(skill.requiredLevel)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${skillPath}.requiredLevel`,
        code: "hero_skill_required_level_invalid",
        message: `Hero skill ${skill.id} requiredLevel must be a positive integer.`
      });
    }
    if (!isPositiveInteger(skill.maxRank)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${skillPath}.maxRank`,
        code: "hero_skill_max_rank_invalid",
        message: `Hero skill ${skill.id} maxRank must be a positive integer.`
      });
    }
    if (!Array.isArray(skill.ranks) || skill.ranks.length !== skill.maxRank) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${skillPath}.ranks`,
        code: "hero_skill_rank_count_mismatch",
        message: `Hero skill ${skill.id} must define exactly ${skill.maxRank} rank entries.`
      });
    }

    const rankIds = new Set<number>();
    for (const [rankIndex, rank] of (skill.ranks ?? []).entries()) {
      const rankPath = `${skillPath}.ranks[${rankIndex}]`;
      if (!isPositiveInteger(rank.rank) || rank.rank > skill.maxRank) {
        pushIssue(issues, {
          documentId: "heroSkills",
          path: `${rankPath}.rank`,
          code: "hero_skill_rank_invalid",
          message: `Hero skill ${skill.id} rank must be between 1 and ${skill.maxRank}.`
        });
      }
      if (rankIds.has(rank.rank)) {
        pushIssue(issues, {
          documentId: "heroSkills",
          path: `${rankPath}.rank`,
          code: "duplicate_hero_skill_rank",
          message: `Hero skill ${skill.id} has duplicate rank entry ${rank.rank}.`
        });
      }
      if (!isNonEmptyString(rank.description)) {
        pushIssue(issues, {
          documentId: "heroSkills",
          path: `${rankPath}.description`,
          code: "hero_skill_rank_description_missing",
          message: `Hero skill ${skill.id} rank ${rank.rank} must define a description.`
        });
      }
      validateHeroSkillStatBonuses(rank.statBonuses, `${rankPath}.statBonuses`, issues);
      for (const [battleSkillIndex, battleSkillId] of (rank.battleSkillIds ?? []).entries()) {
        if (!battleSkillIds.has(battleSkillId)) {
          pushIssue(issues, {
            documentId: "heroSkills",
            path: `${rankPath}.battleSkillIds[${battleSkillIndex}]`,
            code: "unknown_hero_skill_battle_skill",
            message: `Hero skill ${skill.id} rank ${rank.rank} references unknown battle skill ${battleSkillId}.`
          });
        }
      }
      rankIds.add(rank.rank);
    }

    if (skill.prerequisites !== undefined && !Array.isArray(skill.prerequisites)) {
      pushIssue(issues, {
        documentId: "heroSkills",
        path: `${skillPath}.prerequisites`,
        code: "hero_skill_prerequisites_invalid",
        message: `Hero skill ${skill.id} prerequisites must be an array when provided.`
      });
    }

    prerequisiteIndex.set(
      skill.id,
      (Array.isArray(skill.prerequisites) ? skill.prerequisites : []).map((prerequisite, prerequisiteIndexValue) => ({
        prerequisite,
        path: `${skillPath}.prerequisites[${prerequisiteIndexValue}]`
      }))
    );

    skillIds.add(skill.id);
  }

  for (const [skillId, prerequisites] of prerequisiteIndex.entries()) {
    for (const prerequisiteEntry of prerequisites) {
      if (!skillIds.has(prerequisiteEntry.prerequisite)) {
        pushIssue(issues, {
          documentId: "heroSkills",
          path: prerequisiteEntry.path,
          code: "unknown_hero_skill_prerequisite",
          message: `Hero skill ${skillId} references unknown prerequisite ${prerequisiteEntry.prerequisite}.`
        });
      }
      if (prerequisiteEntry.prerequisite === skillId) {
        pushIssue(issues, {
          documentId: "heroSkills",
          path: prerequisiteEntry.path,
          code: "hero_skill_self_prerequisite",
          message: `Hero skill ${skillId} cannot depend on itself.`
        });
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];

  const detectCycles = (skillId: string): void => {
    if (visited.has(skillId) || visiting.has(skillId)) {
      return;
    }

    visiting.add(skillId);
    stack.push(skillId);
    for (const prerequisiteEntry of prerequisiteIndex.get(skillId) ?? []) {
      if (!skillIds.has(prerequisiteEntry.prerequisite) || prerequisiteEntry.prerequisite === skillId) {
        continue;
      }
      if (visiting.has(prerequisiteEntry.prerequisite)) {
        const cycleStart = stack.indexOf(prerequisiteEntry.prerequisite);
        const cycle = [...stack.slice(cycleStart), prerequisiteEntry.prerequisite].join(" -> ");
        pushIssue(issues, {
          documentId: "heroSkills",
          path: prerequisiteEntry.path,
          code: "hero_skill_prerequisite_cycle",
          message: `Hero skill prerequisite cycle detected: ${cycle}.`
        });
        continue;
      }
      detectCycles(prerequisiteEntry.prerequisite);
    }
    stack.pop();
    visiting.delete(skillId);
    visited.add(skillId);
  };

  for (const skillId of skillIds) {
    detectCycles(skillId);
  }

  return issues;
}

function validateLearnedSkillEntry(
  learnedSkill: HeroLearnedSkillState,
  heroPath: string,
  heroId: string,
  heroLevel: number,
  heroSkillIndex: Map<string, HeroSkillReference>,
  seenSkillIds: Set<string>,
  issues: CrossFileConfigIssue[]
): learnedSkill is HeroLearnedSkillState & { skillId: string; rank: number } {
  const skillId = learnedSkill?.skillId?.trim();
  if (!skillId) {
    pushIssue(issues, {
      documentId: "world",
      path: `${heroPath}.skillId`,
      code: "hero_skill_id_missing",
      message: `Hero ${heroId} learned skill entry is missing a skill id.`
    });
    return false;
  }

  if (!isPositiveInteger(learnedSkill.rank)) {
    pushIssue(issues, {
      documentId: "world",
      path: `${heroPath}.rank`,
      code: "hero_skill_rank_invalid",
      message: `Hero ${heroId} learned skill ${skillId} rank must be a positive integer.`
    });
    return false;
  }

  if (seenSkillIds.has(skillId)) {
    pushIssue(issues, {
      documentId: "world",
      path: `${heroPath}.skillId`,
      code: "duplicate_hero_learned_skill",
      message: `Hero ${heroId} learns ${skillId} more than once.`
    });
  }
  seenSkillIds.add(skillId);

  const skill = heroSkillIndex.get(skillId);
  if (!skill) {
    pushIssue(issues, {
      documentId: "world",
      path: `${heroPath}.skillId`,
      code: "hero_skill_missing",
      message: `Hero ${heroId} references unknown hero skill ${skillId}.`
    });
    return false;
  }

  if (learnedSkill.rank > skill.maxRank) {
    pushIssue(issues, {
      documentId: "world",
      path: `${heroPath}.rank`,
      code: "hero_skill_rank_exceeds_max",
      message: `Hero ${heroId} sets ${skillId} to rank ${learnedSkill.rank}, but the skill only supports rank ${skill.maxRank}.`
    });
  }

  if (heroLevel < skill.requiredLevel) {
    pushIssue(issues, {
      documentId: "world",
      path: heroPath,
      code: "hero_skill_level_too_low",
      message: `Hero ${heroId} is level ${heroLevel} but ${skillId} requires level ${skill.requiredLevel}.`
    });
  }

  return true;
}

export function validateWorldHeroSkillReferences(
  world: WorldGenerationConfig,
  heroSkillTree: HeroSkillTreeConfig
): CrossFileConfigIssue[] {
  const issues: CrossFileConfigIssue[] = [];
  const heroSkillIndex = createHeroSkillIndex(heroSkillTree);

  world.heroes.forEach((hero, heroIndex) => {
    const learnedSkillRanks = new Map<string, number>();
    const seenSkillIds = new Set<string>();
    const heroLevel = hero.progression?.level ?? 1;

    for (const [skillIndex, learnedSkill] of (hero.learnedSkills ?? []).entries()) {
      const learnedSkillPath = `heroes[${heroIndex}].learnedSkills[${skillIndex}]`;
      if (
        !validateLearnedSkillEntry(
          learnedSkill,
          learnedSkillPath,
          hero.id,
          heroLevel,
          heroSkillIndex,
          seenSkillIds,
          issues
        )
      ) {
        continue;
      }
      learnedSkillRanks.set(learnedSkill.skillId, learnedSkill.rank);
    }

    for (const [skillIndex, learnedSkill] of (hero.learnedSkills ?? []).entries()) {
      const definition = learnedSkill?.skillId ? heroSkillIndex.get(learnedSkill.skillId) : undefined;
      if (!definition) {
        continue;
      }
      const missingPrerequisite = definition.prerequisites.find((prerequisite) => (learnedSkillRanks.get(prerequisite) ?? 0) <= 0);
      if (missingPrerequisite) {
        pushIssue(issues, {
          documentId: "world",
          path: `heroes[${heroIndex}].learnedSkills[${skillIndex}].skillId`,
          code: "hero_skill_prerequisite_missing",
          message: `Hero ${hero.id} learns ${learnedSkill.skillId} without prerequisite ${missingPrerequisite}.`
        });
      }
    }
  });

  return issues;
}

export function assertNoCrossFileConfigIssues(issues: CrossFileConfigIssue[]): void {
  const firstIssue = issues[0];
  if (firstIssue) {
    throw new CrossFileConfigValidationError(firstIssue);
  }
}
