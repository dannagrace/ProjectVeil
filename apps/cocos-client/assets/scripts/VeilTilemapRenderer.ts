import { _decorator, Component, TiledLayer, TiledMap } from "cc";
import type { PlayerTileView, Vec2 } from "./VeilCocosSession.ts";
import { createTileLookup, fogEdgeGidForTile, resolveFogEdgePulseGid, resolveFogPulseGid } from "./cocos-map-visuals.ts";

const { ccclass, property } = _decorator;

interface TilemapRenderOptions {
  activeHeroPosition: Vec2 | null;
  fogPulsePhase: number;
  reachableKeys: Set<string>;
}

@ccclass("ProjectVeilTilemapRenderer")
export class VeilTilemapRenderer extends Component {
  @property
  terrainLayerName = "terrain";

  @property
  fogLayerName = "fog";

  @property
  fogEdgeLayerName = "fogEdge";

  @property
  objectLayerName = "objects";

  @property
  overlayLayerName = "overlay";

  @property
  grassTerrainGid = 1;

  @property
  dirtTerrainGid = 2;

  @property
  sandTerrainGid = 3;

  @property
  waterTerrainGid = 4;

  @property
  unknownTerrainGid = 5;

  @property
  hiddenFogGid = 1;

  @property
  exploredFogGid = 2;

  @property
  visibleFogGid = 0;

  @property
  hiddenFogPulseGid = 0;

  @property
  exploredFogPulseGid = 0;

  @property
  hiddenFogEdgeBaseGid = 0;

  @property
  exploredFogEdgeBaseGid = 0;

  @property
  hiddenFogEdgePulseOffset = 0;

  @property
  exploredFogEdgePulseOffset = 0;

  @property
  alphaFogOverlayEnabled = true;

  @property
  woodResourceGid = 1;

  @property
  oreResourceGid = 2;

  @property
  goldResourceGid = 3;

  @property
  neutralOccupantGid = 4;

  @property
  heroOccupantGid = 5;

  @property
  buildingOccupantGid = 6;

  @property
  reachableOverlayGid = 1;

  @property
  activeHeroOverlayGid = 2;

  private readonly cachedTerrainGids = new Map<string, number>();
  private readonly cachedFogGids = new Map<string, number>();
  private readonly cachedFogEdgeGids = new Map<string, number>();
  private readonly cachedObjectGids = new Map<string, number>();
  private readonly cachedOverlayGids = new Map<string, number>();

  canRender(): boolean {
    return Boolean(this.resolveTiledMap());
  }

  clear(): void {
    this.clearLayer(this.resolveLayer(this.terrainLayerName), this.cachedTerrainGids);
    this.clearLayer(this.resolveLayer(this.fogLayerName), this.cachedFogGids);
    this.clearLayer(this.resolveLayer(this.fogEdgeLayerName), this.cachedFogEdgeGids);
    this.clearLayer(this.resolveLayer(this.objectLayerName), this.cachedObjectGids);
    this.clearLayer(this.resolveLayer(this.overlayLayerName), this.cachedOverlayGids);
  }

  syncTiles(tiles: PlayerTileView[], options: TilemapRenderOptions): boolean {
    const terrainLayer = this.resolveLayer(this.terrainLayerName);
    const fogLayer = this.resolveLayer(this.fogLayerName);
    const fogEdgeLayer = this.resolveLayer(this.fogEdgeLayerName);
    const objectLayer = this.resolveLayer(this.objectLayerName);
    const overlayLayer = this.resolveLayer(this.overlayLayerName);
    const tileLookup = createTileLookup(tiles);

    if (!terrainLayer && !fogLayer && !fogEdgeLayer && !objectLayer && !overlayLayer) {
      return false;
    }

    const usedKeys = new Set<string>();
    for (const tile of tiles) {
      const key = this.tileKey(tile.position);
      usedKeys.add(key);
      const baseFogGid = this.alphaFogOverlayEnabled ? 0 : this.fogGidForTile(tile);
      const baseFogEdgeGid = this.alphaFogOverlayEnabled
        ? 0
        : fogEdgeGidForTile(tile, tileLookup, {
            hiddenFogEdgeBaseGid: this.hiddenFogEdgeBaseGid,
            exploredFogEdgeBaseGid: this.exploredFogEdgeBaseGid
          });

      this.applyCachedGid(terrainLayer, this.cachedTerrainGids, tile.position, key, this.terrainGidForTile(tile));
      this.applyCachedGid(
        fogLayer,
        this.cachedFogGids,
        tile.position,
        key,
        resolveFogPulseGid(
          baseFogGid,
          tile.fog === "hidden" ? this.hiddenFogPulseGid : tile.fog === "explored" ? this.exploredFogPulseGid : 0,
          options.fogPulsePhase
        )
      );
      this.applyCachedGid(
        fogEdgeLayer,
        this.cachedFogEdgeGids,
        tile.position,
        key,
        resolveFogEdgePulseGid(
          baseFogEdgeGid,
          tile.fog === "hidden"
            ? this.hiddenFogEdgePulseOffset
            : tile.fog === "explored"
              ? this.exploredFogEdgePulseOffset
              : 0,
          options.fogPulsePhase
        )
      );
      this.applyCachedGid(
        objectLayer,
        this.cachedObjectGids,
        tile.position,
        key,
        this.objectGidForTile(tile, options.activeHeroPosition)
      );
      this.applyCachedGid(
        overlayLayer,
        this.cachedOverlayGids,
        tile.position,
        key,
        this.overlayGidForTile(tile, options.activeHeroPosition, options.reachableKeys)
      );
    }

    this.clearUnusedEntries(terrainLayer, this.cachedTerrainGids, usedKeys);
    this.clearUnusedEntries(fogLayer, this.cachedFogGids, usedKeys);
    this.clearUnusedEntries(fogEdgeLayer, this.cachedFogEdgeGids, usedKeys);
    this.clearUnusedEntries(objectLayer, this.cachedObjectGids, usedKeys);
    this.clearUnusedEntries(overlayLayer, this.cachedOverlayGids, usedKeys);
    return true;
  }

