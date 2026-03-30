import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getDefaultBattleBalanceConfig,
  validateBattleBalanceConfig,
  validateBattleSkillCatalog,
  validateContentPackConsistency,
  validateMapObjectsConfig,
  validateUnitCatalog,
  validateWorldConfig,
  type BattleBalanceConfig,
  type BattleSkillCatalogConfig,
  type ContentPackDocumentId,
  type ContentPackValidationIssue,
  type MapObjectsConfig,
  type RuntimeConfigBundle,
  type UnitCatalogConfig,
  type WorldGenerationConfig
} from "../packages/shared/src/index.ts";
import {
  DEFAULT_CONTENT_PACK_MAP_PACK,
  resolveExtraContentPackMapPack,
  type ContentPackMapPackDefinition
} from "./content-pack-map-packs.ts";

interface DocumentValidationIssue {
  bundleId: string;
  documentId: ContentPackDocumentId;
  path: string;
  message: string;
}

interface BundleContentPackValidationIssue extends ContentPackValidationIssue {
  bundleId: string;
}

interface BundleValidationReport {
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

interface ContentPackCliReport {
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
      const definition = resolveExtraContentPackMapPack(presetId);
      if (!definition) {
        throw new Error(`Unknown map pack "${presetId}". Supported values: frontier-basin, phase2.`);
      }
      extraMapPacks.push(definition);
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

function printIssues(title: string, issues: Array<{ documentId: string; path: string; message: string }>): void {
  if (issues.length === 0) {
    console.log(`${title}: 0 issues`);
    return;
  }

  console.log(`${title}: ${issues.length} issue(s)`);
  for (const issue of issues) {
    console.log(`- [${issue.documentId}] ${issue.path}: ${issue.message}`);
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

async function main(): Promise<void> {
  const { rootDir, reportPath, extraMapPacks } = parseArgs(process.argv.slice(2));
  const bundleDefinitions = [DEFAULT_CONTENT_PACK_MAP_PACK, ...extraMapPacks];
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
  const contentPackIssues = bundles.flatMap((bundle) => bundle.contentPack.issues);
  const report: ContentPackCliReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootDir,
    valid: bundles.every((bundle) => bundle.valid),
    bundleCount: bundles.length,
    documentValidation: {
      valid: documentIssues.length === 0,
      issueCount: documentIssues.length,
      issues: documentIssues
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

  console.log("Project Veil content-pack validation");
  console.log(`Root: ${rootDir}`);
  console.log(`Bundles: ${report.bundleCount}`);
  console.log(`Result: ${report.valid ? "PASS" : "FAIL"}`);
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

void main().catch((error) => {
  console.error(`Content-pack validation failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
