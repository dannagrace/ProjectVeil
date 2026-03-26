import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicAssets = path.join(root, "apps/client/public/assets");
const cocosIcons = path.join(root, "apps/cocos-client/assets/resources/placeholder/icons");
const cocosTiles = path.join(root, "apps/cocos-client/assets/resources/placeholder/tiles");

writeTerrain("grass-tile.svg", "grass-1.png", {
  shell: "#1f2619",
  trim: "#5d8a4f",
  accent: "#dff2b7"
});
writeTerrain("grass-tile-alt.svg", "grass-3.png", {
  shell: "#1d2318",
  trim: "#66925a",
  accent: "#d6edac"
});
writeTerrain("dirt-tile.svg", "dirt-1.png", {
  shell: "#2a1d16",
  trim: "#9a643d",
  accent: "#efc493"
});
writeTerrain("dirt-tile-alt.svg", "dirt-3.png", {
  shell: "#261811",
  trim: "#a16b45",
  accent: "#ebb887"
});
writeTerrain("sand-tile.svg", "sand-1.png", {
  shell: "#302516",
  trim: "#b28d4b",
  accent: "#f7dfad"
});
writeTerrain("sand-tile-alt.svg", "sand-2.png", {
  shell: "#2b2114",
  trim: "#c29a55",
  accent: "#f5d79a"
});
writeTerrain("water-tile.svg", "water-1.png", {
  shell: "#111d29",
  trim: "#4b88b3",
  accent: "#b5dbf3"
});
writeTerrain("water-tile-alt.svg", "water-2.png", {
  shell: "#101923",
  trim: "#5993bd",
  accent: "#9fcfea"
});
writeTerrain("fog-tile.svg", "hidden-1.png", {
  shell: "#15171d",
  trim: "#5f6b7d",
  accent: "#c2cad6"
});

writeDecoratedIcon(path.join(publicAssets, "resources/gold-pile.svg"), readPngDataUri("icons/gold.png"), {
  panel: "#23170e",
  trim: "#bc8c3f",
  accent: "#fde19a",
  title: "Gold Pile"
});
writeDecoratedIcon(path.join(publicAssets, "resources/wood-stack.svg"), readPngDataUri("icons/wood.png"), {
  panel: "#24160e",
  trim: "#9a6b45",
  accent: "#f1d0a9",
  title: "Wood Stack"
});
writeDecoratedIcon(path.join(publicAssets, "resources/ore-crate.svg"), readPngDataUri("icons/ore.png"), {
  panel: "#182028",
  trim: "#889eb5",
  accent: "#dfeaf8",
  title: "Ore Cache"
});

writeBuildingIcon("recruitment-post.svg", readPngDataUri("icons/recruitment.png"), {
  panel: "#261a2f",
  trim: "#b188dd",
  accent: "#f3dcff",
  banner: "#ff9d7d",
  title: "Recruitment Post"
});
writeBuildingIcon("attribute-shrine.svg", readPngDataUri("icons/shrine.png"), {
  panel: "#16263a",
  trim: "#73bde4",
  accent: "#e4f7ff",
  banner: "#fff2a4",
  title: "Attribute Shrine"
});
writeBuildingIcon("resource-mine.svg", readPngDataUri("icons/mine.png"), {
  panel: "#2a2119",
  trim: "#c1905c",
  accent: "#f4ddbe",
  banner: "#89dce7",
  title: "Resource Mine"
});

writeUnitPortrait("hero-guard-basic.svg", readPngDataUri("icons/hero.png"), {
  panel: "#15201f",
  trim: "#6db59d",
  accent: "#d4f6eb",
  banner: "#f0cd86",
  title: "Hero Guard"
});
writeUnitPortrait("hero-guard-basic-selected.svg", readPngDataUri("icons/hero.png"), {
  panel: "#112226",
  trim: "#68d2c1",
  accent: "#d5fff9",
  banner: "#9ef1ff",
  title: "Hero Guard Selected",
  overlay: "selected"
});
writeUnitPortrait("hero-guard-basic-hit.svg", readPngDataUri("icons/hero.png"), {
  panel: "#271716",
  trim: "#d27c6f",
  accent: "#ffd6d0",
  banner: "#ffb08f",
  title: "Hero Guard Hit",
  overlay: "hit"
});
writeUnitPortrait("wolf-pack.svg", readPngDataUri("icons/battle.png"), {
  panel: "#241416",
  trim: "#c97867",
  accent: "#ffd7cd",
  banner: "#f0c99f",
  title: "Wolf Pack",
  beast: true
});
writeUnitPortrait("wolf-pack-selected.svg", readPngDataUri("icons/battle.png"), {
  panel: "#1f1523",
  trim: "#d978c5",
  accent: "#ffe0fb",
  banner: "#ffb0b8",
  title: "Wolf Pack Selected",
  overlay: "selected",
  beast: true
});
writeUnitPortrait("wolf-pack-hit.svg", readPngDataUri("icons/battle.png"), {
  panel: "#291113",
  trim: "#ec7d6d",
  accent: "#ffe0d8",
  banner: "#ffca7e",
  title: "Wolf Pack Hit",
  overlay: "hit",
  beast: true
});

