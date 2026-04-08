import { readFile, writeFile } from "node:fs/promises";
import path, { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { BuildingKind, MapObjectsConfig, ResourceKind } from "../packages/shared/src/index.ts";
import { DEFAULT_CONTENT_PACK_MAP_PACK, EXTRA_CONTENT_PACK_MAP_PACKS } from "./content-pack-map-packs.ts";

type CoverageSeverity = "error" | "warning";
type CoverageCategory = "neutralArmies" | "buildings" | "resources" | "mapPacks";

interface MapPackCoverage {
  neutralArmies: Record<string, string>;
  buildings: Record<string, string>;
  resources: Record<string, string>;
}

interface ObjectVisualsConfig {
  neutral?: object;
  buildings?: Partial<Record<BuildingKind, object>>;
  resources?: Partial<Record<ResourceKind, object>>;
  phase1MapPackCoverage?: Record<string, MapPackCoverage>;
}

export interface MapObjectVisualCoverageIssue {
  severity: CoverageSeverity;
  code:
    | "coverage_pack_missing"
    | "coverage_node_missing"
    | "coverage_node_extra"
    | "coverage_pack_extra"
    | "coverage_visual_key_mismatch"
    | "coverage_visual_key_unknown";
  mapPackId: string;
  category: CoverageCategory;
  path: string;
  message: string;
}

export interface MapObjectVisualCoverageReport {
  schemaVersion: 1;
  generatedAt: string;
  rootDir: string;
  objectVisualsPath: string;
  mapPackCount: number;
  valid: boolean;
  errorCount: number;
  warningCount: number;
  issues: MapObjectVisualCoverageIssue[];
}

function parseArgs(argv: string[]): {
  rootDir: string;
  objectVisualsPath: string;
  reportPath: string | null;
} {
  let rootDir = resolve(process.cwd(), "configs");
  let objectVisualsPath = resolve(rootDir, "object-visuals.json");
  let reportPath: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--root-dir") {
      rootDir = resolve(argv[index + 1] ?? rootDir);
      objectVisualsPath = resolve(rootDir, "object-visuals.json");
      index += 1;
    } else if (arg === "--object-visuals") {
      objectVisualsPath = resolve(argv[index + 1] ?? objectVisualsPath);
      index += 1;
    } else if (arg === "--report-path") {
      reportPath = resolve(argv[index + 1] ?? "");
      index += 1;
    }
  }

  return { rootDir, objectVisualsPath, reportPath };
}

function getPhase1MapPackDefinitions() {
  return [DEFAULT_CONTENT_PACK_MAP_PACK, ...EXTRA_CONTENT_PACK_MAP_PACKS.filter((definition) => definition.phase === "phase1")];
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}

export function buildGuaranteedResourceCoverageId(resource: {
  position: { x: number; y: number };
  resource: { kind: ResourceKind };
}): string {
  return `${resource.resource.kind}@${resource.position.x},${resource.position.y}`;
}

function issuePath(mapPackId: string, category: Exclude<CoverageCategory, "mapPacks">, nodeId: string): string {
  return `phase1MapPackCoverage.${mapPackId}.${category}.${nodeId}`;
}

function validateExpectedCoverage(options: {
  mapPackId: string;
  expected: MapPackCoverage;
  actual: MapPackCoverage | undefined;
  objectVisuals: ObjectVisualsConfig;
}): MapObjectVisualCoverageIssue[] {
  const { mapPackId, expected, actual, objectVisuals } = options;
  const issues: MapObjectVisualCoverageIssue[] = [];

  if (!actual) {
    issues.push({
      severity: "error",
      code: "coverage_pack_missing",
      mapPackId,
      category: "mapPacks",
      path: `phase1MapPackCoverage.${mapPackId}`,
      message: `Missing Phase 1 map-pack object visual coverage for ${mapPackId}.`
    });
    return issues;
  }

  const validateCategory = (
    category: Exclude<CoverageCategory, "mapPacks">,
    hasVisualKey: (key: string) => boolean
  ) => {
    const expectedEntries = expected[category];
    const actualEntries = actual[category];

    for (const [nodeId, expectedVisualKey] of Object.entries(expectedEntries)) {
      const actualVisualKey = actualEntries[nodeId];
      if (!actualVisualKey) {
        issues.push({
          severity: "error",
          code: "coverage_node_missing",
          mapPackId,
          category,
          path: issuePath(mapPackId, category, nodeId),
          message: `Missing ${category} coverage for ${mapPackId} node ${nodeId}; expected visual key ${expectedVisualKey}.`
        });
        continue;
      }

      if (!hasVisualKey(actualVisualKey)) {
        issues.push({
          severity: "error",
          code: "coverage_visual_key_unknown",
          mapPackId,
          category,
          path: issuePath(mapPackId, category, nodeId),
          message: `${mapPackId} ${category} node ${nodeId} references unknown visual key ${actualVisualKey}.`
        });
        continue;
      }

      if (actualVisualKey !== expectedVisualKey) {
        issues.push({
          severity: "error",
          code: "coverage_visual_key_mismatch",
          mapPackId,
          category,
          path: issuePath(mapPackId, category, nodeId),
          message: `${mapPackId} ${category} node ${nodeId} maps to ${actualVisualKey}, expected ${expectedVisualKey}.`
        });
      }
    }

    for (const nodeId of Object.keys(actualEntries)) {
      if (expectedEntries[nodeId]) {
        continue;
      }

      issues.push({
        severity: "warning",
        code: "coverage_node_extra",
        mapPackId,
        category,
        path: issuePath(mapPackId, category, nodeId),
        message: `${mapPackId} ${category} coverage includes extra node ${nodeId} that is not present in the shipped map pack.`
      });
    }
  };

  validateCategory("neutralArmies", (key) => key === "neutral" && Boolean(objectVisuals.neutral));
  validateCategory("buildings", (key) => Boolean(objectVisuals.buildings?.[key as BuildingKind]));
  validateCategory("resources", (key) => Boolean(objectVisuals.resources?.[key as ResourceKind]));

  return issues;
}

