import assert from "node:assert/strict";
import test from "node:test";
import type { TiledLayer, TiledMap } from "cc";
import { VeilTilemapRenderer } from "../assets/scripts/VeilTilemapRenderer.ts";
import type { PlayerTileView } from "../assets/scripts/VeilCocosSession.ts";
import { createComponentHarness, createTile } from "./helpers/cocos-panel-harness.ts";

class FakeLayer {
  public readonly values = new Map<string, number>();
  public writes = 0;

  constructor(private readonly width: number, private readonly height: number) {}

  getLayerSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  setTileGIDAt(gid: number, x: number, y: number): void {
    this.writes += 1;
    this.values.set(`${x}:${y}`, gid);
  }
}

function attachTestableLayers(
  component: VeilTilemapRenderer,
  names: string[]
): { map: Map<string, FakeLayer>; testable: VeilTilemapRenderer & { resolveTiledMap(): TiledMap | null } } {
  const layers = new Map<string, FakeLayer>();
  names.forEach((name) => {
    layers.set(name, new FakeLayer(4, 4));
  });

  const testable = component as VeilTilemapRenderer & { resolveTiledMap(): TiledMap | null };
  const fakeMap = {
    getLayer(name: string) {
      const layer = layers.get(name);
      return (layer as unknown as TiledLayer) ?? null;
    }
  } as TiledMap;

  testable.resolveTiledMap = () => fakeMap;

  return { map: layers, testable };
}

function toTiles(): PlayerTileView[] {
  return [
    createTile({ x: 0, y: 0 }, { terrain: "grass", fog: "visible" }),
    createTile({ x: 1, y: 0 }, { terrain: "sand", fog: "hidden", resource: { kind: "wood", amount: 5 } }),
    createTile({ x: 2, y: 0 }, { terrain: "dirt", fog: "visible", occupant: { kind: "neutral", refId: "neutral-1" } })
  ];
}

function configureLayerNames(component: VeilTilemapRenderer): void {
  component.terrainLayerName = "terrain";
  component.fogLayerName = "fog";
  component.fogEdgeLayerName = "fogEdge";
  component.objectLayerName = "objects";
  component.overlayLayerName = "overlay";
}

test("VeilTilemapRenderer syncs tile layers and caches repeated writes", () => {
  const { component } = createComponentHarness(VeilTilemapRenderer, { name: "TilemapRoot", width: 0, height: 0 });
  const { map } = attachTestableLayers(component, ["terrain", "fog", "fogEdge", "objects", "overlay"]);
  configureLayerNames(component);

  component.alphaFogOverlayEnabled = false;
  component.grassTerrainGid = 11;
  component.sandTerrainGid = 23;
  component.dirtTerrainGid = 31;
  component.hiddenFogGid = 5;
  component.exploredFogGid = 3;
  component.visibleFogGid = 1;
  component.hiddenFogPulseGid = 7;
  component.hiddenFogEdgeBaseGid = 90;
  component.hiddenFogEdgePulseOffset = 4;
  component.exploredFogEdgeBaseGid = 130;
  component.exploredFogEdgePulseOffset = 6;
  component.woodResourceGid = 44;
  component.neutralOccupantGid = 55;
  component.reachableOverlayGid = 99;
  component.activeHeroOverlayGid = 120;

  const tiles = toTiles();
  const reachable = new Set<string>(["0:0", "1:0"]);

  const rendered = component.syncTiles(tiles, {
    activeHeroPosition: { x: 0, y: 0 },
    fogPulsePhase: 1,
    reachableKeys: reachable
  });

  assert.equal(rendered, true);

  assert.equal(map.get("terrain")?.values.get("0:0"), 11);
  assert.equal(map.get("terrain")?.values.get("1:0"), 23);
  assert.equal(map.get("terrain")?.values.get("2:0"), 31);

  const fogEntries = [...(map.get("fog")?.values.entries() ?? [])].sort(([a], [b]) => (a > b ? 1 : a < b ? -1 : 0));
  assert.deepEqual(fogEntries, [
    ["0:0", 1],
    ["1:0", 7],
    ["2:0", 1]
  ]);

  assert.ok((map.get("fogEdge")?.values.get("1:0") ?? 0) >= 90);

  assert.equal(map.get("objects")?.values.get("2:0"), 55);

  assert.equal(map.get("overlay")?.values.get("0:0"), 120);
  assert.equal(map.get("overlay")?.values.get("1:0"), 99);

  const overlayWrites = map.get("overlay")?.writes ?? 0;
  component.syncTiles(tiles, {
    activeHeroPosition: { x: 0, y: 0 },
    fogPulsePhase: 1,
    reachableKeys: reachable
  });
  assert.equal(map.get("overlay")?.writes, overlayWrites);
});

test("VeilTilemapRenderer clears cached tiles and reports missing layers", () => {
  const { component } = createComponentHarness(VeilTilemapRenderer, { name: "TilemapRoot", width: 0, height: 0 });
  const { map, testable } = attachTestableLayers(component, ["terrain"]);
  configureLayerNames(component);

  component.grassTerrainGid = 10;
  const tiles = [createTile({ x: 0, y: 0 }, { terrain: "grass", fog: "visible" })];
  const options = { activeHeroPosition: { x: 0, y: 0 }, fogPulsePhase: 0, reachableKeys: new Set<string>(["0:0"]) };

  component.syncTiles(tiles, options);
  component.clear();
  assert.equal(map.get("terrain")?.values.get("0:0"), 0);

  testable.resolveTiledMap = () => null;
  const rendered = component.syncTiles(tiles, options);
  assert.equal(rendered, false);
});
