import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import crypto from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const cocosResourceRoot = resolve(rootDir, "apps/cocos-client/assets/resources");

const mirroredCopies = [
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/grass-1.png",
    targets: [
      "apps/client/public/assets/pixel/terrain/grass-tile.png",
      "apps/cocos-client/assets/resources/pixel/terrain/grass-tile.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/grass-2.png",
    targets: [
      "apps/client/public/assets/pixel/terrain/grass-tile-alt.png",
      "apps/cocos-client/assets/resources/pixel/terrain/grass-tile-alt.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/dirt-1.png",
    targets: [
      "apps/client/public/assets/pixel/terrain/dirt-tile.png",
      "apps/cocos-client/assets/resources/pixel/terrain/dirt-tile.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/dirt-2.png",
    targets: [
      "apps/client/public/assets/pixel/terrain/dirt-tile-alt.png",
      "apps/cocos-client/assets/resources/pixel/terrain/dirt-tile-alt.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/sand-1.png",
    targets: [
      "apps/client/public/assets/pixel/terrain/sand-tile.png",
      "apps/cocos-client/assets/resources/pixel/terrain/sand-tile.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/sand-2.png",
    targets: [
      "apps/client/public/assets/pixel/terrain/sand-tile-alt.png",
      "apps/cocos-client/assets/resources/pixel/terrain/sand-tile-alt.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/water-1.png",
    targets: [
      "apps/client/public/assets/pixel/terrain/water-tile.png",
      "apps/cocos-client/assets/resources/pixel/terrain/water-tile.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/water-2.png",
    targets: [
      "apps/client/public/assets/pixel/terrain/water-tile-alt.png",
      "apps/cocos-client/assets/resources/pixel/terrain/water-tile-alt.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/unknown-1.png",
    targets: [
      "apps/client/public/assets/pixel/terrain/fog-tile.png",
      "apps/cocos-client/assets/resources/pixel/terrain/fog-tile.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/hidden-1.png",
    targets: ["apps/cocos-client/assets/resources/pixel/terrain/hidden-tile.png"]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/hidden-2.png",
    targets: ["apps/cocos-client/assets/resources/pixel/terrain/hidden-tile-alt.png"]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/tiles/hidden-3.png",
    targets: ["apps/cocos-client/assets/resources/pixel/terrain/hidden-tile-deep.png"]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/icons/gold.png",
    targets: [
      "apps/client/public/assets/pixel/resources/gold-pile.png",
      "apps/cocos-client/assets/resources/pixel/resources/gold-pile.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/icons/wood.png",
    targets: [
      "apps/client/public/assets/pixel/resources/wood-stack.png",
      "apps/cocos-client/assets/resources/pixel/resources/wood-stack.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/icons/ore.png",
    targets: [
      "apps/client/public/assets/pixel/resources/ore-crate.png",
      "apps/cocos-client/assets/resources/pixel/resources/ore-crate.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/icons/hero.png",
    targets: [
      "apps/client/public/assets/pixel/markers/hero-marker.png",
      "apps/client/public/assets/pixel/markers/hero-marker-selected.png",
      "apps/client/public/assets/pixel/markers/hero-marker-hit.png",
      "apps/cocos-client/assets/resources/pixel/markers/hero-marker.png",
      "apps/cocos-client/assets/resources/pixel/markers/hero-marker-selected.png",
      "apps/cocos-client/assets/resources/pixel/markers/hero-marker-hit.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/icons/neutral.png",
    targets: [
      "apps/client/public/assets/pixel/markers/neutral-marker.png",
      "apps/client/public/assets/pixel/markers/neutral-marker-selected.png",
      "apps/client/public/assets/pixel/markers/neutral-marker-hit.png",
      "apps/cocos-client/assets/resources/pixel/markers/neutral-marker.png",
      "apps/cocos-client/assets/resources/pixel/markers/neutral-marker-selected.png",
      "apps/cocos-client/assets/resources/pixel/markers/neutral-marker-hit.png"
    ]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/icons/hud.png",
    targets: ["apps/cocos-client/assets/resources/pixel/ui/hud-icon.png"]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/icons/battle.png",
    targets: ["apps/cocos-client/assets/resources/pixel/ui/battle-icon.png"]
  },
  {
    from: "apps/cocos-client/assets/resources/placeholder/icons/timeline.png",
    targets: ["apps/cocos-client/assets/resources/pixel/ui/timeline-icon.png"]
  }
];

const generatedImages = [
  {
    width: 96,
    height: 96,
    painter: (x, y, width, height) => drawUnitFrame(x, y, width, height, {
      border: rgb(54, 95, 81),
      corner: rgb(233, 206, 132),
      inner: rgb(250, 246, 236, 0),
      inset: rgb(189, 225, 199, 140)
    }),
    targets: [
      "apps/client/public/assets/pixel/frames/unit-frame-ally.png",
      "apps/cocos-client/assets/resources/pixel/frames/unit-frame-ally.png"
    ]
  },
  {
    width: 96,
    height: 96,
    painter: (x, y, width, height) => drawUnitFrame(x, y, width, height, {
      border: rgb(120, 44, 44),
      corner: rgb(242, 198, 164),
      inner: rgb(250, 246, 236, 0),
      inset: rgb(226, 172, 162, 132)
    }),
    targets: [
      "apps/client/public/assets/pixel/frames/unit-frame-enemy.png",
      "apps/cocos-client/assets/resources/pixel/frames/unit-frame-enemy.png"
    ]
  },
  {
    width: 32,
    height: 32,
    painter: drawFactionCrownBadge,
    targets: [
      "apps/client/public/assets/pixel/badges/faction-crown.png",
      "apps/cocos-client/assets/resources/pixel/badges/faction-crown.png"
    ]
  },
  {
    width: 32,
    height: 32,
    painter: drawFactionWildBadge,
    targets: [
      "apps/client/public/assets/pixel/badges/faction-wild.png",
      "apps/cocos-client/assets/resources/pixel/badges/faction-wild.png"
    ]
  },
  {
    width: 32,
    height: 32,
    painter: drawCommonRarityBadge,
    targets: [
      "apps/client/public/assets/pixel/badges/rarity-common.png",
      "apps/cocos-client/assets/resources/pixel/badges/rarity-common.png"
    ]
  },
  {
    width: 32,
    height: 32,
    painter: drawEliteRarityBadge,
    targets: [
      "apps/client/public/assets/pixel/badges/rarity-elite.png",
      "apps/cocos-client/assets/resources/pixel/badges/rarity-elite.png"
    ]
  },
  {
    width: 32,
    height: 32,
    painter: drawMoveInteractionBadge,
    targets: [
      "apps/client/public/assets/pixel/badges/interaction-move.png",
      "apps/cocos-client/assets/resources/pixel/badges/interaction-move.png"
    ]
  },
  {
    width: 32,
    height: 32,
    painter: drawPickupInteractionBadge,
    targets: [
      "apps/client/public/assets/pixel/badges/interaction-pickup.png",
      "apps/cocos-client/assets/resources/pixel/badges/interaction-pickup.png"
    ]
  },
  {
    width: 32,
    height: 32,
    painter: drawBattleInteractionBadge,
    targets: [
      "apps/client/public/assets/pixel/badges/interaction-battle.png",
      "apps/cocos-client/assets/resources/pixel/badges/interaction-battle.png"
    ]
  }
];

const heroPortraitDescriptors = [
  {
    key: "hero-guard-basic",
    palette: {
      background: rgb(56, 82, 116),
      frame: rgb(237, 208, 140),
      skin: rgb(235, 208, 180),
      hair: rgb(78, 56, 36),
      armor: rgb(154, 176, 202),
      accent: rgb(255, 244, 208)
    },
    crest: "crown"
  },
  {
    key: "hero-ranger-serin",
    palette: {
      background: rgb(48, 88, 74),
      frame: rgb(208, 226, 162),
      skin: rgb(226, 193, 164),
      hair: rgb(96, 58, 34),
      armor: rgb(102, 132, 88),
      accent: rgb(232, 245, 198)
    },
    crest: "leaf"
  },
  {
    key: "hero-oracle-lyra",
    palette: {
      background: rgb(82, 64, 118),
      frame: rgb(214, 196, 255),
      skin: rgb(234, 204, 190),
      hair: rgb(238, 229, 180),
      armor: rgb(174, 152, 228),
      accent: rgb(255, 246, 228)
    },
    crest: "star"
  },
  {
    key: "hero-forgeguard-borin",
    palette: {
      background: rgb(104, 62, 46),
      frame: rgb(238, 194, 142),
      skin: rgb(226, 186, 160),
      hair: rgb(84, 48, 30),
      armor: rgb(148, 116, 88),
      accent: rgb(255, 230, 196)
    },
    crest: "hammer"
  }
];

const showcaseUnitDescriptors = [
  {
    key: "sunlance-knight",
    shape: "knight",
    frame: "ally",
    palette: {
      backdrop: rgb(58, 88, 120, 192),
      primary: rgb(222, 210, 176),
      secondary: rgb(92, 126, 196),
      accent: rgb(255, 232, 154),
      hit: rgb(194, 108, 92)
    }
  },
  {
    key: "moss-stalker",
    shape: "beast",
    frame: "enemy",
    palette: {
      backdrop: rgb(64, 82, 54, 192),
      primary: rgb(128, 172, 94),
      secondary: rgb(68, 98, 54),
      accent: rgb(226, 240, 184),
      hit: rgb(196, 106, 94)
    }
  },
  {
    key: "ember-mage",
    shape: "mage",
    frame: "ally",
    palette: {
      backdrop: rgb(92, 62, 48, 192),
      primary: rgb(204, 92, 68),
      secondary: rgb(84, 50, 116),
      accent: rgb(255, 224, 168),
      hit: rgb(232, 116, 96)
    }
  },
  {
    key: "iron-walker",
    shape: "construct",
    frame: "enemy",
    palette: {
      backdrop: rgb(76, 76, 82, 192),
      primary: rgb(152, 166, 180),
      secondary: rgb(88, 104, 126),
      accent: rgb(224, 236, 242),
      hit: rgb(196, 114, 96)
    }
  },
  {
    key: "dune-raider",
    shape: "raider",
    frame: "enemy",
    palette: {
      backdrop: rgb(118, 88, 48, 192),
      primary: rgb(218, 184, 118),
      secondary: rgb(128, 72, 52),
      accent: rgb(255, 238, 196),
      hit: rgb(214, 112, 92)
    }
  },
  {
    key: "glacier-warden",
    shape: "warden",
    frame: "ally",
    palette: {
      backdrop: rgb(64, 94, 126, 192),
      primary: rgb(184, 220, 236),
      secondary: rgb(98, 128, 168),
      accent: rgb(250, 252, 255),
      hit: rgb(188, 108, 96)
    }
  }
];

const coreUnitDescriptors = [
  {
    key: "hero-guard-basic",
    shape: "knight",
    palette: {
      backdrop: rgb(62, 84, 118, 192),
      primary: rgb(214, 214, 204),
      secondary: rgb(88, 128, 192),
      accent: rgb(255, 236, 182),
      hit: rgb(204, 110, 92)
    }
  },
  {
    key: "wolf-pack",
    shape: "beast",
    palette: {
      backdrop: rgb(74, 68, 64, 192),
      primary: rgb(162, 156, 152),
      secondary: rgb(98, 88, 84),
      accent: rgb(242, 228, 208),
      hit: rgb(196, 106, 96)
    }
  }
];

const showcaseTerrainDescriptors = [
  {
    key: "grassland",
    palette: {
      backdrop: rgb(86, 128, 82),
      base: rgb(104, 164, 98),
      shadow: rgb(62, 118, 68),
      accent: rgb(196, 232, 136),
      detail: rgb(238, 212, 156)
    }
  },
  {
    key: "mountain",
    palette: {
      backdrop: rgb(82, 94, 116),
      base: rgb(118, 132, 152),
      shadow: rgb(80, 90, 112),
      accent: rgb(222, 228, 236),
      detail: rgb(152, 124, 92)
    }
  },
  {
    key: "water",
    palette: {
      backdrop: rgb(62, 98, 142),
      base: rgb(82, 144, 206),
      shadow: rgb(48, 88, 154),
      accent: rgb(210, 242, 255),
      detail: rgb(118, 190, 236)
    }
  },
  {
    key: "desert",
    palette: {
      backdrop: rgb(158, 122, 72),
      base: rgb(212, 176, 112),
      shadow: rgb(180, 142, 88),
      accent: rgb(255, 236, 182),
      detail: rgb(198, 164, 118)
    }
  },
  {
    key: "snow",
    palette: {
      backdrop: rgb(114, 146, 188),
      base: rgb(228, 238, 248),
      shadow: rgb(188, 208, 228),
      accent: rgb(252, 254, 255),
      detail: rgb(144, 176, 212)
    }
  }
];

generatedImages.push(
  ...heroPortraitDescriptors.flatMap((descriptor) => [
    {
      width: 16,
      height: 16,
      painter: (x, y, width, height) => drawHeroPortrait(x, y, width, height, descriptor.palette, descriptor.crest),
      targets: [
        `apps/client/public/assets/pixel/heroes/${descriptor.key}.png`,
        `apps/cocos-client/assets/resources/pixel/heroes/${descriptor.key}.png`
      ]
    }
  ]),
  ...showcaseUnitDescriptors.flatMap((descriptor) =>
    ["idle", "selected", "hit"].map((state) => ({
      width: 32,
      height: 32,
      painter: (x, y, width, height) =>
        drawShowcaseUnitPortrait(x, y, width, height, descriptor.palette, descriptor.shape, state),
      targets: [
        `apps/client/public/assets/pixel/showcase-units/${descriptor.key}${state === "idle" ? "" : `-${state}`}.png`,
        `apps/cocos-client/assets/resources/pixel/showcase-units/${descriptor.key}${state === "idle" ? "" : `-${state}`}.png`
      ]
    }))
  ),
  ...coreUnitDescriptors.flatMap((descriptor) =>
    ["idle", "selected", "hit"].map((state) => ({
      width: 32,
      height: 32,
      painter: (x, y, width, height) =>
        drawShowcaseUnitPortrait(x, y, width, height, descriptor.palette, descriptor.shape, state),
      targets: [
        `apps/client/public/assets/pixel/units/${descriptor.key}${state === "idle" ? "" : `-${state}`}.png`,
        `apps/cocos-client/assets/resources/pixel/units/${descriptor.key}${state === "idle" ? "" : `-${state}`}.png`
      ]
    }))
  ),
  {
    width: 256,
    height: 256,
    painter: drawRecruitmentPostIcon,
    targets: [
      "apps/client/public/assets/pixel/buildings/recruitment-post.png",
      "apps/cocos-client/assets/resources/pixel/buildings/recruitment-post.png"
    ]
  },
  {
    width: 256,
    height: 256,
    painter: drawAttributeShrineIcon,
    targets: [
      "apps/client/public/assets/pixel/buildings/attribute-shrine.png",
      "apps/cocos-client/assets/resources/pixel/buildings/attribute-shrine.png"
    ]
  },
  {
    width: 256,
    height: 256,
    painter: drawResourceMineIcon,
    targets: [
      "apps/client/public/assets/pixel/buildings/resource-mine.png",
      "apps/cocos-client/assets/resources/pixel/buildings/resource-mine.png"
    ]
  },
  {
    width: 256,
    height: 256,
    painter: drawForgeHallIcon,
    targets: [
      "apps/client/public/assets/pixel/buildings/forge-hall.png",
      "apps/cocos-client/assets/resources/pixel/buildings/forge-hall.png"
    ]
  },
  ...showcaseTerrainDescriptors.flatMap((descriptor) => [
    {
      width: 64,
      height: 64,
      painter: (x, y, width, height) => drawShowcaseTerrainTile(x, y, width, height, descriptor.key, descriptor.palette),
      targets: [
        `apps/client/public/assets/pixel/showcase-terrain/${descriptor.key}-tile.png`,
        `apps/cocos-client/assets/resources/pixel/showcase-terrain/${descriptor.key}-tile.png`
      ]
    }
  ])
);

function drawShowcaseTerrainTile(x, y, width, height, kind, palette) {
  let color = palette.backdrop;
  if (isRoundedRect(x, y, width, height, 0.06, 0.06, 0.88, 0.88, 6)) {
    color = palette.base;
  }
  if (isRoundedRect(x, y, width, height, 0.1, 0.1, 0.8, 0.8, 4)) {
    color = palette.base;
  }

  if (kind === "grassland") {
    if (isDiagonalBand(x, y, width, height, -0.45, 1.1, 4) || isDiagonalBand(x, y, width, height, 0.35, 0.74, 3)) {
      color = palette.shadow;
    }
    if (isCircle(x, y, width * 0.24, height * 0.34, width * 0.04) || isCircle(x, y, width * 0.62, height * 0.56, width * 0.04)) {
      color = palette.detail;
    }
    if (
      isRoundedRect(x, y, width, height, 0.18, 0.44, 0.06, 0.2, 2) ||
      isRoundedRect(x, y, width, height, 0.52, 0.26, 0.06, 0.26, 2) ||
      isRoundedRect(x, y, width, height, 0.72, 0.48, 0.06, 0.18, 2)
    ) {
      color = palette.accent;
    }
  }

  if (kind === "mountain") {
    if (isTriangle(x, y, [width * 0.12, height * 0.74], [width * 0.36, height * 0.28], [width * 0.58, height * 0.74])) {
      color = palette.shadow;
    }
    if (isTriangle(x, y, [width * 0.42, height * 0.74], [width * 0.68, height * 0.18], [width * 0.9, height * 0.74])) {
      color = palette.detail;
    }
    if (
      isTriangle(x, y, [width * 0.28, height * 0.44], [width * 0.36, height * 0.28], [width * 0.44, height * 0.44]) ||
      isTriangle(x, y, [width * 0.6, height * 0.34], [width * 0.68, height * 0.18], [width * 0.76, height * 0.34])
    ) {
      color = palette.accent;
    }
  }

  if (kind === "water") {
    if (isDiagonalBand(x, y, width, height, 0.18, 0.56, 2) || isDiagonalBand(x, y, width, height, -0.14, 1.02, 2)) {
      color = palette.shadow;
    }
    if (
      isRoundedRect(x, y, width, height, 0.18, 0.24, 0.18, 0.04, 2) ||
      isRoundedRect(x, y, width, height, 0.52, 0.42, 0.2, 0.04, 2) ||
      isRoundedRect(x, y, width, height, 0.32, 0.64, 0.22, 0.04, 2)
    ) {
      color = palette.accent;
    }
    if (isCircle(x, y, width * 0.76, height * 0.26, width * 0.04)) {
      color = palette.detail;
    }
  }

  if (kind === "desert") {
    if (isDiagonalBand(x, y, width, height, -0.28, 1.18, 4) || isDiagonalBand(x, y, width, height, 0.2, 0.78, 3)) {
      color = palette.shadow;
    }
    if (
      isTriangle(x, y, [width * 0.22, height * 0.52], [width * 0.3, height * 0.34], [width * 0.38, height * 0.52]) ||
      isTriangle(x, y, [width * 0.64, height * 0.42], [width * 0.72, height * 0.24], [width * 0.8, height * 0.42])
    ) {
      color = palette.detail;
    }
    if (isCircle(x, y, width * 0.54, height * 0.66, width * 0.03) || isCircle(x, y, width * 0.18, height * 0.28, width * 0.03)) {
      color = palette.accent;
    }
  }

  if (kind === "snow") {
    if (isDiagonalBand(x, y, width, height, -0.24, 1.1, 4) || isDiagonalBand(x, y, width, height, 0.16, 0.78, 2)) {
      color = palette.shadow;
    }
    if (
      isTriangle(x, y, [width * 0.22, height * 0.46], [width * 0.3, height * 0.28], [width * 0.38, height * 0.46]) ||
      isTriangle(x, y, [width * 0.62, height * 0.58], [width * 0.72, height * 0.34], [width * 0.82, height * 0.58])
    ) {
      color = palette.detail;
    }
    if (
      isCircle(x, y, width * 0.24, height * 0.24, width * 0.03) ||
      isCircle(x, y, width * 0.48, height * 0.18, width * 0.03) ||
      isCircle(x, y, width * 0.74, height * 0.3, width * 0.03)
    ) {
      color = palette.accent;
    }
  }

  return color;
}

const missingSources = mirroredCopies
  .map((copy) => copy.from)
  .filter((from) => !existsSync(resolve(rootDir, from)));

if (missingSources.length > 0) {
  console.error("Missing source assets:");
  for (const source of missingSources) {
    console.error(`- ${source}`);
  }
  process.exit(1);
}

let copiedCount = 0;
for (const entry of mirroredCopies) {
  const sourcePath = resolve(rootDir, entry.from);
  for (const target of entry.targets) {
    const targetPath = resolve(rootDir, target);
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath);
    if (isCocosResource(targetPath)) {
      ensureCocosImageMeta(targetPath);
    }
    copiedCount += 1;
  }
}

let generatedCount = 0;
for (const entry of generatedImages) {
  for (const target of entry.targets) {
    const targetPath = resolve(rootDir, target);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, createPng(entry.width, entry.height, entry.painter));
    if (isCocosResource(targetPath)) {
      ensureCocosImageMeta(targetPath);
    }
    generatedCount += 1;
  }
}

console.log(
  `Synced ${copiedCount} mirrored pixel assets and generated ${generatedCount} pixel UI assets for H5 + Cocos.`
);

function isCocosResource(filepath) {
  return filepath.startsWith(cocosResourceRoot);
}

function ensureCocosImageMeta(filepath) {
  const metaPath = `${filepath}.meta`;
  if (existsSync(metaPath)) {
    return;
  }

  const stem = filepath.slice(filepath.lastIndexOf("/") + 1, filepath.lastIndexOf("."));
  const uuid = crypto.randomUUID();
  const meta = {
    ver: "1.0.27",
    importer: "image",
    imported: true,
    uuid,
    files: [".json", ".png"],
    subMetas: {
      "6c48a": {
        importer: "texture",
        uuid: `${uuid}@6c48a`,
        displayName: stem,
        id: "6c48a",
        name: "texture",
        userData: {
          wrapModeS: "clamp-to-edge",
          wrapModeT: "clamp-to-edge",
          minfilter: "nearest",
          magfilter: "nearest",
          mipfilter: "none",
          anisotropy: 0,
          isUuid: true,
          imageUuidOrDatabaseUri: uuid,
          visible: false
        },
        ver: "1.0.22",
        imported: true,
        files: [".json"],
        subMetas: {}
      }
    },
    userData: {
      type: "texture",
      fixAlphaTransparencyArtifacts: false,
      hasAlpha: true,
      redirect: `${uuid}@6c48a`
    }
  };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
}

function createPng(width, height, painter) {
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = painter(x, y, width, height);
      const offset = (y * width + x) * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = color[3] ?? 255;
    }
  }

  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    const scanlineOffset = y * (width * 4 + 1);
    scanlines[scanlineOffset] = 0;
    pixels.copy(scanlines, scanlineOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = chunk(
    "IHDR",
    Buffer.from([
      (width >>> 24) & 255,
      (width >>> 16) & 255,
      (width >>> 8) & 255,
      width & 255,
      (height >>> 24) & 255,
      (height >>> 16) & 255,
      (height >>> 8) & 255,
      height & 255,
      8,
      6,
      0,
      0,
      0
    ])
  );
  const idat = chunk("IDAT", zlib.deflateSync(scanlines));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rgb(r, g, b, a = 255) {
  return [clamp(r), clamp(g), clamp(b), clamp(a)];
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function isCircle(x, y, cx, cy, radius) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function isRoundedRect(x, y, width, height, rx, ry, rw, rh, radius) {
  const left = width * rx;
  const top = height * ry;
  const rectWidth = width * rw;
  const rectHeight = height * rh;
  const right = left + rectWidth;
  const bottom = top + rectHeight;

  if (x >= left + radius && x <= right - radius && y >= top && y <= bottom) return true;
  if (x >= left && x <= right && y >= top + radius && y <= bottom - radius) return true;
  return (
    isCircle(x, y, left + radius, top + radius, radius) ||
    isCircle(x, y, right - radius, top + radius, radius) ||
    isCircle(x, y, left + radius, bottom - radius, radius) ||
    isCircle(x, y, right - radius, bottom - radius, radius)
  );
}

function isTriangle(x, y, a, b, c) {
  const area = triangleArea(a, b, c);
  const area1 = triangleArea([x, y], b, c);
  const area2 = triangleArea(a, [x, y], c);
  const area3 = triangleArea(a, b, [x, y]);
  return Math.abs(area - (area1 + area2 + area3)) < 0.8;
}

function triangleArea([ax, ay], [bx, by], [cx, cy]) {
  return Math.abs((ax * (by - cy) + bx * (cy - ay) + cx * (ay - by)) / 2);
}

function isDiagonalBand(x, y, width, height, slope, interceptScale, thickness) {
  const targetY = slope * (x - width / 2) + height * interceptScale * 0.5;
  return Math.abs(y - targetY) <= thickness;
}

function drawBadgeShell(x, y, width, height, outer, inner) {
  if (!isCircle(x, y, width * 0.5, height * 0.5, width * 0.46)) {
    return rgb(0, 0, 0, 0);
  }
  if (isCircle(x, y, width * 0.5, height * 0.5, width * 0.34)) {
    return inner;
  }
  return outer;
}

function drawFactionCrownBadge(x, y, width, height) {
  let color = drawBadgeShell(x, y, width, height, rgb(56, 90, 74), rgb(214, 185, 108));
  if (color[3] === 0) {
    return color;
  }

  if (isRoundedRect(x, y, width, height, 0.28, 0.56, 0.44, 0.1, 2)) color = rgb(82, 60, 24);
  if (isTriangle(x, y, [width * 0.28, height * 0.56], [width * 0.4, height * 0.28], [width * 0.48, height * 0.56])) color = rgb(255, 240, 192);
  if (isTriangle(x, y, [width * 0.42, height * 0.56], [width * 0.5, height * 0.22], [width * 0.58, height * 0.56])) color = rgb(255, 248, 208);
  if (isTriangle(x, y, [width * 0.52, height * 0.56], [width * 0.64, height * 0.28], [width * 0.72, height * 0.56])) color = rgb(255, 240, 192);
  return color;
}

function drawFactionWildBadge(x, y, width, height) {
  let color = drawBadgeShell(x, y, width, height, rgb(93, 45, 45), rgb(183, 112, 86));
  if (color[3] === 0) {
    return color;
  }

  if (isTriangle(x, y, [width * 0.28, height * 0.26], [width * 0.42, height * 0.48], [width * 0.3, height * 0.56])) color = rgb(245, 225, 196);
  if (isTriangle(x, y, [width * 0.72, height * 0.26], [width * 0.58, height * 0.48], [width * 0.7, height * 0.56])) color = rgb(245, 225, 196);
  if (isRoundedRect(x, y, width, height, 0.3, 0.5, 0.4, 0.18, 4)) color = rgb(66, 36, 32);
  if (isTriangle(x, y, [width * 0.38, height * 0.62], [width * 0.5, height * 0.8], [width * 0.62, height * 0.62])) color = rgb(245, 225, 196);
  return color;
}

function drawCommonRarityBadge(x, y, width, height) {
  let color = drawBadgeShell(x, y, width, height, rgb(78, 94, 112), rgb(188, 203, 224));
  if (color[3] === 0) {
    return color;
  }

  if (isTriangle(x, y, [width * 0.5, height * 0.2], [width * 0.34, height * 0.5], [width * 0.5, height * 0.8])) color = rgb(248, 252, 255);
  if (isTriangle(x, y, [width * 0.5, height * 0.2], [width * 0.66, height * 0.5], [width * 0.5, height * 0.8])) color = rgb(220, 232, 248);
  if (isCircle(x, y, width * 0.5, height * 0.5, width * 0.08)) color = rgb(255, 255, 255);
  return color;
}

function drawEliteRarityBadge(x, y, width, height) {
  let color = drawBadgeShell(x, y, width, height, rgb(114, 76, 24), rgb(234, 194, 84));
  if (color[3] === 0) {
    return color;
  }

  if (isTriangle(x, y, [width * 0.5, height * 0.16], [width * 0.42, height * 0.44], [width * 0.5, height * 0.52])) color = rgb(255, 248, 216);
  if (isTriangle(x, y, [width * 0.5, height * 0.16], [width * 0.58, height * 0.44], [width * 0.5, height * 0.52])) color = rgb(255, 242, 198);
  if (isTriangle(x, y, [width * 0.26, height * 0.38], [width * 0.46, height * 0.46], [width * 0.38, height * 0.64])) color = rgb(255, 232, 164);
  if (isTriangle(x, y, [width * 0.74, height * 0.38], [width * 0.54, height * 0.46], [width * 0.62, height * 0.64])) color = rgb(255, 232, 164);
  if (isRoundedRect(x, y, width, height, 0.34, 0.62, 0.32, 0.08, 2)) color = rgb(130, 82, 18);
  return color;
}

function drawMoveInteractionBadge(x, y, width, height) {
  let color = drawBadgeShell(x, y, width, height, rgb(54, 86, 118), rgb(138, 192, 236));
  if (color[3] === 0) {
    return color;
  }

  if (isRoundedRect(x, y, width, height, 0.24, 0.56, 0.34, 0.12, 3)) color = rgb(248, 249, 252);
  if (isTriangle(x, y, [width * 0.56, height * 0.38], [width * 0.8, height * 0.56], [width * 0.56, height * 0.74])) color = rgb(248, 249, 252);
  return color;
}

function drawPickupInteractionBadge(x, y, width, height) {
  let color = drawBadgeShell(x, y, width, height, rgb(86, 72, 32), rgb(212, 182, 96));
  if (color[3] === 0) {
    return color;
  }

  if (isRoundedRect(x, y, width, height, 0.28, 0.44, 0.44, 0.26, 4)) color = rgb(120, 80, 42);
  if (isRoundedRect(x, y, width, height, 0.34, 0.34, 0.32, 0.08, 2)) color = rgb(244, 232, 184);
  if (isDiagonalBand(x, y, width, height, -0.9, 1.34, 1)) color = rgb(164, 120, 72);
  return color;
}

function drawBattleInteractionBadge(x, y, width, height) {
  let color = drawBadgeShell(x, y, width, height, rgb(98, 44, 34), rgb(222, 112, 86));
  if (color[3] === 0) {
    return color;
  }

  if (isTriangle(x, y, [width * 0.28, height * 0.72], [width * 0.48, height * 0.22], [width * 0.42, height * 0.72])) color = rgb(255, 244, 225);
  if (isTriangle(x, y, [width * 0.72, height * 0.72], [width * 0.52, height * 0.22], [width * 0.58, height * 0.72])) color = rgb(255, 244, 225);
  if (isRoundedRect(x, y, width, height, 0.36, 0.72, 0.08, 0.12, 2)) color = rgb(120, 70, 38);
  if (isRoundedRect(x, y, width, height, 0.56, 0.72, 0.08, 0.12, 2)) color = rgb(120, 70, 38);
  return color;
}

function drawUnitFrame(x, y, width, height, palette) {
  const frameThickness = Math.max(4, Math.round(width * 0.08));
  const insetThickness = Math.max(2, Math.round(width * 0.03));
  const nearEdge = x < frameThickness || y < frameThickness || x >= width - frameThickness || y >= height - frameThickness;
  const innerEdge =
    x < frameThickness + insetThickness ||
    y < frameThickness + insetThickness ||
    x >= width - frameThickness - insetThickness ||
    y >= height - frameThickness - insetThickness;
  const cornerAccent =
    isRoundedRect(x, y, width, height, 0.08, 0.08, 0.18, 0.08, 3) ||
    isRoundedRect(x, y, width, height, 0.74, 0.08, 0.18, 0.08, 3) ||
    isRoundedRect(x, y, width, height, 0.08, 0.84, 0.18, 0.08, 3) ||
    isRoundedRect(x, y, width, height, 0.74, 0.84, 0.18, 0.08, 3);

  if (nearEdge) {
    return palette.border;
  }
  if (cornerAccent) {
    return palette.corner;
  }
  if (innerEdge) {
    return palette.inset;
  }
  return palette.inner;
}

function drawHeroPortrait(x, y, width, height, palette, crest) {
  if (!isRoundedRect(x, y, width, height, 0.06, 0.06, 0.88, 0.88, 3)) {
    return rgb(0, 0, 0, 0);
  }

  let color = palette.frame;
  const inset = x >= 1 && x <= width - 2 && y >= 1 && y <= height - 2;
  if (inset) {
    color = palette.background;
  }

  if (x >= 3 && x <= 12 && y >= 9 && y <= 13) color = palette.armor;
  if (x >= 4 && x <= 11 && y >= 4 && y <= 9) color = palette.skin;
  if (x >= 3 && x <= 12 && y >= 2 && y <= 6) color = palette.hair;
  if (x >= 5 && x <= 10 && y >= 10 && y <= 12) color = palette.accent;
  if ((x === 6 || x === 9) && y === 6) color = rgb(52, 36, 30);
  if (x >= 6 && x <= 9 && y === 8) color = rgb(192, 120, 104);

  if (crest === "crown") {
    if (isTriangle(x, y, [4, 4], [6, 1], [7, 4]) || isTriangle(x, y, [9, 4], [10, 1], [12, 4])) color = palette.accent;
    if (isTriangle(x, y, [6, 4], [8, 0], [10, 4])) color = palette.accent;
  } else if (crest === "leaf") {
    if (isDiagonalBand(x, y, width, height, -0.8, 1.0, 1) && x >= 7 && y <= 6) color = palette.accent;
    if (isDiagonalBand(x, y, width, height, 0.8, -0.2, 1) && x <= 8 && y <= 6) color = palette.accent;
  } else if (crest === "star") {
    if ((x === 8 && y >= 1 && y <= 4) || (y === 3 && x >= 6 && x <= 10)) color = palette.accent;
    if ((x === 7 && y === 2) || (x === 9 && y === 2) || (x === 7 && y === 4) || (x === 9 && y === 4)) color = palette.accent;
  } else if (crest === "hammer") {
    if (x >= 5 && x <= 10 && y >= 2 && y <= 3) color = palette.accent;
    if (x >= 7 && x <= 8 && y >= 2 && y <= 6) color = palette.accent;
  }

  return color;
}

function drawShowcaseUnitPortrait(x, y, width, height, palette, shape, state) {
  if (!isRoundedRect(x, y, width, height, 0.08, 0.08, 0.84, 0.84, 6)) {
    return rgb(0, 0, 0, 0);
  }

  let color = palette.backdrop;
  const centerX = width / 2;
  const centerY = height / 2;

  if (isCircle(x, y, centerX, centerY - 1, width * 0.34)) {
    color = rgb(
      palette.primary[0] + (state === "selected" ? 22 : 0),
      palette.primary[1] + (state === "selected" ? 18 : 0),
      palette.primary[2] + (state === "selected" ? 18 : 0),
      214
    );
  }

  if (shape === "knight") {
    if (isRoundedRect(x, y, width, height, 0.32, 0.28, 0.36, 0.22, 4)) color = palette.primary;
    if (isTriangle(x, y, [width * 0.5, height * 0.12], [width * 0.34, height * 0.36], [width * 0.66, height * 0.36])) color = palette.secondary;
    if (isRoundedRect(x, y, width, height, 0.58, 0.48, 0.12, 0.22, 3)) color = palette.accent;
  } else if (shape === "beast") {
    if (isTriangle(x, y, [width * 0.28, height * 0.3], [width * 0.4, height * 0.12], [width * 0.44, height * 0.36])) color = palette.secondary;
    if (isTriangle(x, y, [width * 0.72, height * 0.3], [width * 0.6, height * 0.12], [width * 0.56, height * 0.36])) color = palette.secondary;
    if (isRoundedRect(x, y, width, height, 0.3, 0.36, 0.4, 0.28, 6)) color = palette.primary;
    if (isTriangle(x, y, [width * 0.46, height * 0.58], [width * 0.5, height * 0.7], [width * 0.54, height * 0.58])) color = palette.accent;
  } else if (shape === "mage") {
    if (isTriangle(x, y, [width * 0.5, height * 0.16], [width * 0.28, height * 0.7], [width * 0.72, height * 0.7])) color = palette.primary;
    if (isCircle(x, y, width * 0.5, height * 0.34, width * 0.11)) color = palette.accent;
    if (isRoundedRect(x, y, width, height, 0.68, 0.24, 0.06, 0.44, 2)) color = palette.secondary;
  } else if (shape === "construct") {
    if (isRoundedRect(x, y, width, height, 0.26, 0.28, 0.48, 0.4, 4)) color = palette.primary;
    if (isRoundedRect(x, y, width, height, 0.38, 0.42, 0.24, 0.08, 2)) color = palette.accent;
    if (isRoundedRect(x, y, width, height, 0.22, 0.64, 0.14, 0.18, 2) || isRoundedRect(x, y, width, height, 0.64, 0.64, 0.14, 0.18, 2)) color = palette.secondary;
  } else if (shape === "raider") {
    if (isRoundedRect(x, y, width, height, 0.28, 0.3, 0.4, 0.28, 5)) color = palette.primary;
    if (isDiagonalBand(x, y, width, height, -0.85, 1.06, 1) && x >= 10 && y >= 10) color = palette.secondary;
    if (isRoundedRect(x, y, width, height, 0.62, 0.18, 0.06, 0.58, 2)) color = palette.accent;
  } else if (shape === "warden") {
    if (isRoundedRect(x, y, width, height, 0.28, 0.3, 0.44, 0.34, 6)) color = palette.primary;
    if (isTriangle(x, y, [width * 0.24, height * 0.4], [width * 0.5, height * 0.12], [width * 0.76, height * 0.4])) color = palette.secondary;
    if (isRoundedRect(x, y, width, height, 0.64, 0.44, 0.1, 0.24, 2)) color = palette.accent;
  }

  if (state === "selected") {
    if (
      x <= 2 ||
      y <= 2 ||
      x >= width - 3 ||
      y >= height - 3 ||
      (x + y) % 11 === 0
    ) {
      color = rgb(255, 244, 196, 220);
    }
  } else if (state === "hit") {
    if (isDiagonalBand(x, y, width, height, 1, 0.3, 1.4) || isDiagonalBand(x, y, width, height, 1, 0.6, 1.4)) {
      color = palette.hit;
    } else if (color[3] > 0) {
      color = rgb(color[0] * 0.88, color[1] * 0.72, color[2] * 0.72, color[3]);
    }
  }

  return color;
}

function drawBuildingBackdrop(x, y, width, height, colors) {
  if (!isRoundedRect(x, y, width, height, 0.06, 0.08, 0.88, 0.82, Math.max(10, Math.round(width * 0.05)))) {
    return rgb(0, 0, 0, 0);
  }

  let color = colors.backdrop;
  if (isRoundedRect(x, y, width, height, 0.1, 0.12, 0.8, 0.74, Math.max(8, Math.round(width * 0.04)))) {
    color = colors.inner;
  }
  if (
    x < Math.max(10, Math.round(width * 0.08)) ||
    y < Math.max(12, Math.round(height * 0.1)) ||
    x >= width - Math.max(10, Math.round(width * 0.08)) ||
    y >= height - Math.max(12, Math.round(height * 0.14))
  ) {
    color = colors.frame;
  }
  if (isRoundedRect(x, y, width, height, 0.14, 0.18, 0.72, 0.04, 3)) {
    color = colors.accent;
  }
  return color;
}

function drawRecruitmentPostIcon(x, y, width, height) {
  let color = drawBuildingBackdrop(x, y, width, height, {
    backdrop: rgb(44, 62, 84),
    inner: rgb(74, 102, 126),
    frame: rgb(226, 205, 162),
    accent: rgb(248, 230, 188)
  });
  if (color[3] === 0) {
    return color;
  }

  if (isTriangle(x, y, [width * 0.18, height * 0.52], [width * 0.5, height * 0.18], [width * 0.82, height * 0.52])) {
    color = rgb(130, 70, 58);
  }
  if (isRoundedRect(x, y, width, height, 0.24, 0.52, 0.52, 0.2, 10)) {
    color = rgb(196, 176, 142);
  }
  if (isRoundedRect(x, y, width, height, 0.44, 0.58, 0.12, 0.22, 6)) {
    color = rgb(94, 62, 42);
  }
  if (
    isRoundedRect(x, y, width, height, 0.18, 0.38, 0.06, 0.34, 4) ||
    isRoundedRect(x, y, width, height, 0.76, 0.38, 0.06, 0.34, 4)
  ) {
    color = rgb(104, 72, 48);
  }
  if (
    isRoundedRect(x, y, width, height, 0.18, 0.36, 0.08, 0.12, 4) ||
    isRoundedRect(x, y, width, height, 0.74, 0.36, 0.08, 0.12, 4)
  ) {
    color = rgb(222, 88, 74);
  }
  if (isTriangle(x, y, [width * 0.48, height * 0.3], [width * 0.56, height * 0.42], [width * 0.4, height * 0.42])) {
    color = rgb(248, 240, 220);
  }
  if (isRoundedRect(x, y, width, height, 0.26, 0.72, 0.48, 0.06, 3)) {
    color = rgb(120, 86, 58);
  }
  return color;
}

function drawAttributeShrineIcon(x, y, width, height) {
  let color = drawBuildingBackdrop(x, y, width, height, {
    backdrop: rgb(54, 54, 92),
    inner: rgb(92, 88, 146),
    frame: rgb(222, 214, 248),
    accent: rgb(244, 238, 255)
  });
  if (color[3] === 0) {
    return color;
  }

  if (
    isRoundedRect(x, y, width, height, 0.26, 0.62, 0.48, 0.1, 6) ||
    isRoundedRect(x, y, width, height, 0.32, 0.52, 0.36, 0.08, 6)
  ) {
    color = rgb(174, 168, 210);
  }
  if (isTriangle(x, y, [width * 0.5, height * 0.22], [width * 0.36, height * 0.5], [width * 0.64, height * 0.5])) {
    color = rgb(178, 228, 255);
  }
  if (isTriangle(x, y, [width * 0.5, height * 0.16], [width * 0.44, height * 0.28], [width * 0.56, height * 0.28])) {
    color = rgb(255, 252, 255);
  }
  if (isRoundedRect(x, y, width, height, 0.46, 0.46, 0.08, 0.16, 3)) {
    color = rgb(236, 220, 164);
  }
  if (isRoundedRect(x, y, width, height, 0.22, 0.72, 0.56, 0.06, 3)) {
    color = rgb(118, 100, 166);
  }
  if (isCircle(x, y, width * 0.38, height * 0.38, width * 0.04) || isCircle(x, y, width * 0.62, height * 0.38, width * 0.04)) {
    color = rgb(248, 238, 178);
  }
  return color;
}

function drawResourceMineIcon(x, y, width, height) {
  let color = drawBuildingBackdrop(x, y, width, height, {
    backdrop: rgb(66, 56, 54),
    inner: rgb(110, 94, 88),
    frame: rgb(212, 190, 150),
    accent: rgb(240, 226, 194)
  });
  if (color[3] === 0) {
    return color;
  }

  if (isTriangle(x, y, [width * 0.14, height * 0.68], [width * 0.36, height * 0.24], [width * 0.58, height * 0.68])) {
    color = rgb(126, 116, 124);
  }
  if (isTriangle(x, y, [width * 0.42, height * 0.68], [width * 0.68, height * 0.18], [width * 0.9, height * 0.68])) {
    color = rgb(96, 92, 108);
  }
  if (isRoundedRect(x, y, width, height, 0.34, 0.44, 0.32, 0.24, 10)) {
    color = rgb(28, 28, 36);
  }
  if (
    isRoundedRect(x, y, width, height, 0.28, 0.42, 0.06, 0.3, 4) ||
    isRoundedRect(x, y, width, height, 0.66, 0.42, 0.06, 0.3, 4)
  ) {
    color = rgb(140, 104, 70);
  }
  if (isRoundedRect(x, y, width, height, 0.3, 0.4, 0.4, 0.04, 3)) {
    color = rgb(164, 120, 82);
  }
  if (isTriangle(x, y, [width * 0.72, height * 0.52], [width * 0.8, height * 0.38], [width * 0.86, height * 0.56])) {
    color = rgb(134, 214, 232);
  }
  if (isTriangle(x, y, [width * 0.18, height * 0.54], [width * 0.24, height * 0.4], [width * 0.3, height * 0.58])) {
    color = rgb(238, 188, 92);
  }
  if (isRoundedRect(x, y, width, height, 0.2, 0.72, 0.6, 0.06, 3)) {
    color = rgb(126, 88, 60);
  }
  return color;
}

function drawForgeHallIcon(x, y, width, height) {
  let color = rgb(0, 0, 0, 0);
  if (isRoundedRect(x, y, width, height, 0.08, 0.12, 0.84, 0.76, 10)) {
    color = rgb(58, 68, 84);
  }
  if (isTriangle(x, y, [width * 0.18, height * 0.42], [width * 0.5, height * 0.14], [width * 0.82, height * 0.42])) {
    color = rgb(144, 88, 66);
  }
  if (isRoundedRect(x, y, width, height, 0.24, 0.44, 0.52, 0.3, 8)) {
    color = rgb(116, 128, 142);
  }
  if (isRoundedRect(x, y, width, height, 0.44, 0.5, 0.12, 0.24, 4)) {
    color = rgb(44, 52, 66);
  }
  if (isRoundedRect(x, y, width, height, 0.22, 0.32, 0.16, 0.18, 4) || isRoundedRect(x, y, width, height, 0.62, 0.32, 0.16, 0.18, 4)) {
    color = rgb(238, 198, 126);
  }
  if (isRoundedRect(x, y, width, height, 0.34, 0.24, 0.32, 0.06, 3)) {
    color = rgb(246, 224, 184);
  }
  if (isTriangle(x, y, [width * 0.5, height * 0.56], [width * 0.62, height * 0.74], [width * 0.38, height * 0.74])) {
    color = rgb(232, 134, 84);
  }
  if (isRoundedRect(x, y, width, height, 0.48, 0.48, 0.04, 0.2, 2)) {
    color = rgb(255, 240, 214);
  }
  return color;
}
