import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCocosTileMarkerText,
  describeCocosTileObject,
  resolveCocosTileMarkerVisual
} from "../assets/scripts/cocos-object-visuals";
import type { PlayerTileView } from "../assets/scripts/VeilCocosSession";

function createTile(): PlayerTileView {
  return {
    position: { x: 1, y: 1 },
    fog: "visible",
    terrain: "grass",
    walkable: true,
    resource: undefined,
    occupant: undefined,
    building: undefined
  };
}

test("describeCocosTileObject maps pickup resources to config-driven descriptors", () => {
  const tile = createTile();
  tile.resource = {
    kind: "wood",
    amount: 5
  };

  assert.deepEqual(describeCocosTileObject(tile), {
    title: "木材堆",
    subtitle: "地图基础资源点，可直接采集。",
    shortLabel: "木材",
    tag: "采集",
    faction: null,
    rarity: "common",
    interactionType: "pickup"
  });
  assert.equal(buildCocosTileMarkerText(tile), "+W");
  assert.equal(resolveCocosTileMarkerVisual(tile)?.iconKey, "wood");
  assert.equal(resolveCocosTileMarkerVisual(tile)?.fallbackLabel, "木材");
});

test("describeCocosTileObject maps battle occupants to stable cocos markers", () => {
  const neutralTile = createTile();
  neutralTile.occupant = {
    kind: "neutral",
    refId: "neutral-1"
  };

  const heroTile = createTile();
  heroTile.occupant = {
    kind: "hero",
    refId: "hero-2"
  };

  assert.equal(describeCocosTileObject(neutralTile)?.tag, "战斗");
  assert.equal(describeCocosTileObject(neutralTile)?.shortLabel, "守军");
  assert.equal(buildCocosTileMarkerText(neutralTile), "!M");
  assert.equal(resolveCocosTileMarkerVisual(neutralTile)?.interactionType, "battle");
  assert.equal(resolveCocosTileMarkerVisual(neutralTile)?.iconKey, "neutral");

  assert.equal(describeCocosTileObject(heroTile)?.faction, "crown");
  assert.equal(describeCocosTileObject(heroTile)?.shortLabel, "英雄");
  assert.equal(buildCocosTileMarkerText(heroTile), "!H");
  assert.equal(resolveCocosTileMarkerVisual(heroTile)?.faction, "crown");
  assert.equal(resolveCocosTileMarkerVisual(heroTile)?.iconKey, "hero");
});

test("buildCocosTileMarkerText hides empty walkable tiles", () => {
  assert.equal(buildCocosTileMarkerText(createTile()), "");
  assert.equal(resolveCocosTileMarkerVisual(createTile()), null);
});

test("describeCocosTileObject exposes recruitment posts as visitable buildings", () => {
  const tile = createTile();
  tile.building = {
    id: "recruit-post-1",
    kind: "recruitment_post",
    label: "前线招募所",
    unitTemplateId: "hero_guard_basic",
    recruitCount: 4,
    availableCount: 3,
    cost: {
      gold: 240,
      wood: 0,
      ore: 0
    }
  };

  assert.equal(describeCocosTileObject(tile)?.shortLabel, "招募");
  assert.equal(describeCocosTileObject(tile)?.tag, "访问");
  assert.equal(buildCocosTileMarkerText(tile), ">R");
  assert.equal(resolveCocosTileMarkerVisual(tile)?.iconKey, "recruitment");
  assert.equal(resolveCocosTileMarkerVisual(tile)?.rarity, "common");
});

test("describeCocosTileObject exposes attribute shrines as permanent stat buildings", () => {
  const tile = createTile();
  tile.building = {
    id: "shrine-1",
    kind: "attribute_shrine",
    label: "战旗圣坛",
    bonus: {
      attack: 1,
      defense: 0,
      power: 0,
      knowledge: 0
    },
    lastUsedDay: undefined
  };

  assert.equal(describeCocosTileObject(tile)?.shortLabel, "神殿");
  assert.equal(describeCocosTileObject(tile)?.tag, "访问");
  assert.equal(buildCocosTileMarkerText(tile), ">S");
  assert.equal(resolveCocosTileMarkerVisual(tile)?.iconKey, "shrine");
  assert.equal(resolveCocosTileMarkerVisual(tile)?.rarity, "elite");
});

test("describeCocosTileObject exposes resource mines as harvestable daily pickups", () => {
  const tile = createTile();
  tile.building = {
    id: "mine-1",
    kind: "resource_mine",
    label: "前线伐木场",
    resourceKind: "wood",
    income: 2,
    lastHarvestDay: 1
  };

  assert.equal(describeCocosTileObject(tile)?.shortLabel, "矿场");
  assert.equal(describeCocosTileObject(tile)?.tag, "采集");
  assert.match(describeCocosTileObject(tile)?.subtitle ?? "", /木材 \+2 · 今日已采集/);
  assert.equal(buildCocosTileMarkerText(tile), ">M");
  assert.equal(resolveCocosTileMarkerVisual(tile)?.iconKey, "mine");
  assert.equal(resolveCocosTileMarkerVisual(tile)?.interactionType, "move");
});

test("resolveCocosTileMarkerVisual keeps generic buildings visible via fallback labels", () => {
  const tile = createTile();
  tile.occupant = {
    kind: "building",
    refId: "building-1"
  };

  assert.equal(resolveCocosTileMarkerVisual(tile)?.iconKey, null);
  assert.equal(resolveCocosTileMarkerVisual(tile)?.fallbackLabel, "建筑");
  assert.equal(resolveCocosTileMarkerVisual(tile)?.interactionType, "move");
});
