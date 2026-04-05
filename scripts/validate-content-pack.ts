import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  getDefaultEquipmentCatalog,
  getDefaultBattleBalanceConfig,
  validateBattleBalanceConfig,
  validateBattleSkillCatalog,
  validateDailyDungeonConfigDocument,
  validateContentPackConsistency,
  validateEquipmentCatalog,
  validateHeroSkillTreeConfig,
  validateMapObjectsConfig,
  validateUnitCatalog,
  validateWorldConfig,
  type BattleBalanceConfig,
  type BattleSkillCatalogConfig,
  type ContentPackDocumentId,
  type ContentPackValidationIssue,
  type DailyDungeonConfigDocument,
  type HeroSkillTreeConfig,
  type MapObjectsConfig,
  type RuntimeConfigBundle,
  type UnitCatalogConfig,
  type WorldGenerationConfig
} from "../packages/shared/src/index.ts";
import {
  DEFAULT_CONTENT_PACK_MAP_PACK,
  resolveContentPackMapPack,
  type ContentPackMapPackDefinition
} from "./content-pack-map-packs.ts";

type ValidationDocumentId = ContentPackDocumentId | "heroSkills" | "equipment" | "dailyDungeons";

interface DocumentValidationIssue {
  bundleId: string;
  documentId: ValidationDocumentId;
  path: string;
  message: string;
}

interface BundleContentPackValidationIssue extends ContentPackValidationIssue {
  bundleId: string;
}

export interface BundleValidationReport {
  id: string;
  worldFileName: string;
  mapObjectsFileName: string;
  valid: boolean;
  documentValidation: {
    valid: boolean;
    issueCount: number;
    issues: DocumentValidationIssue[];
  };
  contentPack: {
    valid: boolean;
    issueCount: number;
    summary: string;
    issues: BundleContentPackValidationIssue[];
  };
}

export interface ContentPackCliReport {
  schemaVersion: 1;
  generatedAt: string;
  rootDir: string;
  valid: boolean;
  bundleCount: number;
  documentValidation: {
    valid: boolean;
    issueCount: number;
    issues: DocumentValidationIssue[];
  };
  authoringValidation: {
    valid: boolean;
    issueCount: number;
    issues: DocumentValidationIssue[];
  };
  contentPack: {
    valid: boolean;
    issueCount: number;
    summary: string;
    issues: BundleContentPackValidationIssue[];
  };
  bundles: BundleValidationReport[];
}

function parseArgs(argv: string[]): {
  rootDir: string;
  reportPath: string | null;
  extraMapPacks: ContentPackMapPackDefinition[];
} {
  let rootDir = resolve(process.cwd(), "configs");
  let reportPath: string | null = null;
  const extraMapPacks: ContentPackMapPackDefinition[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root-dir") {
      rootDir = resolve(argv[index + 1] ?? rootDir);
      index += 1;
    } else if (arg === "--report-path") {
      reportPath = resolve(argv[index + 1] ?? "");
      index += 1;
    } else if (arg === "--map-pack") {
      const presetId = argv[index + 1] ?? "";
      const definition = resolveContentPackMapPack(presetId);
      if (!definition) {
        throw new Error(
          `Unknown map pack "${presetId}". Supported values: default, frontier-basin, stonewatch-fork, ridgeway-crossing, highland-reach, amber-fields, ironpass-gorge, splitrock-canyon, bogfen-crossing, murkveil-delta, frostwatch-ridge, ashpeak-ascent, thornwall-divide, phase2.`
        );
      }
      if (definition.id !== DEFAULT_CONTENT_PACK_MAP_PACK.id) {
        extraMapPacks.push(definition);
      }
      index += 1;
    }
  }

  return { rootDir, reportPath, extraMapPacks };
}

async function readJsonConfig<T>(rootDir: string, fileName: string): Promise<T> {
  return JSON.parse(await readFile(resolve(rootDir, fileName), "utf8")) as T;
}

function validateDocuments(bundleId: string, bundle: RuntimeConfigBundle): DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];

  const capture = (documentId: ContentPackDocumentId, path: string, callback: () => void) => {
    try {
      callback();
    } catch (error) {
      issues.push({
        bundleId,
        documentId,
        path,
        message: error instanceof Error ? error.message : "Unknown validation error"
      });
    }
  };

  capture("world", "$", () => validateWorldConfig(bundle.world));
  capture("units", "$", () => validateUnitCatalog(bundle.units, bundle.battleSkills));
  capture("battleSkills", "$", () => validateBattleSkillCatalog(bundle.battleSkills));
  capture("mapObjects", "$", () => validateMapObjectsConfig(bundle.mapObjects, bundle.world, bundle.units));
  capture("battleBalance", "$", () =>
    validateBattleBalanceConfig(bundle.battleBalance ?? getDefaultBattleBalanceConfig(), bundle.battleSkills)
  );

  return issues;
}

function printIssues(
  title: string,
  issues: Array<{ documentId: string; path: string; message: string; suggestion?: string; code?: string }>
): void {
  if (issues.length === 0) {
    console.log(`${title}: 0 issues`);
    return;
  }

  console.log(`${title}: ${issues.length} issue(s)`);
  for (const issue of issues) {
    const code = issue.code ? ` (${issue.code})` : "";
    const suggestion = issue.suggestion ? ` Suggestion: ${issue.suggestion}` : "";
    console.log(`- [${issue.documentId}] ${issue.path}${code}: ${issue.message}${suggestion}`);
  }
}

