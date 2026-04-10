import assert from "node:assert/strict";
import test from "node:test";

import {
  validateBattleBalanceConfig,
  validateBattleSkillCatalog,
  validateBossEncounterTemplateCatalog
} from "../src/world-config.ts";

import type {
  BattleBalanceConfig,
  BattleSkillCatalogConfig,
  BossEncounterTemplateCatalogConfig
} from "../src/models.ts";

// ---------------------------------------------------------------------------
// Helpers to build minimal valid configs
// ---------------------------------------------------------------------------

function makeValidBattleBalanceConfig(): BattleBalanceConfig {
  return {
    damage: {
      defendingDefenseBonus: 0.1,
      offenseAdvantageStep: 0.05,
      minimumOffenseMultiplier: 0.5,
      varianceBase: 1.0,
      varianceRange: 0.2
    },
    environment: {
      blockerSpawnThreshold: 0.3,
      blockerDurability: 2,
      trapSpawnThreshold: 0.1,
      trapDamage: 5,
      trapCharges: 1
    },
    turnTimerSeconds: 30,
    afkStrikesBeforeForfeit: 3,
    pvp: {
      eloK: 32
    }
  };
}

function makeValidBattleSkillCatalog(): BattleSkillCatalogConfig {
  return {
    statuses: [
      {
        id: "burning",
        name: "Burning",
        description: "Takes damage each turn",
        duration: 2,
        attackModifier: 0,
        defenseModifier: 0,
        damagePerTurn: 5
      }
    ],
    skills: [
      {
        id: "fireball",
        name: "Fireball",
        description: "Deals fire damage",
        kind: "active" as const,
        target: "enemy" as const,
        cooldown: 2,
        effects: {}
      }
    ]
  };
}

function makeValidBossEncounterTemplateCatalog(
  battleSkillCatalog: BattleSkillCatalogConfig = makeValidBattleSkillCatalog()
): BossEncounterTemplateCatalogConfig {
  return {
    templates: [
      {
        id: "dragon-boss",
        name: "The Dragon",
        phases: [
          {
            id: "phase-full",
            hpThreshold: 1
          }
        ]
      }
    ]
  };
}

// ---------------------------------------------------------------------------
// validateBattleBalanceConfig
// ---------------------------------------------------------------------------

test("validateBattleBalanceConfig: valid config does not throw", () => {
  assert.doesNotThrow(() => validateBattleBalanceConfig(makeValidBattleBalanceConfig()));
});

test("validateBattleBalanceConfig: non-object config throws", () => {
  assert.throws(
    () => validateBattleBalanceConfig(null as unknown as BattleBalanceConfig),
    /Battle balance config must be an object/
  );
});

test("validateBattleBalanceConfig: missing damage section throws", () => {
  const config = makeValidBattleBalanceConfig();
  delete (config as Partial<BattleBalanceConfig>).damage;
  assert.throws(() => validateBattleBalanceConfig(config), /Battle balance config must define damage/);
});

test("validateBattleBalanceConfig: missing environment section throws", () => {
  const config = makeValidBattleBalanceConfig();
  delete (config as Partial<BattleBalanceConfig>).environment;
  assert.throws(() => validateBattleBalanceConfig(config), /Battle balance config must define environment/);
});

test("validateBattleBalanceConfig: missing pvp section throws", () => {
  const config = makeValidBattleBalanceConfig();
  delete (config as Partial<BattleBalanceConfig>).pvp;
  assert.throws(() => validateBattleBalanceConfig(config), /Battle balance config must define pvp/);
});

test("validateBattleBalanceConfig: turnTimerSeconds of 0 throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.turnTimerSeconds = 0;
  assert.throws(() => validateBattleBalanceConfig(config), /turnTimerSeconds must be a positive integer/);
});

test("validateBattleBalanceConfig: negative turnTimerSeconds throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.turnTimerSeconds = -5;
  assert.throws(() => validateBattleBalanceConfig(config), /turnTimerSeconds must be a positive integer/);
});

test("validateBattleBalanceConfig: afkStrikesBeforeForfeit of 0 throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.afkStrikesBeforeForfeit = 0;
  assert.throws(() => validateBattleBalanceConfig(config), /afkStrikesBeforeForfeit must be a positive integer/);
});

test("validateBattleBalanceConfig: negative afkStrikesBeforeForfeit throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.afkStrikesBeforeForfeit = -1;
  assert.throws(() => validateBattleBalanceConfig(config), /afkStrikesBeforeForfeit must be a positive integer/);
});

test("validateBattleBalanceConfig: blockerSpawnThreshold < 0 throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.environment.blockerSpawnThreshold = -0.1;
  assert.throws(() => validateBattleBalanceConfig(config), /blockerSpawnThreshold must be within/);
});

test("validateBattleBalanceConfig: blockerSpawnThreshold > 1 throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.environment.blockerSpawnThreshold = 1.5;
  assert.throws(() => validateBattleBalanceConfig(config), /blockerSpawnThreshold must be within/);
});

