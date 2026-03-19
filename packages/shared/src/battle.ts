import type {
  BattleAction,
  BattleOutcome,
  BattleState,
  HeroState,
  NeutralArmyState,
  UnitStack,
  ValidationResult
} from "./models";
import { getDefaultUnitCatalog } from "./world-config";

interface RngStep {
  nextSeed: number;
  value: number;
}

function nextRng(seed: number): RngStep {
  const nextSeed = (seed * 1664525 + 1013904223) >>> 0;
  return {
    nextSeed,
    value: nextSeed / 0x100000000
  };
}

function sortTurnOrder(units: Record<string, UnitStack>): string[] {
  return Object.values(units)
    .filter((unit) => unit.count > 0)
    .sort((a, b) => b.initiative - a.initiative)
    .map((unit) => unit.id);
}

function averageDamage(unit: UnitStack): number {
  return (unit.minDamage + unit.maxDamage) / 2;
}

function estimateDamage(attacker: UnitStack, defender: UnitStack, randomValue: number): number {
  const defenseBonus = defender.defending ? 5 : 0;
  const offenseModifier = 1 + (attacker.attack - (defender.defense + defenseBonus)) * 0.05;
  const variance = 0.9 + randomValue * 0.2;
  return Math.max(1, Math.floor(attacker.count * averageDamage(attacker) * Math.max(0.3, offenseModifier) * variance));
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

function advanceTurn(state: BattleState, actingUnitId: string, waited: boolean): BattleState {
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
      activeUnitId: nextQueue[0] ?? null,
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
    activeUnitId: refreshedOrder[0] ?? null,
    turnOrder: refreshedOrder,
    units: refreshedUnits
  };
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
    activeUnitId: null,
    turnOrder: [],
    units: {},
    log: [],
    rng: {
      seed: 1,
      cursor: 0
    }
  };
}

