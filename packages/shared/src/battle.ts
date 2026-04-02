import type {
  BattleAction,
  BattleHazardState,
  BattleSkillCatalogConfig,
  BattleSkillConfig,
  BattleOutcome,
  BattleSkillId,
  BattleSkillState,
  BattleState,
  BattleStatusEffectConfig,
  BattleStatusEffectId,
  BattleStatusEffectState,
  HeroState,
  NeutralArmyState,
  UnitStack,
  ValidationResult
} from "./models.ts";
import { validateAction } from "./action-precheck.ts";
import { nextDeterministicRandom } from "./deterministic-rng.ts";
import { createHeroEquipmentBonusSummary } from "./equipment.ts";
import { grantedHeroBattleSkillIds } from "./hero-skills.ts";
import { requireValue, withOptionalProperty } from "./invariant.ts";
import { getBattleBalanceConfig, getDefaultBattleSkillCatalog, getDefaultUnitCatalog } from "./world-config.ts";

interface ContactResolutionResult {
  state: BattleState;
  intercepted: boolean;
}

interface BattleCatalogIndex {
  skillById: Map<BattleSkillId, BattleSkillConfig>;
  statusById: Map<BattleStatusEffectId, BattleStatusEffectConfig>;
}

function cloneSkillState(skill: BattleSkillState): BattleSkillState {
  return { ...skill };
}

function cloneStatusEffectState(status: BattleStatusEffectState): BattleStatusEffectState {
  return { ...status };
}

function cloneHazardState(hazard: BattleHazardState): BattleHazardState {
  return { ...hazard };
}

function skillsOf(unit: UnitStack): BattleSkillState[] {
  return unit.skills ?? [];
}

function statusEffectsOf(unit: UnitStack): BattleStatusEffectState[] {
  return unit.statusEffects ?? [];
}

function withNormalizedCollections(unit: UnitStack): UnitStack {
  return {
    ...unit,
    skills: skillsOf(unit).map(cloneSkillState),
    statusEffects: statusEffectsOf(unit).map(cloneStatusEffectState)
  };
}

function hazardsOf(state: BattleState): BattleHazardState[] {
  return state.environment ?? [];
}

function normalizeBattleRngState(state: BattleState): BattleState["rng"] {
  const rng = state.rng;
  return {
    seed: Number.isFinite(rng?.seed) ? Math.floor(rng.seed) >>> 0 : 1,
    cursor: Number.isFinite(rng?.cursor) ? Math.max(0, Math.floor(rng.cursor)) : 0
  };
}

export function normalizeBattleState(state: BattleState): BattleState {
  return {
    ...state,
    units: Object.fromEntries(
      Object.entries(state.units).map(([unitId, unit]) => [unitId, withNormalizedCollections(unit)])
    ),
    environment: hazardsOf(state).map(cloneHazardState),
    rng: normalizeBattleRngState(state)
  };
}

function battleCatalogIndexFor(catalog: BattleSkillCatalogConfig): BattleCatalogIndex {
  return {
    skillById: new Map(catalog.skills.map((skill) => [skill.id, skill])),
    statusById: new Map(catalog.statuses.map((status) => [status.id, status]))
  };
}

function getBattleCatalogIndex(): BattleCatalogIndex {
  return battleCatalogIndexFor(getDefaultBattleSkillCatalog());
}

function skillDefinitionFor(
  skillId: BattleSkillId,
  catalogIndex: BattleCatalogIndex = getBattleCatalogIndex()
): BattleSkillConfig {
  return requireValue(catalogIndex.skillById.get(skillId), `Missing battle skill definition: ${skillId}`);
}

function statusDefinitionFor(
  statusId: BattleStatusEffectId,
  catalogIndex: BattleCatalogIndex = getBattleCatalogIndex()
): BattleStatusEffectConfig {
  return requireValue(catalogIndex.statusById.get(statusId), `Missing battle status definition: ${statusId}`);
}

function createSkillState(
  skillId: BattleSkillId,
  catalogIndex: BattleCatalogIndex = getBattleCatalogIndex()
): BattleSkillState {
  const definition = skillDefinitionFor(skillId, catalogIndex);
  return {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    kind: definition.kind,
    target: definition.target,
    ...(definition.delivery ? { delivery: definition.delivery } : {}),
    cooldown: definition.cooldown,
    remainingCooldown: 0
  };
}

function createStatusEffectState(
  statusId: BattleStatusEffectId,
  sourceUnitId?: string,
  catalogIndex: BattleCatalogIndex = getBattleCatalogIndex()
): BattleStatusEffectState {
  const definition = statusDefinitionFor(statusId, catalogIndex);
  return withOptionalProperty({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    durationRemaining: definition.duration,
    attackModifier: definition.attackModifier,
    defenseModifier: definition.defenseModifier,
    damagePerTurn: definition.damagePerTurn,
    initiativeModifier: definition.initiativeModifier ?? 0,
    blocksActiveSkills: definition.blocksActiveSkills ?? false
  }, "sourceUnitId", sourceUnitId);
}

function isContactSkillDefinition(skill: BattleSkillConfig): boolean {
  return skill.target === "enemy" && skill.delivery !== "ranged";
}

function buildFormationLanes(unitCount: number, totalLanes: number): number[] {
  if (unitCount <= 0) {
    return [];
  }

  if (unitCount === 1) {
    return [Math.floor((Math.max(1, totalLanes) - 1) / 2)];
  }

  const maxLane = Math.max(0, totalLanes - 1);
  return Array.from({ length: unitCount }, (_, index) =>
    Math.round((index * maxLane) / Math.max(1, unitCount - 1))
  );
}

function totalInitiativeModifier(unit: UnitStack): number {
  return statusEffectsOf(unit).reduce((total, status) => total + status.initiativeModifier, 0);
}

function effectiveInitiative(unit: UnitStack): number {
  return unit.initiative + totalInitiativeModifier(unit);
}

function canUseActiveSkills(unit: UnitStack): boolean {
  return statusEffectsOf(unit).every((status) => !status.blocksActiveSkills);
}

