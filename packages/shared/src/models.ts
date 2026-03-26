export type TerrainType = "grass" | "dirt" | "sand" | "water";
export type FogState = "hidden" | "explored" | "visible";
export type ResourceKind = "gold" | "wood" | "ore";
export type OccupantKind = "hero" | "neutral" | "building";
export type BuildingKind = "recruitment_post" | "attribute_shrine" | "resource_mine";
export type ResourceLedger = Record<ResourceKind, number>;
export type WorldResourceLedger = Record<string, ResourceLedger>;

export interface Vec2 {
  x: number;
  y: number;
}

export interface HeroStats {
  attack: number;
  defense: number;
  power: number;
  knowledge: number;
  hp: number;
  maxHp: number;
}

export type HeroStatBonus = Pick<HeroStats, "attack" | "defense" | "power" | "knowledge">;

export type HeroSkillId = string;
export type HeroSkillBranchId = string;
export type EquipmentId = string;
export type EquipmentType = "weapon" | "armor" | "accessory";
export type EquipmentRarity = "common" | "rare" | "epic";
export type EquipmentSpecialEffectId = "initiative_edge" | "brace" | "channeling" | "momentum" | "ward";

export interface EquipmentStatBonuses {
  attackPercent: number;
  defensePercent: number;
  power: number;
  knowledge: number;
  maxHp: number;
}

export interface EquipmentSpecialEffectConfig {
  id: EquipmentSpecialEffectId;
  name: string;
  description: string;
}

export interface EquipmentDefinition {
  id: EquipmentId;
  name: string;
  type: EquipmentType;
  rarity: EquipmentRarity;
  description: string;
  bonuses: Partial<EquipmentStatBonuses>;
  specialEffect?: EquipmentSpecialEffectConfig;
}

export interface EquipmentCatalogConfig {
  entries: EquipmentDefinition[];
}

export interface HeroLearnedSkillState {
  skillId: HeroSkillId;
  rank: number;
}

export interface HeroSkillBranchConfig {
  id: HeroSkillBranchId;
  name: string;
  description: string;
}

export interface HeroSkillRankConfig {
  rank: number;
  description: string;
  battleSkillIds?: BattleSkillId[];
}

export interface HeroSkillConfig {
  id: HeroSkillId;
  branchId: HeroSkillBranchId;
  name: string;
  description: string;
  requiredLevel: number;
  maxRank: number;
  prerequisites?: HeroSkillId[];
  ranks: HeroSkillRankConfig[];
}

export interface HeroSkillTreeConfig {
  branches: HeroSkillBranchConfig[];
  skills: HeroSkillConfig[];
}

export interface BattleDamageBalanceConfig {
  defendingDefenseBonus: number;
  offenseAdvantageStep: number;
  minimumOffenseMultiplier: number;
  varianceBase: number;
  varianceRange: number;
}

export interface BattleEnvironmentBalanceConfig {
  blockerSpawnThreshold: number;
  blockerDurability: number;
  trapSpawnThreshold: number;
  trapDamage: number;
  trapCharges: number;
  trapGrantedStatusId?: BattleStatusEffectId;
}

export interface BattleBalanceConfig {
  damage: BattleDamageBalanceConfig;
  environment: BattleEnvironmentBalanceConfig;
}

export interface MovePoints {
  total: number;
  remaining: number;
}

export interface HeroProgression {
  level: number;
  experience: number;
  skillPoints: number;
  battlesWon: number;
  neutralBattlesWon: number;
  pvpBattlesWon: number;
}

export interface HeroBattleSkillState {
  skillId: BattleSkillId;
  rank: number;
}

export interface HeroEquipmentSlots {
  weaponId?: EquipmentId;
  armorId?: EquipmentId;
  accessoryId?: EquipmentId;
}

export interface HeroEquipmentState {
  weaponId?: EquipmentId;
  armorId?: EquipmentId;
  accessoryId?: EquipmentId;
  trinketIds: EquipmentId[];
}

export interface HeroLoadout {
  learnedSkills: HeroBattleSkillState[];
  equipment: HeroEquipmentState;
  inventory: EquipmentId[];
}

