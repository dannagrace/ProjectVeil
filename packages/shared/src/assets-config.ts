import type { BuildingKind, ResourceKind, TerrainType } from "./models";

export type AssetState = "idle" | "selected" | "hit";
export type MarkerKind = "hero" | "neutral";
export type AssetStage = "placeholder" | "production";
export type AssetSource = "generated" | "licensed" | "commissioned";

export interface TerrainAssetEntry {
  default: string;
  variants: string[];
}

export interface UnitAssetEntry {
  portrait: Record<AssetState, string>;
  frame: string;
}

export interface MarkerAssetEntry {
  idle: string;
  selected: string;
  hit: string;
}

export interface AssetMetadataEntry {
  slot: string;
  stage: AssetStage;
  source: AssetSource;
  notes?: string;
}

export interface AssetConfig {
  terrain: Record<TerrainType | "unknown", TerrainAssetEntry>;
  resources: Record<ResourceKind, string>;
  buildings: Record<BuildingKind, string>;
  units: Record<string, UnitAssetEntry>;
  markers: Record<MarkerKind, MarkerAssetEntry>;
  metadata: Record<string, AssetMetadataEntry>;
  badges: {
    factions: Record<string, string>;
    rarities: Record<string, string>;
    interactions: Record<string, string>;
  };
}

const TERRAIN_KEYS = ["grass", "dirt", "sand", "water", "unknown"] as const;
const RESOURCE_KEYS = ["gold", "wood", "ore"] as const;
const BUILDING_KEYS = ["recruitment_post", "attribute_shrine", "resource_mine"] as const;
const MARKER_KEYS = ["hero", "neutral"] as const;
const ASSET_STATE_KEYS = ["idle", "selected", "hit"] as const;
const BADGE_GROUP_KEYS = ["factions", "rarities", "interactions"] as const;

export function getAssetConfigValidationErrors(config: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(config)) {
    return ["Asset config must be an object"];
  }

  validateTerrainSection(config.terrain, errors);
  validateStringMapSection(config.resources, RESOURCE_KEYS, "resources", errors);
  validateStringMapSection(config.buildings, BUILDING_KEYS, "buildings", errors);
  validateUnitsSection(config.units, errors);
  validateMarkersSection(config.markers, errors);
  validateMetadataSection(config.metadata, errors);
  validateBadgesSection(config.badges, errors);

  if (errors.length === 0) {
    validateMetadataCoverage(config as unknown as AssetConfig, errors);
  }

  return errors;
}

export function parseAssetConfig(config: unknown): AssetConfig {
  const errors = getAssetConfigValidationErrors(config);
  if (errors.length > 0) {
    throw new Error(`Invalid asset config:\n- ${errors.join("\n- ")}`);
  }

  return config as AssetConfig;
}

function validateTerrainSection(section: unknown, errors: string[]): void {
  if (!isRecord(section)) {
    errors.push("terrain must be an object");
    return;
  }

  for (const key of TERRAIN_KEYS) {
    const entry = section[key];
    if (!isRecord(entry)) {
      errors.push(`terrain.${key} must be an object`);
      continue;
    }

    validateAssetPath(entry.default, `terrain.${key}.default`, errors);
    validateAssetPathArray(entry.variants, `terrain.${key}.variants`, errors);

    if (Array.isArray(entry.variants) && entry.variants.length > 0 && typeof entry.default === "string") {
      if (!entry.variants.includes(entry.default)) {
        errors.push(`terrain.${key}.variants must include terrain.${key}.default`);
      }
    }
  }
}

function validateStringMapSection(
  section: unknown,
  requiredKeys: readonly string[],
  sectionName: string,
  errors: string[]
): void {
  if (!isRecord(section)) {
    errors.push(`${sectionName} must be an object`);
    return;
  }

  for (const key of requiredKeys) {
    validateAssetPath(section[key], `${sectionName}.${key}`, errors);
  }
}

function validateUnitsSection(section: unknown, errors: string[]): void {
  if (!isRecord(section)) {
    errors.push("units must be an object");
    return;
  }

  for (const [unitId, entry] of Object.entries(section)) {
    if (!isRecord(entry)) {
      errors.push(`units.${unitId} must be an object`);
      continue;
    }

    if (!isRecord(entry.portrait)) {
      errors.push(`units.${unitId}.portrait must be an object`);
    } else {
      for (const state of ASSET_STATE_KEYS) {
        validateAssetPath(entry.portrait[state], `units.${unitId}.portrait.${state}`, errors);
      }
    }

    validateAssetPath(entry.frame, `units.${unitId}.frame`, errors);
  }
}

