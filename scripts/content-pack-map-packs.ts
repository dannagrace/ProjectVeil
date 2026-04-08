export interface ContentPackMapPackDefinition {
  id: string;
  worldFileName: string;
  mapObjectsFileName: string;
  phase: "phase1" | "phase2";
  aliases?: string[];
}

export const DEFAULT_CONTENT_PACK_MAP_PACK: ContentPackMapPackDefinition = {
  id: "default",
  worldFileName: "phase1-world.json",
  mapObjectsFileName: "phase1-map-objects.json",
  phase: "phase1",
  aliases: ["phase1"]
};

export const EXTRA_CONTENT_PACK_MAP_PACKS: ContentPackMapPackDefinition[] = [
  {
    id: "frontier-basin",
    worldFileName: "phase1-world-frontier-basin.json",
    mapObjectsFileName: "phase1-map-objects-frontier-basin.json",
    phase: "phase1",
    aliases: ["frontier_basin"]
  },
  {
    id: "stonewatch-fork",
    worldFileName: "phase1-world-stonewatch-fork.json",
    mapObjectsFileName: "phase1-map-objects-stonewatch-fork.json",
    phase: "phase1",
    aliases: ["stonewatch_fork", "stonewatch"]
  },
  {
    id: "ridgeway-crossing",
    worldFileName: "phase1-world-ridgeway-crossing.json",
    mapObjectsFileName: "phase1-map-objects-ridgeway-crossing.json",
    phase: "phase1",
    aliases: ["ridgeway_crossing", "ridgeway"]
  },
  {
    id: "highland-reach",
    worldFileName: "phase1-world-highland-reach.json",
    mapObjectsFileName: "phase1-map-objects-highland-reach.json",
    phase: "phase1",
    aliases: ["highland_reach", "highland"]
  },
  {
    id: "amber-fields",
    worldFileName: "phase1-world-amber-fields.json",
    mapObjectsFileName: "phase1-map-objects-amber-fields.json",
    phase: "phase1",
    aliases: ["amber_fields", "amber"]
  },
  {
    id: "ironpass-gorge",
    worldFileName: "phase1-world-ironpass-gorge.json",
    mapObjectsFileName: "phase1-map-objects-ironpass-gorge.json",
    phase: "phase1",
    aliases: ["ironpass_gorge", "ironpass"]
  },
  {
    id: "splitrock-canyon",
    worldFileName: "phase1-world-splitrock-canyon.json",
    mapObjectsFileName: "phase1-map-objects-splitrock-canyon.json",
    phase: "phase1",
    aliases: ["splitrock_canyon", "splitrock"]
  },
  {
    id: "bogfen-crossing",
    worldFileName: "phase1-world-bogfen-crossing.json",
    mapObjectsFileName: "phase1-map-objects-bogfen-crossing.json",
    phase: "phase1",
    aliases: ["bogfen_crossing", "bogfen"]
  },
  {
    id: "murkveil-delta",
    worldFileName: "phase1-world-murkveil-delta.json",
    mapObjectsFileName: "phase1-map-objects-murkveil-delta.json",
    phase: "phase1",
    aliases: ["murkveil_delta", "murkveil"]
  },
  {
    id: "frostwatch-ridge",
    worldFileName: "phase1-world-frostwatch-ridge.json",
    mapObjectsFileName: "phase1-map-objects-frostwatch-ridge.json",
    phase: "phase1",
    aliases: ["frostwatch_ridge", "frostwatch"]
  },
  {
    id: "ashpeak-ascent",
    worldFileName: "phase1-world-ashpeak-ascent.json",
    mapObjectsFileName: "phase1-map-objects-ashpeak-ascent.json",
    phase: "phase1",
    aliases: ["ashpeak_ascent", "ashpeak"]
  },
  {
    id: "thornwall-divide",
    worldFileName: "phase1-world-thornwall-divide.json",
    mapObjectsFileName: "phase1-map-objects-thornwall-divide.json",
    phase: "phase1",
    aliases: ["thornwall_divide", "thornwall"]
  },
  {
    id: "phase2",
    worldFileName: "phase2-contested-basin.json",
    mapObjectsFileName: "phase2-map-objects-contested-basin.json",
    phase: "phase2",
    aliases: ["contested-basin", "contested_basin", "phase2-contested-basin"]
  },
  {
    id: "phase2-frontier-expanded",
    worldFileName: "phase2-frontier-expanded.json",
    mapObjectsFileName: "phase2-map-objects-frontier-expanded.json",
    phase: "phase2",
    aliases: ["phase2_frontier_expanded", "frontier-expanded", "frontier_expanded"]
  }
];

export function resolveContentPackMapPack(id: string): ContentPackMapPackDefinition | undefined {
  const normalized = id.trim().toLowerCase();
  if (
    DEFAULT_CONTENT_PACK_MAP_PACK.id === normalized ||
    DEFAULT_CONTENT_PACK_MAP_PACK.aliases?.some((alias) => alias === normalized)
  ) {
    return DEFAULT_CONTENT_PACK_MAP_PACK;
  }

  return EXTRA_CONTENT_PACK_MAP_PACKS.find(
    (definition) =>
      definition.id === normalized ||
      definition.aliases?.some((alias) => alias === normalized)
  );
}

export function resolveExtraContentPackMapPack(id: string): ContentPackMapPackDefinition | undefined {
  const resolved = resolveContentPackMapPack(id);
  return resolved?.id === DEFAULT_CONTENT_PACK_MAP_PACK.id ? undefined : resolved;
}
