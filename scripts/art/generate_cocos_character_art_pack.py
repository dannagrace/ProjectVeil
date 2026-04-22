from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps


ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = ROOT / "output" / "unit-art-upgrade" / "sources"
COCOS_ROOT = ROOT / "apps" / "cocos-client" / "assets" / "resources" / "pixel"
H5_ROOT = ROOT / "apps" / "client" / "public" / "assets" / "pixel"
HERO_ROOT = COCOS_ROOT / "heroes"
UNIT_ROOT = COCOS_ROOT / "units"
SHOWCASE_ROOT = COCOS_ROOT / "showcase-units"
MARKER_ROOT = COCOS_ROOT / "markers"
FRAME_ROOT = COCOS_ROOT / "frames"
H5_HERO_ROOT = H5_ROOT / "heroes"
H5_UNIT_ROOT = H5_ROOT / "units"
H5_SHOWCASE_ROOT = H5_ROOT / "showcase-units"
H5_MARKER_ROOT = H5_ROOT / "markers"
H5_FRAME_ROOT = H5_ROOT / "frames"


def load(name: str) -> Image.Image:
    return Image.open(SOURCE_ROOT / name).convert("RGBA")


def crop_square(img: Image.Image, zoom: float = 1.0, center: tuple[float, float] = (0.5, 0.5)) -> Image.Image:
    width, height = img.size
    side = min(width, height)
    crop_side = max(1, int(round(side / zoom)))
    cx = int(round(width * center[0]))
    cy = int(round(height * center[1]))
    left = max(0, min(width - crop_side, cx - crop_side // 2))
    top = max(0, min(height - crop_side, cy - crop_side // 2))
    return img.crop((left, top, left + crop_side, top + crop_side))


def fit_render(
    img: Image.Image,
    size: int,
    zoom: float = 1.0,
    center: tuple[float, float] = (0.5, 0.5),
    contrast: float = 1.08,
    sharpness: float = 1.22,
    color: float = 0.96,
) -> Image.Image:
    square = crop_square(img, zoom=zoom, center=center)
    square = ImageEnhance.Color(square).enhance(color)
    square = ImageEnhance.Contrast(square).enhance(contrast)
    square = ImageEnhance.Sharpness(square).enhance(sharpness)
    return square.resize((size, size), Image.Resampling.LANCZOS)


def save(img: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path)


def save_all(img: Image.Image, *paths: Path) -> None:
    for path in paths:
        save(img, path)


def hero_from_sheet(sheet: Image.Image, quadrant: tuple[int, int], zoom: float, center: tuple[float, float], filename: str) -> None:
    width, height = sheet.size
    half_w = width // 2
    half_h = height // 2
    left = quadrant[0] * half_w
    top = quadrant[1] * half_h
    tile = sheet.crop((left, top, left + half_w, top + half_h))
    portrait = fit_render(tile, 16, zoom=zoom, center=center, contrast=1.14, sharpness=1.35, color=0.94)
    save_all(portrait, HERO_ROOT / filename, H5_HERO_ROOT / filename)


def make_selected_variant(img: Image.Image) -> Image.Image:
    base = img.copy()
    glow = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    for inset, alpha in ((0, 94), (1, 62), (2, 40)):
        draw.rounded_rectangle(
            (inset, inset, base.width - 1 - inset, base.height - 1 - inset),
            radius=6,
            outline=(94, 182, 255, alpha),
            width=1,
        )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=0.8))
    tinted = Image.blend(base, Image.new("RGBA", base.size, (76, 120, 180, 255)), 0.08)
    tinted.alpha_composite(glow)
    return tinted


def make_hit_variant(img: Image.Image) -> Image.Image:
    base = img.copy()
    damaged = Image.blend(base, Image.new("RGBA", base.size, (110, 28, 32, 255)), 0.18)
    slash = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(slash)
    draw.line((4, 26, 28, 6), fill=(255, 116, 116, 120), width=3)
    draw.line((7, 28, 30, 10), fill=(255, 180, 180, 70), width=1)
    slash = slash.filter(ImageFilter.GaussianBlur(radius=0.6))
    damaged.alpha_composite(slash)
    return ImageEnhance.Contrast(damaged).enhance(1.06)


def render_unit_variants(source_name: str, target_stem: str, directory: Path, zoom: float = 1.18, center: tuple[float, float] = (0.5, 0.45)) -> None:
    src = load(source_name)
    idle = fit_render(src, 32, zoom=zoom, center=center, contrast=1.08, sharpness=1.28, color=0.95)
    mirror_root = {
        UNIT_ROOT: H5_UNIT_ROOT,
        SHOWCASE_ROOT: H5_SHOWCASE_ROOT,
    }.get(directory)
    idle_path = directory / f"{target_stem}.png"
    selected_path = directory / f"{target_stem}-selected.png"
    hit_path = directory / f"{target_stem}-hit.png"
    if mirror_root is None:
        save(idle, idle_path)
        save(make_selected_variant(idle), selected_path)
        save(make_hit_variant(idle), hit_path)
        return

    save_all(idle, idle_path, mirror_root / f"{target_stem}.png")
    save_all(
        make_selected_variant(idle),
        selected_path,
        mirror_root / f"{target_stem}-selected.png",
    )
    save_all(
        make_hit_variant(idle),
        hit_path,
        mirror_root / f"{target_stem}-hit.png",
    )


def radial_gradient(size: int, inner: tuple[int, int, int], outer: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    px = img.load()
    cx = cy = (size - 1) / 2
    max_dist = (cx**2 + cy**2) ** 0.5
    for y in range(size):
        for x in range(size):
            dist = ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / max_dist
            t = min(1.0, max(0.0, dist))
            r = round(inner[0] + (outer[0] - inner[0]) * t)
            g = round(inner[1] + (outer[1] - inner[1]) * t)
            b = round(inner[2] + (outer[2] - inner[2]) * t)
            px[x, y] = (r, g, b, 255)
    return img


def create_marker(kind: str, state: str) -> Image.Image:
    size = 48
    base = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(base)
    palette = {
        "hero": ((72, 96, 124), (26, 34, 46), (216, 224, 232)),
        "neutral": ((96, 74, 66), (33, 24, 22), (219, 206, 196)),
    }[kind]
    img = radial_gradient(size, palette[0], palette[1])
    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse((4, 4, size - 4, size - 4), fill=255)
    base.paste(img, mask=mask)
    draw = ImageDraw.Draw(base)
    rim = (142, 184, 228, 255) if kind == "hero" else (189, 146, 120, 255)
    draw.ellipse((4, 4, size - 4, size - 4), outline=rim, width=2)
    if state == "selected":
        draw.ellipse((1, 1, size - 1, size - 1), outline=(112, 214, 255, 210), width=2)
    if kind == "hero":
        draw.polygon([(24, 10), (29, 18), (38, 20), (31, 26), (33, 36), (24, 30), (15, 36), (17, 26), (10, 20), (19, 18)], fill=palette[2] + (255,))
    else:
        draw.polygon([(12, 32), (18, 16), (24, 26), (30, 16), (36, 32), (24, 38)], fill=palette[2] + (255,))
        draw.ellipse((18, 18, 22, 22), fill=(40, 24, 24, 255))
        draw.ellipse((26, 18, 30, 22), fill=(40, 24, 24, 255))
    if state == "hit":
        slash = Image.new("RGBA", base.size, (0, 0, 0, 0))
        sdraw = ImageDraw.Draw(slash)
        sdraw.line((10, 36, 36, 12), fill=(255, 108, 108, 150), width=4)
        base.alpha_composite(slash.filter(ImageFilter.GaussianBlur(radius=0.7)))
    return base


def create_frame(kind: str) -> Image.Image:
    size = 96
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    inner = (232, 228, 220, 255)
    border_main = (60, 104, 92, 255) if kind == "ally" else (110, 60, 60, 255)
    border_shadow = (30, 40, 42, 255)
    corner = (214, 176, 102, 255) if kind == "ally" else (186, 106, 94, 255)
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((8, 8, size - 8, size - 8), radius=10, fill=inner, outline=border_shadow, width=3)
    draw.rounded_rectangle((12, 12, size - 12, size - 12), radius=8, outline=border_main, width=4)
    for x0, y0 in ((6, 6), (size - 26, 6), (6, size - 26), (size - 26, size - 26)):
        draw.rounded_rectangle((x0, y0, x0 + 20, y0 + 20), radius=4, fill=corner)
    glaze = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    gdraw = ImageDraw.Draw(glaze)
    gdraw.rounded_rectangle((14, 14, size - 14, size - 14), radius=7, outline=(255, 255, 255, 38), width=2)
    img.alpha_composite(glaze.filter(ImageFilter.GaussianBlur(radius=0.8)))
    return img


def main() -> None:
    hero_sheet = load("hero-sheet.png")
    hero_from_sheet(hero_sheet, (0, 0), zoom=1.62, center=(0.48, 0.32), filename="hero-guard-basic.png")
    hero_from_sheet(hero_sheet, (1, 0), zoom=1.68, center=(0.50, 0.32), filename="hero-ranger-serin.png")
    hero_from_sheet(hero_sheet, (0, 1), zoom=1.72, center=(0.50, 0.29), filename="hero-oracle-lyra.png")
    hero_from_sheet(hero_sheet, (1, 1), zoom=1.65, center=(0.50, 0.31), filename="hero-forgeguard-borin.png")

    render_unit_variants("unit-guard.png", "hero-guard-basic", UNIT_ROOT, zoom=1.32, center=(0.5, 0.34))
    render_unit_variants("unit-wolf-pack.png", "wolf-pack", UNIT_ROOT, zoom=1.22, center=(0.5, 0.34))
    render_unit_variants("unit-crown-crossbowman.png", "crown-crossbowman", UNIT_ROOT, zoom=1.22, center=(0.5, 0.34))
    render_unit_variants("unit-crown-light-outrider.png", "crown-light-outrider", UNIT_ROOT, zoom=1.22, center=(0.5, 0.34))
    render_unit_variants("unit-wild-cave-bear.png", "wild-cave-bear", UNIT_ROOT, zoom=1.18, center=(0.5, 0.34))
    render_unit_variants("unit-wild-serpent.png", "wild-serpent", UNIT_ROOT, zoom=1.18, center=(0.5, 0.34))
    render_unit_variants("unit-wild-hawk-rider.png", "wild-hawk-rider", UNIT_ROOT, zoom=1.22, center=(0.5, 0.34))
    render_unit_variants("unit-wild-cave-troll.png", "wild-cave-troll", UNIT_ROOT, zoom=1.16, center=(0.5, 0.34))
    render_unit_variants("unit-shadow-skeleton.png", "shadow-skeleton", UNIT_ROOT, zoom=1.22, center=(0.5, 0.34))
    render_unit_variants("unit-shadow-wraith.png", "shadow-wraith", UNIT_ROOT, zoom=1.22, center=(0.5, 0.34))
    render_unit_variants("unit-shadow-hexer.png", "shadow-hexer", UNIT_ROOT, zoom=1.22, center=(0.5, 0.34))
    render_unit_variants("unit-shadow-death-knight.png", "shadow-death-knight", UNIT_ROOT, zoom=1.22, center=(0.5, 0.34))

    render_unit_variants("unit-moss-stalker.png", "moss-stalker", SHOWCASE_ROOT, zoom=1.18, center=(0.5, 0.35))
    render_unit_variants("unit-iron-walker.png", "iron-walker", SHOWCASE_ROOT, zoom=1.18, center=(0.5, 0.34))
    render_unit_variants("unit-sunlance-knight.png", "sunlance-knight", SHOWCASE_ROOT, zoom=1.22, center=(0.5, 0.34))
    render_unit_variants("unit-ember-mage.png", "ember-mage", SHOWCASE_ROOT, zoom=1.22, center=(0.5, 0.34))
    render_unit_variants("unit-dune-raider.png", "dune-raider", SHOWCASE_ROOT, zoom=1.18, center=(0.5, 0.34))
    render_unit_variants("unit-glacier-warden.png", "glacier-warden", SHOWCASE_ROOT, zoom=1.20, center=(0.5, 0.34))

    save_all(create_marker("hero", "idle"), MARKER_ROOT / "hero-marker.png", H5_MARKER_ROOT / "hero-marker.png")
    save_all(
        create_marker("hero", "selected"),
        MARKER_ROOT / "hero-marker-selected.png",
        H5_MARKER_ROOT / "hero-marker-selected.png",
    )
    save_all(create_marker("hero", "hit"), MARKER_ROOT / "hero-marker-hit.png", H5_MARKER_ROOT / "hero-marker-hit.png")
    save_all(
        create_marker("neutral", "idle"),
        MARKER_ROOT / "neutral-marker.png",
        H5_MARKER_ROOT / "neutral-marker.png",
    )
    save_all(
        create_marker("neutral", "selected"),
        MARKER_ROOT / "neutral-marker-selected.png",
        H5_MARKER_ROOT / "neutral-marker-selected.png",
    )
    save_all(
        create_marker("neutral", "hit"),
        MARKER_ROOT / "neutral-marker-hit.png",
        H5_MARKER_ROOT / "neutral-marker-hit.png",
    )

    save_all(create_frame("ally"), FRAME_ROOT / "unit-frame-ally.png", H5_FRAME_ROOT / "unit-frame-ally.png")
    save_all(create_frame("enemy"), FRAME_ROOT / "unit-frame-enemy.png", H5_FRAME_ROOT / "unit-frame-enemy.png")


if __name__ == "__main__":
    main()