function validateMarkersSection(section: unknown, errors: string[]): void {
  if (!isRecord(section)) {
    errors.push("markers must be an object");
    return;
  }

  for (const key of MARKER_KEYS) {
    const entry = section[key];
    if (!isRecord(entry)) {
      errors.push(`markers.${key} must be an object`);
      continue;
    }

    for (const state of ASSET_STATE_KEYS) {
      validateAssetPath(entry[state], `markers.${key}.${state}`, errors);
    }
  }
}

function validateBadgesSection(section: unknown, errors: string[]): void {
  if (!isRecord(section)) {
    errors.push("badges must be an object");
    return;
  }

  for (const group of BADGE_GROUP_KEYS) {
    const entry = section[group];
    if (!isRecord(entry)) {
      errors.push(`badges.${group} must be an object`);
      continue;
    }

    if (Object.keys(entry).length === 0) {
      errors.push(`badges.${group} must define at least one asset`);
      continue;
    }

    for (const [key, value] of Object.entries(entry)) {
      validateAssetPath(value, `badges.${group}.${key}`, errors);
    }
  }
}

function validateMetadataSection(section: unknown, errors: string[]): void {
  if (!isRecord(section)) {
    errors.push("metadata must be an object");
    return;
  }

  const seenSlots = new Map<string, string>();

  for (const [assetPath, entry] of Object.entries(section)) {
    validateAssetPath(assetPath, `metadata.${assetPath}`, errors);

    if (!isRecord(entry)) {
      errors.push(`metadata[${assetPath}] must be an object`);
      continue;
    }

    if (typeof entry.slot !== "string" || entry.slot.length === 0) {
      errors.push(`metadata[${assetPath}].slot must be a non-empty string`);
    } else {
      if (!/^[a-z0-9_.-]+$/.test(entry.slot)) {
        errors.push(`metadata[${assetPath}].slot must use lowercase letters, numbers, dots, dashes or underscores`);
      }

      const existingPath = seenSlots.get(entry.slot);
      if (existingPath) {
        errors.push(`metadata[${assetPath}].slot duplicates metadata[${existingPath}].slot (${entry.slot})`);
      } else {
        seenSlots.set(entry.slot, assetPath);
      }
    }

    validateEnum(entry.stage, ["placeholder", "production"], `metadata[${assetPath}].stage`, errors);
    validateEnum(entry.source, ["generated", "licensed", "commissioned"], `metadata[${assetPath}].source`, errors);

    if (entry.notes !== undefined && typeof entry.notes !== "string") {
      errors.push(`metadata[${assetPath}].notes must be a string when provided`);
    }
  }
}

function validateMetadataCoverage(config: AssetConfig, errors: string[]): void {
  const referencedPaths = new Set(collectAssetPaths(config));
  const metadataPaths = new Set(Object.keys(config.metadata));

  for (const assetPath of referencedPaths) {
    if (!metadataPaths.has(assetPath)) {
      errors.push(`metadata[${assetPath}] is missing for referenced asset path`);
    }
  }

  for (const assetPath of metadataPaths) {
    if (!referencedPaths.has(assetPath)) {
      errors.push(`metadata[${assetPath}] does not map to any referenced asset path`);
    }
  }
}

function validateAssetPathArray(value: unknown, path: string, errors: string[]): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${path} must be a non-empty array`);
    return;
  }

  for (const [index, item] of value.entries()) {
    validateAssetPath(item, `${path}[${index}]`, errors);
  }
}

function validateAssetPath(value: unknown, path: string, errors: string[]): void {
  if (typeof value !== "string" || value.length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return;
  }

  if (!value.startsWith("/assets/")) {
    errors.push(`${path} must start with /assets/`);
  }
}

function validateEnum(value: unknown, choices: readonly string[], path: string, errors: string[]): void {
  if (typeof value !== "string" || !choices.includes(value)) {
    errors.push(`${path} must be one of: ${choices.join(", ")}`);
  }
}

export function collectAssetPaths(assetConfig: AssetConfig): string[] {
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

export function getAssetMetadataEntry(assetConfig: AssetConfig, assetPath: string): AssetMetadataEntry | null {
  return assetConfig.metadata[assetPath] ?? null;
}

export function summarizeAssetMetadata(assetConfig: AssetConfig): {
  total: number;
  byStage: Record<AssetStage, number>;
  bySource: Record<AssetSource, number>;
} {
  const summary = {
    total: 0,
    byStage: {
      placeholder: 0,
      production: 0
    },
    bySource: {
      generated: 0,
      licensed: 0,
      commissioned: 0
    }
  };

  for (const entry of Object.values(assetConfig.metadata)) {
    summary.total += 1;
    summary.byStage[entry.stage] += 1;
    summary.bySource[entry.source] += 1;
  }

  return summary;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