export interface HeroState {
  id: string;
  playerId: string;
  name: string;
  position: Vec2;
  vision: number;
  move: MovePoints;
  stats: HeroStats;
  progression: HeroProgression;
  loadout: HeroLoadout;
  armyTemplateId: string;
  armyCount: number;
  learnedSkills: HeroLearnedSkillState[];
}

export interface HeroBattleSkillConfig {
  skillId: BattleSkillId;
  rank?: number;
}

export interface HeroEquipmentConfig {
  weaponId?: EquipmentId;
  armorId?: EquipmentId;
  accessoryId?: EquipmentId;
  trinketIds?: EquipmentId[];
}

export interface HeroLoadoutConfig {
  learnedSkills?: HeroBattleSkillConfig[];
  equipment?: HeroEquipmentConfig | null;
  inventory?: EquipmentId[] | null;
}

export interface ResourceNode {
  kind: ResourceKind;
  amount: number;
}

export interface OccupantState {
  kind: OccupantKind;
  refId: string;
}

export interface RecruitmentBuildingConfig {
  id: string;
  kind: "recruitment_post";
  position: Vec2;
  label: string;
  unitTemplateId: string;
  recruitCount: number;
  cost: ResourceLedger;
}

export interface AttributeShrineBuildingConfig {
  id: string;
  kind: "attribute_shrine";
  position: Vec2;
  label: string;
  bonus: HeroStatBonus;
}

export interface ResourceMineBuildingConfig {
  id: string;
  kind: "resource_mine";
  position: Vec2;
  label: string;
  resourceKind: ResourceKind;
  income: number;
}

export type MapBuildingConfig =
  | RecruitmentBuildingConfig
  | AttributeShrineBuildingConfig
  | ResourceMineBuildingConfig;

export interface RecruitmentBuildingState extends RecruitmentBuildingConfig {
  availableCount: number;
  lastUsedDay?: number;
}

export interface AttributeShrineBuildingState extends AttributeShrineBuildingConfig {
  lastUsedDay?: number;
}

export interface ResourceMineBuildingState extends ResourceMineBuildingConfig {
  lastHarvestDay?: number;
}

export type MapBuildingState =
  | RecruitmentBuildingState
  | AttributeShrineBuildingState
  | ResourceMineBuildingState;

export interface RecruitmentBuildingView {
  id: string;
  kind: "recruitment_post";
  label: string;
  unitTemplateId: string;
  recruitCount: number;
  availableCount: number;
  cost: ResourceLedger;
  lastUsedDay?: number;
}

export interface AttributeShrineBuildingView {
  id: string;
  kind: "attribute_shrine";
  label: string;
  bonus: HeroStatBonus;
  lastUsedDay?: number;
}

export interface ResourceMineBuildingView {
  id: string;
  kind: "resource_mine";
  label: string;
  resourceKind: ResourceKind;
  income: number;
  lastHarvestDay?: number;
}

export type PlayerBuildingView =
  | RecruitmentBuildingView
  | AttributeShrineBuildingView
  | ResourceMineBuildingView;

export interface TileState {
  position: Vec2;
  terrain: TerrainType;
  walkable: boolean;
  resource: ResourceNode | undefined;
  occupant: OccupantState | undefined;
  building: MapBuildingState | undefined;
}

export interface WorldMapState {
  width: number;
  height: number;
  tiles: TileState[];
}

export interface WorldMetaState {
  roomId: string;
  seed: number;
  day: number;
}

export interface WorldState {
  meta: WorldMetaState;
  map: WorldMapState;
  heroes: HeroState[];
  neutralArmies: Record<string, NeutralArmyState>;
  buildings: Record<string, MapBuildingState>;
  resources: WorldResourceLedger;
  visibilityByPlayer: Record<string, FogState[]>;
}

export interface NeutralArmyStack {
  templateId: string;
  count: number;
}

export type NeutralBehaviorMode = "guard" | "patrol";
export type NeutralMoveReason = "patrol" | "return" | "chase";
export type NeutralAIState = "patrol" | "chase" | "return";

export interface NeutralArmyBehaviorConfig {
  mode?: NeutralBehaviorMode;
  patrolPath?: Vec2[];
  aggroRange?: number;
  patrolRadius?: number;
  detectionRadius?: number;
  chaseDistance?: number;
  speed?: number;
}