function describeHazard(hazard: BattleHazardState, catalogIndex: BattleCatalogIndex = getBattleCatalogIndex()): string {
  if (hazard.kind === "blocker") {
    return `${hazard.lane + 1} 线 ${hazard.name} ${hazard.durability}/${hazard.maxDurability}`;
  }

  if (!hazard.revealed) {
    return `${hazard.lane + 1} 线 隐藏陷阱`;
  }

  const parts = [`${hazard.lane + 1} 线 ${hazard.name}`];
  if (hazard.damage > 0) {
    parts.push(`${hazard.damage} 伤害`);
  }
  if (hazard.grantedStatusId) {
    parts.push(statusDefinitionFor(hazard.grantedStatusId, catalogIndex).name);
  }
  parts.push(hazard.charges > 0 ? `${hazard.charges} 次` : "已触发");
  return parts.join(" · ");
}

export function createBattleEnvironmentState(lanes: number, seed: number): BattleHazardState[] {
  const resolvedLanes = Math.max(1, lanes);
  const balance = getBattleBalanceConfig().environment;
  let environmentSeed = (seed ^ 0x9e3779b9) >>> 0;
  const hazards: BattleHazardState[] = [];

  const blockerRoll = nextDeterministicRandom(environmentSeed);
  environmentSeed = blockerRoll.nextSeed;
  const blockerLaneRoll = nextDeterministicRandom(environmentSeed);
  environmentSeed = blockerLaneRoll.nextSeed;
  if (blockerRoll.value >= balance.blockerSpawnThreshold) {
    hazards.push({
      id: `hazard-blocker-${Math.floor(blockerLaneRoll.value * resolvedLanes)}`,
      kind: "blocker",
      lane: Math.min(resolvedLanes - 1, Math.floor(blockerLaneRoll.value * resolvedLanes)),
      name: "碎石路障",
      description: "近身接战前需要先破开这道障碍。",
      durability: balance.blockerDurability,
      maxDurability: balance.blockerDurability
    });
  }

  const trapRoll = nextDeterministicRandom(environmentSeed);
  environmentSeed = trapRoll.nextSeed;
  const trapLaneRoll = nextDeterministicRandom(environmentSeed);
  environmentSeed = trapLaneRoll.nextSeed;
  if (trapRoll.value >= balance.trapSpawnThreshold) {
    const lane = Math.min(resolvedLanes - 1, Math.floor(trapLaneRoll.value * resolvedLanes));
    const trapTypeRoll = nextDeterministicRandom(environmentSeed);
    const trapType = trapTypeRoll.value < 1 / 3 ? "damage" : trapTypeRoll.value < 2 / 3 ? "slow" : "silence";
    const trapBase =
      trapType === "damage"
        ? {
            effect: "damage" as const,
            name: "爆裂地刺",
            description: "隐藏在地面的尖刺会在近战突进时突然弹出。",
            damage: balance.trapDamage,
            grantedStatusId: balance.trapGrantedStatusId
          }
        : trapType === "slow"
          ? {
              effect: "slow" as const,
              name: "缠足泥沼",
              description: "踩中后会被拖慢，下一轮行动明显延后。",
              damage: 0,
              grantedStatusId: "slowed" as BattleStatusEffectId
            }
          : {
              effect: "silence" as const,
              name: "封咒符印",
              description: "触发后短时间内无法施放主动技能。",
              damage: 0,
              grantedStatusId: "silenced" as BattleStatusEffectId
            };
    hazards.push(withOptionalProperty({
      id: `hazard-trap-${lane}`,
      kind: "trap",
      lane,
      effect: trapBase.effect,
      name: trapBase.name,
      description: trapBase.description,
      damage: trapBase.damage,
      charges: balance.trapCharges,
      revealed: false,
      triggered: false,
      triggeredByCamp: "both"
    }, "grantedStatusId", trapBase.grantedStatusId));
  }

  return hazards;
}

function sortTurnOrder(units: Record<string, UnitStack>): string[] {
  return Object.values(units)
    .filter((unit) => unit.count > 0)
    .sort((a, b) => effectiveInitiative(b) - effectiveInitiative(a))
    .map((unit) => unit.id);
}

function averageDamage(unit: UnitStack): number {
  return (unit.minDamage + unit.maxDamage) / 2;
}

function totalAttackModifier(unit: UnitStack): number {
  return statusEffectsOf(unit).reduce((total, status) => total + status.attackModifier, 0);
}

function totalDefenseModifier(unit: UnitStack): number {
  return statusEffectsOf(unit).reduce((total, status) => total + status.defenseModifier, 0);
}

function estimateDamage(attacker: UnitStack, defender: UnitStack, randomValue: number, multiplier = 1): number {
  const balance = getBattleBalanceConfig().damage;
  const defenseBonus = defender.defending ? balance.defendingDefenseBonus : 0;
  const effectiveAttack = attacker.attack + totalAttackModifier(attacker);
  const effectiveDefense = defender.defense + totalDefenseModifier(defender) + defenseBonus;
  const offenseModifier = 1 + (effectiveAttack - effectiveDefense) * balance.offenseAdvantageStep;
  const variance = balance.varianceBase + randomValue * balance.varianceRange;
  return Math.max(
    1,
    Math.floor(
      attacker.count *
        averageDamage(attacker) *
        Math.max(balance.minimumOffenseMultiplier, offenseModifier) *
        variance *
        multiplier
    )
  );
}

function applyDamage(target: UnitStack, damage: number): UnitStack {
  const hpPool = (target.count - 1) * target.maxHp + target.currentHp;
  const remainingHpPool = Math.max(0, hpPool - damage);
  if (remainingHpPool === 0) {
    return {
      ...target,
      count: 0,
      currentHp: 0
    };
  }

  const survivingCount = Math.ceil(remainingHpPool / target.maxHp);
  const currentHp = remainingHpPool - (survivingCount - 1) * target.maxHp;
  return {
    ...target,
    count: survivingCount,
    currentHp
  };
}

function buildUnitStack(
  base: Omit<UnitStack, "skills" | "statusEffects">,
  battleSkills?: BattleSkillId[],
  catalogIndex: BattleCatalogIndex = getBattleCatalogIndex()
): UnitStack {
  return {
    ...base,
    skills: [...new Set(battleSkills ?? [])].map((skillId) => createSkillState(skillId, catalogIndex)),
    statusEffects: []
  };
}

