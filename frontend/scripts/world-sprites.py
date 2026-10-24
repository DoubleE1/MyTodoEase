"""
Cut the World sprite sheets in design/world/<theme> into transparent sprites for the Insights World view.

The sheets are AI renders of isometric soil blocks on a flat magenta background (#FF00FF), one growth
stage per tile. This script:
  1. keys the magenta out (alpha from the colour's distance to magenta, edge colours un-mixed),
  2. splits each sheet into tiles by empty columns (and rows for multi-row sheets),
  3. measures the block in every tile (its width and the height of the top face centre above the
     bottom tip) so all sprites can be scaled to the same block width and anchored on the top face,
  4. writes frontend/src/assets/world/<theme>/<name>.webp plus sprites.ts with the anchors.

Usage (from the repository root, needs Pillow):
  python frontend/scripts/world-sprites.py
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass

from PIL import Image, ImageChops, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE = os.path.join(ROOT, "design", "world")
OUT = os.path.join(ROOT, "frontend", "src", "assets", "world")

BLOCK_WIDTH = 256  # every sprite is scaled so its block is this wide (px)
KEY_LO, KEY_HI = 36, 110  # distance from magenta: fully transparent below, fully opaque above
PAD = 2

# Which tile of which sheet becomes which sprite, per theme. Rows/columns are zero based; a sheet with one
# row has row 0. Tiles not listed are ignored.
THEMES: dict[str, list[tuple[str, str, int, int]]] = {
    "grove": [
        # (sprite name, sheet file, row, column)
        ("bare", "pine-sheet.webp", 0, 0),
        ("leafy-1a", "leafy-sheet.webp", 0, 0),
        ("leafy-1b", "leafy-sheet.webp", 0, 1),
        ("leafy-2", "leafy-sheet.webp", 0, 2),
        ("leafy-3", "leafy-sheet.webp", 0, 3),
        ("leafy-4", "leafy-sheet.webp", 0, 4),
        ("pine-1", "pine-sheet.webp", 0, 1),
        ("pine-2", "pine-sheet.webp", 0, 2),
        ("pine-3", "pine-sheet.webp", 0, 3),
        ("pine-4", "pine-sheet.webp", 0, 4),
        ("blossom-1", "blossom-sheet.webp", 0, 1),
        ("blossom-2", "blossom-sheet.webp", 0, 2),
        ("blossom-3", "blossom-sheet.webp", 0, 3),
        ("blossom-4", "blossom-sheet.webp", 0, 4),
        # mixed-sheet.webp (leafy / pine / blossom rows) is kept for reference only: its rows touch, and the big
        # blossom's crown is hidden behind the pine block above it.
    ],
    "city": [
        ("bare", "city-sheet.webp", 0, 0),
        ("modern-1", "city-sheet.webp", 0, 1),
        ("modern-2", "city-sheet.webp", 0, 2),
        ("modern-3", "city-sheet.webp", 0, 3),
        ("modern-4", "city-sheet.webp", 0, 4),
        ("castle-1", "city-sheet.webp", 1, 1),
        ("castle-2", "city-sheet.webp", 1, 2),
        ("castle-3", "city-sheet.webp", 1, 3),
        ("castle-4", "city-sheet.webp", 1, 4),
        ("pagoda-1", "city-sheet.webp", 2, 1),
        ("pagoda-2", "city-sheet.webp", 2, 2),
        ("pagoda-3", "city-sheet.webp", 2, 3),
        ("pagoda-4", "city-sheet.webp", 2, 4),
    ],
}


@dataclass
class Tile:
    image: Image.Image  # RGBA, cropped to the silhouette with PAD
    block_width: int
    bottom: int  # y of the block's bottom tip (last opaque row)
    face_y: int  # y of the block's top face centre (first row at full block width)
    centre_x: float  # x of the block's bottom tip


def key_magenta(sheet: Image.Image) -> Image.Image:
    """Alpha from how far a pixel is from pure magenta; edge pixels get their magenta share removed."""
    rgb = sheet.convert("RGB")
    r, g, b = rgb.split()
    # Pure magenta is (255, 0, 255): distance = max(255 - r, g, 255 - b).
    distance = ImageChops.lighter(ImageChops.lighter(ImageChops.invert(r), g), ImageChops.invert(b))
    ramp = [0] * 256
    for d in range(256):
        ramp[d] = max(0, min(255, round((d - KEY_LO) * 255 / (KEY_HI - KEY_LO))))
    alpha = distance.point(ramp)
    # Shrink the matte by a pixel so no magenta rim survives on the silhouette.
    alpha = ImageChops.darker(alpha, alpha.filter(ImageFilter.MinFilter(3)))
    out = rgb.copy()
    out.putalpha(alpha)
    # Un-mix the partially transparent rim: colour = a * object + (1 - a) * magenta.
    px = out.load()
    w, h = out.size
    for y in range(h):
        for x in range(w):
            pr, pg, pb, pa = px[x, y]
            if 0 < pa < 255:
                a = pa / 255
                nr = max(0, min(255, round((pr - (1 - a) * 255) / a)))
                nb = max(0, min(255, round((pb - (1 - a) * 255) / a)))
                ng = max(0, min(255, round(pg / a)))
                px[x, y] = (nr, ng, nb, pa)
    return out


def runs(values: list[bool], min_gap: int) -> list[tuple[int, int]]:
    """Index ranges where values are true, merging runs separated by fewer than min_gap false values."""
    result: list[tuple[int, int]] = []
    start = None
    gap = 0
    for i, v in enumerate(values):
        if v:
            if start is None:
                start = i
            gap = 0
        elif start is not None:
            gap += 1
            if gap >= min_gap:
                result.append((start, i - gap + 1))
                start = None
                gap = 0
    if start is not None:
        result.append((start, len(values)))
    return result


def split_tiles(keyed: Image.Image) -> list[list[tuple[Image.Image, int]]]:
    """Tiles as rows[row][column] with each tile's y offset in the sheet, cropped to its silhouette plus PAD.

    Columns are separated first (tall trees of one row may overlap the next row's blocks vertically,
    but columns always have clear gaps), then each column is split into its rows. A column whose rows
    touch is cut at its narrowest row near the boundaries that the clean columns establish.
    """
    alpha = keyed.getchannel("A")
    w, h = alpha.size
    mask = alpha.point(lambda a: 255 if a > 24 else 0)
    col_has = [mask.crop((x, 0, x + 1, h)).getbbox() is not None for x in range(w)]
    column_ranges = runs(col_has, 12)
    per_column: list[list[tuple[int, int]]] = []
    strips: list[Image.Image] = []
    for x0, x1 in column_ranges:
        strip = mask.crop((x0, 0, x1, h))
        strips.append(strip)
        row_has = [strip.crop((0, y, x1 - x0, y + 1)).getbbox() is not None for y in range(h)]
        per_column.append(runs(row_has, 1))
    row_count = max(len(r) for r in per_column)
    clean = next(r for r in per_column if len(r) == row_count)
    # Blocks share a baseline across a row, so the narrowest row just below a clean row's bottom is the cut.
    windows = [(clean[i][1] - 30, clean[i + 1][0] + 10) for i in range(row_count - 1)]
    for index, ranges in enumerate(per_column):
        if len(ranges) == row_count:
            continue
        strip = strips[index]
        sw = strip.width
        widths = []
        for y in range(h):
            bbox = strip.crop((0, y, sw, y + 1)).getbbox()
            widths.append(bbox[2] - bbox[0] if bbox else 0)
        cuts = [min(range(max(0, lo), min(h, hi)), key=lambda y: widths[y]) for lo, hi in windows]
        print(f"  column {index}: rows touch, cutting at {cuts} (widths {[widths[c] for c in cuts]} px)")
        top = min(y for y in range(h) if widths[y] > 0)
        bottom = max(y for y in range(h) if widths[y] > 0) + 1
        edges = [top] + cuts + [bottom]
        per_column[index] = [(edges[i], edges[i + 1]) for i in range(row_count)]
    columns: list[list[tuple[Image.Image, int]]] = []
    for (x0, x1), ranges in zip(column_ranges, per_column):
        tiles: list[tuple[Image.Image, int]] = []
        for y0, y1 in ranges:
            top = max(0, y0 - PAD)
            tile = keyed.crop((max(0, x0 - PAD), top, min(w, x1 + PAD), min(h, y1 + PAD)))
            bbox = tile.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
            inner_top = max(0, bbox[1] - PAD)
            tiles.append((tile.crop((max(0, bbox[0] - PAD), inner_top, bbox[2] + PAD, bbox[3] + PAD)), top + inner_top))
        columns.append(tiles)
    return [[column[r] for column in columns] for r in range(row_count)]


def measure(tile: Image.Image, bottom_hint: int | None = None) -> Tile:
    """Locate the block: scanning down, the top face's edges widen steeply until the corners, after which the
    sides are vertical (pebbles may bulge a little further out, so the corners are not simply the widest row).

    On tiles with something wide growing on the block this can lock onto the canopy instead, so callers take the
    block size from the sheet's bare tile (or the tile with the smallest depth) and apply it to the rest.
    """
    mask = tile.getchannel("A").point(lambda a: 255 if a > 128 else 0)
    w, h = mask.size
    widths: list[tuple[int, int, int]] = []  # (width, left, right) per row
    for y in range(h):
        bbox = mask.crop((0, y, w, y + 1)).getbbox()
        widths.append((bbox[2] - bbox[0], bbox[0], bbox[2]) if bbox else (0, 0, 0))
    # The block's bottom tip ends the contiguous silhouette under the middle of the widest row. Looking only at
    # that middle band ignores slivers of the next row's tile (flags, roof tips) that a cut may have left beside it.
    widest = max(r[0] for r in widths)
    widest_row = next(y for y in range(h) if widths[y][0] == widest)
    mid = (widths[widest_row][1] + widths[widest_row][2]) / 2
    band = (int(mid - widest / 4), int(mid + widest / 4))
    band_mask = mask.crop((band[0], 0, band[1], h))

    def band_width(y: int) -> int:
        bbox = band_mask.crop((0, y, band[1] - band[0], y + 1)).getbbox()
        return bbox[2] - bbox[0] if bbox else 0

    # Walk down to the tip, unless the caller knows the row's baseline (all blocks of a sheet row share one).
    if bottom_hint is None:
        bottom = widest_row
        while bottom + 1 < h and band_width(bottom + 1) > 0:
            bottom += 1
    else:
        bottom = max(widest_row, min(h - 1, bottom_hint))
    tips = []
    for y in range(max(0, bottom - 2), bottom + 1):
        bbox = band_mask.crop((0, y, band[1] - band[0], y + 1)).getbbox()
        if bbox:
            tips.append((bbox[0] + band[0], bbox[2] + band[0]))
    centre_x = sum((l + r) / 2 for l, r in tips) / len(tips)
    face_y = next(
        (y for y in range(0, bottom - 2) if widths[y][0] >= widest * 0.9 and widths[y + 2][0] - widths[y][0] <= 3),
        bottom,
    )
    return Tile(tile, widths[face_y][0], bottom, face_y, centre_x)


def calibrate(rows: list[list[Tile]]) -> None:
    """Give every tile of a sheet the block size of its most reliable tile: the first column's (bare) block when
    the sheet has one, otherwise the tile with the smallest measured depth."""
    tiles = [t for r in rows for t in r]
    reference = min(tiles, key=lambda t: t.bottom - t.face_y)
    first = rows[0][0]
    if first.bottom - first.face_y <= (reference.bottom - reference.face_y) * 1.15:
        reference = first
    depth = reference.bottom - reference.face_y
    for t in tiles:
        t.block_width = reference.block_width
        t.face_y = t.bottom - depth
        clean_below_block(t)


def clean_below_block(t: Tile) -> None:
    """Clear pixels below the top face that lie outside the block's sides and bottom tip (with a margin for the
    pebbles): what remains there is a sliver of a neighbouring tile."""
    margin = 10
    half = t.block_width / 2
    px = t.image.load()
    w, h = t.image.size
    for y in range(t.face_y, h):
        # Sides are vertical down to where the bottom tip starts; the tip's edges then close in at 2:1.
        reach = min(half, (t.bottom - y) * 2) + margin
        lo, hi = t.centre_x - reach, t.centre_x + reach
        for x in range(w):
            if (x < lo or x > hi) and px[x, y][3]:
                r, g, b, _ = px[x, y]
                px[x, y] = (r, g, b, 0)
    bbox = t.image.getchannel("A").getbbox()
    if bbox:
        t.image = t.image.crop((0, 0, w, min(h, bbox[3] + PAD)))


def build_theme(theme: str, sprites: list[tuple[str, str, int, int]]) -> None:
    source = os.path.join(SOURCE, theme)
    out = os.path.join(OUT, theme)
    os.makedirs(out, exist_ok=True)
    sheets: dict[str, list[list[Tile]]] = {}
    manifest: list[tuple[str, int, int, int, int]] = []  # name, width, height, anchor x, anchor y
    for name, sheet_file, row, col in sprites:
        if sheet_file not in sheets:
            path = os.path.join(source, sheet_file)
            print(f"keying {theme}/{sheet_file} ...", flush=True)
            rows = split_tiles(key_magenta(Image.open(path)))
            measured: list[list[Tile]] = []
            for r in rows:
                # The first tile of a row (bare block or sprout) has nothing hanging below it: its bottom tip
                # is the row's baseline in sheet coordinates, shared by every block of the row.
                first = measure(r[0][0])
                baseline = r[0][1] + first.bottom
                measured.append([first] + [measure(img, baseline - y0) for img, y0 in r[1:]])
            sheets[sheet_file] = measured
            calibrate(sheets[sheet_file])
            print(f"  {len(rows)} row(s): {[len(r) for r in rows]} tiles")
        tile = sheets[sheet_file][row][col]
        scale = BLOCK_WIDTH / tile.block_width
        img = tile.image
        resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
        anchor_x = round(tile.centre_x * scale)
        anchor_y = round(tile.face_y * scale)
        out_path = os.path.join(out, f"{name}.webp")
        resized.save(out_path, "WEBP", quality=88, method=6, alpha_quality=92)
        manifest.append((name, resized.width, resized.height, anchor_x, anchor_y))
        print(f"  {name}: {resized.width}x{resized.height} anchor ({anchor_x}, {anchor_y}) block {tile.block_width}px "
              f"depth {(tile.bottom - tile.face_y) * scale:.0f}px -> {os.path.getsize(out_path) // 1024} KB")

    lines = [
        f"// Generated by frontend/scripts/world-sprites.py from design/world/{theme}; do not edit by hand.",
        "// Every sprite's block is BLOCK_WIDTH px wide; the anchor is the centre of the block's top face.",
        "import type { Sprite } from '../sprite';",
        "",
    ]
    for name, *_ in manifest:
        lines.append(f"import {name.replace('-', '_')} from './{name}.webp';")
    lines += ["", f"export const BLOCK_WIDTH = {BLOCK_WIDTH};", "", "export const SPRITES = {"]
    for name, w, h, ax, ay in manifest:
        lines.append(f"  '{name}': {{ url: {name.replace('-', '_')}, width: {w}, height: {h}, anchorX: {ax}, anchorY: {ay} }},")
    lines += ["} satisfies Record<string, Sprite>;", "", "export type SpriteName = keyof typeof SPRITES;", ""]
    with open(os.path.join(out, "sprites.ts"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print(f"wrote {theme}/sprites.ts")


def main() -> int:
    for theme, sprites in THEMES.items():
        build_theme(theme, sprites)
    return 0


if __name__ == "__main__":
    sys.exit(main())