async function loadBundle(rootDir: string, definition: ContentPackMapPackDefinition): Promise<RuntimeConfigBundle> {
  const [world, mapObjects, units, battleSkills, battleBalance] = await Promise.all([
    readJsonConfig<WorldGenerationConfig>(rootDir, definition.worldFileName),
    readJsonConfig<MapObjectsConfig>(rootDir, definition.mapObjectsFileName),
    readJsonConfig<UnitCatalogConfig>(rootDir, "units.json"),
    readJsonConfig<BattleSkillCatalogConfig>(rootDir, "battle-skills.json"),
    readJsonConfig<BattleBalanceConfig>(rootDir, "battle-balance.json")
  ]);

  return {
    world,
    mapObjects,
    units,
    battleSkills,
    battleBalance
  };
}

async function validateAuthoringConfigs(
  rootDir: string,
  battleSkills: BattleSkillCatalogConfig
): Promise<DocumentValidationIssue[]> {
  const issues: DocumentValidationIssue[] = [];
  const capture = (documentId: ValidationDocumentId, path: string, callback: () => void) => {
    try {
      callback();
    } catch (error) {
      issues.push({
        bundleId: "global",
        documentId,
        path,
        message: error instanceof Error ? error.message : "Unknown validation error"
      });
    }
  };

  const [compactHeroSkills, fullHeroSkills, dailyDungeons] = await Promise.all([
    readJsonConfig<HeroSkillTreeConfig>(rootDir, "hero-skills.json"),
    readJsonConfig<HeroSkillTreeConfig>(rootDir, "hero-skill-trees-full.json"),
    readJsonConfig<DailyDungeonConfigDocument>(rootDir, "daily-dungeons.json")
  ]);

  capture("heroSkills", "hero-skills.json", () => validateHeroSkillTreeConfig(compactHeroSkills, battleSkills));
  capture("heroSkills", "hero-skill-trees-full.json", () => validateHeroSkillTreeConfig(fullHeroSkills, battleSkills));
  capture("equipment", "packages/shared/src/equipment.ts", () => validateEquipmentCatalog(getDefaultEquipmentCatalog()));
  capture("dailyDungeons", "daily-dungeons.json", () => {
    const issues = validateDailyDungeonConfigDocument(dailyDungeons);
    if (issues.length > 0) {
      const [firstIssue] = issues;
      throw new Error(`${firstIssue?.path}: ${firstIssue?.message}`);
    }
  });

  return issues;
}

export async function buildContentPackCliReport(options: {
  rootDir?: string;
  extraMapPacks?: ContentPackMapPackDefinition[];
} = {}): Promise<ContentPackCliReport> {
  const rootDir = options.rootDir ?? resolve(process.cwd(), "configs");
  const bundleDefinitions = [DEFAULT_CONTENT_PACK_MAP_PACK, ...(options.extraMapPacks ?? [])];
  const battleSkills = await readJsonConfig<BattleSkillCatalogConfig>(rootDir, "battle-skills.json");
  const bundles = await Promise.all(
    bundleDefinitions.map(async (definition): Promise<BundleValidationReport> => {
      const bundle = await loadBundle(rootDir, definition);
      const documentIssues = validateDocuments(definition.id, bundle);
      const contentPack = validateContentPackConsistency(bundle);

      return {
        id: definition.id,
        worldFileName: definition.worldFileName,
        mapObjectsFileName: definition.mapObjectsFileName,
        valid: documentIssues.length === 0 && contentPack.valid,
        documentValidation: {
          valid: documentIssues.length === 0,
          issueCount: documentIssues.length,
          issues: documentIssues
        },
        contentPack: {
          valid: contentPack.valid,
          issueCount: contentPack.issueCount,
          summary: contentPack.summary,
          issues: contentPack.issues.map((issue) => ({
            ...issue,
            bundleId: definition.id
          }))
        }
      };
    })
  );

  const documentIssues = bundles.flatMap((bundle) => bundle.documentValidation.issues);
  const authoringIssues = await validateAuthoringConfigs(rootDir, battleSkills);
  const contentPackIssues = bundles.flatMap((bundle) => bundle.contentPack.issues);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootDir,
    valid: bundles.every((bundle) => bundle.valid) && authoringIssues.length === 0,
    bundleCount: bundles.length,
    documentValidation: {
      valid: documentIssues.length === 0,
      issueCount: documentIssues.length,
      issues: documentIssues
    },
    authoringValidation: {
      valid: authoringIssues.length === 0,
      issueCount: authoringIssues.length,
      issues: authoringIssues
    },
    contentPack: {
      valid: contentPackIssues.length === 0,
      issueCount: contentPackIssues.length,
      summary:
        contentPackIssues.length === 0
          ? `Content-pack consistency passed across ${bundles.length} validated bundle(s).`
          : `Found ${contentPackIssues.length} content-pack consistency issue(s) across ${bundles.length} validated bundle(s).`,
      issues: contentPackIssues
    },
    bundles
  };
}

async function main(): Promise<void> {
  const { rootDir, reportPath, extraMapPacks } = parseArgs(process.argv.slice(2));
  const report = await buildContentPackCliReport({
    rootDir,
    extraMapPacks
  });

  console.log("Project Veil content-pack validation");
  console.log(`Root: ${rootDir}`);
  console.log(`Bundles: ${report.bundleCount}`);
  console.log(`Result: ${report.valid ? "PASS" : "FAIL"}`);
  printIssues("Authoring config validation", report.authoringValidation.issues);
  for (const bundle of report.bundles) {
    console.log(
      `Bundle: ${bundle.id} (${bundle.worldFileName} + ${bundle.mapObjectsFileName})`
    );
    printIssues("Per-document validation", bundle.documentValidation.issues);
    printIssues("Content-pack consistency", bundle.contentPack.issues);
  }

  if (reportPath) {
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Report written to ${reportPath}`);
  }

  if (!report.valid) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    console.error(`Content-pack validation failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