function setSkillCooldown(unit: UnitStack, skillId: BattleSkillId): UnitStack {
  const skills = skillsOf(unit);
  const updatedSkills = skills.map((skill) =>
    skill.id === skillId ? { ...skill, remainingCooldown: skill.cooldown } : skill
  );
  return {
    ...unit,
    skills: updatedSkills
  };
}

function tickUnitSkillCooldowns(unit: UnitStack): UnitStack {
  const skills = skillsOf(unit);
  if (skills.length === 0) {
    return unit;
  }

  return {
    ...unit,
    skills: skills.map((skill) =>
      skill.remainingCooldown > 0 ? { ...skill, remainingCooldown: skill.remainingCooldown - 1 } : skill
    )
  };
}

function upsertStatusEffect(
  unit: UnitStack,
  statusId: BattleStatusEffectId,
  sourceUnitId?: string,
  catalogIndex: BattleCatalogIndex = getBattleCatalogIndex()
): UnitStack {
  const statuses = statusEffectsOf(unit).filter((status) => status.id !== statusId);
  return {
    ...unit,
    statusEffects: statuses.concat(createStatusEffectState(statusId, sourceUnitId, catalogIndex))
  };
}

function findSkill(unit: UnitStack, skillId: BattleSkillId): BattleSkillState | undefined {
  return skillsOf(unit).find((skill) => skill.id === skillId);
}

function applyOnHitStatuses(
  attacker: UnitStack,
  defender: UnitStack,
  log: string[],
  catalogIndex: BattleCatalogIndex,
  explicitSkillIds: BattleSkillId[] = []
): UnitStack {
  if (defender.count <= 0) {
    return defender;
  }

  const passiveSkillIds = skillsOf(attacker)
    .filter((skill) => skill.kind === "passive")
    .map((skill) => skill.id);
  const skillIds = Array.from(new Set(explicitSkillIds.concat(passiveSkillIds)));

  let nextDefender = defender;
  for (const skillId of skillIds) {
    const skill = findSkill(attacker, skillId);
    const definition = skillDefinitionFor(skillId, catalogIndex);
    const statusId = definition.effects?.onHitStatusId;
    if (!skill || !statusId || nextDefender.count <= 0) {
      continue;
    }

    const status = statusDefinitionFor(statusId, catalogIndex);
    log.push(`${attacker.stackName} 的${skill.name}让 ${nextDefender.stackName} 陷入${status.name}`);
    nextDefender = upsertStatusEffect(nextDefender, statusId, attacker.id, catalogIndex);
  }

  return nextDefender;
}

function processTurnStartForUnit(unit: UnitStack): { unit: UnitStack; log: string[] } {
  let nextUnit = tickUnitSkillCooldowns(unit);
  const log: string[] = [];
  const remainingStatuses: BattleStatusEffectState[] = [];

  for (const status of statusEffectsOf(nextUnit)) {
    if (status.damagePerTurn > 0 && nextUnit.count > 0) {
      nextUnit = applyDamage(nextUnit, status.damagePerTurn);
      log.push(`${nextUnit.stackName} 受到${status.name}影响，损失 ${status.damagePerTurn} 生命`);
    }

    const nextDuration = status.durationRemaining - 1;
    if (nextDuration > 0 && nextUnit.count > 0) {
      remainingStatuses.push({
        ...status,
        durationRemaining: nextDuration
      });
    } else {
      log.push(`${nextUnit.stackName} 的${status.name}结束`);
    }
  }

  return {
    unit: {
      ...nextUnit,
      statusEffects: remainingStatuses
    },
    log
  };
}

function describeGrantedStatus(status: BattleStatusEffectConfig): string {
  const parts: string[] = [];
  const initiativeModifier = status.initiativeModifier ?? 0;
  if (status.attackModifier !== 0) {
    parts.push(`${status.attackModifier > 0 ? "+" : ""}${status.attackModifier} 攻击`);
  }
  if (status.defenseModifier !== 0) {
    parts.push(`${status.defenseModifier > 0 ? "+" : ""}${status.defenseModifier} 防御`);
  }
  if (status.damagePerTurn > 0) {
    parts.push(`每回合 ${status.damagePerTurn} 持续伤害`);
  }
  if (initiativeModifier !== 0) {
    parts.push(`${initiativeModifier > 0 ? "+" : ""}${initiativeModifier} 先攻`);
  }
  if (status.blocksActiveSkills) {
    parts.push("禁用主动技能");
  }
  return parts.length > 0 ? `${status.name}（${parts.join("，")}）` : status.name;
}

function hasStatusEffect(unit: UnitStack, statusId: BattleStatusEffectId): boolean {
  return statusEffectsOf(unit).some((status) => status.id === statusId);
}

function isActiveSkillReady(skill: BattleSkillState): boolean {
  return skill.kind === "active" && skill.remainingCooldown === 0;
}

function scoreAutomatedEnemySkill(
  skillDefinition: BattleSkillConfig,
  target: UnitStack,
  catalogIndex: BattleCatalogIndex
): number {
  let score = (skillDefinition.effects?.damageMultiplier ?? 1) * 10;

  if (skillDefinition.effects?.allowRetaliation === false) {
    score += 4;
  }

  if (skillDefinition.effects?.onHitStatusId) {
    const status = statusDefinitionFor(skillDefinition.effects.onHitStatusId, catalogIndex);
    score += 4 + status.damagePerTurn + Math.max(0, -status.attackModifier) + Math.max(0, -status.defenseModifier);
    if (hasStatusEffect(target, status.id)) {
      score -= 6;
    }
  }

  if (target.count <= 3) {
    score += 1;
  }

  return score;
}

