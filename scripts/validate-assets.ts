import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import assetConfigJson from "../configs/assets.json";
import cocosPresentationConfigJson from "../configs/cocos-presentation.json";
import {
  formatPresentationReadinessSummary,
  getCocosPresentationReleaseGate,
  cocosPresentationReadiness
} from "../apps/cocos-client/assets/scripts/cocos-presentation-readiness.ts";
import unitCatalog from "../configs/units.json";
import {
  collectAssetPaths,
  getAssetConfigValidationErrors,
  parseAssetConfig,
  summarizeAssetMetadata
} from "../packages/shared/src/assets-config";

const rootDir = process.cwd();
const publicDir = path.join(rootDir, "apps/client/public");
const cocosResourceDir = path.join(rootDir, "apps/cocos-client/assets/resources");
const args = parseArgs(process.argv);

const errors = [...getAssetConfigValidationErrors(assetConfigJson)];
const assetConfig = parseOrNull();

if (assetConfig) {
  validateManifestCoverage(assetConfig, errors);
  validateAssetFiles(assetConfig, errors);
  validateRoadmapCoverage(assetConfig, errors);
  validateIssue33Dimensions(assetConfig, errors);
  validateCocosPresentationAudioAssets(errors);
  validateCocosPresentationAnimationProfiles(errors);
  validateCocosReleaseReadiness(errors, args.requireCocosReleaseReady);
}

if (errors.length > 0) {
  console.error("Asset validation failed:");
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exitCode = 1;
} else {
  const metadata = summarizeAssetMetadata(assetConfig);
  const publicBytes = summarizeAssetBytes(assetConfig, "public");
  const cocosBytes = summarizeAssetBytes(assetConfig, "cocos");
  const audioBytes = summarizeCocosPresentationAudioBytes();
  console.log(
    `Asset validation passed: ${Object.keys(assetConfig.heroes).length} heroes, ${Object.keys(assetConfig.units).length + Object.keys(assetConfig.showcaseUnits).length} unit sprite sets, ${collectAssetPaths(assetConfig).length} registered files, ${metadata.byStage.placeholder} placeholder / ${metadata.byStage.prototype} prototype / ${metadata.byStage.production} production, public ${Math.round(publicBytes / 1024)} KiB / cocos ${Math.round(cocosBytes / 1024)} KiB, audio ${Math.round(audioBytes / 1024)} KiB, readiness ${formatPresentationReadinessSummary(cocosPresentationReadiness)}`
  );
}

function parseOrNull() {
  try {
    return parseAssetConfig(assetConfigJson);
  } catch {
    return null;
  }
}

function parseArgs(argv: string[]): { requireCocosReleaseReady: boolean } {
  let requireCocosReleaseReady = false;
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--require-cocos-release-ready") {
      requireCocosReleaseReady = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { requireCocosReleaseReady };
}

function validateCocosReleaseReadiness(errors: string[], required: boolean): void {
  if (!required) {
    return;
  }
  const releaseGate = getCocosPresentationReleaseGate(cocosPresentationReadiness);
  if (!releaseGate.ready) {
    errors.push(`Cocos primary client is not release-ready: ${releaseGate.blockers.join(", ")}`);
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
    const publicPath = toPublicAssetFilepath(assetPath);
    if (!existsSync(publicPath)) {
      errors.push(`${assetPath} does not exist at ${path.relative(rootDir, publicPath)}`);
    }

    const cocosPath = toCocosAssetFilepath(assetPath);
    if (!existsSync(cocosPath)) {
      errors.push(`${assetPath} does not exist at ${path.relative(rootDir, cocosPath)}`);
    }
  }
}

function validateRoadmapCoverage(assetConfig: ReturnType<typeof parseAssetConfig>, errors: string[]): void {
  const heroPortraitCount = Object.keys(assetConfig.heroes).length;
  const unitSpriteSetCount = Object.keys(assetConfig.units).length + Object.keys(assetConfig.showcaseUnits).length;
  const terrainThemeCount = Object.keys(assetConfig.showcaseTerrain).length;
  const buildingIconCount = new Set([
    ...Object.keys(assetConfig.buildings),
    ...Object.keys(assetConfig.showcaseBuildings)
  ]).size;

  if (heroPortraitCount < 4) {
    errors.push(`heroes must define at least 4 portrait slots for issue #33 coverage (received ${heroPortraitCount})`);
  }

  if (unitSpriteSetCount < 8) {
    errors.push(`units + showcaseUnits must define at least 8 sprite sets for issue #33 coverage (received ${unitSpriteSetCount})`);
  }

  if (terrainThemeCount < 5) {
    errors.push(`showcaseTerrain must expose at least 5 terrain themes for issue #33 coverage (received ${terrainThemeCount})`);
  }

  if (!assetConfig.showcaseBuildings.forge_hall) {
    errors.push("showcaseBuildings.forge_hall is required to track the forge icon coverage target");
  }

  if (buildingIconCount < 4) {
    errors.push(`buildings + showcaseBuildings must expose at least 4 building icons for issue #33 coverage (received ${buildingIconCount})`);
  }
}

