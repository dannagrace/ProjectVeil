import { existsSync } from "node:fs";
import path from "node:path";
import assetConfigJson from "../configs/assets.json";
import unitCatalog from "../configs/units.json";
import { getAssetConfigValidationErrors, parseAssetConfig } from "../packages/shared/src/assets-config";

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "apps/client/public");

const errors = [...getAssetConfigValidationErrors(assetConfigJson)];
const assetConfig = parseOrNull();

if (assetConfig) {
  validateManifestCoverage(assetConfig, errors);
  validateAssetFiles(assetConfig, errors);
}

if (errors.length > 0) {
  console.error("Asset validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Asset validation passed: ${Object.keys(assetConfig.units).length} units, ${countAssetPaths(assetConfig)} registered files`
  );
}

function parseOrNull() {
  try {
    return parseAssetConfig(assetConfigJson);
  } catch {
    return null;
  }
}

function validateManifestCoverage(
  assetConfig: ReturnType<typeof parseAssetConfig>,
  errors: string[]
): void {
  const unitIds = new Set(unitCatalog.templates.map((template) => template.id));
  const factionIds = new Set(unitCatalog.templates.map((template) => template.faction));
  const rarityIds = new Set(unitCatalog.templates.map((template) => template.rarity));

  for (const unitId of unitIds) {
    if (!assetConfig.units[unitId]) {
      errors.push(`units.${unitId} is missing for unit template ${unitId}`);
    }
  }

  for (const unitId of Object.keys(assetConfig.units)) {
    if (!unitIds.has(unitId)) {
      errors.push(`units.${unitId} does not match any unit template id`);
    }
  }

  for (const factionId of factionIds) {
    if (!assetConfig.badges.factions[factionId]) {
      errors.push(`badges.factions.${factionId} is missing for unit catalog coverage`);
    }
  }

  for (const rarityId of rarityIds) {
    if (!assetConfig.badges.rarities[rarityId]) {
      errors.push(`badges.rarities.${rarityId} is missing for unit catalog coverage`);
    }
  }
}

function validateAssetFiles(assetConfig: ReturnType<typeof parseAssetConfig>, errors: string[]): void {
  for (const assetPath of collectAssetPaths(assetConfig)) {
    const filepath = path.join(publicDir, assetPath.slice(1));
    if (!existsSync(filepath)) {
      errors.push(`${assetPath} does not exist at ${path.relative(rootDir, filepath)}`);
    }
  }
}

function collectAssetPaths(assetConfig: ReturnType<typeof parseAssetConfig>): string[] {
  const paths = new Set<string>();

  for (const terrain of Object.values(assetConfig.terrain)) {
    paths.add(terrain.default);
    for (const variant of terrain.variants) {
      paths.add(variant);
    }
  }

  for (const resource of Object.values(assetConfig.resources)) {
    paths.add(resource);
  }

  for (const building of Object.values(assetConfig.buildings)) {
    paths.add(building);
  }

  for (const unit of Object.values(assetConfig.units)) {
    for (const portrait of Object.values(unit.portrait)) {
      paths.add(portrait);
    }
    paths.add(unit.frame);
  }

  for (const marker of Object.values(assetConfig.markers)) {
    for (const state of Object.values(marker)) {
      paths.add(state);
    }
  }

  for (const badgeGroup of Object.values(assetConfig.badges)) {
    for (const badge of Object.values(badgeGroup)) {
      paths.add(badge);
    }
  }

  return [...paths];
}

function countAssetPaths(assetConfig: ReturnType<typeof parseAssetConfig>): number {
  return collectAssetPaths(assetConfig).length;
}