export function pickAutomatedBattleAction(state: BattleState): BattleAction | null {
  if (!state.activeUnitId) {
    return null;
  }

  const activeUnit = state.units[state.activeUnitId];
  if (!activeUnit || activeUnit.count <= 0) {
    return null;
  }

  const catalogIndex = getBattleCatalogIndex();
  const readySkills = canUseActiveSkills(activeUnit) ? skillsOf(activeUnit).filter(isActiveSkillReady) : [];

  for (const skill of readySkills) {
    if (skill.target !== "self") {
      continue;
    }

    const definition = skillDefinitionFor(skill.id, catalogIndex);
    if (definition.effects?.grantedStatusId && hasStatusEffect(activeUnit, definition.effects.grantedStatusId)) {
      continue;
    }

    return {
      type: "battle.skill",
      unitId: activeUnit.id,
      skillId: skill.id,
      targetId: activeUnit.id
    };
  }

  const enemyUnits = Object.values(state.units).filter((unit) => unit.camp !== activeUnit.camp && unit.count > 0);
  if (enemyUnits.length === 0) {
    return null;
  }

  let bestEnemySkillAction: BattleAction | null = null;
  let bestEnemySkillScore = -Infinity;

  for (const skill of readySkills) {
    if (skill.target !== "enemy") {
      continue;
    }

    const definition = skillDefinitionFor(skill.id, catalogIndex);
    for (const target of enemyUnits) {
      const score = scoreAutomatedEnemySkill(definition, target, catalogIndex);
      if (score <= bestEnemySkillScore) {
        continue;
      }

      bestEnemySkillScore = score;
      bestEnemySkillAction = {
        type: "battle.skill",
        unitId: activeUnit.id,
        skillId: skill.id,
        targetId: target.id
      };
    }
  }

  if (bestEnemySkillAction) {
    return bestEnemySkillAction;
  }

  const fallbackTarget = enemyUnits[0]!;

  return {
    type: "battle.attack",
    attackerId: activeUnit.id,
    defenderId: fallbackTarget.id
  };
}

export interface AutomatedBattleSkillUsageEntry {
  skillId: BattleSkillId;
  uses: number;
  share: number;
}

export interface AutomatedBattleSimulationResult {
  outcome: BattleOutcome;
  finalState: BattleState;
  rounds: number;
  turns: number;
  skillUsage: Record<BattleSkillId, number>;
  maxActionsReached: boolean;
}

export interface AutomatedBattleMetrics {
  battleCount: number;
  attackerWins: number;
  defenderWins: number;
  unresolvedBattles: number;
  attackerWinRate: number;
  defenderWinRate: number;
  unresolvedRate: number;
  averageRounds: number;
  averageTurns: number;
  minRounds: number;
  maxRounds: number;
  totalSkillUses: number;
  skillUsage: AutomatedBattleSkillUsageEntry[];
}

export interface AutomatedBattleSimulationOptions {
  maxActions?: number;
}

function sortSkillUsage(skillUsage: Record<BattleSkillId, number>): AutomatedBattleSkillUsageEntry[] {
  const totalSkillUses = Object.values(skillUsage).reduce((total, value) => total + value, 0);
  return Object.entries(skillUsage)
    .map(([skillId, uses]) => ({
      skillId,
      uses,
      share: totalSkillUses > 0 ? uses / totalSkillUses : 0
    }))
    .sort((left, right) => right.uses - left.uses || left.skillId.localeCompare(right.skillId));
}

export function simulateAutomatedBattle(
  initialState: BattleState,
  options: AutomatedBattleSimulationOptions = {}
): AutomatedBattleSimulationResult {
  const maxActions = Math.max(1, options.maxActions ?? 200);
  const skillUsage: Record<BattleSkillId, number> = {};
  let state = structuredClone(initialState);
  let turns = 0;

  while (getBattleOutcome(state).status === "in_progress" && turns < maxActions) {
    const action = pickAutomatedBattleAction(state);
    if (!action) {
      break;
    }

    if (action.type === "battle.skill") {
      skillUsage[action.skillId] = (skillUsage[action.skillId] ?? 0) + 1;
    }

    state = applyBattleAction(state, action);
    turns += 1;
  }

  return {
    outcome: getBattleOutcome(state),
    finalState: state,
    rounds: state.round,
    turns,
    skillUsage,
    maxActionsReached: turns >= maxActions && getBattleOutcome(state).status === "in_progress"
  };
}

export function simulateAutomatedBattles(
  createInitialState: (battleIndex: number) => BattleState,
  battleCount: number,
  options: AutomatedBattleSimulationOptions = {}
): AutomatedBattleMetrics {
  const resolvedBattleCount = Math.max(1, Math.floor(battleCount));
  const aggregateSkillUsage: Record<BattleSkillId, number> = {};
  let attackerWins = 0;
  let defenderWins = 0;
  let unresolvedBattles = 0;
  let totalRounds = 0;
  let totalTurns = 0;
  let minRounds = Number.POSITIVE_INFINITY;
  let maxRounds = 0;

  for (let battleIndex = 0; battleIndex < resolvedBattleCount; battleIndex += 1) {
    const result = simulateAutomatedBattle(createInitialState(battleIndex), options);

    if (result.outcome.status === "attacker_victory") {
      attackerWins += 1;
    } else if (result.outcome.status === "defender_victory") {
      defenderWins += 1;
    } else {
      unresolvedBattles += 1;
    }

    totalRounds += result.rounds;
    totalTurns += result.turns;
    minRounds = Math.min(minRounds, result.rounds);
    maxRounds = Math.max(maxRounds, result.rounds);

    for (const [skillId, uses] of Object.entries(result.skillUsage)) {
      aggregateSkillUsage[skillId] = (aggregateSkillUsage[skillId] ?? 0) + uses;
    }
  }

  const totalSkillUses = Object.values(aggregateSkillUsage).reduce((total, value) => total + value, 0);

  return {
    battleCount: resolvedBattleCount,
    attackerWins,
    defenderWins,
    unresolvedBattles,
    attackerWinRate: attackerWins / resolvedBattleCount,
    defenderWinRate: defenderWins / resolvedBattleCount,
    unresolvedRate: unresolvedBattles / resolvedBattleCount,
    averageRounds: totalRounds / resolvedBattleCount,
    averageTurns: totalTurns / resolvedBattleCount,
    minRounds: Number.isFinite(minRounds) ? minRounds : 0,
    maxRounds,
    totalSkillUses,
    skillUsage: sortSkillUsage(aggregateSkillUsage)
  };
}

