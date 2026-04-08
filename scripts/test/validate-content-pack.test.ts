import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const configsDir = join(repoRoot, "configs");
const scriptPath = join(repoRoot, "scripts", "validate-content-pack.ts");

async function copyConfigFixture(tempDir: string, fileName: string): Promise<void> {
  const content = await readFile(join(configsDir, fileName), "utf8");
  await writeFile(join(tempDir, fileName), content, "utf8");
}

async function seedContentPackRoot(tempDir: string): Promise<void> {
  await Promise.all(
    [
      "phase1-world.json",
      "phase1-map-objects.json",
      "phase1-world-frontier-basin.json",
      "phase1-map-objects-frontier-basin.json",
      "phase1-world-stonewatch-fork.json",
      "phase1-map-objects-stonewatch-fork.json",
      "phase1-world-ridgeway-crossing.json",
      "phase1-map-objects-ridgeway-crossing.json",
      "phase1-world-highland-reach.json",
      "phase1-map-objects-highland-reach.json",
      "phase1-world-amber-fields.json",
      "phase1-map-objects-amber-fields.json",
      "phase1-world-ironpass-gorge.json",
      "phase1-map-objects-ironpass-gorge.json",
      "phase1-world-splitrock-canyon.json",
      "phase1-map-objects-splitrock-canyon.json",
      "phase2-contested-basin.json",
      "phase2-map-objects-contested-basin.json",
      "units.json",
      "battle-skills.json",
      "battle-balance.json",
      "hero-skills.json",
      "hero-skill-trees-full.json",
      "daily-dungeons.json",
      "boss-encounter-templates.json"
    ].map((fileName) => copyConfigFixture(tempDir, fileName))
  );
}

test("validate-content-pack validates all shipped map packs with CLI presets", async () => {
  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      scriptPath,
      "--root-dir",
      configsDir,
      "--map-pack",
      "frontier-basin",
      "--map-pack",
      "stonewatch-fork",
      "--map-pack",
      "ridgeway-crossing",
      "--map-pack",
      "highland-reach",
      "--map-pack",
      "amber-fields",
      "--map-pack",
      "ironpass-gorge",
      "--map-pack",
      "splitrock-canyon",
      "--map-pack",
      "phase2"
    ],
    { cwd: repoRoot }
  );

  assert.match(stdout, /Bundles: 9/);
  assert.match(stdout, /Bundle: frontier-basin/);
  assert.match(stdout, /Bundle: stonewatch-fork/);
  assert.match(stdout, /Bundle: ridgeway-crossing/);
  assert.match(stdout, /Bundle: highland-reach/);
  assert.match(stdout, /Bundle: amber-fields/);
  assert.match(stdout, /Bundle: ironpass-gorge/);
  assert.match(stdout, /Bundle: splitrock-canyon/);
  assert.match(stdout, /Bundle: phase2/);
  assert.match(stdout, /Result: PASS/);
});

test("validate-content-pack fails when a pack places an object onto blocked terrain", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-content-pack-"));
  await seedContentPackRoot(tempDir);

  const ridgewayWorldPath = join(tempDir, "phase1-world-ridgeway-crossing.json");
  const ridgewayWorld = JSON.parse(await readFile(ridgewayWorldPath, "utf8")) as {
    terrainOverrides: Array<{ position: { x: number; y: number }; terrain: string }>;
  };
  ridgewayWorld.terrainOverrides.push({
    position: { x: 6, y: 4 },
    terrain: "water"
  });
  await writeFile(ridgewayWorldPath, `${JSON.stringify(ridgewayWorld, null, 2)}\n`, "utf8");

  await assert.rejects(
    execFileAsync(
      "node",
      [
        "--import",
        "tsx",
        scriptPath,
        "--root-dir",
        tempDir,
        "--map-pack",
        "ridgeway-crossing"
      ],
      { cwd: repoRoot }
    ),
    (error: NodeJS.ErrnoException & { stdout?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout ?? "", /Bundle: ridgeway-crossing/);
      assert.match(error.stdout ?? "", /\[mapObjects\] buildings\[3\]\.position/);
      assert.match(error.stdout ?? "", /placed on water terrain/);
      return true;
    }
  );
});

test("validate-content-pack supports the stonewatch fork preset on its own", async () => {
  const { stdout } = await execFileAsync(
    "node",
    [
      "--import",
      "tsx",
      scriptPath,
      "--root-dir",
      configsDir,
      "--map-pack",
      "stonewatch-fork"
    ],
    { cwd: repoRoot }
  );

  assert.match(stdout, /Bundles: 2/);
  assert.match(stdout, /Bundle: stonewatch-fork/);
  assert.match(stdout, /Result: PASS/);
});

