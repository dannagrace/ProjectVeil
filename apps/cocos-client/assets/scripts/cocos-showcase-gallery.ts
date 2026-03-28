export type LobbyShowcaseEntryKind = "hero" | "unit" | "building";
export type LobbyShowcasePhase = "idle" | "selected" | "hit";

export interface LobbyShowcaseEntry {
  kind: LobbyShowcaseEntryKind;
  id: string;
  label: string;
}

export interface LobbyTerrainShowcaseEntry {
  id: string;
  label: string;
}

export interface LobbyBuildingShowcaseEntry {
  id: string;
  label: string;
  iconKey: "recruitment" | "shrine" | "mine" | "battle";
}

export interface LobbyShowcaseAssets<Frame = unknown> {
  icons: Partial<Record<LobbyBuildingShowcaseEntry["iconKey"], Frame | null | undefined>>;
  heroes: Record<string, Frame | null | undefined>;
  units: Record<string, { idle: Frame | null; selected: Frame | null; hit: Frame | null } | undefined>;
  showcaseUnits: Record<string, { idle: Frame | null; selected: Frame | null; hit: Frame | null } | undefined>;
  showcaseTerrain: Record<string, Frame | null | undefined>;
  showcaseBuildings: Record<string, Frame | null | undefined>;
}

const LOBBY_SHOWCASE_UNITS_PER_PAGE = 4;
const LOBBY_SHOWCASE_UNIT_PAGE_STEP = 2;

export const lobbyHeroShowcaseEntries: LobbyShowcaseEntry[] = [
  { kind: "hero", id: "hero_guard_basic", label: "守御" },
  { kind: "hero", id: "hero_ranger_serin", label: "瑟琳" },
  { kind: "hero", id: "hero_oracle_lyra", label: "莱拉" },
  { kind: "hero", id: "hero_forgeguard_borin", label: "博林" }
];

export const lobbyShowcaseUnitEntries: LobbyShowcaseEntry[] = [
  { kind: "unit", id: "sunlance_knight", label: "晨枪" },
  { kind: "unit", id: "moss_stalker", label: "苔影" },
  { kind: "unit", id: "ember_mage", label: "余烬" },
  { kind: "unit", id: "iron_walker", label: "铁卫" },
  { kind: "unit", id: "dune_raider", label: "沙袭" },
  { kind: "unit", id: "glacier_warden", label: "霜卫" }
];

export const lobbyTerrainShowcaseEntries: LobbyTerrainShowcaseEntry[] = [
  { id: "grassland", label: "草原" },
  { id: "mountain", label: "山脉" },
  { id: "water", label: "水域" },
  { id: "desert", label: "沙漠" },
  { id: "snow", label: "雪原" }
];

export const lobbyBuildingShowcaseEntries: LobbyBuildingShowcaseEntry[] = [
  { id: "recruitment_post", label: "招募", iconKey: "recruitment" },
  { id: "attribute_shrine", label: "神社", iconKey: "shrine" },
  { id: "resource_mine", label: "矿场", iconKey: "mine" },
  { id: "forge_hall", label: "锻炉", iconKey: "battle" }
];

export function getLobbyShowcaseUnitPageCount(): number {
  if (lobbyShowcaseUnitEntries.length <= LOBBY_SHOWCASE_UNITS_PER_PAGE) {
    return 1;
  }
  return Math.floor((lobbyShowcaseUnitEntries.length - LOBBY_SHOWCASE_UNITS_PER_PAGE) / LOBBY_SHOWCASE_UNIT_PAGE_STEP) + 1;
}

export function nextLobbyShowcaseUnitPage(page: number): number {
  const pageCount = getLobbyShowcaseUnitPageCount();
  if (pageCount <= 1) {
    return 0;
  }
  return (page + 1) % pageCount;
}

export function resolveLobbyShowcaseEntries(page: number): LobbyShowcaseEntry[] {
  const maxStartIndex = Math.max(0, lobbyShowcaseUnitEntries.length - LOBBY_SHOWCASE_UNITS_PER_PAGE);
  const pageCount = getLobbyShowcaseUnitPageCount();
  const normalizedPage = pageCount <= 1 ? 0 : ((page % pageCount) + pageCount) % pageCount;
  const startIndex = Math.min(normalizedPage * LOBBY_SHOWCASE_UNIT_PAGE_STEP, maxStartIndex);
  return [
    ...lobbyHeroShowcaseEntries,
    ...lobbyShowcaseUnitEntries.slice(startIndex, startIndex + LOBBY_SHOWCASE_UNITS_PER_PAGE)
  ];
}

export function nextLobbyShowcasePhase(phase: LobbyShowcasePhase): LobbyShowcasePhase {
  if (phase === "idle") {
    return "selected";
  }
  if (phase === "selected") {
    return "hit";
  }
  return "idle";
}

export function formatLobbyShowcasePhaseLabel(phase: LobbyShowcasePhase): string {
  if (phase === "selected") {
    return "预备";
  }
  if (phase === "hit") {
    return "受击";
  }
  return "待机";
}

export function resolveLobbyShowcaseFrame<Frame>(
  entry: LobbyShowcaseEntry,
  assets: LobbyShowcaseAssets<Frame> | null | undefined,
  phase: LobbyShowcasePhase
): Frame | null {
  if (!assets) {
    return null;
  }

  if (entry.kind === "hero") {
    return assets.units[entry.id]?.[phase] ?? assets.heroes[entry.id] ?? null;
  }

  if (entry.kind === "unit") {
    return assets.showcaseUnits[entry.id]?.[phase] ?? assets.units[entry.id]?.[phase] ?? null;
  }

  return assets.showcaseBuildings[entry.id] ?? null;
}

export function resolveLobbyTerrainFrame<Frame>(
  entry: LobbyTerrainShowcaseEntry,
  assets: LobbyShowcaseAssets<Frame> | null | undefined
): Frame | null {
  if (!assets) {
    return null;
  }
  return assets.showcaseTerrain[entry.id] ?? null;
}

export function resolveLobbyBuildingFrame<Frame>(
  entry: LobbyBuildingShowcaseEntry,
  assets: LobbyShowcaseAssets<Frame> | null | undefined
): Frame | null {
  if (!assets) {
    return null;
  }
  return assets.showcaseBuildings[entry.id] ?? assets.icons[entry.iconKey] ?? null;
}