function advanceTurnInternal(state: BattleState, actingUnitId: string, waited: boolean): BattleState {
  const aliveIds = new Set(
    Object.values(state.units)
      .filter((unit) => unit.count > 0)
      .map((unit) => unit.id)
  );

  const queue = state.turnOrder.filter((unitId) => aliveIds.has(unitId) && unitId !== actingUnitId);
  const nextQueue = waited && aliveIds.has(actingUnitId) ? queue.concat(actingUnitId) : queue;
  if (nextQueue.length > 0) {
    return {
      ...state,
      activeUnitId: nextQueue[0]!,
      turnOrder: nextQueue
    };
  }

  const refreshedUnits = Object.fromEntries(
    Object.entries(state.units).map(([id, unit]) => [
      id,
      {
        ...unit,
        hasRetaliated: false,
        defending: false
      }
    ])
  );
  const refreshedOrder = sortTurnOrder(refreshedUnits);
  return {
    ...state,
    round: state.round + 1,
    activeUnitId: refreshedOrder[0]!,
    turnOrder: refreshedOrder,
    units: refreshedUnits
  };
}

function prepareStateForActiveUnit(state: BattleState): BattleState {
  let nextState = state;
  let remainingIterations = Object.keys(state.units).length + 1;

  while (nextState.activeUnitId && remainingIterations > 0) {
    remainingIterations -= 1;
    const activeUnit = nextState.units[nextState.activeUnitId]!;

    const processed = processTurnStartForUnit(activeUnit);
    nextState = {
      ...nextState,
      units: {
        ...nextState.units,
        [activeUnit.id]: processed.unit
      },
      log: processed.log.length > 0 ? nextState.log.concat(processed.log) : nextState.log
    };

    if (processed.unit.count > 0) {
      break;
    }

    nextState = advanceTurnInternal(nextState, activeUnit.id, false);
  }

  return nextState;
}

function advanceTurn(state: BattleState, actingUnitId: string, waited: boolean): BattleState {
  return prepareStateForActiveUnit(advanceTurnInternal(state, actingUnitId, waited));
}

function triggerTrap(
  unit: UnitStack,
  trap: Extract<BattleHazardState, { kind: "trap" }>,
  log: string[],
  catalogIndex: BattleCatalogIndex
): UnitStack {
  let nextUnit = unit;
  log.push(`${unit.stackName} 踩中隐藏陷阱 ${trap.name}，陷阱位置暴露`);

  if (trap.damage > 0) {
    nextUnit = applyDamage(nextUnit, trap.damage);
    log.push(`${unit.stackName} 触发 ${trap.name}，损失 ${trap.damage} 生命`);
  }

  if (trap.grantedStatusId && nextUnit.count > 0 && catalogIndex.statusById.has(trap.grantedStatusId)) {
    const status = statusDefinitionFor(trap.grantedStatusId, catalogIndex);
    nextUnit = upsertStatusEffect(nextUnit, trap.grantedStatusId, trap.id, catalogIndex);
    log.push(`${nextUnit.stackName} 因 ${trap.name} 陷入${status.name}`);
  }

  return nextUnit;
}

function resolveContactHazards(
  state: BattleState,
  attackerId: string,
  defenderId: string,
  catalogIndex: BattleCatalogIndex
): ContactResolutionResult {
  const defender = state.units[defenderId]!;
  const lane = defender.lane;
  let nextState = state;
  let nextUnits = { ...state.units };
  let nextEnvironment = hazardsOf(state).map(cloneHazardState);
  let nextLog = [...state.log];
  let attacker = nextUnits[attackerId]!;

  for (const hazard of nextEnvironment) {
    if (hazard.kind !== "trap" || hazard.lane !== lane || hazard.charges <= 0) {
      continue;
    }

    if (hazard.triggeredByCamp && hazard.triggeredByCamp !== "both" && hazard.triggeredByCamp !== attacker.camp) {
      continue;
    }

    attacker = triggerTrap(attacker, hazard, nextLog, catalogIndex);
    nextUnits[attacker.id] = attacker;
    hazard.revealed = true;
    hazard.triggered = true;
    hazard.charges -= 1;
    if (hazard.charges <= 0) {
      nextLog.push(`${hazard.name} 已失效，但该位置对双方保持可见`);
    }
  }

  nextEnvironment = nextEnvironment.filter((hazard) =>
    hazard.kind === "trap" ? hazard.charges > 0 || hazard.revealed : hazard.durability > 0
  );
  nextState = {
    ...state,
    units: nextUnits,
    environment: nextEnvironment,
    log: nextLog
  };

  if (attacker.count <= 0) {
    return {
      state: advanceTurn(nextState, attacker.id, false),
      intercepted: true
    };
  }

  const blockerIndex = nextEnvironment.findIndex(
    (hazard) => hazard.kind === "blocker" && hazard.lane === lane && hazard.durability > 0
  );
  if (blockerIndex >= 0) {
    const blocker = nextEnvironment[blockerIndex] as Extract<BattleHazardState, { kind: "blocker" }>;
    const updatedDurability = blocker.durability - 1;
    nextLog = nextState.log.concat(`${attacker.stackName} 被 ${blocker.name} 阻挡，只能先破开障碍`);
    if (updatedDurability > 0) {
      nextEnvironment[blockerIndex] = {
        ...blocker,
        durability: updatedDurability
      };
    } else {
      nextEnvironment = nextEnvironment.filter((hazard) => hazard.id !== blocker.id);
      nextLog.push(`${blocker.name} 被击碎，${lane + 1} 线重新打开`);
    }

    return {
      state: advanceTurn(
        {
          ...nextState,
          environment: nextEnvironment,
          log: nextLog
        },
        attacker.id,
        false
      ),
      intercepted: true
    };
  }

  return {
    state: nextState,
    intercepted: false
  };
}