function validateIssue33Dimensions(assetConfig: ReturnType<typeof parseAssetConfig>, errors: string[]): void {
  for (const [heroId, hero] of Object.entries(assetConfig.heroes)) {
    validateExactPngSize(hero.portrait, 16, 16, `heroes.${heroId}.portrait`, errors);
  }

  for (const [unitId, unit] of Object.entries(assetConfig.units)) {
    validateExactPngSize(unit.portrait.idle, 32, 32, `units.${unitId}.portrait.idle`, errors);
    validateExactPngSize(unit.portrait.selected, 32, 32, `units.${unitId}.portrait.selected`, errors);
    validateExactPngSize(unit.portrait.hit, 32, 32, `units.${unitId}.portrait.hit`, errors);
  }

  for (const [unitId, unit] of Object.entries(assetConfig.showcaseUnits)) {
    validateExactPngSize(unit.portrait.idle, 32, 32, `showcaseUnits.${unitId}.portrait.idle`, errors);
    validateExactPngSize(unit.portrait.selected, 32, 32, `showcaseUnits.${unitId}.portrait.selected`, errors);
    validateExactPngSize(unit.portrait.hit, 32, 32, `showcaseUnits.${unitId}.portrait.hit`, errors);
  }

  for (const [terrainId, assetPath] of Object.entries(assetConfig.showcaseTerrain)) {
    validateExactPngSize(assetPath, 64, 64, `showcaseTerrain.${terrainId}`, errors);
  }

  for (const [terrainId, terrain] of Object.entries(assetConfig.terrain)) {
    validateMinimumPngSize(terrain.default, 64, 64, `terrain.${terrainId}.default`, errors);
    terrain.variants.forEach((variant, index) => {
      validateMinimumPngSize(variant, 64, 64, `terrain.${terrainId}.variants[${index}]`, errors);
    });
  }

  for (const [buildingId, assetPath] of Object.entries(assetConfig.buildings)) {
    validateMinimumPngSize(assetPath, 256, 256, `buildings.${buildingId}`, errors);
  }

  for (const [buildingId, assetPath] of Object.entries(assetConfig.showcaseBuildings)) {
    validateMinimumPngSize(assetPath, 256, 256, `showcaseBuildings.${buildingId}`, errors);
  }
}

function validateCocosPresentationAudioAssets(errors: string[]): void {
  const audio = typeof cocosPresentationConfigJson.audio === "object" && cocosPresentationConfigJson.audio !== null
    ? cocosPresentationConfigJson.audio
    : {};
  const groups = [
    ...Object.entries(typeof audio.music === "object" && audio.music !== null ? audio.music : {}),
    ...Object.entries(typeof audio.cues === "object" && audio.cues !== null ? audio.cues : {})
  ];
  for (const [entryId, entry] of groups) {
    const assetStage = typeof entry?.assetStage === "string" ? entry.assetStage : "";
    if (assetStage !== "placeholder" && assetStage !== "production") {
      errors.push(`cocos presentation audio ${entryId} must declare assetStage placeholder|production`);
    }
  }

  for (const assetPath of collectCocosPresentationAudioAssetPaths()) {
    const filepath = path.join(cocosResourceDir, `${assetPath}.wav`);
    if (!existsSync(filepath)) {
      errors.push(`cocos presentation audio ${assetPath} is missing at ${path.relative(rootDir, filepath)}`);
      continue;
    }

    if (readWavPcmDurationMs(filepath) < 120) {
      errors.push(`cocos presentation audio ${assetPath} is shorter than 120ms and likely malformed`);
    }
  }
}

