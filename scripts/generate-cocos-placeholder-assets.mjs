import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();
const tilesDir = path.join(root, "apps/cocos-client/assets/resources/placeholder/tiles");
const iconsDir = path.join(root, "apps/cocos-client/assets/resources/placeholder/icons");
fs.mkdirSync(tilesDir, { recursive: true });
fs.mkdirSync(iconsDir, { recursive: true });

const TILE = 72;
const ICON = 48;

generateTileSeries("grass", 3, drawGrassVariant);
generateTileSeries("dirt", 3, drawDirtVariant);
generateTileSeries("sand", 2, drawSandVariant);
generateTileSeries("water", 2, drawWaterVariant);
generateTileSeries("unknown", 1, drawUnknownVariant);
generateTileSeries("hidden", 3, drawHiddenVariant);

generateIcon("wood", drawWoodIcon);
generateIcon("gold", drawGoldIcon);
generateIcon("ore", drawOreIcon);
generateIcon("neutral", drawNeutralIcon);
generateIcon("hero", drawHeroIcon);
generateIcon("hud", drawHudIcon);
generateIcon("battle", drawBattleIcon);
generateIcon("timeline", drawTimelineIcon);

function generateTileSeries(prefix, count, painter) {
  for (let index = 0; index < count; index += 1) {
    writePng(path.join(tilesDir, `${prefix}-${index + 1}.png`), TILE, TILE, (x, y, width, height) => painter(index, x, y, width, height));
  }
}

function generateIcon(name, painter) {
  writePng(path.join(iconsDir, `${name}.png`), ICON, ICON, painter);
}

