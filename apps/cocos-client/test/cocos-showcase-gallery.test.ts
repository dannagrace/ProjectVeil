import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLobbyShowcasePhaseLabel,
  getLobbyShowcaseUnitPageCount,
  nextLobbyShowcasePhase,
  nextLobbyShowcaseUnitPage,
  resolveLobbyShowcaseEntries,
  resolveLobbyBuildingFrame,
  resolveLobbyTerrainFrame,
  resolveLobbyShowcaseFrame
} from "../assets/scripts/cocos-showcase-gallery";

test("showcase gallery phases rotate idle -> selected -> hit -> idle", () => {
  assert.equal(nextLobbyShowcasePhase("idle"), "selected");
  assert.equal(nextLobbyShowcasePhase("selected"), "hit");
  assert.equal(nextLobbyShowcasePhase("hit"), "idle");
  assert.equal(formatLobbyShowcasePhaseLabel("idle"), "待机");
  assert.equal(formatLobbyShowcasePhaseLabel("selected"), "预备");
  assert.equal(formatLobbyShowcasePhaseLabel("hit"), "受击");
});

test("showcase gallery prefers unit state frames for hero entries when available", () => {
  const frame = resolveLobbyShowcaseFrame(
    { kind: "hero", id: "hero_guard_basic", label: "守御" },
    {
      icons: {},
      heroes: { hero_guard_basic: "hero-portrait" },
      units: {
        hero_guard_basic: {
          idle: "unit-idle",
          selected: "unit-selected",
          hit: "unit-hit"
        }
      },
      showcaseUnits: {},
      showcaseTerrain: {},
      showcaseBuildings: {}
    },
    "selected"
  );

  assert.equal(frame, "unit-selected");
});

test("showcase gallery falls back to hero portrait and building art when stateful frames are absent", () => {
  const heroFrame = resolveLobbyShowcaseFrame(
    { kind: "hero", id: "hero_ranger_serin", label: "瑟琳" },
    {
      icons: {},
      heroes: { hero_ranger_serin: "hero-portrait" },
      units: {},
      showcaseUnits: {},
      showcaseTerrain: {},
      showcaseBuildings: {}
    },
    "hit"
  );
  const buildingFrame = resolveLobbyShowcaseFrame(
    { kind: "building", id: "forge_hall", label: "锻炉" },
    {
      icons: {},
      heroes: {},
      units: {},
      showcaseUnits: {},
      showcaseTerrain: {},
      showcaseBuildings: { forge_hall: "forge-hall" }
    },
    "idle"
  );

  assert.equal(heroFrame, "hero-portrait");
  assert.equal(buildingFrame, "forge-hall");
});

test("showcase gallery resolves terrain frames from the dedicated showcase terrain pack", () => {
  const terrainFrame = resolveLobbyTerrainFrame(
    { id: "snow", label: "雪原" },
    {
      icons: {},
      heroes: {},
      units: {},
      showcaseUnits: {},
      showcaseTerrain: { snow: "snow-tile" },
      showcaseBuildings: {}
    }
  );

  assert.equal(terrainFrame, "snow-tile");
});

test("showcase gallery resolves building art first and falls back to icon art when needed", () => {
  const buildingFrame = resolveLobbyBuildingFrame(
    { id: "resource_mine", label: "矿场", iconKey: "mine" },
    {
      icons: { mine: "mine-icon" },
      heroes: {},
      units: {},
      showcaseUnits: {},
      showcaseTerrain: {},
      showcaseBuildings: { resource_mine: "mine-building" }
    }
  );
  const fallbackFrame = resolveLobbyBuildingFrame(
    { id: "attribute_shrine", label: "神社", iconKey: "shrine" },
    {
      icons: { shrine: "shrine-icon" },
      heroes: {},
      units: {},
      showcaseUnits: {},
      showcaseTerrain: {},
      showcaseBuildings: {}
    }
  );

  assert.equal(buildingFrame, "mine-building");
  assert.equal(fallbackFrame, "shrine-icon");
});

test("showcase gallery rotates unit pages in overlapping windows so all six showcase units appear", () => {
  const page0 = resolveLobbyShowcaseEntries(0);
  const page1 = resolveLobbyShowcaseEntries(1);
  const wrappedPage = resolveLobbyShowcaseEntries(3);

  assert.equal(getLobbyShowcaseUnitPageCount(), 2);
  assert.equal(nextLobbyShowcaseUnitPage(0), 1);
  assert.equal(nextLobbyShowcaseUnitPage(1), 0);
  assert.deepEqual(
    page0.slice(4).map((entry) => entry.id),
    ["sunlance_knight", "moss_stalker", "ember_mage", "iron_walker"]
  );
  assert.deepEqual(
    page1.slice(4).map((entry) => entry.id),
    ["ember_mage", "iron_walker", "dune_raider", "glacier_warden"]
  );
  assert.deepEqual(wrappedPage.map((entry) => entry.id), page1.map((entry) => entry.id));
});