  private resolveTiledMap(): TiledMap | null {
    return this.node.getComponent(TiledMap);
  }

  private resolveLayer(name: string): TiledLayer | null {
    const tiledMap = this.resolveTiledMap();
    if (!tiledMap || !name.trim()) {
      return null;
    }

    return tiledMap.getLayer(name) ?? null;
  }

  private clearLayer(layer: TiledLayer | null, cache: Map<string, number>): void {
    if (!layer) {
      cache.clear();
      return;
    }

    for (const key of cache.keys()) {
      const position = this.positionFromKey(key);
      if (!this.isInsideLayer(layer, position)) {
        continue;
      }

      layer.setTileGIDAt(0, position.x, position.y);
    }

    cache.clear();
  }

  private applyCachedGid(
    layer: TiledLayer | null,
    cache: Map<string, number>,
    position: Vec2,
    key: string,
    nextGid: number
  ): void {
    if (!layer || !this.isInsideLayer(layer, position)) {
      cache.delete(key);
      return;
    }

    if (cache.get(key) === nextGid) {
      return;
    }

    layer.setTileGIDAt(nextGid, position.x, position.y);
    cache.set(key, nextGid);
  }

  private clearUnusedEntries(layer: TiledLayer | null, cache: Map<string, number>, usedKeys: Set<string>): void {
    if (!layer) {
      cache.clear();
      return;
    }

    for (const [key] of cache) {
      if (usedKeys.has(key)) {
        continue;
      }

      const position = this.positionFromKey(key);
      if (this.isInsideLayer(layer, position)) {
        layer.setTileGIDAt(0, position.x, position.y);
      }
      cache.delete(key);
    }
  }

  private terrainGidForTile(tile: PlayerTileView): number {
    switch (tile.terrain) {
      case "grass":
        return this.grassTerrainGid;
      case "dirt":
        return this.dirtTerrainGid;
      case "sand":
        return this.sandTerrainGid;
      case "water":
        return this.waterTerrainGid;
      default:
        return this.unknownTerrainGid;
    }
  }

  private fogGidForTile(tile: PlayerTileView): number {
    switch (tile.fog) {
      case "hidden":
        return this.hiddenFogGid;
      case "explored":
        return this.exploredFogGid;
      default:
        return this.visibleFogGid;
    }
  }

  private objectGidForTile(tile: PlayerTileView, activeHeroPosition: Vec2 | null): number {
    if (tile.fog === "hidden") {
      return 0;
    }

    if (activeHeroPosition && tile.position.x === activeHeroPosition.x && tile.position.y === activeHeroPosition.y) {
      return 0;
    }

    if (tile.occupant?.kind === "neutral") {
      return this.neutralOccupantGid;
    }

    if (tile.occupant?.kind === "hero") {
      return this.heroOccupantGid;
    }

    if (tile.building) {
      return this.buildingOccupantGid;
    }

    if (!tile.resource) {
      return 0;
    }

    switch (tile.resource.kind) {
      case "wood":
        return this.woodResourceGid;
      case "ore":
        return this.oreResourceGid;
      case "gold":
        return this.goldResourceGid;
      default:
        return 0;
    }
  }

  private overlayGidForTile(
    tile: PlayerTileView,
    activeHeroPosition: Vec2 | null,
    reachableKeys: Set<string>
  ): number {
    if (activeHeroPosition && tile.position.x === activeHeroPosition.x && tile.position.y === activeHeroPosition.y) {
      return this.activeHeroOverlayGid;
    }

    return reachableKeys.has(this.tileKey(tile.position)) ? this.reachableOverlayGid : 0;
  }

  private tileKey(position: Vec2): string {
    return `${position.x}:${position.y}`;
  }

  private positionFromKey(key: string): Vec2 {
    const parts = key.split(":");
    const x = Number(parts[0] ?? 0);
    const y = Number(parts[1] ?? 0);
    return {
      x: Number.isFinite(x) ? x : 0,
      y: Number.isFinite(y) ? y : 0
    };
  }

  private isInsideLayer(layer: TiledLayer, position: Vec2): boolean {
    const size = layer.getLayerSize();
    return position.x >= 0 && position.y >= 0 && position.x < size.width && position.y < size.height;
  }
}
