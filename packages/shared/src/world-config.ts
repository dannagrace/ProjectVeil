import defaultMapObjectsConfig from "../../../configs/phase1-map-objects.json";
import defaultUnitsConfig from "../../../configs/units.json";
import defaultWorldConfig from "../../../configs/phase1-world.json";
import type {
  MapObjectsConfig,
  ResourceNode,
  UnitCatalogConfig,
  WorldGenerationConfig
} from "./models";

function isResourceNode(value: unknown): value is ResourceNode | undefined {
  if (value === undefined) {
    return true;
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  const node = value as Record<string, unknown>;
  return (
    (node.kind === "gold" || node.kind === "wood" || node.kind === "ore") &&
    typeof node.amount === "number"
  );
}

export function validateWorldConfig(config: WorldGenerationConfig): void {
  if (config.width <= 0 || config.height <= 0) {
    throw new Error("World config width/height must be positive");
  }

  if (config.heroes.length === 0) {
    throw new Error("World config must define at least one hero");
  }

  for (const hero of config.heroes) {
    if (hero.position.x < 0 || hero.position.y < 0) {
      throw new Error(`Hero ${hero.id} position must be inside the map`);
    }

    if (hero.position.x >= config.width || hero.position.y >= config.height) {
      throw new Error(`Hero ${hero.id} position exceeds map bounds`);
    }
  }
}

export function validateMapObjectsConfig(config: MapObjectsConfig, world: WorldGenerationConfig): void {
  for (const army of config.neutralArmies) {
    if (army.position.x < 0 || army.position.y < 0 || army.position.x >= world.width || army.position.y >= world.height) {
      throw new Error(`Neutral army ${army.id} exceeds map bounds`);
    }

    if (!isResourceNode(army.reward)) {
      throw new Error(`Neutral army ${army.id} reward is invalid`);
    }
  }

  for (const resource of config.guaranteedResources) {
    if (
      resource.position.x < 0 ||
      resource.position.y < 0 ||
      resource.position.x >= world.width ||
      resource.position.y >= world.height
    ) {
      throw new Error("Guaranteed resource exceeds map bounds");
    }
  }
}

export function validateUnitCatalog(config: UnitCatalogConfig): void {
  if (config.templates.length === 0) {
    throw new Error("Unit catalog must contain at least one template");
  }

  const ids = new Set<string>();
  for (const template of config.templates) {
    if (template.faction !== "crown" && template.faction !== "wild") {
      throw new Error(`Invalid faction for unit template: ${template.id}`);
    }

    if (template.rarity !== "common" && template.rarity !== "elite") {
      throw new Error(`Invalid rarity for unit template: ${template.id}`);
    }

    if (ids.has(template.id)) {
      throw new Error(`Duplicate unit template id: ${template.id}`);
    }
    ids.add(template.id);
  }
}

export function getDefaultWorldConfig(): WorldGenerationConfig {
  const config = defaultWorldConfig as WorldGenerationConfig;
  validateWorldConfig(config);
  return config;
}

export function getDefaultMapObjectsConfig(): MapObjectsConfig {
  const world = getDefaultWorldConfig();
  const config = defaultMapObjectsConfig as MapObjectsConfig;
  validateMapObjectsConfig(config, world);
  return config;
}

export function getDefaultUnitCatalog(): UnitCatalogConfig {
  const config = defaultUnitsConfig as UnitCatalogConfig;
  validateUnitCatalog(config);
  return config;
}