test("validate-content-pack fails on typed hero progression and equipment authoring mismatches", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-content-pack-"));
  await seedContentPackRoot(tempDir);

  const worldPath = join(tempDir, "phase1-world.json");
  const world = JSON.parse(await readFile(worldPath, "utf8")) as {
    heroes: Array<{
      progression: {
        level: number;
        experience: number;
        skillPoints?: number;
      };
      loadout: {
        equipment?: {
          weaponId?: string;
          accessoryId?: string;
          trinketIds?: string[];
        };
        inventory: string[];
      };
      learnedSkills?: Array<{ skillId: string; rank: number }>;
    }>;
  };

  world.heroes[0]!.progression.level = 1;
  world.heroes[0]!.progression.experience = 175;
  world.heroes[0]!.progression.skillPoints = 2;
  world.heroes[0]!.learnedSkills = [{ skillId: "war_banner", rank: 1 }];
  world.heroes[0]!.loadout.equipment = {
    weaponId: "padded_gambeson",
    accessoryId: "missing_accessory",
    trinketIds: ["militia_pike"]
  };
  world.heroes[0]!.loadout.inventory = [
    "militia_pike",
    "vanguard_blade",
    "padded_gambeson",
    "scout_compass",
    "oak_longbow",
    "tower_shield_mail",
    "scribe_charm"
  ];
  await writeFile(worldPath, `${JSON.stringify(world, null, 2)}\n`, "utf8");

  await assert.rejects(
    execFileAsync("node", ["--import", "tsx", scriptPath, "--root-dir", tempDir], { cwd: repoRoot }),
    (error: NodeJS.ErrnoException & { stdout?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout ?? "", /hero_progression_level_experience_mismatch/);
      assert.match(error.stdout ?? "", /hero_skill_points_exceed_progression/);
      assert.match(error.stdout ?? "", /hero_equipment_slot_mismatch/);
      assert.match(error.stdout ?? "", /hero_equipment_missing/);
      assert.match(error.stdout ?? "", /hero_equipment_legacy_trinket_ids/);
      assert.match(error.stdout ?? "", /hero_inventory_capacity_exceeded/);
      assert.match(error.stdout ?? "", /Suggestion:/);
      return true;
    }
  );
});

test("validate-content-pack fails on unknown hero skill battle-skill references", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-content-pack-"));
  await seedContentPackRoot(tempDir);

  const heroSkillsPath = join(tempDir, "hero-skill-trees-full.json");
  const heroSkills = JSON.parse(await readFile(heroSkillsPath, "utf8")) as {
    skills: Array<{ ranks: Array<{ battleSkillIds?: string[] }> }>;
  };

  heroSkills.skills[0]!.ranks[0]!.battleSkillIds = ["missing_skill"];
  await writeFile(heroSkillsPath, `${JSON.stringify(heroSkills, null, 2)}\n`, "utf8");

  await assert.rejects(
    execFileAsync("node", ["--import", "tsx", scriptPath, "--root-dir", tempDir], { cwd: repoRoot }),
    (error: NodeJS.ErrnoException & { stdout?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout ?? "", /Authoring config validation: 1 issue\(s\)/);
      assert.match(error.stdout ?? "", /\[heroSkills\] hero-skill-trees-full\.json/);
      assert.match(error.stdout ?? "", /references unknown battle skill missing_skill/);
      return true;
    }
  );
});

test("validate-content-pack uses the authored hero skill tree for world cross-file validation", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-content-pack-"));
  await seedContentPackRoot(tempDir);

  const worldPath = join(tempDir, "phase1-world.json");
  const world = JSON.parse(await readFile(worldPath, "utf8")) as {
    heroes: Array<{ learnedSkills?: Array<{ skillId: string; rank: number }> }>;
  };
  world.heroes[0] = {
    ...world.heroes[0]!,
    learnedSkills: [{ skillId: "war_banner", rank: 1 }]
  };
  await writeFile(worldPath, `${JSON.stringify(world, null, 2)}\n`, "utf8");

  const heroSkillsPath = join(tempDir, "hero-skill-trees-full.json");
  const heroSkills = JSON.parse(await readFile(heroSkillsPath, "utf8")) as {
    skills: Array<{ id: string }>;
  };

  heroSkills.skills = heroSkills.skills.filter((skill) => skill.id !== "war_banner");
  await writeFile(heroSkillsPath, `${JSON.stringify(heroSkills, null, 2)}\n`, "utf8");

  await assert.rejects(
    execFileAsync("node", ["--import", "tsx", scriptPath, "--root-dir", tempDir], { cwd: repoRoot }),
    (error: NodeJS.ErrnoException & { stdout?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout ?? "", /\[world\] heroes\[0\]\.learnedSkills\[0\]\.skillId/);
      assert.match(error.stdout ?? "", /references unknown hero skill war_banner/);
      return true;
    }
  );
});

test("validate-content-pack fails on invalid reward payload amounts before runtime", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "veil-content-pack-"));
  await seedContentPackRoot(tempDir);

  const mapObjectsPath = join(tempDir, "phase1-map-objects.json");
  const mapObjects = JSON.parse(await readFile(mapObjectsPath, "utf8")) as {
    neutralArmies: Array<{ reward?: { kind: string; amount: number } }>;
    guaranteedResources: Array<{ resource: { amount: number } }>;
  };

  mapObjects.neutralArmies[0]!.reward = { kind: "gold", amount: 0 };
  mapObjects.guaranteedResources[0]!.resource.amount = -2;
  await writeFile(mapObjectsPath, `${JSON.stringify(mapObjects, null, 2)}\n`, "utf8");

  await assert.rejects(
    execFileAsync("node", ["--import", "tsx", scriptPath, "--root-dir", tempDir], { cwd: repoRoot }),
    (error: NodeJS.ErrnoException & { stdout?: string }) => {
      assert.equal(error.code, 1);
      assert.match(error.stdout ?? "", /neutral_reward_amount_invalid/);
      assert.match(error.stdout ?? "", /guaranteed_resource_amount_invalid/);
      assert.match(error.stdout ?? "", /must be a positive integer/);
      return true;
    }
  );
});