function applyAttackSequence(
  state: BattleState,
  attackerId: string,
  defenderId: string,
  options?: {
    damageMultiplier?: number;
    allowRetaliation?: boolean;
    delivery?: "contact" | "ranged";
    logPrefix?: string;
    skillId?: BattleSkillId;
    catalogIndex?: BattleCatalogIndex;
  }
): BattleState {
  const catalogIndex = options?.catalogIndex ?? getBattleCatalogIndex();
  const preparedState =
    (options?.delivery ?? "contact") === "contact"
      ? resolveContactHazards(state, attackerId, defenderId, catalogIndex)
      : {
          state,
          intercepted: false
        };
  if (preparedState.intercepted) {
    return preparedState.state;
  }

  const attacker = preparedState.state.units[attackerId]!;
  const defender = preparedState.state.units[defenderId]!;
  const attackRoll = nextDeterministicRandom(preparedState.state.rng.seed);
  const attackDamage = estimateDamage(attacker, defender, attackRoll.value, options?.damageMultiplier ?? 1);
  const nextUnits: Record<string, UnitStack> = {
    ...preparedState.state.units,
    [defender.id]: applyDamage(defender, attackDamage)
  };
  let nextRngState = {
    seed: attackRoll.nextSeed,
    cursor: preparedState.state.rng.cursor + 1
  };
  const log = preparedState.state.log.concat(
    `${options?.logPrefix ?? `${attacker.stackName} 对 ${defender.stackName}`} 造成 ${attackDamage} 伤害`
  );

  let damagedDefender = nextUnits[defender.id]!;
  damagedDefender = applyOnHitStatuses(
    attacker,
    damagedDefender,
    log,
    catalogIndex,
    options?.skillId ? [options.skillId] : []
  );
  nextUnits[defender.id] = damagedDefender;

  if ((options?.allowRetaliation ?? true) && damagedDefender.count > 0 && !damagedDefender.hasRetaliated) {
    const retaliationRoll = nextDeterministicRandom(nextRngState.seed);
    const retaliationDamage = estimateDamage(damagedDefender, attacker, retaliationRoll.value);
    let damagedAttacker = applyDamage(attacker, retaliationDamage);
    damagedAttacker = applyOnHitStatuses(damagedDefender, damagedAttacker, log, catalogIndex);
    nextUnits[attacker.id] = damagedAttacker;
    nextUnits[defender.id] = {
      ...damagedDefender,
      hasRetaliated: true
    };
    nextRngState = {
      seed: retaliationRoll.nextSeed,
      cursor: nextRngState.cursor + 1
    };
    log.push(`${damagedDefender.stackName} 反击 ${attacker.stackName}，造成 ${retaliationDamage} 伤害`);
  }

  return advanceTurn(
    {
      ...preparedState.state,
      units: nextUnits,
      log,
      rng: nextRngState
    },
    attacker.id,
    false
  );
}

export function executeBattleSkill(
  state: BattleState,
  unitId: string,
  skillId: BattleSkillId,
  targetId?: string
): BattleState {
  const normalizedState: BattleState = {
    ...state,
    units: Object.fromEntries(
      Object.entries(state.units).map(([currentUnitId, unit]) => [currentUnitId, withNormalizedCollections(unit)])
    ),
    environment: hazardsOf(state).map(cloneHazardState)
  };
  const action: BattleAction = {
    type: "battle.skill",
    unitId,
    skillId,
    ...(targetId ? { targetId } : {})
  };
  const validation = validateBattleAction(normalizedState, action);
  if (!validation.valid) {
    return {
      ...normalizedState,
      log: normalizedState.log.concat(`Action rejected: ${validation.reason}`)
    };
  }

  const catalogIndex = getBattleCatalogIndex();
  const caster = normalizedState.units[unitId]!;
  const skillDefinition = skillDefinitionFor(skillId, catalogIndex);
  const casterWithCooldown = setSkillCooldown(caster, skillId);

  if (skillDefinition.target === "enemy" && targetId) {
    return applyAttackSequence(
      {
        ...normalizedState,
        units: {
          ...normalizedState.units,
          [caster.id]: casterWithCooldown
        }
      },
      caster.id,
      targetId,
      {
        damageMultiplier: skillDefinition.effects?.damageMultiplier ?? 1,
        allowRetaliation: skillDefinition.effects?.allowRetaliation ?? true,
        delivery: isContactSkillDefinition(skillDefinition) ? "contact" : "ranged",
        logPrefix: `${caster.stackName} 施放 ${skillDefinition.name}，对 ${normalizedState.units[targetId]!.stackName}`,
        skillId,
        catalogIndex
      }
    );
  }

  if (skillDefinition.effects?.grantedStatusId) {
    const grantedStatus = statusDefinitionFor(skillDefinition.effects.grantedStatusId, catalogIndex);
    const empoweredCaster = upsertStatusEffect(
      casterWithCooldown,
      skillDefinition.effects.grantedStatusId,
      caster.id,
      catalogIndex
    );
    return advanceTurn(
      {
        ...normalizedState,
        units: {
          ...normalizedState.units,
          [caster.id]: empoweredCaster
        },
        log: normalizedState.log.concat(
          `${caster.stackName} 施放 ${skillDefinition.name}，获得 ${describeGrantedStatus(grantedStatus)}`
        )
      },
      caster.id,
      false
    );
  }

  return advanceTurn(
    {
      ...normalizedState,
      units: {
        ...normalizedState.units,
        [caster.id]: casterWithCooldown
      },
      log: normalizedState.log.concat(`${caster.stackName} 施放 ${skillDefinition.name}`)
    },
    caster.id,
    false
  );
}

export function validateBattleAction(state: BattleState, action: BattleAction): ValidationResult {
  if (action.type === "battle.wait" || action.type === "battle.defend") {
    if (state.activeUnitId !== action.unitId) {
      return { valid: false, reason: "unit_not_active" };
    }

    const unit = state.units[action.unitId];
    if (!unit || unit.count <= 0) {
      return { valid: false, reason: "unit_not_available" };
    }

    return { valid: true };
  }

  if (action.type === "battle.skill") {
    if (state.activeUnitId !== action.unitId) {
      return { valid: false, reason: "unit_not_active" };
    }

    const unit = state.units[action.unitId];
    if (!unit || unit.count <= 0) {
      return { valid: false, reason: "unit_not_available" };
    }

    const skill = findSkill(unit, action.skillId);
    if (!skill || skill.kind !== "active") {
      return { valid: false, reason: "skill_not_available" };
    }

    if (!canUseActiveSkills(unit)) {
      return { valid: false, reason: "skill_disabled" };
    }

    if (skill.remainingCooldown > 0) {
      return { valid: false, reason: "skill_on_cooldown" };
    }

    if (skill.target === "self") {
      if (action.targetId && action.targetId !== unit.id) {
        return { valid: false, reason: "invalid_skill_target" };
      }
      return { valid: true };
    }

    if (!action.targetId) {
      return { valid: false, reason: "skill_target_missing" };
    }

    const target = state.units[action.targetId];
    if (!target || target.count <= 0) {
      return { valid: false, reason: "defender_not_available" };
    }

    if (target.camp === unit.camp) {
      return { valid: false, reason: "friendly_fire_blocked" };
    }

    return { valid: true };
  }

  if (state.activeUnitId !== action.attackerId) {
    return { valid: false, reason: "attacker_not_active" };
  }

  const attacker = state.units[action.attackerId];
  const defender = state.units[action.defenderId];
  if (!attacker || attacker.count <= 0) {
    return { valid: false, reason: "attacker_not_available" };
  }

  if (!defender || defender.count <= 0) {
    return { valid: false, reason: "defender_not_available" };
  }

  if (attacker.camp === defender.camp) {
    return { valid: false, reason: "friendly_fire_blocked" };
  }

  return { valid: true };
}

