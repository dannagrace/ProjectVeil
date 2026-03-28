import { existsSync } from "node:fs";
import path from "node:path";
import assetConfigJson from "../configs/assets.json";
import unitCatalog from "../configs/units.json";
import {
  collectAssetPaths,
  getAssetConfigValidationErrors,
  parseAssetConfig,
  summarizeAssetMetadata
} from "../packages/shared/src/assets-config";

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
  const metadata = summarizeAssetMetadata(assetConfig);
  console.log(
    `Asset validation passed: ${Object.keys(assetConfig.units).length} units, ${collectAssetPaths(assetConfig).length} registered files, ${metadata.byStage.placeholder} placeholder / ${metadata.byStage.prototype} prototype / ${metadata.byStage.production} production`
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
