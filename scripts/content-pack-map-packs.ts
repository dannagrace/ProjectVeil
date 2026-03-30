export interface ContentPackMapPackDefinition {
  id: string;
  worldFileName: string;
  mapObjectsFileName: string;
  aliases?: string[];
}

export const DEFAULT_CONTENT_PACK_MAP_PACK: ContentPackMapPackDefinition = {
  id: "default",
  worldFileName: "phase1-world.json",
  mapObjectsFileName: "phase1-map-objects.json"
};

export const EXTRA_CONTENT_PACK_MAP_PACKS: ContentPackMapPackDefinition[] = [
  {
    id: "frontier-basin",
    worldFileName: "phase1-world-frontier-basin.json",
    mapObjectsFileName: "phase1-map-objects-frontier-basin.json",
    aliases: ["frontier_basin"]
  },
  {
    id: "phase2",
    worldFileName: "phase2-contested-basin.json",
    mapObjectsFileName: "phase2-map-objects-contested-basin.json",
    aliases: ["contested-basin", "contested_basin", "phase2-contested-basin"]
  }
];

export function resolveExtraContentPackMapPack(id: string): ContentPackMapPackDefinition | undefined {
  const normalized = id.trim().toLowerCase();
  return EXTRA_CONTENT_PACK_MAP_PACKS.find(
    (definition) =>
      definition.id === normalized ||
      definition.aliases?.some((alias) => alias === normalized)
  );
}