writeMarker("hero-marker.svg", readPngDataUri("icons/hero.png"), {
  trim: "#68b29a",
  accent: "#d9fff2",
  title: "Hero Marker"
});
writeMarker("hero-marker-selected.svg", readPngDataUri("icons/hero.png"), {
  trim: "#61d8d0",
  accent: "#e0ffff",
  title: "Hero Marker Selected",
  overlay: "selected"
});
writeMarker("hero-marker-hit.svg", readPngDataUri("icons/hero.png"), {
  trim: "#de7f73",
  accent: "#ffe1db",
  title: "Hero Marker Hit",
  overlay: "hit"
});
writeMarker("neutral-marker.svg", readPngDataUri("icons/neutral.png"), {
  trim: "#d48d62",
  accent: "#ffe7db",
  title: "Neutral Marker"
});
writeMarker("neutral-marker-selected.svg", readPngDataUri("icons/neutral.png"), {
  trim: "#d4b462",
  accent: "#fff2cc",
  title: "Neutral Marker Selected",
  overlay: "selected"
});
writeMarker("neutral-marker-hit.svg", readPngDataUri("icons/neutral.png"), {
  trim: "#e36e6e",
  accent: "#ffdede",
  title: "Neutral Marker Hit",
  overlay: "hit"
});

writeFrame("unit-frame-ally.svg", {
  shell: "#173329",
  trim: "#61a792",
  accent: "#d6fff4",
  title: "Ally Frame"
});
writeFrame("unit-frame-enemy.svg", {
  shell: "#3a1919",
  trim: "#cf7866",
  accent: "#ffe2da",
  title: "Enemy Frame"
});

writeBadge("faction-crown.svg", {
  shell: "#1c2b35",
  trim: "#6fc0dc",
  accent: "#f4f8ff",
  glyph: crownGlyph(),
  title: "Crown Faction"
});
writeBadge("faction-wild.svg", {
  shell: "#2d2018",
  trim: "#d58b5f",
  accent: "#fff1e2",
  glyph: wildGlyph(),
  title: "Wild Faction"
});
writeBadge("rarity-common.svg", {
  shell: "#20242e",
  trim: "#8da0ba",
  accent: "#eff4ff",
  glyph: commonGlyph(),
  title: "Common Rarity"
});
writeBadge("rarity-elite.svg", {
  shell: "#2e2417",
  trim: "#ddb55d",
  accent: "#fff0bd",
  glyph: eliteGlyph(),
  title: "Elite Rarity"
});
writeBadge("interaction-move.svg", {
  shell: "#1b2834",
  trim: "#69b6d6",
  accent: "#def8ff",
  glyph: moveGlyph(),
  title: "Move Interaction"
});
writeBadge("interaction-pickup.svg", {
  shell: "#1f2716",
  trim: "#82bd65",
  accent: "#ebffd6",
  glyph: pickupGlyph(),
  title: "Pickup Interaction"
});
writeBadge("interaction-battle.svg", {
  shell: "#341a18",
  trim: "#d27964",
  accent: "#ffe0d8",
  glyph: battleGlyph(),
  title: "Battle Interaction"
});