export function createEmptyBattleState(): BattleState {
  return {
    id: "battle-empty",
    round: 0,
    lanes: 1,
    activeUnitId: null,
    turnOrder: [],
    units: {},
    environment: [],
    log: [],
    rng: {
      seed: 1,
      cursor: 0
    }
  };
}

export function createDemoBattleState(): BattleState {
  const unitCatalog = getDefaultUnitCatalog();
  const catalogIndex = getBattleCatalogIndex();
  const templateById = new Map(unitCatalog.templates.map((template) => [template.id, template]));
  const heroTemplate = templateById.get("hero_guard_basic");
  const wolfTemplate = templateById.get("wolf_pack");
  if (!heroTemplate || !wolfTemplate) {
    throw new Error("Missing demo battle templates");
  }
  const units: Record<string, UnitStack> = {
    "pikeman-a": buildUnitStack(
      {
        id: "pikeman-a",
        templateId: "hero_guard_basic",
        camp: "attacker",
        lane: 0,
        stackName: "枪兵",
        initiative: 8,
        attack: 4,
        defense: 5,
        minDamage: 1,
        maxDamage: 3,
        count: 12,
        currentHp: 10,
        maxHp: 10,
        hasRetaliated: false,
        defending: false
      },
      heroTemplate.battleSkills,
      catalogIndex
    ),
    "wolf-d": buildUnitStack(
      {
        id: "wolf-d",
        templateId: "wolf_pack",
        camp: "defender",
        lane: 0,
        stackName: "恶狼",
        initiative: 10,
        attack: 6,
        defense: 4,
        minDamage: 2,
        maxDamage: 4,
        count: 8,
        currentHp: 8,
        maxHp: 8,
        hasRetaliated: false,
        defending: false
      },
      wolfTemplate.battleSkills,
      catalogIndex
    )
  };

  const turnOrder = sortTurnOrder(units);
  return {
    id: "battle-demo",
    round: 1,
    lanes: 1,
    activeUnitId: turnOrder[0] ?? null,
    turnOrder,
    units,
    environment: [],
    log: ["战斗开始"],
    rng: {
      seed: 4242,
      cursor: 0
    }
  };
}

export function createNeutralBattleState(hero: HeroState, neutralArmy: NeutralArmyState, seed: number): BattleState {
  const units: Record<string, UnitStack> = {};
  const catalog = getDefaultUnitCatalog();
  const battleCatalogIndex = getBattleCatalogIndex();
  const templateById = new Map(catalog.templates.map((template) => [template.id, template]));
  const heroTemplate = templateById.get(hero.armyTemplateId);
  const heroEquipment = createHeroEquipmentBonusSummary(hero);
  const lanes = Math.max(1, neutralArmy.stacks.length);
  const attackerLanes = buildFormationLanes(1, lanes);
  const defenderLanes = buildFormationLanes(neutralArmy.stacks.length, lanes);
  if (!heroTemplate) {
    throw new Error(`Missing hero army template: ${hero.armyTemplateId}`);
  }
  const heroBattleSkills = [...new Set([...(heroTemplate.battleSkills ?? []), ...grantedHeroBattleSkillIds(hero)])];

  units[`${hero.id}-stack`] = buildUnitStack(
    {
      id: `${hero.id}-stack`,
      templateId: hero.armyTemplateId,
      camp: "attacker",
      lane: attackerLanes[0] ?? 0,
      stackName: heroTemplate.stackName,
      initiative: heroTemplate.initiative,
      attack: heroTemplate.attack + hero.stats.attack + heroEquipment.attack,
      defense: heroTemplate.defense + hero.stats.defense + heroEquipment.defense,
      minDamage: heroTemplate.minDamage,
      maxDamage: heroTemplate.maxDamage,
      count: hero.armyCount,
      currentHp: heroTemplate.maxHp,
      maxHp: heroTemplate.maxHp,
      hasRetaliated: false,
      defending: false
    },
    heroBattleSkills,
    battleCatalogIndex
  );

  for (const [index, stack] of neutralArmy.stacks.entries()) {
    const template = templateById.get(stack.templateId);
    if (!template) {
      throw new Error(`Missing neutral unit template: ${stack.templateId}`);
    }
    const id = `${neutralArmy.id}-stack-${index + 1}`;
    units[id] = buildUnitStack(
      {
        id,
        templateId: stack.templateId,
        camp: "defender",
        lane: defenderLanes[index] ?? index,
        stackName: template.stackName,
        initiative: template.initiative,
        attack: template.attack,
        defense: template.defense,
        minDamage: template.minDamage,
        maxDamage: template.maxDamage,
        count: stack.count,
        currentHp: template.maxHp,
        maxHp: template.maxHp,
        hasRetaliated: false,
        defending: false
      },
      template.battleSkills,
      battleCatalogIndex
    );
  }

  const turnOrder = sortTurnOrder(units);
  const environment = createBattleEnvironmentState(lanes, seed);
  return {
    id: `battle-${neutralArmy.id}`,
    round: 1,
    lanes,
    activeUnitId: turnOrder[0] ?? null,
    turnOrder,
    units,
    environment,
    log: [`${hero.name} 遭遇 ${neutralArmy.id}`, ...visibleEnvironmentLog(environment, battleCatalogIndex)],
    rng: {
      seed,
      cursor: 0
    },
    worldHeroId: hero.id,
    neutralArmyId: neutralArmy.id,
    encounterPosition: neutralArmy.position
  };
}

