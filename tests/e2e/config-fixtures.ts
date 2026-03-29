import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ResourceKind = "gold" | "wood" | "ore";

interface HeroConfig {
  playerId: string;
  move: {
    total: number;
  };
  stats: {
    attack: number;
    defense: number;
    power: number;
    knowledge: number;
  };
  armyCount: number;
}

interface WorldConfig {
  heroes: HeroConfig[];
}

interface RecruitmentPostConfig {
  id: string;
  kind: "recruitment_post";
  unitTemplateId: string;
  recruitCount: number;
  cost: {
    gold: number;
    wood: number;
    ore: number;
  };
}

interface AttributeShrineConfig {
  id: string;
  kind: "attribute_shrine";
  bonus: {
    attack: number;
    defense: number;
    power: number;
    knowledge: number;
  };
}

interface ResourceMineConfig {
  id: string;
  kind: "resource_mine";
  resourceKind: ResourceKind;
  income: number;
}

interface NeutralArmyConfig {
  id: string;
  reward: {
    kind: ResourceKind;
    amount: number;
  };
}

interface MapObjectsConfig {
  neutralArmies: NeutralArmyConfig[];
  buildings: Array<RecruitmentPostConfig | AttributeShrineConfig | ResourceMineConfig>;
}

interface HeroStats {
  attack: number;
  defense: number;
  power: number;
  knowledge: number;
}

interface E2EConfigFixtures {
  world: WorldConfig;
  mapObjects: MapObjectsConfig;
}

const REQUIRED_PLAYER_IDS = ["player-1", "player-2"] as const;
const REQUIRED_BUILDING_IDS = ["recruit-post-1", "shrine-attack-1", "mine-wood-1"] as const;
const REQUIRED_NEUTRAL_ARMY_IDS = ["neutral-1"] as const;

function fixtureError(message: string): Error {
  return new Error(`[e2e config fixtures] ${message}`);
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw fixtureError(message);
  }
}

function readJsonFixture<T>(relativePath: string): T {
  const absolutePath = resolve(__dirname, "..", "..", relativePath);
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw fixtureError(`failed to load ${relativePath}: ${detail}`);
  }
}

function getHeroConfig(playerId: string, fixtures: E2EConfigFixtures = e2eConfigFixtures): HeroConfig {
  const hero = fixtures.world.heroes.find((entry) => entry.playerId === playerId);
  invariant(hero, `missing hero for playerId "${playerId}" in configs/phase1-world.json`);
  return hero;
}

function getBuildingConfig(buildingId: string, fixtures: E2EConfigFixtures = e2eConfigFixtures) {
  const building = fixtures.mapObjects.buildings.find((entry) => entry.id === buildingId);
  invariant(building, `missing building "${buildingId}" in configs/phase1-map-objects.json`);
  return building;
}

function getNeutralArmyConfig(neutralArmyId: string, fixtures: E2EConfigFixtures = e2eConfigFixtures): NeutralArmyConfig {
  const neutralArmy = fixtures.mapObjects.neutralArmies.find((entry) => entry.id === neutralArmyId);
  invariant(neutralArmy, `missing neutral army "${neutralArmyId}" in configs/phase1-map-objects.json`);
  return neutralArmy;
}

function getRecruitmentPostConfig(
  buildingId = "recruit-post-1",
  fixtures: E2EConfigFixtures = e2eConfigFixtures
): RecruitmentPostConfig {
  const building = getBuildingConfig(buildingId, fixtures);
  invariant(
    building.kind === "recruitment_post",
    `building "${buildingId}" is expected to be a recruitment_post in configs/phase1-map-objects.json`
  );
  return building;
}

function getAttributeShrineConfig(
  buildingId = "shrine-attack-1",
  fixtures: E2EConfigFixtures = e2eConfigFixtures
): AttributeShrineConfig {
  const building = getBuildingConfig(buildingId, fixtures);
  invariant(
    building.kind === "attribute_shrine",
    `building "${buildingId}" is expected to be an attribute_shrine in configs/phase1-map-objects.json`
  );
  return building;
}

function getResourceMineConfig(
  buildingId = "mine-wood-1",
  fixtures: E2EConfigFixtures = e2eConfigFixtures
): ResourceMineConfig {
  const building = getBuildingConfig(buildingId, fixtures);
  invariant(
    building.kind === "resource_mine",
    `building "${buildingId}" is expected to be a resource_mine in configs/phase1-map-objects.json`
  );
  return building;
}

