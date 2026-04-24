from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageChops


ROOT = Path(__file__).resolve().parent.parent
SOURCE_LOGO = ROOT / "logo.png"
OUTPUT_DIR = ROOT / "public" / "icons"
ICO_PATH = ROOT / "public" / "icons" / "app-icon.ico"

EXTENSION_SIZES = [16, 32, 48, 128]
STORE_SIZES = [256, 512, 1024]
ICO_SIZES = [(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]


def trim_whitespace(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    diff = Image.eval(ImageChops.difference(rgba, background), lambda px: 255 if px else 0)
    bbox = diff.getbbox()
    return rgba.crop(bbox) if bbox else rgba


def make_white_background_transparent(image: Image.Image, threshold: int = 245) -> Image.Image:
    rgba = image.convert("RGBA")
    pixels = rgba.load()

    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            if alpha == 0:
                continue
            if red >= threshold and green >= threshold and blue >= threshold:
                pixels[x, y] = (red, green, blue, 0)

    return rgba


def crop_symbol(image: Image.Image) -> Image.Image:
    transparent = make_white_background_transparent(image)
    trimmed = trim_whitespace(transparent)
    width, height = trimmed.size
    symbol_bottom = int(height * 0.73)
    return trimmed.crop((0, 0, width, symbol_bottom))


def build_square_icon(image: Image.Image, size: int) -> Image.Image:
    symbol = crop_symbol(image).convert("RGBA")
    canvas = Image.new("RGBA", (size, size), (255, 255, 255, 0))

    padding = int(size * 0.08)
    target = size - (padding * 2)
    symbol.thumbnail((target, target), Image.Resampling.LANCZOS)

    x = (size - symbol.width) // 2
    y = (size - symbol.height) // 2
    canvas.alpha_composite(symbol, (x, y))
    return canvas


def save_png_set(source_image: Image.Image) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for size in sorted(set(EXTENSION_SIZES + STORE_SIZES)):
        icon = build_square_icon(source_image, size)
        icon.save(OUTPUT_DIR / f"icon-{size}.png")


def save_ico(source_image: Image.Image) -> None:
    largest = build_square_icon(source_image, 256)
    largest.save(ICO_PATH, format="ICO", sizes=ICO_SIZES)


def main() -> None:
    if not SOURCE_LOGO.exists():
        raise SystemExit(f"Missing source logo: {SOURCE_LOGO}")

    source_image = Image.open(SOURCE_LOGO)
    save_png_set(source_image)
    save_ico(source_image)
    print(f"Generated icons in {OUTPUT_DIR}")


if __name__ == "__main__":
    main()
