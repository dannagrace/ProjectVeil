import assert from "node:assert/strict";
import test from "node:test";
import { buildCocosTileMarkerText, describeCocosTileObject } from "../assets/scripts/cocos-object-visuals";
import type { PlayerTileView } from "../assets/scripts/VeilCocosSession";

function createTile(): PlayerTileView {
  return {
    position: { x: 1, y: 1 },
    fog: "visible",
    terrain: "grass",
    walkable: true,
    resource: undefined,
    occupant: undefined
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

  assert.equal(describeCocosTileObject(heroTile)?.faction, "crown");
  assert.equal(describeCocosTileObject(heroTile)?.shortLabel, "英雄");
  assert.equal(buildCocosTileMarkerText(heroTile), "!H");
});

test("buildCocosTileMarkerText hides empty walkable tiles", () => {
  assert.equal(buildCocosTileMarkerText(createTile()), "");
});