function validateCocosPresentationAnimationProfiles(errors: string[]): void {
  const animationProfiles = typeof cocosPresentationConfigJson.animationProfiles === "object" && cocosPresentationConfigJson.animationProfiles !== null
    ? cocosPresentationConfigJson.animationProfiles
    : {};
  for (const [templateId, entry] of Object.entries(animationProfiles)) {
    const deliveryMode = typeof entry?.deliveryMode === "string" ? entry.deliveryMode : "";
    if (!["fallback", "sequence", "clip", "spine"].includes(deliveryMode)) {
      errors.push(`cocos presentation animationProfiles.${templateId}.deliveryMode must be fallback|sequence|clip|spine`);
    }
    const assetStage = typeof entry?.assetStage === "string" ? entry.assetStage : "";
    if (!["placeholder", "production"].includes(assetStage)) {
      errors.push(`cocos presentation animationProfiles.${templateId}.assetStage must be placeholder|production`);
    }
  }
}

function validateExactPngSize(assetPath: string, expectedWidth: number, expectedHeight: number, label: string, errors: string[]): void {
  const size = readPngSize(toPublicAssetFilepath(assetPath));
  if (!size) {
    errors.push(`${label} could not read PNG dimensions for ${assetPath}`);
    return;
  }

  if (size.width !== expectedWidth || size.height !== expectedHeight) {
    errors.push(`${label} must be ${expectedWidth}x${expectedHeight} (received ${size.width}x${size.height})`);
  }
}

function validateMinimumPngSize(assetPath: string, minWidth: number, minHeight: number, label: string, errors: string[]): void {
  const size = readPngSize(toPublicAssetFilepath(assetPath));
  if (!size) {
    errors.push(`${label} could not read PNG dimensions for ${assetPath}`);
    return;
  }

  if (size.width < minWidth || size.height < minHeight) {
    errors.push(`${label} must be at least ${minWidth}x${minHeight} (received ${size.width}x${size.height})`);
  }
}

function summarizeAssetBytes(assetConfig: ReturnType<typeof parseAssetConfig>, target: "public" | "cocos"): number {
  return collectAssetPaths(assetConfig).reduce((total, assetPath) => {
    const filepath = target === "public" ? toPublicAssetFilepath(assetPath) : toCocosAssetFilepath(assetPath);
    return existsSync(filepath) ? total + statSync(filepath).size : total;
  }, 0);
}

function summarizeCocosPresentationAudioBytes(): number {
  return collectCocosPresentationAudioAssetPaths().reduce((total, assetPath) => {
    const filepath = path.join(cocosResourceDir, `${assetPath}.wav`);
    return existsSync(filepath) ? total + statSync(filepath).size : total;
  }, 0);
}

function toPublicAssetFilepath(assetPath: string): string {
  return path.join(publicDir, assetPath.slice(1));
}

function toCocosAssetFilepath(assetPath: string): string {
  return path.join(cocosResourceDir, assetPath.slice("/assets/".length));
}

function readPngSize(filepath: string): { width: number; height: number } | null {
  if (!existsSync(filepath) || path.extname(filepath).toLowerCase() !== ".png") {
    return null;
  }

  const buffer = readFileSync(filepath);
  if (buffer.length < 24) {
    return null;
  }

  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    return null;
  }

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20)
  };
}

function collectCocosPresentationAudioAssetPaths(): string[] {
  const audio = typeof cocosPresentationConfigJson.audio === "object" && cocosPresentationConfigJson.audio !== null
    ? cocosPresentationConfigJson.audio
    : {};
  const music = typeof audio.music === "object" && audio.music !== null ? Object.values(audio.music) : [];
  const cues = typeof audio.cues === "object" && audio.cues !== null ? Object.values(audio.cues) : [];
  return [...music, ...cues]
    .map((entry) => (typeof entry?.assetPath === "string" ? entry.assetPath : ""))
    .filter((assetPath, index, all) => assetPath.length > 0 && all.indexOf(assetPath) === index);
}

function readWavPcmDurationMs(filepath: string): number {
  const buffer = readFileSync(filepath);
  if (buffer.length < 44 || buffer.subarray(0, 4).toString("utf8") !== "RIFF" || buffer.subarray(8, 12).toString("utf8") !== "WAVE") {
    return 0;
  }

  const channelCount = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);
  const dataSize = buffer.readUInt32LE(40);
  const bytesPerSample = Math.max(1, channelCount * bitsPerSample / 8);
  return Math.round((dataSize / bytesPerSample / Math.max(sampleRate, 1)) * 1000);
}