export async function buildMapObjectVisualCoverageReport(options: {
  rootDir?: string;
  objectVisualsPath?: string;
} = {}): Promise<MapObjectVisualCoverageReport> {
  const rootDir = options.rootDir ?? resolve(process.cwd(), "configs");
  const objectVisualsPath = options.objectVisualsPath ?? resolve(rootDir, "object-visuals.json");
  const objectVisuals = await readJson<ObjectVisualsConfig>(objectVisualsPath);
  const coverage = objectVisuals.phase1MapPackCoverage ?? {};
  const mapPackDefinitions = getPhase1MapPackDefinitions();
  const expectedMapPacks = new Map<string, MapPackCoverage>();

  for (const definition of mapPackDefinitions) {
    const mapObjectsPath = path.resolve(rootDir, definition.mapObjectsFileName);
    const mapObjects = await readJson<MapObjectsConfig>(mapObjectsPath);
    expectedMapPacks.set(definition.id, {
      neutralArmies: Object.fromEntries(mapObjects.neutralArmies.map((entry) => [entry.id, "neutral"])),
      buildings: Object.fromEntries(mapObjects.buildings.map((entry) => [entry.id, entry.kind])),
      resources: Object.fromEntries(
        mapObjects.guaranteedResources.map((entry) => [buildGuaranteedResourceCoverageId(entry), entry.resource.kind])
      )
    });
  }

  const issues = [...expectedMapPacks.entries()].flatMap(([mapPackId, expected]) =>
    validateExpectedCoverage({
      mapPackId,
      expected,
      actual: coverage[mapPackId],
      objectVisuals
    })
  );

  for (const mapPackId of Object.keys(coverage)) {
    if (expectedMapPacks.has(mapPackId)) {
      continue;
    }

    issues.push({
      severity: "warning",
      code: "coverage_pack_extra",
      mapPackId,
      category: "mapPacks",
      path: `phase1MapPackCoverage.${mapPackId}`,
      message: `Phase 1 map-pack object visual coverage includes extra map pack ${mapPackId} that is not part of the 13 shipped Phase 1 packs.`
    });
  }

  const errorCount = issues.filter((issue) => issue.severity === "error").length;
  const warningCount = issues.length - errorCount;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    rootDir,
    objectVisualsPath,
    mapPackCount: mapPackDefinitions.length,
    valid: errorCount === 0,
    errorCount,
    warningCount,
    issues
  };
}

function printIssues(title: string, issues: MapObjectVisualCoverageIssue[]): void {
  if (issues.length === 0) {
    console.log(`${title}: 0 issue(s)`);
    return;
  }

  console.log(`${title}: ${issues.length} issue(s)`);
  for (const issue of issues) {
    console.log(`- [${issue.mapPackId}] ${issue.path} (${issue.code}): ${issue.message}`);
  }
}

async function main(): Promise<void> {
  const { rootDir, objectVisualsPath, reportPath } = parseArgs(process.argv.slice(2));
  const report = await buildMapObjectVisualCoverageReport({ rootDir, objectVisualsPath });
  const errors = report.issues.filter((issue) => issue.severity === "error");
  const warnings = report.issues.filter((issue) => issue.severity === "warning");

  console.log("Project Veil map-object visual coverage validation");
  console.log(`Root: ${report.rootDir}`);
  console.log(`Object visuals: ${report.objectVisualsPath}`);
  console.log(`Phase 1 map packs: ${report.mapPackCount}`);
  console.log(`Result: ${report.valid ? "PASS" : "FAIL"}`);
  printIssues("Errors", errors);
  printIssues("Warnings", warnings);

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
    console.error(
      `Map-object visual coverage validation failed: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exitCode = 1;
  });
}