function writeTerrain(fileName, tilePng, palette) {
  const href = readPngDataUri(`tiles/${tilePng}`);
  writeSvg(path.join(publicAssets, "terrain", fileName), "0 0 128 128", `
    <rect width="128" height="128" rx="26" fill="${palette.shell}"/>
    <rect x="8" y="8" width="112" height="112" rx="20" fill="#0c1117"/>
    <rect x="12" y="12" width="104" height="104" rx="18" fill="${palette.trim}"/>
    <rect x="16" y="16" width="96" height="96" rx="14" fill="#10161d"/>
    <image href="${href}" x="16" y="16" width="96" height="96" preserveAspectRatio="none" style="image-rendering: pixelated" />
    <rect x="16" y="16" width="96" height="10" fill="${palette.accent}" opacity="0.22"/>
    <rect x="20" y="100" width="88" height="6" fill="#0c1117" opacity="0.45"/>
    <rect x="24" y="24" width="8" height="8" fill="${palette.accent}" opacity="0.5"/>
    <rect x="96" y="24" width="8" height="8" fill="${palette.accent}" opacity="0.42"/>
    <rect x="24" y="96" width="8" height="8" fill="${palette.accent}" opacity="0.3"/>
    <rect x="96" y="96" width="8" height="8" fill="${palette.accent}" opacity="0.34"/>
  `);
}

function writeDecoratedIcon(filepath, href, palette) {
  writeSvg(filepath, "0 0 128 128", `
    <rect width="128" height="128" rx="26" fill="${palette.panel}"/>
    <rect x="10" y="10" width="108" height="108" rx="18" fill="#10161d"/>
    <rect x="14" y="14" width="100" height="100" rx="16" fill="${palette.trim}"/>
    <rect x="20" y="20" width="88" height="88" rx="14" fill="#10161d"/>
    <circle cx="64" cy="64" r="38" fill="${palette.accent}" opacity="0.22"/>
    <image href="${href}" x="28" y="28" width="72" height="72" preserveAspectRatio="none" style="image-rendering: pixelated" />
    <rect x="26" y="88" width="76" height="8" fill="#0a1016" opacity="0.48"/>
  `);
}

function writeBuildingIcon(fileName, href, palette) {
  writeSvg(path.join(publicAssets, "buildings", fileName), "0 0 128 128", `
    <rect width="128" height="128" rx="26" fill="${palette.panel}"/>
    <rect x="10" y="10" width="108" height="108" rx="18" fill="#0f141c"/>
    <rect x="14" y="14" width="100" height="100" rx="16" fill="${palette.trim}"/>
    <rect x="18" y="18" width="92" height="92" rx="14" fill="#121821"/>
    <rect x="24" y="24" width="80" height="16" rx="6" fill="${palette.banner}" opacity="0.95"/>
    <rect x="28" y="28" width="8" height="8" fill="#fff5d9" opacity="0.7"/>
    <image href="${href}" x="26" y="38" width="76" height="76" preserveAspectRatio="none" style="image-rendering: pixelated" />
  `);
}

function writeUnitPortrait(fileName, href, palette) {
  const overlay = palette.overlay ?? "";
  const beast = palette.beast
    ? `
      <path d="M34 44l10-10 10 16M94 44l-10-10-10 16" fill="none" stroke="${palette.accent}" stroke-width="8" stroke-linecap="square"/>
      <path d="M44 86l-6 10M64 90l0 10M84 86l6 10" fill="none" stroke="${palette.banner}" stroke-width="6" stroke-linecap="square"/>
    `
    : `
      <rect x="30" y="26" width="68" height="12" rx="4" fill="${palette.banner}" opacity="0.92"/>
      <rect x="34" y="30" width="14" height="4" fill="#fff2c9" opacity="0.84"/>
    `;

  writeSvg(path.join(publicAssets, "units", fileName), "0 0 128 128", `
    <rect width="128" height="128" rx="26" fill="${palette.panel}"/>
    <rect x="8" y="8" width="112" height="112" rx="18" fill="#111820"/>
    <rect x="12" y="12" width="104" height="104" rx="16" fill="${palette.trim}"/>
    <rect x="16" y="16" width="96" height="96" rx="14" fill="#141c25"/>
    <circle cx="64" cy="52" r="30" fill="${palette.accent}" opacity="0.18"/>
    <image href="${href}" x="24" y="24" width="80" height="80" preserveAspectRatio="none" style="image-rendering: pixelated" />
    ${beast}
    <rect x="24" y="98" width="80" height="10" rx="4" fill="${palette.banner}" opacity="0.9"/>
    ${overlay}
  `);
}

function writeMarker(fileName, href, palette) {
  const overlay = palette.overlay === "selected"
    ? `<circle cx="64" cy="44" r="32" fill="none" stroke="${palette.accent}" stroke-width="8" opacity="0.85"/>`
    : palette.overlay === "hit"
      ? `<path d="M34 22l60 44M94 22L34 66" stroke="${palette.trim}" stroke-width="8" stroke-linecap="square" opacity="0.9"/>`
      : "";
  writeSvg(path.join(publicAssets, "markers", fileName), "0 0 96 128", `
    <path d="M48 120L22 76a38 38 0 1 1 52 0L48 120z" fill="#11161d"/>
    <path d="M48 112L28 76a30 30 0 1 1 40 0L48 112z" fill="${palette.trim}"/>
    <circle cx="48" cy="44" r="26" fill="${palette.accent}" opacity="0.18"/>
    <image href="${href}" x="18" y="14" width="60" height="60" preserveAspectRatio="none" style="image-rendering: pixelated" />
    ${overlay}
  `);
}