test("validateBattleBalanceConfig: blockerSpawnThreshold of 0 is valid", () => {
  const config = makeValidBattleBalanceConfig();
  config.environment.blockerSpawnThreshold = 0;
  assert.doesNotThrow(() => validateBattleBalanceConfig(config));
});

test("validateBattleBalanceConfig: blockerSpawnThreshold of 1 is valid", () => {
  const config = makeValidBattleBalanceConfig();
  config.environment.blockerSpawnThreshold = 1;
  assert.doesNotThrow(() => validateBattleBalanceConfig(config));
});

test("validateBattleBalanceConfig: pvp.eloK of 0 throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.pvp.eloK = 0;
  assert.throws(() => validateBattleBalanceConfig(config), /pvp\.eloK must be a positive integer/);
});

test("validateBattleBalanceConfig: negative pvp.eloK throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.pvp.eloK = -10;
  assert.throws(() => validateBattleBalanceConfig(config), /pvp\.eloK must be a positive integer/);
});

test("validateBattleBalanceConfig: damage.minimumOffenseMultiplier of 0 throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.damage.minimumOffenseMultiplier = 0;
  assert.throws(() => validateBattleBalanceConfig(config), /damage\.minimumOffenseMultiplier must be > 0/);
});

test("validateBattleBalanceConfig: damage.varianceBase of 0 throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.damage.varianceBase = 0;
  assert.throws(() => validateBattleBalanceConfig(config), /damage\.varianceBase must be > 0/);
});

test("validateBattleBalanceConfig: negative damage.varianceRange throws", () => {
  const config = makeValidBattleBalanceConfig();
  config.damage.varianceRange = -1;
  assert.throws(() => validateBattleBalanceConfig(config), /damage\.varianceRange must be >= 0/);
});

// ---------------------------------------------------------------------------
// validateBattleSkillCatalog
// ---------------------------------------------------------------------------

test("validateBattleSkillCatalog: valid catalog does not throw", () => {
  assert.doesNotThrow(() => validateBattleSkillCatalog(makeValidBattleSkillCatalog()));
});

test("validateBattleSkillCatalog: missing skills array throws", () => {
  const config = makeValidBattleSkillCatalog();
  delete (config as Partial<BattleSkillCatalogConfig>).skills;
  assert.throws(
    () => validateBattleSkillCatalog(config),
    /Battle skill catalog must contain skills and statuses arrays/
  );
});

test("validateBattleSkillCatalog: missing statuses array throws", () => {
  const config = makeValidBattleSkillCatalog();
  delete (config as Partial<BattleSkillCatalogConfig>).statuses;
  assert.throws(
    () => validateBattleSkillCatalog(config),
    /Battle skill catalog must contain skills and statuses arrays/
  );
});

test("validateBattleSkillCatalog: empty skills array throws", () => {
  const config = makeValidBattleSkillCatalog();
  config.skills = [];
  assert.throws(
    () => validateBattleSkillCatalog(config),
    /Battle skill catalog must contain at least one skill/
  );
});

test("validateBattleSkillCatalog: status with empty id throws", () => {
  const config = makeValidBattleSkillCatalog();
  config.statuses[0].id = "";
  assert.throws(() => validateBattleSkillCatalog(config), /Battle status id must be a non-empty string/);
});

test("validateBattleSkillCatalog: duplicate status id throws", () => {
  const config = makeValidBattleSkillCatalog();
  config.statuses.push({ ...config.statuses[0] });
  assert.throws(() => validateBattleSkillCatalog(config), /Duplicate battle status id/);
});

test("validateBattleSkillCatalog: status with zero duration throws", () => {
  const config = makeValidBattleSkillCatalog();
  config.statuses[0].duration = 0;
  assert.throws(() => validateBattleSkillCatalog(config), /must define a positive integer duration/);
});

test("validateBattleSkillCatalog: status with negative damagePerTurn throws", () => {
  const config = makeValidBattleSkillCatalog();
  config.statuses[0].damagePerTurn = -1;
  assert.throws(() => validateBattleSkillCatalog(config), /damagePerTurn must be a non-negative integer/);
});

test("validateBattleSkillCatalog: skill with empty id throws", () => {
  const config = makeValidBattleSkillCatalog();
  config.skills[0].id = "";
  assert.throws(() => validateBattleSkillCatalog(config), /Battle skill id must be a non-empty string/);
});

test("validateBattleSkillCatalog: duplicate skill id throws", () => {
  const config = makeValidBattleSkillCatalog();
  config.skills.push({ ...config.skills[0] });
  assert.throws(() => validateBattleSkillCatalog(config), /Duplicate battle skill id/);
});

test("validateBattleSkillCatalog: skill with invalid kind throws", () => {
  const config = makeValidBattleSkillCatalog();
  (config.skills[0] as { kind: unknown }).kind = "unknown_kind";
  assert.throws(() => validateBattleSkillCatalog(config), /has invalid kind/);
});

test("validateBattleSkillCatalog: skill with invalid target throws", () => {
  const config = makeValidBattleSkillCatalog();
  (config.skills[0] as { target: unknown }).target = "random_target";
  assert.throws(() => validateBattleSkillCatalog(config), /has invalid target/);
});

