export type TerrainType = "grass" | "dirt" | "sand" | "water";
export type FogState = "hidden" | "explored" | "visible";
export type ResourceKind = "gold" | "wood" | "ore";
export type OccupantKind = "hero" | "neutral" | "building";
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

export interface MovePoints {
  total: number;
  remaining: number;
}

export interface HeroProgression {
  level: number;
  experience: number;
  battlesWon: number;
  neutralBattlesWon: number;
  pvpBattlesWon: number;
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
  armyTemplateId: string;
  armyCount: number;
}

export interface ResourceNode {
  kind: ResourceKind;
  amount: number;
}

export interface OccupantState {
  kind: OccupantKind;
  refId: string;
}

export interface TileState {
  position: Vec2;
  terrain: TerrainType;
  walkable: boolean;
  resource: ResourceNode | undefined;
  occupant: OccupantState | undefined;
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
  resources: WorldResourceLedger;
  visibilityByPlayer: Record<string, FogState[]>;
}

export interface NeutralArmyStack {
  templateId: string;
  count: number;
}

export interface NeutralArmyState {
  id: string;
  position: Vec2;
  reward: ResourceNode | undefined;
  stacks: NeutralArmyStack[];
}

export interface PlayerTileView {
  position: Vec2;
  fog: FogState;
  terrain: TerrainType | "unknown";
  walkable: boolean;
  resource: ResourceNode | undefined;
  occupant: OccupantState | undefined;
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

export interface UnitStack {
  id: string;
  templateId: string;
  camp: "attacker" | "defender";
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
}

export interface DeterministicRngState {
  seed: number;
  cursor: number;
}

export interface BattleState {
  id: string;
  round: number;
  activeUnitId: string | null;
  turnOrder: string[];
  units: Record<string, UnitStack>;
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
      type: "hero.progressed";
      heroId: string;
      battleId: string;
      battleKind: "neutral" | "hero";
      experienceGained: number;
      totalExperience: number;
      level: number;
      levelsGained: number;
    }
  | {
      type: "battle.started";
      heroId: string;
      encounterKind: "neutral" | "hero";
      neutralArmyId?: string;
      defenderHeroId?: string;
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
  armyTemplateId: string;
  armyCount: number;
}

export function createDefaultHeroProgression(): HeroProgression {
  return {
    level: 1,
    experience: 0,
    battlesWon: 0,
    neutralBattlesWon: 0,
    pvpBattlesWon: 0
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
    progression: normalizeHeroProgression(hero.progression)
  };
}

export interface NeutralArmyConfig {
  id: string;
  position: Vec2;
  reward: ResourceNode | undefined;
  stacks: NeutralArmyStack[];
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
}

export interface UnitCatalogConfig {
  templates: UnitTemplateConfig[];
}