function writeFrame(fileName, palette) {
  writeSvg(path.join(publicAssets, "frames", fileName), "0 0 128 96", `
    <rect x="2" y="2" width="124" height="92" rx="18" fill="#0b1015"/>
    <rect x="8" y="8" width="112" height="80" rx="14" fill="none" stroke="${palette.shell}" stroke-width="10"/>
    <rect x="12" y="12" width="104" height="72" rx="12" fill="none" stroke="${palette.trim}" stroke-width="4"/>
    <rect x="18" y="18" width="18" height="10" fill="${palette.accent}"/>
    <rect x="92" y="18" width="18" height="10" fill="${palette.accent}"/>
    <rect x="18" y="68" width="18" height="10" fill="${palette.accent}" opacity="0.86"/>
    <rect x="92" y="68" width="18" height="10" fill="${palette.accent}" opacity="0.86"/>
  `);
}

function writeBadge(fileName, palette) {
  writeSvg(path.join(publicAssets, "badges", fileName), "0 0 96 96", `
    <rect width="96" height="96" rx="24" fill="${palette.shell}"/>
    <rect x="8" y="8" width="80" height="80" rx="18" fill="${palette.trim}"/>
    <rect x="14" y="14" width="68" height="68" rx="14" fill="#121821"/>
    ${palette.glyph}
  `);
}

function crownGlyph() {
  return `
    <path d="M26 60h44v10H26z" fill="#fff4cf"/>
    <path d="M28 58l8-20 12 12 12-18 10 26z" fill="#ffe28c"/>
    <rect x="34" y="66" width="28" height="6" fill="#e4b95a"/>
  `;
}

function wildGlyph() {
  return `
    <path d="M30 64l10-26 10 18 8-18 8 26z" fill="#ffd2a6"/>
    <rect x="36" y="66" width="24" height="6" fill="#f0a971"/>
    <rect x="44" y="30" width="8" height="18" fill="#fff4df"/>
  `;
}

function commonGlyph() {
  return `
    <rect x="32" y="30" width="32" height="32" rx="8" fill="#edf4ff"/>
    <rect x="40" y="38" width="16" height="16" rx="4" fill="#a9b8cf"/>
  `;
}

function eliteGlyph() {
  return `
    <path d="M48 24l10 18 20 4-14 14 4 18-20-10-20 10 4-18-14-14 20-4z" fill="#ffe28f"/>
    <circle cx="48" cy="50" r="8" fill="#fff5d0"/>
  `;
}

function moveGlyph() {
  return `
    <path d="M26 50h34" stroke="#e4fbff" stroke-width="8" stroke-linecap="square"/>
    <path d="M52 34l18 16-18 16" fill="none" stroke="#8fe4ef" stroke-width="8" stroke-linecap="square" stroke-linejoin="bevel"/>
  `;
}

function pickupGlyph() {
  return `
    <circle cx="40" cy="48" r="12" fill="#f7ffd4"/>
    <circle cx="58" cy="42" r="10" fill="#d5ff9b"/>
    <circle cx="56" cy="58" r="8" fill="#97d768"/>
  `;
}

function battleGlyph() {
  return `
    <path d="M34 68L48 28l8 8-10 32z" fill="#fff0da"/>
    <path d="M62 28l-14 40-8-8 10-32z" fill="#ffd8c7"/>
    <rect x="34" y="66" width="14" height="8" fill="#f2ae8e"/>
    <rect x="48" y="66" width="14" height="8" fill="#f2ae8e"/>
  `;
}

function readPngDataUri(relativePath) {
  const filePath = relativePath.startsWith("tiles/")
    ? path.join(cocosTiles, relativePath.replace("tiles/", ""))
    : path.join(cocosIcons, relativePath.replace("icons/", ""));
  const bytes = fs.readFileSync(filePath);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

function writeSvg(filepath, viewBox, inner) {
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  fs.writeFileSync(
    filepath,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" shape-rendering="crispEdges">${inner}</svg>\n`
  );
}