test("validateBattleSkillCatalog: skill with negative cooldown throws", () => {
  const config = makeValidBattleSkillCatalog();
  config.skills[0].cooldown = -1;
  assert.throws(() => validateBattleSkillCatalog(config), /cooldown must be a non-negative integer/);
});

test("validateBattleSkillCatalog: passive skill with non-zero cooldown throws", () => {
  const config = makeValidBattleSkillCatalog();
  config.skills[0].kind = "passive" as const;
  config.skills[0].cooldown = 1;
  assert.throws(() => validateBattleSkillCatalog(config), /Passive battle skill.*must have cooldown 0/);
});

test("validateBattleSkillCatalog: skill referencing unknown grantedStatusId throws", () => {
  const config = makeValidBattleSkillCatalog();
  config.skills[0].effects = { grantedStatusId: "nonexistent_status" };
  assert.throws(() => validateBattleSkillCatalog(config), /references unknown granted status/);
});

// ---------------------------------------------------------------------------
// validateBossEncounterTemplateCatalog
// ---------------------------------------------------------------------------

test("validateBossEncounterTemplateCatalog: valid catalog does not throw", () => {
  const skills = makeValidBattleSkillCatalog();
  assert.doesNotThrow(() =>
    validateBossEncounterTemplateCatalog(makeValidBossEncounterTemplateCatalog(skills), skills)
  );
});

test("validateBossEncounterTemplateCatalog: empty templates array throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config: BossEncounterTemplateCatalogConfig = { templates: [] };
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /Boss encounter template catalog must contain a non-empty templates array/
  );
});

test("validateBossEncounterTemplateCatalog: non-array templates throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config = { templates: null } as unknown as BossEncounterTemplateCatalogConfig;
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /Boss encounter template catalog must contain a non-empty templates array/
  );
});

test("validateBossEncounterTemplateCatalog: template with empty id throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config = makeValidBossEncounterTemplateCatalog(skills);
  config.templates[0].id = "";
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /Boss encounter template id must be a non-empty string/
  );
});

test("validateBossEncounterTemplateCatalog: duplicate template id throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config = makeValidBossEncounterTemplateCatalog(skills);
  config.templates.push({ ...config.templates[0] });
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /Duplicate boss encounter template id/
  );
});

test("validateBossEncounterTemplateCatalog: template with empty name throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config = makeValidBossEncounterTemplateCatalog(skills);
  config.templates[0].name = "";
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /must define a name/
  );
});

test("validateBossEncounterTemplateCatalog: template with no phases throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config = makeValidBossEncounterTemplateCatalog(skills);
  config.templates[0].phases = [];
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /must define at least one phase/
  );
});

test("validateBossEncounterTemplateCatalog: first phase not starting at hpThreshold 1 throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config = makeValidBossEncounterTemplateCatalog(skills);
  config.templates[0].phases[0].hpThreshold = 0.5;
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /must start with a phase at hpThreshold 1/
  );
});

test("validateBossEncounterTemplateCatalog: phase hpThreshold > 1 throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config = makeValidBossEncounterTemplateCatalog(skills);
  config.templates[0].phases[0].hpThreshold = 1.5;
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /hpThreshold must be within/
  );
});

test("validateBossEncounterTemplateCatalog: phase hpThreshold of 0 throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config = makeValidBossEncounterTemplateCatalog(skills);
  // Need a valid first phase then an invalid second phase
  config.templates[0].phases = [
    { id: "phase-full", hpThreshold: 1 },
    { id: "phase-empty", hpThreshold: 0 }
  ];
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /hpThreshold must be within/
  );
});

test("validateBossEncounterTemplateCatalog: phases not in descending hpThreshold order throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config = makeValidBossEncounterTemplateCatalog(skills);
  config.templates[0].phases = [
    { id: "phase-full", hpThreshold: 1 },
    { id: "phase-mid", hpThreshold: 0.8 },
    { id: "phase-high", hpThreshold: 0.9 }
  ];
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /hpThreshold must be in descending order/
  );
});

test("validateBossEncounterTemplateCatalog: phase referencing unknown skill override throws", () => {
  const skills = makeValidBattleSkillCatalog();
  const config = makeValidBossEncounterTemplateCatalog(skills);
  config.templates[0].phases[0].skillOverrides = {
    addSkillIds: ["unknown-skill-id"]
  };
  assert.throws(
    () => validateBossEncounterTemplateCatalog(config, skills),
    /references unknown battle skill/
  );
});

test("validateBossEncounterTemplateCatalog: multi-phase template with valid descending thresholds does not throw", () => {
  const skills = makeValidBattleSkillCatalog();
  const catalog: BossEncounterTemplateCatalogConfig = {
    templates: [
      {
        id: "multi-phase-boss",
        name: "Multi Phase Boss",
        phases: [
          { id: "phase-full", hpThreshold: 1 },
          { id: "phase-half", hpThreshold: 0.5 },
          { id: "phase-low", hpThreshold: 0.2 }
        ]
      }
    ]
  };
  assert.doesNotThrow(() => validateBossEncounterTemplateCatalog(catalog, skills));
});