export interface NeutralArmyBehaviorState {
  mode: NeutralBehaviorMode;
  patrolPath: Vec2[];
  patrolIndex: number;
  patrolRadius: number;
  detectionRadius: number;
  chaseDistance: number;
  speed: number;
  state: NeutralAIState;
  targetHeroId?: string;
}

export interface NeutralArmyState {
  id: string;
  position: Vec2;
  reward: ResourceNode | undefined;
  stacks: NeutralArmyStack[];
  origin?: Vec2;
  behavior?: NeutralArmyBehaviorState;
}

export interface PlayerTileView {
  position: Vec2;
  fog: FogState;
  terrain: TerrainType | "unknown";
  walkable: boolean;
  resource: ResourceNode | undefined;
  occupant: OccupantState | undefined;
  building: PlayerBuildingView | undefined;
}

export interface PlayerWorldView {
  meta: WorldMetaState;
  map: {
    width: number;
    height: number;
    tiles: PlayerTileView[];
  };
  ownHeroes: HeroState[];
  visibleHeroes: Array<{
    id: string;
    playerId: string;
    name: string;
    position: Vec2;
  }>;
  resources: ResourceLedger;
  playerId: string;
}

export interface PlayerWorldPrediction {
  world: PlayerWorldView;
  movementPlan: MovementPlan | null;
  reachableTiles: Vec2[];
  reason?: string;
}

export interface MovementPlan {
  heroId: string;
  destination: Vec2;
  path: Vec2[];
  travelPath: Vec2[];
  moveCost: number;
  endsInEncounter: boolean;
  encounterKind: "none" | "neutral" | "hero";
  encounterRefId?: string;
}

export type BattleSkillId = string;
export type BattleSkillKind = "active" | "passive";
export type BattleSkillTarget = "enemy" | "self";
export type BattleSkillDelivery = "contact" | "ranged";
export type BattleStatusEffectId = string;

export interface BattleSkillState {
  id: BattleSkillId;
  name: string;
  description: string;
  kind: BattleSkillKind;
  target: BattleSkillTarget;
  delivery?: BattleSkillDelivery;
  cooldown: number;
  remainingCooldown: number;
}

export interface BattleStatusEffectState {
  id: BattleStatusEffectId;
  name: string;
  description: string;
  durationRemaining: number;
  attackModifier: number;
  defenseModifier: number;
  damagePerTurn: number;
  initiativeModifier: number;
  blocksActiveSkills: boolean;
  sourceUnitId?: string;
}

export interface UnitStack {
  id: string;
  templateId: string;
  camp: "attacker" | "defender";
  lane: number;
  stackName: string;
  initiative: number;
  attack: number;
  defense: number;
  minDamage: number;
  maxDamage: number;
  count: number;
  currentHp: number;
  maxHp: number;
  hasRetaliated: boolean;
  defending: boolean;
  skills?: BattleSkillState[];
  statusEffects?: BattleStatusEffectState[];
}

export interface BattleBlockerState {
  id: string;
  kind: "blocker";
  lane: number;
  name: string;
  description: string;
  durability: number;
  maxDurability: number;
}

export interface BattleTrapState {
  id: string;
  kind: "trap";
  lane: number;
  effect: "damage" | "slow" | "silence";
  name: string;
  description: string;
  damage: number;
  charges: number;
  revealed: boolean;
  triggered: boolean;
  grantedStatusId?: BattleStatusEffectId;
  triggeredByCamp?: "attacker" | "defender" | "both";
}

export type BattleHazardState = BattleBlockerState | BattleTrapState;

export interface DeterministicRngState {
  seed: number;
  cursor: number;
}

export interface BattleState {
  id: string;
  round: number;
  lanes: number;
  activeUnitId: string | null;
  turnOrder: string[];
  units: Record<string, UnitStack>;
  environment: BattleHazardState[];
  log: string[];
  rng: DeterministicRngState;
  worldHeroId?: string;
  neutralArmyId?: string;
  defenderHeroId?: string;
  encounterPosition?: Vec2;
}