function writePng(filepath, width, height, painter) {
  const png = createPng(width, height, painter);
  fs.writeFileSync(filepath, png);
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
  const ihdr = chunk("IHDR", Buffer.from([
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
  ]));
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

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function rgb(r, g, b, a = 255) {
  return [clamp(r), clamp(g), clamp(b), clamp(a)];
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function verticalGradient(y, height, top, bottom) {
  const t = y / Math.max(1, height - 1);
  return rgb(mix(top[0], bottom[0], t), mix(top[1], bottom[1], t), mix(top[2], bottom[2], t), 255);
}

function add(color, delta) {
  return rgb(color[0] + delta[0], color[1] + delta[1], color[2] + delta[2], color[3] ?? 255);
}

function withBorder(x, y, width, height, base, border) {
  if (x < 2 || y < 2 || x >= width - 2 || y >= height - 2) {
    return border;
  }
  return base;
}

function drawGrassVariant(variant, x, y, width, height) {
  let color = verticalGradient(y, height, [176, 212, 128], [102, 147, 88]);
  const wave = Math.sin((x * (0.18 + variant * 0.04)) + (y * (0.11 + variant * 0.02)));
  if (wave > 0.45) color = add(color, [14, 10, 5]);
  if (((x * (3 + variant) + y * (5 - variant)) % (23 + variant * 3)) < 2) color = rgb(86, 116, 69);
  if (variant === 0 && y > height * 0.64 && Math.abs(x - width * 0.45) < width * 0.24) color = rgb(95, 126, 78);
  if (variant === 1 && y > height * 0.58 && x > width * 0.18 && x < width * 0.74) color = rgb(108, 141, 86);
  if (variant === 2 && Math.abs(x - width * 0.3) + Math.abs(y - height * 0.62) < 18) color = rgb(119, 149, 91);
  return withBorder(x, y, width, height, color, rgb(67, 94, 58));
}

function drawDirtVariant(variant, x, y, width, height) {
  let color = verticalGradient(y, height, [212, 162, 114], [146, 102, 72]);
  const ridge = Math.sin((x * (0.16 + variant * 0.03)) + (y * 0.08));
  if (ridge > 0.48) color = add(color, [12, 6, 2]);
  if (((x + y * (2 + variant)) % (24 + variant * 4)) < 2) color = rgb(117, 79, 54);
  if (variant === 1 && y > height * 0.62) color = rgb(132, 92, 61);
  if (variant === 2 && x > width * 0.42 && y > height * 0.52) color = rgb(120, 84, 56);
  return withBorder(x, y, width, height, color, rgb(92, 62, 42));
}

function drawSandVariant(variant, x, y, width, height) {
  let color = verticalGradient(y, height, [236, 210, 148], [190, 162, 102]);
  const ripple = Math.sin((x * (0.28 + variant * 0.04)) + (y * (0.07 + variant * 0.01)));
  if (Math.abs(ripple) < 0.1) color = add(color, [-22, -18, -12]);
  if (variant === 1 && ((x + y) % 19) < 2) color = rgb(214, 184, 128);
  if (y > height * 0.72) color = rgb(171, 143, 89);
  return withBorder(x, y, width, height, color, rgb(146, 119, 72));
}

function drawWaterVariant(variant, x, y, width, height) {
  let color = verticalGradient(y, height, [130, 186, 230], [65, 106, 156]);
  const wave = Math.sin((x * (0.28 + variant * 0.05)) + (y * (0.14 + variant * 0.03)));
  if (wave > 0.5) color = add(color, [18, 22, 18]);
  if (Math.abs(wave) < 0.08) color = add(color, [-18, -10, -2]);
  if (variant === 1 && y < height * 0.38) color = add(color, [8, 12, 18]);
  return withBorder(x, y, width, height, color, rgb(50, 83, 123));
}

function drawUnknownVariant(_variant, x, y, width, height) {
  let color = verticalGradient(y, height, [124, 138, 154], [82, 92, 108]);
  if (((x + y) % 23) < 2) color = rgb(148, 164, 182);
  return withBorder(x, y, width, height, color, rgb(60, 68, 80));
}

function drawHiddenVariant(variant, x, y, width, height) {
  let color = verticalGradient(y, height, [54, 68, 88], [22, 31, 45]);
  const offsets = [
    [0.28, 0.32, 13, 0.62, 0.54, 16, 0.46, 0.66, 11],
    [0.24, 0.46, 14, 0.56, 0.36, 15, 0.72, 0.58, 10],
    [0.34, 0.28, 11, 0.54, 0.58, 17, 0.74, 0.4, 12]
  ][variant] ?? [0.28, 0.32, 13, 0.62, 0.54, 16, 0.46, 0.66, 11];
  const fog = Math.max(
    blob(x, y, width * offsets[0], height * offsets[1], offsets[2]),
    blob(x, y, width * offsets[3], height * offsets[4], offsets[5]),
    blob(x, y, width * offsets[6], height * offsets[7], offsets[8])
  );
  if (fog > 0.14) {
    const tint = Math.min(1, fog * 1.25);
    color = rgb(mix(color[0], 96, tint), mix(color[1], 110, tint), mix(color[2], 130, tint), 255);
  }
  if (((x * (2 + variant) + y * (3 + variant)) % 27) < 2) color = add(color, [6, 8, 10]);
  if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) {
    return rgb(color[0] - 6, color[1] - 7, color[2] - 8, 255);
  }
  return color;
}

function drawWoodIcon(x, y, width, height) {
  if (outsideCircle(x, y, width, height, 0.46)) return rgb(0, 0, 0, 0);
  let color = rgb(78, 54, 34);
  if (isRoundedRect(x, y, width, height, 0.18, 0.4, 0.64, 0.18, 4)) color = rgb(162, 116, 74);
  if (isRoundedRect(x, y, width, height, 0.14, 0.58, 0.72, 0.16, 4)) color = rgb(182, 132, 84);
  if (isCircle(x, y, width * 0.18, height * 0.49, width * 0.08)) color = rgb(232, 194, 146);
  if (isCircle(x, y, width * 0.22, height * 0.67, width * 0.07)) color = rgb(232, 194, 146);
  return color;
}

function drawGoldIcon(x, y, width, height) {
  if (outsideCircle(x, y, width, height, 0.46)) return rgb(0, 0, 0, 0);
  let color = rgb(115, 84, 22);
  if (isCircle(x, y, width * 0.5, height * 0.52, width * 0.18)) color = rgb(246, 207, 82);
  if (isCircle(x, y, width * 0.36, height * 0.62, width * 0.12)) color = rgb(236, 189, 62);
  if (isCircle(x, y, width * 0.62, height * 0.66, width * 0.1)) color = rgb(255, 228, 128);
  return color;
}

function drawOreIcon(x, y, width, height) {
  if (outsideCircle(x, y, width, height, 0.46)) return rgb(0, 0, 0, 0);
  let color = rgb(72, 82, 95);
  if (isCircle(x, y, width * 0.34, height * 0.58, width * 0.12)) color = rgb(184, 196, 212);
  if (isCircle(x, y, width * 0.54, height * 0.46, width * 0.14)) color = rgb(202, 214, 228);
  if (isCircle(x, y, width * 0.68, height * 0.66, width * 0.11)) color = rgb(164, 178, 194);
  return color;
}

function drawNeutralIcon(x, y, width, height) {
  if (outsideCircle(x, y, width, height, 0.46)) return rgb(0, 0, 0, 0);
  let color = rgb(94, 42, 42);
  if (isDiagonalBand(x, y, width, height, -0.72, 0.72, 4)) color = rgb(230, 206, 190);
  if (isDiagonalBand(x, y, width, height, 0.72, 0.72, 4)) color = rgb(230, 206, 190);
  if (isCircle(x, y, width * 0.5, height * 0.54, width * 0.08)) color = rgb(214, 84, 72);
  return color;
}

function drawHeroIcon(x, y, width, height) {
  if (outsideCircle(x, y, width, height, 0.46)) return rgb(0, 0, 0, 0);
  let color = rgb(52, 64, 86);
  if (isCircle(x, y, width * 0.5, height * 0.5, width * 0.34)) color = rgb(236, 206, 122);
  if (isCircle(x, y, width * 0.5, height * 0.5, width * 0.28)) color = rgb(67, 88, 118);
  if (isCircle(x, y, width * 0.5, height * 0.4, width * 0.1)) color = rgb(245, 225, 182);
  if (isRoundedRect(x, y, width, height, 0.34, 0.5, 0.32, 0.2, 5)) color = rgb(219, 164, 96);
  if (isRoundedRect(x, y, width, height, 0.28, 0.62, 0.44, 0.1, 4)) color = rgb(236, 206, 122);
  if (isRoundedRect(x, y, width, height, 0.38, 0.28, 0.24, 0.05, 3)) color = rgb(255, 242, 195);
  return color;
}

function drawHudIcon(x, y, width, height) {
  if (outsideCircle(x, y, width, height, 0.46)) return rgb(0, 0, 0, 0);
  let color = rgb(46, 58, 76);
  if (isCircle(x, y, width * 0.5, height * 0.5, width * 0.34)) color = rgb(213, 184, 112);
  if (isCircle(x, y, width * 0.5, height * 0.5, width * 0.28)) color = rgb(58, 74, 98);
  if (isRoundedRect(x, y, width, height, 0.3, 0.32, 0.42, 0.08, 3)) color = rgb(255, 245, 220);
  if (isRoundedRect(x, y, width, height, 0.3, 0.48, 0.34, 0.08, 3)) color = rgb(228, 214, 182);
  if (isRoundedRect(x, y, width, height, 0.3, 0.64, 0.28, 0.08, 3)) color = rgb(196, 208, 222);
  return color;
}

function drawBattleIcon(x, y, width, height) {
  if (outsideCircle(x, y, width, height, 0.46)) return rgb(0, 0, 0, 0);
  let color = rgb(72, 36, 32);
  if (isCircle(x, y, width * 0.5, height * 0.5, width * 0.34)) color = rgb(222, 124, 94);
  if (isCircle(x, y, width * 0.5, height * 0.5, width * 0.28)) color = rgb(88, 46, 44);
  if (isTriangle(x, y, [width * 0.32, height * 0.7], [width * 0.5, height * 0.26], [width * 0.44, height * 0.7])) color = rgb(255, 235, 214);
  if (isTriangle(x, y, [width * 0.56, height * 0.26], [width * 0.72, height * 0.7], [width * 0.5, height * 0.7])) color = rgb(255, 235, 214);
  return color;
}

function drawTimelineIcon(x, y, width, height) {
  if (outsideCircle(x, y, width, height, 0.46)) return rgb(0, 0, 0, 0);
  let color = rgb(38, 58, 82);
  if (isCircle(x, y, width * 0.5, height * 0.5, width * 0.34)) color = rgb(135, 186, 232);
  if (isCircle(x, y, width * 0.5, height * 0.5, width * 0.28)) color = rgb(55, 78, 104);
  if (isRoundedRect(x, y, width, height, 0.32, 0.38, 0.08, 0.08, 3)) color = rgb(244, 249, 255);
  if (isRoundedRect(x, y, width, height, 0.46, 0.38, 0.08, 0.08, 3)) color = rgb(244, 249, 255);
  if (isRoundedRect(x, y, width, height, 0.6, 0.38, 0.08, 0.08, 3)) color = rgb(244, 249, 255);
  if (isRoundedRect(x, y, width, height, 0.36, 0.56, 0.36, 0.06, 3)) color = rgb(222, 234, 247);
  if (isRoundedRect(x, y, width, height, 0.36, 0.68, 0.22, 0.06, 3)) color = rgb(198, 214, 230);
  return color;
}

function blob(x, y, cx, cy, radius) {
  const dx = x - cx;
  const dy = y - cy;
  const distance = Math.sqrt(dx * dx + dy * dy);
  return Math.max(0, 1 - distance / radius);
}

function outsideCircle(x, y, width, height, radiusScale) {
  const dx = x - width / 2;
  const dy = y - height / 2;
  return Math.sqrt(dx * dx + dy * dy) > Math.min(width, height) * radiusScale;
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

function isDiagonalBand(x, y, width, height, slope, interceptScale, thickness) {
  const targetY = slope * (x - width / 2) + height * interceptScale * 0.5;
  return Math.abs(y - targetY) <= thickness;
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
