import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  createHeroBattleState,
  createNeutralBattleState,
  createWorldStateFromConfigs,
  getBattleBalanceConfig,
  getDefaultBattleSkillCatalog,
  getDefaultMapObjectsConfig,
  getDefaultUnitCatalog,
  getDefaultWorldConfig,
  replaceRuntimeConfigs,
  resetRuntimeConfigs,
  simulateAutomatedBattles,
  type BattleBalanceConfig,
  type BattleSkillCatalogConfig,
  type BattleState,
  type HeroState,
  type NeutralArmyState
} from "../packages/shared/src/index";

type ScenarioId = "neutral-default" | "hero-duel-default" | "all";

interface CliOptions {
  count: number;
  scenario: ScenarioId;
  skillConfigPath?: string;
  balanceConfigPath?: string;
  maxActions: number;
  topSkills: number;
}

interface ScenarioDefinition {
  id: Exclude<ScenarioId, "all">;
  description: string;
  createBattle: (battleIndex: number) => BattleState;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    count: 1000,
    scenario: "neutral-default",
    maxActions: 200,
    topSkills: 8
  };

  for (const argument of argv) {
    if (!argument.startsWith("--")) {
      continue;
    }

    const [key, rawValue] = argument.slice(2).split("=", 2);
    const value = rawValue ?? "";

    if (key === "count" && value) {
      options.count = Math.max(1, Math.floor(Number(value) || options.count));
    } else if (key === "scenario" && (value === "neutral-default" || value === "hero-duel-default" || value === "all")) {
      options.scenario = value;
    } else if (key === "skill-config" && value) {
      options.skillConfigPath = value;
    } else if (key === "balance-config" && value) {
      options.balanceConfigPath = value;
    } else if (key === "max-actions" && value) {
      options.maxActions = Math.max(1, Math.floor(Number(value) || options.maxActions));
    } else if (key === "top-skills" && value) {
      options.topSkills = Math.max(1, Math.floor(Number(value) || options.topSkills));
    }
  }

  return options;
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const absolutePath = resolve(process.cwd(), filePath);
  const content = await readFile(absolutePath, "utf8");
  return JSON.parse(content) as T;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function createScenarioDefinitions(): ScenarioDefinition[] {
  const world = createWorldStateFromConfigs(getDefaultWorldConfig(), getDefaultMapObjectsConfig(), 1001, "battle-metrics");
  const attacker = world.heroes[0];
  const defender = world.heroes[1];
  const neutralArmy: NeutralArmyState = {
    id: "neutral-benchmark",
    position: { x: 2, y: 2 },
    reward: { kind: "gold", amount: 100 },
    stacks: [{ templateId: "wolf_pack", count: 10 }]
  };

  if (!attacker || !defender) {
    throw new Error("World config must define at least two heroes for battle validation");
  }

  return [
    {
      id: "neutral-default",
      description: `${attacker.name} vs 10x 恶狼`,
      createBattle: (battleIndex) => createNeutralBattleState(attacker, cloneNeutralArmy(neutralArmy), 1000 + battleIndex)
    },
    {
      id: "hero-duel-default",
      description: `${attacker.name} vs ${defender.name}`,
      createBattle: (battleIndex) => createHeroBattleState(cloneHero(attacker), cloneHero(defender), 4000 + battleIndex)
    }
  ];
}

function cloneHero(hero: HeroState): HeroState {
  return structuredClone(hero);
}

function cloneNeutralArmy(neutralArmy: NeutralArmyState): NeutralArmyState {
  return structuredClone(neutralArmy);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const world = getDefaultWorldConfig();
  const mapObjects = getDefaultMapObjectsConfig();
  const units = getDefaultUnitCatalog();
  const battleSkills = options.skillConfigPath
    ? await readJsonFile<BattleSkillCatalogConfig>(options.skillConfigPath)
    : getDefaultBattleSkillCatalog();
  const battleBalance = options.balanceConfigPath
    ? await readJsonFile<BattleBalanceConfig>(options.balanceConfigPath)
    : getBattleBalanceConfig();

  replaceRuntimeConfigs({
    world,
    mapObjects,
    units,
    battleSkills,
    battleBalance
  });

  try {
    const definitions = createScenarioDefinitions();
    const selectedDefinitions = options.scenario === "all"
      ? definitions
      : definitions.filter((definition) => definition.id === options.scenario);

    console.log("Battle auto-validation");
    console.log(`skillConfig=${options.skillConfigPath ? basename(resolve(process.cwd(), options.skillConfigPath)) : "runtime-default"}`);
    console.log(`balanceConfig=${options.balanceConfigPath ? basename(resolve(process.cwd(), options.balanceConfigPath)) : "runtime-default"}`);
    console.log(`battleCount=${options.count}`);
    console.log(`maxActions=${options.maxActions}`);

    for (const definition of selectedDefinitions) {
      const metrics = simulateAutomatedBattles(definition.createBattle, options.count, {
        maxActions: options.maxActions
      });

      console.log(`\n[${definition.id}] ${definition.description}`);
      console.log(`attackerWinRate=${formatPercent(metrics.attackerWinRate)} (${metrics.attackerWins}/${metrics.battleCount})`);
      console.log(`defenderWinRate=${formatPercent(metrics.defenderWinRate)} (${metrics.defenderWins}/${metrics.battleCount})`);
      if (metrics.unresolvedBattles > 0) {
        console.log(`unresolvedRate=${formatPercent(metrics.unresolvedRate)} (${metrics.unresolvedBattles}/${metrics.battleCount})`);
      }
      console.log(
        `rounds=avg ${metrics.averageRounds.toFixed(2)} / min ${metrics.minRounds} / max ${metrics.maxRounds}`
      );
      console.log(`turns=avg ${metrics.averageTurns.toFixed(2)}`);
      console.log(`skillUsageTotal=${metrics.totalSkillUses}`);
      console.log("skillUsageDistribution=");
      for (const entry of metrics.skillUsage.slice(0, options.topSkills)) {
        console.log(`  ${entry.skillId}: ${entry.uses} (${formatPercent(entry.share)})`);
      }
    }
  } finally {
    resetRuntimeConfigs();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