export type WorldAction =
  | {
      type: "hero.move";
      heroId: string;
      destination: Vec2;
    }
  | {
      type: "hero.collect";
      heroId: string;
      position: Vec2;
    }
  | {
      type: "hero.recruit";
      heroId: string;
      buildingId: string;
    }
  | {
      type: "hero.visit";
      heroId: string;
      buildingId: string;
    }
  | {
      type: "hero.claimMine";
      heroId: string;
      buildingId: string;
    }
  | {
      type: "hero.learnSkill";
      heroId: string;
      skillId: HeroSkillId;
    }
  | {
      type: "hero.equip";
      heroId: string;
      slot: EquipmentType;
      equipmentId: EquipmentId;
    }
  | {
      type: "hero.unequip";
      heroId: string;
      slot: EquipmentType;
    }
  | {
      type: "turn.endDay";
    };

export type BattleAction =
  | {
      type: "battle.attack";
      attackerId: string;
      defenderId: string;
    }
  | {
      type: "battle.wait";
      unitId: string;
    }
  | {
      type: "battle.defend";
      unitId: string;
    }
  | {
      type: "battle.skill";
      unitId: string;
      skillId: BattleSkillId;
      targetId?: string;
    };

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export type WorldEvent =
  | {
      type: "hero.moved";
      heroId: string;
      path: Vec2[];
      moveCost: number;
    }
  | {
      type: "hero.collected";
      heroId: string;
      resource: ResourceNode;
    }
  | {
      type: "hero.recruited";
      heroId: string;
      buildingId: string;
      buildingKind: BuildingKind;
      unitTemplateId: string;
      count: number;
      cost: ResourceLedger;
    }
  | {
      type: "hero.visited";
      heroId: string;
      buildingId: string;
      buildingKind: "attribute_shrine";
      bonus: HeroStatBonus;
    }
  | {
      type: "hero.claimedMine";
      heroId: string;
      buildingId: string;
      buildingKind: "resource_mine";
      resourceKind: ResourceKind;
      income: number;
      ownerPlayerId: string;
    }
  | {
      type: "resource.produced";
      playerId: string;
      buildingId: string;
      buildingKind: "resource_mine";
      resource: ResourceNode;
    }
  | {
      type: "neutral.moved";
      neutralArmyId: string;
      from: Vec2;
      to: Vec2;
      reason: NeutralMoveReason;
      targetHeroId?: string;
    }
  | {
      type: "hero.progressed";
      heroId: string;
      battleId: string;
      battleKind: "neutral" | "hero";
      experienceGained: number;
      totalExperience: number;
      level: number;
      levelsGained: number;
      skillPointsAwarded: number;
      availableSkillPoints: number;
    }
  | {
      type: "hero.skillLearned";
      heroId: string;
      skillId: HeroSkillId;
      branchId: HeroSkillBranchId;
      skillName: string;
      branchName: string;
      newRank: number;
      spentPoint: number;
      remainingSkillPoints: number;
      newlyGrantedBattleSkillIds: BattleSkillId[];
    }
  | {
      type: "hero.equipmentChanged";
      heroId: string;
      slot: EquipmentType;
      equippedItemId?: EquipmentId;
      unequippedItemId?: EquipmentId;
    }
  | {
      type: "battle.started";
      heroId: string;
      encounterKind: "neutral" | "hero";
      neutralArmyId?: string;
      defenderHeroId?: string;
      initiator?: "hero" | "neutral";
      battleId: string;
      path: Vec2[];
      moveCost: number;
    }
  | {
      type: "turn.advanced";
      day: number;
    }
  | {
      type: "battle.resolved";
      heroId: string;
      defenderHeroId?: string;
      battleId: string;
      result: "attacker_victory" | "defender_victory";
    };

export interface WorldActionOutcome {
  state: WorldState;
  events: WorldEvent[];
  movementPlan?: MovementPlan;
}

export type BattleOutcome =
  | {
      status: "in_progress";
    }
  | {
      status: "attacker_victory";
      survivingAttackers: string[];
      survivingDefenders: string[];
    }
  | {
      status: "defender_victory";
      survivingAttackers: string[];
      survivingDefenders: string[];
    };