function loadFixtures(): E2EConfigFixtures {
  const fixtures = {
    world: readJsonFixture<WorldConfig>("configs/phase1-world.json"),
    mapObjects: readJsonFixture<MapObjectsConfig>("configs/phase1-map-objects.json")
  };

  for (const playerId of REQUIRED_PLAYER_IDS) {
    getHeroConfig(playerId, fixtures);
  }

  for (const buildingId of REQUIRED_BUILDING_IDS) {
    getBuildingConfig(buildingId, fixtures);
  }

  for (const neutralArmyId of REQUIRED_NEUTRAL_ARMY_IDS) {
    getNeutralArmyConfig(neutralArmyId, fixtures);
  }

  return fixtures;
}

export const e2eConfigFixtures = loadFixtures();

export function validateE2EConfigFixtures(): E2EConfigFixtures {
  return e2eConfigFixtures;
}

export function getHeroMoveTotal(playerId = "player-1"): number {
  return getHeroConfig(playerId).move.total;
}

export function getHeroStats(playerId = "player-1"): HeroStats {
  const { attack, defense, power, knowledge } = getHeroConfig(playerId).stats;
  return { attack, defense, power, knowledge };
}

export function getHeroArmyCount(playerId = "player-1"): number {
  return getHeroConfig(playerId).armyCount;
}

export function formatHeroStatsText(stats: HeroStats): string {
  return `ATK ${stats.attack} · DEF ${stats.defense} · POW ${stats.power} · KNW ${stats.knowledge}`;
}

export function formatHeroStatBonus(bonus: HeroStats): string {
  const parts = [
    bonus.attack > 0 ? `攻击 +${bonus.attack}` : "",
    bonus.defense > 0 ? `防御 +${bonus.defense}` : "",
    bonus.power > 0 ? `力量 +${bonus.power}` : "",
    bonus.knowledge > 0 ? `知识 +${bonus.knowledge}` : ""
  ].filter(Boolean);

  return parts.join(" / ") || "属性提升";
}

export function getHeroStatsAfterShrine(playerId = "player-1", buildingId = "shrine-attack-1"): HeroStats {
  const stats = getHeroStats(playerId);
  const bonus = getAttributeShrineConfig(buildingId).bonus;

  return {
    attack: stats.attack + bonus.attack,
    defense: stats.defense + bonus.defense,
    power: stats.power + bonus.power,
    knowledge: stats.knowledge + bonus.knowledge
  };
}

export function getShrineVisitLogText(buildingId = "shrine-attack-1"): string {
  return `Visited ${buildingId}: ${formatHeroStatBonus(getAttributeShrineConfig(buildingId).bonus)}`;
}

export function getRecruitmentCount(buildingId = "recruit-post-1"): number {
  return getRecruitmentPostConfig(buildingId).recruitCount;
}

export function getRecruitmentCost(buildingId = "recruit-post-1"): RecruitmentPostConfig["cost"] {
  return getRecruitmentPostConfig(buildingId).cost;
}

export function getRecruitmentLogText(buildingId = "recruit-post-1"): string {
  const config = getRecruitmentPostConfig(buildingId);
  return `Recruited ${config.unitTemplateId} x${config.recruitCount}`;
}

export function formatDailyIncome(kind: ResourceKind, amount: number): string {
  const label = kind === "gold" ? "金币" : kind === "wood" ? "木材" : "矿石";
  return `${label} +${amount}/天`;
}

export function getMineIncome(buildingId = "mine-wood-1"): number {
  return getResourceMineConfig(buildingId).income;
}

export function getMineClaimLogText(buildingId = "mine-wood-1"): string {
  const config = getResourceMineConfig(buildingId);
  return `Claimed mine: ${formatDailyIncome(config.resourceKind, config.income)}`;
}

export function getNeutralBattleReward(neutralArmyId = "neutral-1"): NeutralArmyConfig["reward"] {
  return getNeutralArmyConfig(neutralArmyId).reward;
}

export function getNeutralBattleRewardText(neutralArmyId = "neutral-1"): string {
  const reward = getNeutralBattleReward(neutralArmyId);
  return `${reward.kind} +${reward.amount}`;
}
