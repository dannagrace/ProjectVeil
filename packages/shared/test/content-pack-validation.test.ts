import assert from "node:assert/strict";
import test from "node:test";
import {
  getBattleBalanceConfig,
  getDefaultBattleSkillCatalog,
  getDefaultMapObjectsConfig,
  getDefaultUnitCatalog,
  getDefaultWorldConfig,
  validateContentPackConsistency
} from "../src/index.ts";

test("content-pack validation passes for the default runtime bundle", () => {
  const report = validateContentPackConsistency({
    world: getDefaultWorldConfig(),
    mapObjects: getDefaultMapObjectsConfig(),
    units: getDefaultUnitCatalog(),
    battleSkills: getDefaultBattleSkillCatalog(),
    battleBalance: getBattleBalanceConfig()
  });

  assert.equal(report.valid, true);
  assert.equal(report.issueCount, 0);
});

test("content-pack validation reports broken cross-file references clearly", () => {
  const world = getDefaultWorldConfig();
  world.heroes[0] = {
    ...world.heroes[0],
    armyTemplateId: "missing_hero_template"
  };

  const mapObjects = getDefaultMapObjectsConfig();
  mapObjects.neutralArmies[0] = {
    ...mapObjects.neutralArmies[0],
    stacks: [{ templateId: "missing_neutral_template", count: 4 }]
  };

  const units = getDefaultUnitCatalog();
  units.templates[0] = {
    ...units.templates[0],
    battleSkills: ["missing_skill"]
  };

  const battleBalance = {
    ...getBattleBalanceConfig(),
    environment: {
      ...getBattleBalanceConfig().environment,
      trapGrantedStatusId: "missing_status"
    }
  };

  const report = validateContentPackConsistency({
    world,
    mapObjects,
    units,
    battleSkills: getDefaultBattleSkillCatalog(),
    battleBalance
  });

  assert.equal(report.valid, false);
  assert.deepEqual(
    report.issues.map((issue) => `${issue.documentId}:${issue.path}`),
    [
      "world:heroes[0].armyTemplateId",
      "mapObjects:neutralArmies[0].stacks[0].templateId",
      "units:templates[0].battleSkills[0]",
      "battleBalance:environment.trapGrantedStatusId"
    ]
  );
});
