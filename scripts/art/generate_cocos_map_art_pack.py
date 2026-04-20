from __future__ import annotations

import hashlib
import math
import random
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
COCOS_ROOT = ROOT / "apps" / "cocos-client" / "assets" / "resources"
TERRAIN_ROOT = COCOS_ROOT / "pixel" / "terrain"
FOG_ROOT = COCOS_ROOT / "placeholder" / "fog"
BUILDING_ROOT = COCOS_ROOT / "pixel" / "buildings"
RESOURCE_ROOT = COCOS_ROOT / "pixel" / "resources"


def stable_rng(*parts: str) -> random.Random:
    digest = hashlib.sha256("::".join(parts).encode("utf-8")).digest()
    seed = int.from_bytes(digest[:8], "big")
    return random.Random(seed)


def clamp(v: float, lo: int = 0, hi: int = 255) -> int:
    return max(lo, min(hi, int(round(v))))


def mix(a: tuple[int, int, int], b: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return (
        clamp(a[0] + (b[0] - a[0]) * t),
        clamp(a[1] + (b[1] - a[1]) * t),
        clamp(a[2] + (b[2] - a[2]) * t),
    )


def rgba(rgb: tuple[int, int, int], alpha: int = 255) -> tuple[int, int, int, int]:
    return rgb[0], rgb[1], rgb[2], alpha


def scale_canvas(img: Image.Image, size: int) -> Image.Image:
    return img.resize((size, size), Image.Resampling.NEAREST)


def save_scaled(base: Image.Image, path: Path, size: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    scale_canvas(base, size).save(path)


TERRAIN_PALETTES = {
    "grass": {
        "base": (93, 112, 86),
        "alt": (112, 128, 98),
        "shadow": (48, 57, 52),
        "accent": (129, 145, 109),
        "crack": (59, 69, 61),
    },
    "dirt": {
        "base": (115, 92, 77),
        "alt": (128, 104, 87),
        "shadow": (66, 50, 42),
        "accent": (148, 124, 104),
        "crack": (82, 64, 52),
    },
    "sand": {
        "base": (133, 123, 104),
        "alt": (148, 139, 118),
        "shadow": (82, 74, 60),
        "accent": (164, 156, 134),
        "crack": (94, 86, 68),
    },
    "water": {
        "base": (53, 79, 104),
        "alt": (71, 97, 126),
        "shadow": (23, 39, 55),
        "accent": (112, 134, 158),
        "crack": (86, 111, 137),
    },
    "hidden": {
        "base": (37, 45, 56),
        "alt": (49, 58, 70),
        "shadow": (13, 17, 24),
        "accent": (80, 91, 108),
        "crack": (26, 31, 39),
    },
}


@dataclass(frozen=True)
class TileSpec:
    filename: str
    palette_key: str
    ridge_bias: float = 0.0
    alt: bool = False
    deep: bool = False


TERRAIN_SPECS = [
    TileSpec("grass-tile.png", "grass", ridge_bias=-0.08, alt=False),
    TileSpec("grass-tile-alt.png", "grass", ridge_bias=0.08, alt=True),
    TileSpec("dirt-tile.png", "dirt", ridge_bias=0.03, alt=False),
    TileSpec("dirt-tile-alt.png", "dirt", ridge_bias=-0.05, alt=True),
    TileSpec("sand-tile.png", "sand", ridge_bias=0.03, alt=False),
    TileSpec("sand-tile-alt.png", "sand", ridge_bias=-0.02, alt=True),
    TileSpec("water-tile.png", "water", ridge_bias=-0.08, alt=False),
    TileSpec("water-tile-alt.png", "water", ridge_bias=0.08, alt=True),
    TileSpec("hidden-tile.png", "hidden", ridge_bias=0.0, alt=False),
    TileSpec("hidden-tile-alt.png", "hidden", ridge_bias=0.12, alt=True),
    TileSpec("hidden-tile-deep.png", "hidden", ridge_bias=-0.12, alt=False, deep=True),
]


def terrain_value(kind: str, x: int, y: int, spec: TileSpec, rng: random.Random) -> tuple[int, int, int]:
    palette = TERRAIN_PALETTES[kind]
    diagonal = (x * 0.32 + y * 0.21 + spec.ridge_bias * 12.0)
    cross = math.sin(diagonal) * 0.35 + math.cos((x - y) * 0.28) * 0.15
    broad = math.sin((x + 5) * 0.13) * 0.12 + math.cos((y + 11) * 0.17) * 0.12
    grain = ((x * 31 + y * 17) % 9) / 8.0 - 0.5
    t = max(0.0, min(1.0, 0.5 + cross * 0.45 + broad * 0.25 + grain * 0.08))
    color = mix(palette["base"], palette["alt"], t)
    if kind == "water":
        ripple = (math.sin((x + y) * 0.42 + (0.9 if spec.alt else 0.0)) + 1.0) * 0.5
        color = mix(color, palette["accent"], ripple * 0.28)
    else:
        ridge = max(0.0, math.sin((x - y) * 0.45 + (0.6 if spec.alt else 0.0)))
        color = mix(color, palette["accent"], ridge * 0.12)
    if spec.deep:
        color = mix(color, palette["shadow"], 0.28)
    return color


def paint_terrain(spec: TileSpec) -> Image.Image:
    rng = stable_rng("terrain", spec.filename)
    img = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    px = img.load()
    palette = TERRAIN_PALETTES[spec.palette_key]

    for y in range(24):
        for x in range(24):
            color = terrain_value(spec.palette_key, x, y, spec, rng)
            if spec.palette_key != "water":
                if (x * 7 + y * 11 + (5 if spec.alt else 0)) % 13 == 0:
                    color = mix(color, palette["shadow"], 0.18)
                if (x * 13 + y * 3 + (7 if spec.deep else 0)) % 17 == 0:
                    color = mix(color, palette["accent"], 0.12)
            px[x, y] = rgba(color)

    draw = ImageDraw.Draw(img)
    if spec.palette_key == "grass":
        for _ in range(34 if spec.alt else 28):
            sx = rng.randrange(24)
            sy = rng.randrange(24)
            length = 1 + rng.randrange(3)
            for i in range(length):
                x = min(23, sx + (i // 2))
                y = max(0, sy - i)
                px[x, y] = rgba(mix(palette["accent"], (168, 179, 136), 0.35))
        for _ in range(10):
            x = rng.randrange(24)
            y = rng.randrange(24)
            draw.point((x, y), fill=rgba(palette["shadow"]))
    elif spec.palette_key in {"dirt", "sand"}:
        for offset in range(-6, 24, 6):
            shade = palette["crack"] if (offset // 6) % 2 == 0 else mix(palette["shadow"], palette["crack"], 0.6)
            draw.line((offset, 0, offset + 10, 23), fill=rgba(shade, 150 if spec.palette_key == "sand" else 180), width=1)
        for _ in range(16):
            x = rng.randrange(24)
            y = rng.randrange(24)
            r = 0 if spec.palette_key == "sand" else 1
            color = mix(palette["shadow"], palette["accent"], rng.random() * 0.35)
            draw.ellipse((x - r, y - r, x + r, y + r), fill=rgba(color, 220))
    elif spec.palette_key == "water":
        for offset in range(-8, 24, 5):
            draw.line((offset, 23, offset + 10, 0), fill=rgba(mix(palette["accent"], (184, 203, 219), 0.45), 160), width=1)
        for _ in range(7):
            x = rng.randrange(3, 21)
            y = rng.randrange(3, 21)
            r = rng.randrange(1, 3)
            draw.arc((x - r, y - r, x + r, y + r), 180, 360, fill=rgba((188, 203, 214), 170), width=1)
    elif spec.palette_key == "hidden":
        for _ in range(22):
            x = rng.randrange(24)
            y = rng.randrange(24)
            r = rng.randrange(1, 4 if spec.deep else 3)
            alpha = 65 if spec.deep else 48
            draw.ellipse((x - r, y - r, x + r, y + r), fill=rgba(mix(palette["accent"], (138, 151, 166), 0.35), alpha))
        for offset in range(-12, 24, 6):
            draw.line((offset, 0, offset + 16, 23), fill=rgba(mix(palette["shadow"], palette["base"], 0.3), 140), width=1)

    border = mix(palette["shadow"], (11, 14, 20), 0.55)
    draw.rectangle((0, 0, 23, 23), outline=rgba(border))
    return img


def build_fog_background(mode: str, size: int = 84) -> Image.Image:
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = base.load()
    rng = stable_rng("fog", mode)
    top = (47, 56, 70) if mode == "explored" else (18, 21, 28)
    bottom = (30, 38, 48) if mode == "explored" else (9, 12, 17)
    accent = (89, 101, 118) if mode == "explored" else (39, 45, 57)
    for y in range(size):
        t = y / (size - 1)
        row = mix(top, bottom, t * 0.9)
        for x in range(size):
            wave = math.sin((x + y) * 0.085) * 0.06 + math.cos((x - y) * 0.09) * 0.05
            speck = (((x * 19 + y * 13) % 11) / 10.0 - 0.5) * 0.06
            color = mix(row, accent, max(0.0, min(1.0, 0.24 + wave + speck)))
            alpha = 208 if mode == "explored" else 244
            px[x, y] = rgba(color, alpha)
    draw = ImageDraw.Draw(base)
    for offset in range(-size, size, 18):
        alpha = 38 if mode == "explored" else 24
        draw.line((offset, size, offset + size * 0.72, 0), fill=rgba((146, 160, 175), alpha), width=2)
    for _ in range(18 if mode == "explored" else 24):
        x = rng.randrange(size)
        y = rng.randrange(size)
        r = rng.randrange(4, 10)
        fill = rgba((153, 164, 179) if mode == "explored" else (72, 81, 92), 18 if mode == "explored" else 14)
        draw.ellipse((x - r, y - r, x + r, y + r), fill=fill)
    return base


def paint_fog_variant(src_path: Path) -> Image.Image:
    mode = "hidden" if src_path.stem.startswith("hidden-") else "explored"
    mask_src = Image.open(src_path).convert("RGBA")
    alpha = mask_src.getchannel("A")
    mask = alpha.filter(ImageFilter.GaussianBlur(radius=1.2))
    base = build_fog_background(mode, size=mask_src.width)
    tinted = Image.new("RGBA", mask_src.size, (0, 0, 0, 0))
    tinted.alpha_composite(base)
    result = Image.new("RGBA", mask_src.size, (0, 0, 0, 0))
    result.paste(tinted, mask=mask)

    rim = Image.new("RGBA", mask_src.size, (0, 0, 0, 0))
    rim_draw = ImageDraw.Draw(rim)
    rim_color = (120, 136, 156, 95) if mode == "explored" else (66, 74, 87, 88)
    edge = alpha.filter(ImageFilter.FIND_EDGES).filter(ImageFilter.GaussianBlur(radius=0.8))
    rim_draw.bitmap((0, 0), edge, fill=rim_color)
    result.alpha_composite(rim)
    return result


def outlined_polygon(draw: ImageDraw.ImageDraw, points: list[tuple[int, int]], fill: tuple[int, int, int], outline: tuple[int, int, int]) -> None:
    draw.polygon(points, fill=rgba(fill), outline=rgba(outline))


def make_building_canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    return img, draw


BUILDING_OUTLINE = (41, 31, 33)
BUILDING_SHADOW = (28, 21, 23)
STONE_LIGHT = (152, 146, 138)
STONE_DARK = (88, 80, 73)
WOOD_LIGHT = (142, 102, 72)
WOOD_DARK = (84, 58, 41)
ROOF_LIGHT = (126, 72, 64)
ROOF_DARK = (70, 41, 39)
MOSS = (98, 118, 95)
GOLD = (204, 165, 88)
GLINT = (237, 224, 164)
ICE = (130, 157, 170)


def draw_ground(draw: ImageDraw.ImageDraw, tint: tuple[int, int, int]) -> None:
    draw.rectangle((8, 46, 55, 54), fill=rgba(tint), outline=rgba(BUILDING_OUTLINE))
    for x in range(10, 53, 6):
        draw.line((x, 47, x + 3, 53), fill=rgba(mix(tint, BUILDING_SHADOW, 0.35)))


def paint_recruitment_post() -> Image.Image:
    img, draw = make_building_canvas()
    draw_ground(draw, (89, 85, 80))
    outlined_polygon(draw, [(16, 24), (48, 24), (53, 28), (11, 28)], (132, 123, 111), BUILDING_OUTLINE)
    draw.rectangle((18, 28, 46, 46), fill=rgba(STONE_LIGHT), outline=rgba(BUILDING_OUTLINE))
    draw.rectangle((21, 31, 43, 46), fill=rgba((167, 156, 144)), outline=rgba(STONE_DARK))
    outlined_polygon(draw, [(15, 24), (32, 11), (49, 24)], ROOF_LIGHT, BUILDING_OUTLINE)
    outlined_polygon(draw, [(20, 24), (32, 16), (44, 24)], ROOF_DARK, BUILDING_OUTLINE)
    draw.rectangle((28, 33, 36, 46), fill=rgba(WOOD_DARK), outline=rgba(BUILDING_OUTLINE))
    draw.rectangle((19, 33, 24, 39), fill=rgba(GOLD), outline=rgba(BUILDING_OUTLINE))
    draw.rectangle((40, 33, 45, 39), fill=rgba(GOLD), outline=rgba(BUILDING_OUTLINE))
    draw.rectangle((30, 18, 34, 22), fill=rgba(GLINT), outline=rgba(BUILDING_OUTLINE))
    draw.line((11, 28, 8, 39), fill=rgba((98, 46, 42)), width=2)
    draw.line((53, 28, 56, 39), fill=rgba((98, 46, 42)), width=2)
    return img


def paint_attribute_shrine() -> Image.Image:
    img, draw = make_building_canvas()
    draw_ground(draw, (77, 80, 92))
    outlined_polygon(draw, [(20, 42), (44, 42), (48, 46), (16, 46)], STONE_DARK, BUILDING_OUTLINE)
    outlined_polygon(draw, [(23, 36), (41, 36), (44, 40), (20, 40)], (106, 107, 118), BUILDING_OUTLINE)
    outlined_polygon(draw, [(26, 30), (38, 30), (41, 34), (23, 34)], (123, 124, 136), BUILDING_OUTLINE)
    outlined_polygon(draw, [(29, 24), (35, 24), (38, 28), (26, 28)], (138, 141, 152), BUILDING_OUTLINE)
    draw.rectangle((31, 15, 33, 24), fill=rgba(GLINT), outline=rgba(BUILDING_OUTLINE))
    draw.ellipse((28, 10, 36, 18), fill=rgba(GOLD), outline=rgba(BUILDING_OUTLINE))
    draw.line((18, 42, 10, 18), fill=rgba((103, 112, 132)), width=2)
    draw.line((46, 42, 54, 18), fill=rgba((103, 112, 132)), width=2)
    draw.polygon([(10, 18), (14, 11), (18, 18)], fill=rgba((161, 173, 198)), outline=rgba(BUILDING_OUTLINE))
    draw.polygon([(54, 18), (50, 11), (46, 18)], fill=rgba((161, 173, 198)), outline=rgba(BUILDING_OUTLINE))
    return img


def paint_resource_mine() -> Image.Image:
    img, draw = make_building_canvas()
    draw_ground(draw, (82, 73, 69))
    outlined_polygon(draw, [(16, 24), (48, 24), (53, 30), (11, 30)], (114, 101, 96), BUILDING_OUTLINE)
    outlined_polygon(draw, [(15, 24), (32, 10), (49, 24)], (104, 87, 81), BUILDING_OUTLINE)
    draw.rectangle((17, 30, 47, 45), fill=rgba((97, 89, 84)), outline=rgba(BUILDING_OUTLINE))
    draw.rectangle((22, 33, 42, 45), fill=rgba((34, 32, 36)), outline=rgba((18, 17, 19)))
    draw.line((18, 30, 24, 18), fill=rgba(WOOD_LIGHT), width=2)
    draw.line((46, 30, 40, 18), fill=rgba(WOOD_LIGHT), width=2)
    draw.polygon([(10, 37), (14, 29), (18, 37)], fill=rgba(GOLD), outline=rgba(BUILDING_OUTLINE))
    draw.polygon([(54, 37), (50, 29), (46, 37)], fill=rgba(ICE), outline=rgba(BUILDING_OUTLINE))
    draw.line((20, 24, 11, 15), fill=rgba((87, 69, 65)), width=2)
    draw.line((44, 24, 53, 15), fill=rgba((87, 69, 65)), width=2)
    return img


def paint_watchtower() -> Image.Image:
    img, draw = make_building_canvas()
    draw_ground(draw, (86, 88, 82))
    draw.rectangle((28, 18, 36, 46), fill=rgba((133, 124, 110)), outline=rgba(BUILDING_OUTLINE))
    draw.rectangle((30, 20, 34, 44), fill=rgba((162, 150, 134)), outline=rgba(STONE_DARK))
    draw.rectangle((22, 14, 42, 20), fill=rgba((93, 84, 76)), outline=rgba(BUILDING_OUTLINE))
    outlined_polygon(draw, [(20, 14), (32, 7), (44, 14)], (116, 75, 70), BUILDING_OUTLINE)
    for y in (24, 30, 36):
        draw.line((28, y, 36, y), fill=rgba(STONE_DARK))
    draw.line((22, 20, 16, 33), fill=rgba(WOOD_DARK), width=2)
    draw.line((42, 20, 48, 33), fill=rgba(WOOD_DARK), width=2)
    draw.polygon([(42, 8), (52, 12), (42, 16)], fill=rgba((136, 43, 45)), outline=rgba(BUILDING_OUTLINE))
    draw.line((42, 8, 42, 20), fill=rgba(BUILDING_OUTLINE), width=1)
    return img


def paint_buildings() -> dict[str, Image.Image]:
    return {
        "recruitment-post.png": paint_recruitment_post(),
        "attribute-shrine.png": paint_attribute_shrine(),
        "resource-mine.png": paint_resource_mine(),
        "forge-hall.png": paint_watchtower(),
    }


def make_resource_canvas() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    return img, draw


def paint_gold() -> Image.Image:
    img, draw = make_resource_canvas()
    draw.ellipse((2, 3, 21, 20), fill=rgba((77, 64, 41)), outline=rgba(BUILDING_OUTLINE))
    for x, y, r in [(8, 13, 4), (11, 10, 5), (15, 13, 3)]:
        draw.ellipse((x - r, y - r, x + r, y + r), fill=rgba(GOLD), outline=rgba((126, 94, 34)))
        draw.ellipse((x - r + 2, y - r + 1, x - r + 4, y - r + 3), fill=rgba(GLINT))
    return img


def paint_wood() -> Image.Image:
    img, draw = make_resource_canvas()
    draw.ellipse((2, 4, 21, 20), fill=rgba((74, 57, 47)), outline=rgba(BUILDING_OUTLINE))
    for y in (9, 13):
        draw.rounded_rectangle((6, y, 18, y + 4), radius=2, fill=rgba((149, 112, 78)), outline=rgba(WOOD_DARK))
        draw.ellipse((4, y, 8, y + 4), fill=rgba((197, 164, 126)), outline=rgba(WOOD_DARK))
        draw.arc((4, y, 8, y + 4), 0, 300, fill=rgba((103, 80, 51)))
    return img


def paint_ore() -> Image.Image:
    img, draw = make_resource_canvas()
    draw.ellipse((2, 3, 21, 20), fill=rgba((60, 67, 79)), outline=rgba(BUILDING_OUTLINE))
    crystals = [
        [(7, 15), (10, 8), (13, 15)],
        [(11, 14), (14, 7), (17, 14)],
        [(4, 13), (7, 8), (10, 13)],
    ]
    for poly in crystals:
        outlined_polygon(draw, poly, (182, 193, 207), (106, 121, 140))
        x0 = min(p[0] for p in poly)
        y0 = min(p[1] for p in poly)
        x1 = max(p[0] for p in poly)
        y1 = max(p[1] for p in poly)
        draw.line((x0 + 1, y1 - 1, x1 - 1, y0 + 1), fill=rgba((222, 228, 235)))
    return img


def paint_resources() -> dict[str, Image.Image]:
    return {
        "gold-pile.png": paint_gold(),
        "wood-stack.png": paint_wood(),
        "ore-crate.png": paint_ore(),
    }


def generate() -> None:
    for spec in TERRAIN_SPECS:
        save_scaled(paint_terrain(spec), TERRAIN_ROOT / spec.filename, 72)

    save_scaled(paint_terrain(TileSpec("fog-tile.png", "hidden", ridge_bias=0.2, alt=True)), TERRAIN_ROOT / "fog-tile.png", 72)

    for src in sorted(FOG_ROOT.glob("*.png")):
        paint_fog_variant(src).save(src)

    for name, img in paint_buildings().items():
        save_scaled(img, BUILDING_ROOT / name, 256)

    for name, img in paint_resources().items():
        save_scaled(img, RESOURCE_ROOT / name, 48)


if __name__ == "__main__":
    generate()
