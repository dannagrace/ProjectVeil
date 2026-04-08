import assert from "node:assert/strict";
import test from "node:test";
import {
  getBattleBalanceConfig,
  getDefaultBattleSkillCatalog,
  getDefaultHeroSkillTreeConfig,
  getDefaultMapObjectsConfig,
  getDefaultUnitCatalog,
  getDefaultWorldConfig,
  replaceRuntimeConfigs,
  resetRuntimeConfigs,
  setHeroSkillTreeConfig,
  setWorldConfig,
  validateHeroSkillTreeConfig
} from "../src/index.ts";

test("validateHeroSkillTreeConfig reports the exact hero skill path for battle skill references", () => {
  const heroSkills = getDefaultHeroSkillTreeConfig();
  heroSkills.skills[0]!.ranks[0]!.battleSkillIds = ["missing_skill"];

  assert.throws(
    () => validateHeroSkillTreeConfig(heroSkills, getDefaultBattleSkillCatalog()),
    /skills\[0\]\.ranks\[0\]\.battleSkillIds\[0\]: Hero skill .* references unknown battle skill missing_skill/
  );
});

test("setWorldConfig rejects learned skills missing from the runtime hero skill tree", () => {
  const world = getDefaultWorldConfig();
  world.heroes[0] = {
    ...world.heroes[0]!,
    learnedSkills: [{ skillId: "missing_skill", rank: 1 }]
  };

  assert.throws(
    () => setWorldConfig(world),
    /heroes\[0\]\.learnedSkills\[0\]\.skillId: Hero .* references unknown hero skill missing_skill/
  );

  resetRuntimeConfigs();
});

test("setHeroSkillTreeConfig rejects trees that invalidate the runtime world", () => {
  const world = getDefaultWorldConfig();
  world.heroes[0] = {
    ...world.heroes[0]!,
    progression: {
      ...(world.heroes[0]!.progression ?? {}),
      level: 2
    },
    learnedSkills: [{ skillId: "war_banner", rank: 1 }]
  };
  setWorldConfig(world);

  const heroSkills = getDefaultHeroSkillTreeConfig();
  heroSkills.skills[0] = {
    ...heroSkills.skills[0]!,
    requiredLevel: 9999
  };

  assert.throws(
    () => setHeroSkillTreeConfig(heroSkills),
    /heroes\[0\]\.learnedSkills\[0\]: Hero .* is level .* but war_banner requires level 9999/
  );

  resetRuntimeConfigs();
});

test("replaceRuntimeConfigs validates world and hero skill cross-file references together", () => {
  const world = getDefaultWorldConfig();
  world.heroes[0] = {
    ...world.heroes[0]!,
    learnedSkills: [{ skillId: "war_banner", rank: 1 }]
  };
  const heroSkills = getDefaultHeroSkillTreeConfig();
  heroSkills.skills[0] = {
    ...heroSkills.skills[0]!,
    requiredLevel: 9999
  };

  assert.throws(
    () =>
      replaceRuntimeConfigs({
        world,
        mapObjects: getDefaultMapObjectsConfig(),
        units: getDefaultUnitCatalog(),
        battleSkills: getDefaultBattleSkillCatalog(),
        battleBalance: getBattleBalanceConfig(),
        heroSkills
      }),
    /heroes\[0\]\.learnedSkills\[0\]: Hero .* is level .* but war_banner requires level 9999/
  );

  resetRuntimeConfigs();
});