export interface HeroConfig {
  id: string;
  playerId: string;
  name: string;
  position: Vec2;
  vision: number;
  move: MovePoints;
  stats: HeroStats;
  progression?: Partial<HeroProgression>;
  loadout?: HeroLoadoutConfig | null;
  armyTemplateId: string;
  armyCount: number;
  learnedSkills?: HeroLearnedSkillState[] | null;
}

export function createDefaultHeroProgression(): HeroProgression {
  return {
    level: 1,
    experience: 0,
    skillPoints: 0,
    battlesWon: 0,
    neutralBattlesWon: 0,
    pvpBattlesWon: 0
  };
}

export function createDefaultEquipmentStatBonuses(): EquipmentStatBonuses {
  return {
    attackPercent: 0,
    defensePercent: 0,
    power: 0,
    knowledge: 0,
    maxHp: 0
  };
}

export function createDefaultHeroEquipment(): HeroEquipmentState {
  return {
    trinketIds: []
  };
}

export function normalizeHeroEquipment(
  equipment?: HeroEquipmentConfig | HeroEquipmentState | null
): HeroEquipmentState {
  const trinketIds = Array.from(
    new Set(
      (equipment?.trinketIds ?? [])
        .filter((itemId): itemId is string => typeof itemId === "string")
        .map((itemId) => itemId.trim())
        .filter((itemId) => itemId.length > 0)
    )
  );

  return {
    ...createDefaultHeroEquipment(),
    ...(equipment?.weaponId?.trim() ? { weaponId: equipment.weaponId.trim() } : {}),
    ...(equipment?.armorId?.trim() ? { armorId: equipment.armorId.trim() } : {}),
    ...(equipment?.accessoryId?.trim() ? { accessoryId: equipment.accessoryId.trim() } : {}),
    trinketIds
  };
}

export function createDefaultHeroLoadout(): HeroLoadout {
  return {
    learnedSkills: [],
    equipment: createDefaultHeroEquipment(),
    inventory: []
  };
}

export function normalizeHeroEquipmentInventory(
  inventory?: EquipmentId[] | null
): EquipmentId[] {
  return (inventory ?? [])
    .filter((itemId): itemId is string => typeof itemId === "string")
    .map((itemId) => itemId.trim())
    .filter((itemId) => itemId.length > 0);
}

export function normalizeHeroLearnedSkills(
  learnedSkills?: HeroLearnedSkillState[] | null
): HeroLearnedSkillState[] {
  const byId = new Map<HeroSkillId, HeroLearnedSkillState>();

  for (const learnedSkill of learnedSkills ?? []) {
    const skillId = learnedSkill?.skillId?.trim();
    if (!skillId) {
      continue;
    }

    const rank = Math.max(1, Math.floor(learnedSkill.rank ?? 1));
    const previous = byId.get(skillId);
    if (!previous || rank > previous.rank) {
      byId.set(skillId, {
        skillId,
        rank
      });
    }
  }

  return Array.from(byId.values()).sort((left, right) => left.skillId.localeCompare(right.skillId));
}

export function normalizeHeroBattleSkills(
  learnedSkills?: HeroBattleSkillState[] | HeroBattleSkillConfig[] | null
): HeroBattleSkillState[] {
  const byId = new Map<BattleSkillId, HeroBattleSkillState>();

  for (const learnedSkill of learnedSkills ?? []) {
    const skillId = learnedSkill?.skillId?.trim();
    if (!skillId) {
      continue;
    }

    const rank = Math.max(1, Math.floor(learnedSkill.rank ?? 1));
    const previous = byId.get(skillId);
    if (!previous || rank > previous.rank) {
      byId.set(skillId, {
        skillId,
        rank
      });
    }
  }

  return Array.from(byId.values()).sort((left, right) => left.skillId.localeCompare(right.skillId));
}

export function normalizeHeroLoadout(
  loadout?: HeroLoadoutConfig | HeroLoadout | null
): HeroLoadout {
  return {
    ...createDefaultHeroLoadout(),
    learnedSkills: normalizeHeroBattleSkills(loadout?.learnedSkills),
    equipment: normalizeHeroEquipment(loadout?.equipment),
    inventory: normalizeHeroEquipmentInventory(loadout?.inventory)
  };
}