export function createDemoBattleState(): BattleState {
  const units: Record<string, UnitStack> = {
    "pikeman-a": {
      id: "pikeman-a",
      templateId: "hero_guard_basic",
      camp: "attacker",
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
    "wolf-d": {
      id: "wolf-d",
      templateId: "wolf_pack",
      camp: "defender",
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
    }
  };

  const turnOrder = sortTurnOrder(units);
  return {
    id: "battle-demo",
    round: 1,
    activeUnitId: turnOrder[0] ?? null,
    turnOrder,
    units,
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
  const templateById = new Map(catalog.templates.map((template) => [template.id, template]));
  const heroTemplate = templateById.get(hero.armyTemplateId);
  if (!heroTemplate) {
    throw new Error(`Missing hero army template: ${hero.armyTemplateId}`);
  }

  units[`${hero.id}-stack`] = {
    id: `${hero.id}-stack`,
    templateId: hero.armyTemplateId,
    camp: "attacker",
    stackName: heroTemplate.stackName,
    initiative: heroTemplate.initiative,
    attack: heroTemplate.attack + hero.stats.attack,
    defense: heroTemplate.defense + hero.stats.defense,
    minDamage: heroTemplate.minDamage,
    maxDamage: heroTemplate.maxDamage,
    count: hero.armyCount,
    currentHp: heroTemplate.maxHp,
    maxHp: heroTemplate.maxHp,
    hasRetaliated: false,
    defending: false
  };

  for (const [index, stack] of neutralArmy.stacks.entries()) {
    const template = templateById.get(stack.templateId);
    if (!template) {
      throw new Error(`Missing neutral unit template: ${stack.templateId}`);
    }
    const id = `${neutralArmy.id}-stack-${index + 1}`;
    units[id] = {
      id,
      templateId: stack.templateId,
      camp: "defender",
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
    };
  }

  const turnOrder = sortTurnOrder(units);
  return {
    id: `battle-${neutralArmy.id}`,
    round: 1,
    activeUnitId: turnOrder[0] ?? null,
    turnOrder,
    units,
    log: [`${hero.name} 遭遇 ${neutralArmy.id}`],
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
  const templateById = new Map(catalog.templates.map((template) => [template.id, template]));
  const attackerTemplate = templateById.get(attackerHero.armyTemplateId);
  const defenderTemplate = templateById.get(defenderHero.armyTemplateId);
  if (!attackerTemplate || !defenderTemplate) {
    throw new Error("Missing hero army template for PvP battle");
  }

  const units: Record<string, UnitStack> = {
    [`${attackerHero.id}-stack`]: {
      id: `${attackerHero.id}-stack`,
      templateId: attackerHero.armyTemplateId,
      camp: "attacker",
      stackName: attackerTemplate.stackName,
      initiative: attackerTemplate.initiative,
      attack: attackerTemplate.attack + attackerHero.stats.attack,
      defense: attackerTemplate.defense + attackerHero.stats.defense,
      minDamage: attackerTemplate.minDamage,
      maxDamage: attackerTemplate.maxDamage,
      count: attackerHero.armyCount,
      currentHp: attackerTemplate.maxHp,
      maxHp: attackerTemplate.maxHp,
      hasRetaliated: false,
      defending: false
    },
    [`${defenderHero.id}-stack`]: {
      id: `${defenderHero.id}-stack`,
      templateId: defenderHero.armyTemplateId,
      camp: "defender",
      stackName: defenderTemplate.stackName,
      initiative: defenderTemplate.initiative,
      attack: defenderTemplate.attack + defenderHero.stats.attack,
      defense: defenderTemplate.defense + defenderHero.stats.defense,
      minDamage: defenderTemplate.minDamage,
      maxDamage: defenderTemplate.maxDamage,
      count: defenderHero.armyCount,
      currentHp: defenderTemplate.maxHp,
      maxHp: defenderTemplate.maxHp,
      hasRetaliated: false,
      defending: false
    }
  };

  const turnOrder = sortTurnOrder(units);
  return {
    id: `battle-${attackerHero.id}-vs-${defenderHero.id}`,
    round: 1,
    activeUnitId: turnOrder[0] ?? null,
    turnOrder,
    units,
    log: [`${attackerHero.name} 遭遇 ${defenderHero.name}`],
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
  const validation = validateBattleAction(state, action);
  if (!validation.valid) {
    return {
      ...state,
      log: state.log.concat(`Action rejected: ${validation.reason}`)
    };
  }

  if (action.type === "battle.wait") {
    return advanceTurn(
      {
        ...state,
        log: state.log.concat(`${action.unitId} 选择等待`)
      },
      action.unitId,
      true
    );
  }

  if (action.type === "battle.defend") {
    return advanceTurn(
      {
        ...state,
        units: {
          ...state.units,
          [action.unitId]: {
            ...state.units[action.unitId]!,
            defending: true
          }
        },
        log: state.log.concat(`${action.unitId} 进入防御`)
      },
      action.unitId,
      false
    );
  }

  const attacker = state.units[action.attackerId]!;
  const defender = state.units[action.defenderId]!;
  const attackRoll = nextRng(state.rng.seed);
  const attackDamage = estimateDamage(attacker, defender, attackRoll.value);
  const nextUnits: Record<string, UnitStack> = {
    ...state.units,
    [defender.id]: applyDamage(defender, attackDamage)
  };
  let nextRngState = {
    seed: attackRoll.nextSeed,
    cursor: state.rng.cursor + 1
  };
  const log = state.log.concat(`${attacker.stackName} 对 ${defender.stackName} 造成 ${attackDamage} 伤害`);

  const damagedDefender = nextUnits[defender.id]!;
  if (damagedDefender.count > 0 && !damagedDefender.hasRetaliated) {
    const retaliationRoll = nextRng(nextRngState.seed);
    const retaliationDamage = estimateDamage(damagedDefender, attacker, retaliationRoll.value);
    nextUnits[attacker.id] = applyDamage(attacker, retaliationDamage);
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
      ...state,
      units: nextUnits,
      log,
      rng: nextRngState
    },
    attacker.id,
    false
  );
}