export function createHeroBattleState(attackerHero: HeroState, defenderHero: HeroState, seed: number): BattleState {
  const catalog = getDefaultUnitCatalog();
  const battleCatalogIndex = getBattleCatalogIndex();
  const templateById = new Map(catalog.templates.map((template) => [template.id, template]));
  const attackerTemplate = templateById.get(attackerHero.armyTemplateId);
  const defenderTemplate = templateById.get(defenderHero.armyTemplateId);
  const attackerEquipment = createHeroEquipmentBonusSummary(attackerHero);
  const defenderEquipment = createHeroEquipmentBonusSummary(defenderHero);
  const lanes = 1;
  const attackerLanes = buildFormationLanes(1, lanes);
  const defenderLanes = buildFormationLanes(1, lanes);
  if (!attackerTemplate || !defenderTemplate) {
    throw new Error("Missing hero army template for PvP battle");
  }
  const attackerBattleSkills = [
    ...new Set([...(attackerTemplate.battleSkills ?? []), ...grantedHeroBattleSkillIds(attackerHero)])
  ];
  const defenderBattleSkills = [
    ...new Set([...(defenderTemplate.battleSkills ?? []), ...grantedHeroBattleSkillIds(defenderHero)])
  ];

  const units: Record<string, UnitStack> = {
    [`${attackerHero.id}-stack`]: buildUnitStack(
      {
        id: `${attackerHero.id}-stack`,
        templateId: attackerHero.armyTemplateId,
        camp: "attacker",
        lane: attackerLanes[0] ?? 0,
        stackName: attackerTemplate.stackName,
        initiative: attackerTemplate.initiative,
        attack: attackerTemplate.attack + attackerHero.stats.attack + attackerEquipment.attack,
        defense: attackerTemplate.defense + attackerHero.stats.defense + attackerEquipment.defense,
        minDamage: attackerTemplate.minDamage,
        maxDamage: attackerTemplate.maxDamage,
        count: attackerHero.armyCount,
        currentHp: attackerTemplate.maxHp,
        maxHp: attackerTemplate.maxHp,
        hasRetaliated: false,
        defending: false
      },
      attackerBattleSkills,
      battleCatalogIndex
    ),
    [`${defenderHero.id}-stack`]: buildUnitStack(
      {
        id: `${defenderHero.id}-stack`,
        templateId: defenderHero.armyTemplateId,
        camp: "defender",
        lane: defenderLanes[0] ?? 0,
        stackName: defenderTemplate.stackName,
        initiative: defenderTemplate.initiative,
        attack: defenderTemplate.attack + defenderHero.stats.attack + defenderEquipment.attack,
        defense: defenderTemplate.defense + defenderHero.stats.defense + defenderEquipment.defense,
        minDamage: defenderTemplate.minDamage,
        maxDamage: defenderTemplate.maxDamage,
        count: defenderHero.armyCount,
        currentHp: defenderTemplate.maxHp,
        maxHp: defenderTemplate.maxHp,
        hasRetaliated: false,
        defending: false
      },
      defenderBattleSkills,
      battleCatalogIndex
    )
  };

  const turnOrder = sortTurnOrder(units);
  const environment = createBattleEnvironmentState(lanes, seed);
  return {
    id: `battle-${attackerHero.id}-vs-${defenderHero.id}`,
    round: 1,
    lanes,
    activeUnitId: turnOrder[0] ?? null,
    turnOrder,
    units,
    environment,
    log: [
      `${attackerHero.name} 遭遇 ${defenderHero.name}`,
      ...visibleEnvironmentLog(environment, battleCatalogIndex)
    ],
    rng: {
      seed,
      cursor: 0
    },
    worldHeroId: attackerHero.id,
    defenderHeroId: defenderHero.id,
    encounterPosition: defenderHero.position
  };
}

export function getBattleOutcome(state: BattleState): BattleOutcome {
  const attackers = Object.values(state.units).filter((unit) => unit.camp === "attacker" && unit.count > 0);
  const defenders = Object.values(state.units).filter((unit) => unit.camp === "defender" && unit.count > 0);

  if (attackers.length > 0 && defenders.length > 0) {
    return { status: "in_progress" };
  }

  if (attackers.length > 0) {
    return {
      status: "attacker_victory",
      survivingAttackers: attackers.map((unit) => unit.id),
      survivingDefenders: []
    };
  }

  return {
    status: "defender_victory",
    survivingAttackers: [],
    survivingDefenders: defenders.map((unit) => unit.id)
  };
}

export function applyBattleAction(state: BattleState, action: BattleAction): BattleState {
  const { state: normalizedState, validation } = validateAction(
    state,
    action,
    validateBattleAction,
    normalizeBattleState
  );
  if (!validation.valid) {
    return {
      ...normalizedState,
      log: normalizedState.log.concat(`Action rejected: ${validation.reason}`)
    };
  }

  if (action.type === "battle.wait") {
    return advanceTurn(
      {
        ...normalizedState,
        log: normalizedState.log.concat(`${action.unitId} 选择等待`)
      },
      action.unitId,
      true
    );
  }

  if (action.type === "battle.defend") {
    return advanceTurn(
      {
        ...normalizedState,
        units: {
          ...normalizedState.units,
          [action.unitId]: {
            ...normalizedState.units[action.unitId]!,
            defending: true
          }
        },
        log: normalizedState.log.concat(`${action.unitId} 进入防御`)
      },
      action.unitId,
      false
    );
  }

  if (action.type === "battle.skill") {
    return executeBattleSkill(normalizedState, action.unitId, action.skillId, action.targetId);
  }

  if (action.type !== "battle.attack") {
    return normalizedState;
  }

  return applyAttackSequence(normalizedState, action.attackerId, action.defenderId);
}

function visibleEnvironmentLog(environment: BattleHazardState[], catalogIndex: BattleCatalogIndex): string[] {
  const visibleHazards = environment.filter((hazard) => hazard.kind === "blocker" || hazard.revealed);
  return visibleHazards.length > 0
    ? [`战场环境：${visibleHazards.map((hazard) => describeHazard(hazard, catalogIndex)).join(" / ")}`]
    : [];
}