export function normalizeHeroProgression(
  progression?: Partial<HeroProgression> | null
): HeroProgression {
  const experience = Math.max(0, Math.floor(progression?.experience ?? 0));
  const minimumLevelFromExperience = levelForExperience(experience);

  return {
    ...createDefaultHeroProgression(),
    ...progression,
    level: Math.max(Math.max(1, Math.floor(progression?.level ?? 1)), minimumLevelFromExperience),
    experience,
    skillPoints: Math.max(0, Math.floor(progression?.skillPoints ?? 0)),
    battlesWon: Math.max(0, Math.floor(progression?.battlesWon ?? 0)),
    neutralBattlesWon: Math.max(0, Math.floor(progression?.neutralBattlesWon ?? 0)),
    pvpBattlesWon: Math.max(0, Math.floor(progression?.pvpBattlesWon ?? 0))
  };
}

export function experienceRequiredForNextLevel(level: number): number {
  const safeLevel = Math.max(1, Math.floor(level));
  return 100 + (safeLevel - 1) * 75;
}

export function totalExperienceRequiredForLevel(level: number): number {
  let total = 0;
  for (let currentLevel = 1; currentLevel < Math.max(1, Math.floor(level)); currentLevel += 1) {
    total += experienceRequiredForNextLevel(currentLevel);
  }
  return total;
}

export function levelForExperience(experience: number): number {
  const safeExperience = Math.max(0, Math.floor(experience));
  let level = 1;
  while (safeExperience >= totalExperienceRequiredForLevel(level + 1)) {
    level += 1;
  }
  return level;
}

export function normalizeHeroState<T extends HeroConfig | HeroState>(hero: T): HeroState {
  return {
    ...hero,
    position: { ...hero.position },
    move: { ...hero.move },
    stats: { ...hero.stats },
    progression: normalizeHeroProgression(hero.progression),
    loadout: normalizeHeroLoadout(hero.loadout),
    learnedSkills: normalizeHeroLearnedSkills(hero.learnedSkills)
  };
}

export interface NeutralArmyConfig {
  id: string;
  position: Vec2;
  reward: ResourceNode | undefined;
  stacks: NeutralArmyStack[];
  behavior?: NeutralArmyBehaviorConfig;
}

export interface GuaranteedResourceConfig {
  position: Vec2;
  resource: ResourceNode;
}

export interface ResourceSpawnConfig {
  goldChance: number;
  woodChance: number;
  oreChance: number;
}

export interface WorldGenerationConfig {
  width: number;
  height: number;
  heroes: HeroConfig[];
  resourceSpawn: ResourceSpawnConfig;
}

export interface MapObjectsConfig {
  neutralArmies: NeutralArmyConfig[];
  guaranteedResources: GuaranteedResourceConfig[];
  buildings: MapBuildingConfig[];
}

export interface UnitTemplateConfig {
  id: string;
  stackName: string;
  faction: "crown" | "wild";
  rarity: "common" | "elite";
  initiative: number;
  attack: number;
  defense: number;
  minDamage: number;
  maxDamage: number;
  maxHp: number;
  battleSkills?: BattleSkillId[];
}

export interface UnitCatalogConfig {
  templates: UnitTemplateConfig[];
}

export interface BattleSkillEffectConfig {
  damageMultiplier?: number;
  allowRetaliation?: boolean;
  grantedStatusId?: BattleStatusEffectId;
  onHitStatusId?: BattleStatusEffectId;
}

export interface BattleSkillConfig {
  id: BattleSkillId;
  name: string;
  description: string;
  kind: BattleSkillKind;
  target: BattleSkillTarget;
  delivery?: BattleSkillDelivery;
  cooldown: number;
  effects?: BattleSkillEffectConfig;
}

export interface BattleStatusEffectConfig {
  id: BattleStatusEffectId;
  name: string;
  description: string;
  duration: number;
  attackModifier: number;
  defenseModifier: number;
  damagePerTurn: number;
  initiativeModifier?: number;
  blocksActiveSkills?: boolean;
}

export interface BattleSkillCatalogConfig {
  skills: BattleSkillConfig[];
  statuses: BattleStatusEffectConfig[];
}
