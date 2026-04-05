import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBattleAction,
  attachBossEncounterTemplate,
  createEmptyBattleState,
  resolveBossEncounterState,
  type BattleState,
  type UnitStack
} from "../src/index.ts";

function createUnit(base: Partial<UnitStack> & Pick<UnitStack, "id" | "templateId" | "camp" | "stackName">): UnitStack {
  return {
    id: base.id,
    templateId: base.templateId,
    camp: base.camp,
    lane: base.lane ?? 0,
    stackName: base.stackName,
    initiative: base.initiative ?? 8,
    attack: base.attack ?? 4,
    defense: base.defense ?? 4,
    minDamage: base.minDamage ?? 2,
    maxDamage: base.maxDamage ?? 4,
    count: base.count ?? 1,
    currentHp: base.currentHp ?? 10,
    maxHp: base.maxHp ?? 10,
    hasRetaliated: false,
    defending: false,
    skills: base.skills ?? [],
    statusEffects: base.statusEffects ?? []
  };
}

function createBossBattle(): BattleState {
  return attachBossEncounterTemplate(
    {
      ...createEmptyBattleState(),
      id: "battle-boss-template",
      round: 1,
      activeUnitId: "boss",
      turnOrder: ["boss", "hero"],
      units: {
        boss: createUnit({
          id: "boss",
          templateId: "shadow_hexer",
          camp: "defender",
          stackName: "Shadow Warden",
          currentHp: 10,
          maxHp: 10
        }),
        hero: createUnit({
          id: "hero",
          templateId: "hero_guard_basic",
          camp: "attacker",
          stackName: "Hero Guard",
          initiative: 9
        })
      },
      unitCooldowns: {
        boss: {},
        hero: {}
      }
    },
    "boss-shadow-warden",
    "boss"
  );
}

test("resolveBossEncounterState transitions boss phases and swaps phase environment", () => {
  const opening = createBossBattle();
  assert.equal(opening.bossEncounter?.activePhaseId, "phase-1-veil");
  assert.deepEqual(opening.units.boss?.skills?.map((skill) => skill.id), ["grave_silence", "bog_veil"]);
  assert.equal(opening.environment.length, 0);

  const phaseTwo = resolveBossEncounterState({
    ...opening,
    units: {
      ...opening.units,
      boss: {
        ...opening.units.boss!,
        currentHp: 6
      }
    }
  });
  assert.equal(phaseTwo.bossEncounter?.activePhaseId, "phase-2-warden-grip");
  assert.deepEqual(phaseTwo.units.boss?.skills?.map((skill) => skill.id), ["grave_silence", "taunt_shout", "bog_veil"]);
  assert.equal(phaseTwo.environment[0]?.kind, "trap");
  assert.equal(phaseTwo.environment[0]?.name, "Veil Snare");

  const phaseThree = resolveBossEncounterState({
    ...phaseTwo,
    units: {
      ...phaseTwo.units,
      boss: {
        ...phaseTwo.units.boss!,
        currentHp: 2
      }
    }
  });
  assert.equal(phaseThree.bossEncounter?.activePhaseId, "phase-3-last-watch");
  assert.deepEqual(phaseThree.units.boss?.skills?.map((skill) => skill.id), ["grave_silence", "stunning_blow", "bog_veil"]);
  assert.equal(phaseThree.environment.length, 0);
});

test("boss post-turn scripted abilities resolve through the shared battle path", () => {
  const opening = createBossBattle();
  const phaseTwo = resolveBossEncounterState({
    ...opening,
    units: {
      ...opening.units,
      boss: {
        ...opening.units.boss!,
        currentHp: 6
      }
    }
  });

  const next = applyBattleAction(phaseTwo, {
    type: "battle.defend",
    unitId: "boss"
  });

  assert.equal(next.activeUnitId, "hero");
  assert.equal(next.units.hero?.statusEffects?.some((status) => status.id === "taunted"), true);
  assert.equal(next.units.boss?.skills?.find((skill) => skill.id === "taunt_shout")?.remainingCooldown, 3);
  assert.equal(next.bossEncounter?.triggeredAbilityKeys.length, 1);
});
