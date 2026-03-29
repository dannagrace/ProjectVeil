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

interface DocumentDefinition {
  id: ContentPackDocumentId;
  fileName: string;
}

interface DocumentValidationIssue {
  documentId: ContentPackDocumentId;
  path: string;
  message: string;
}

interface ContentPackCliReport {
  schemaVersion: 1;
  generatedAt: string;
  rootDir: string;
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
    issues: ContentPackValidationIssue[];
  };
}

const DOCUMENTS: DocumentDefinition[] = [
  { id: "world", fileName: "phase1-world.json" },
  { id: "mapObjects", fileName: "phase1-map-objects.json" },
  { id: "units", fileName: "units.json" },
  { id: "battleSkills", fileName: "battle-skills.json" },
  { id: "battleBalance", fileName: "battle-balance.json" }
];

function parseArgs(argv: string[]): { rootDir: string; reportPath: string | null } {
  let rootDir = resolve(process.cwd(), "configs");
  let reportPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root-dir") {
      rootDir = resolve(argv[index + 1] ?? rootDir);
      index += 1;
    } else if (arg === "--report-path") {
      reportPath = resolve(argv[index + 1] ?? "");
      index += 1;
    }
  }

  return { rootDir, reportPath };
}

async function readJsonConfig<T>(rootDir: string, fileName: string): Promise<T> {
  return JSON.parse(await readFile(resolve(rootDir, fileName), "utf8")) as T;
}

function validateDocuments(bundle: RuntimeConfigBundle): DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];

  const capture = (documentId: ContentPackDocumentId, path: string, callback: () => void) => {
    try {
      callback();
    } catch (error) {
      issues.push({
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

async function main(): Promise<void> {
  const { rootDir, reportPath } = parseArgs(process.argv.slice(2));
  const [world, mapObjects, units, battleSkills, battleBalance] = await Promise.all([
    readJsonConfig<WorldGenerationConfig>(rootDir, "phase1-world.json"),
    readJsonConfig<MapObjectsConfig>(rootDir, "phase1-map-objects.json"),
    readJsonConfig<UnitCatalogConfig>(rootDir, "units.json"),
    readJsonConfig<BattleSkillCatalogConfig>(rootDir, "battle-skills.json"),
    readJsonConfig<BattleBalanceConfig>(rootDir, "battle-balance.json")
  ]);

  const bundle: RuntimeConfigBundle = {
    world,
    mapObjects,
    units,
    battleSkills,
    battleBalance
  };

  const documentIssues = validateDocuments(bundle);
  const contentPack = validateContentPackConsistency(bundle);
  const report: ContentPackCliReport = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootDir,
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
      issues: contentPack.issues
    }
  };

  console.log("Project Veil content-pack validation");
  console.log(`Root: ${rootDir}`);
  console.log(`Result: ${report.valid ? "PASS" : "FAIL"}`);
  printIssues("Per-document validation", report.documentValidation.issues);
  printIssues("Content-pack consistency", report.contentPack.issues);

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
