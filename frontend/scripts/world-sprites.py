"""
Cut the Grove sprite sheets in design/world/grove into transparent sprites for the Insights World view.

The sheets are AI renders of isometric soil blocks on a flat magenta background (#FF00FF), one growth
stage per tile. This script:
  1. keys the magenta out (alpha from the colour's distance to magenta, edge colours un-mixed),
  2. splits each sheet into tiles by empty columns (and rows for multi-row sheets),
  3. measures the block in every tile (its width and the height of the top face centre above the
     bottom tip) so all sprites can be scaled to the same block width and anchored on the top face,
  4. writes frontend/src/assets/world/grove/<name>.webp plus sprites.ts with the anchors.

Usage (from the repository root, needs Pillow):
  python frontend/scripts/world-sprites.py
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass

from PIL import Image, ImageChops, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE = os.path.join(ROOT, "design", "world", "grove")
OUT = os.path.join(ROOT, "frontend", "src", "assets", "world", "grove")

BLOCK_WIDTH = 256  # every sprite is scaled so its block is this wide (px)
KEY_LO, KEY_HI = 36, 110  # distance from magenta: fully transparent below, fully opaque above
PAD = 2

# Which tile of which sheet becomes which sprite. Rows/columns are zero based; a sheet with one row has row 0.
# Tiles not listed are ignored (for example the sheet's second sprout, kept as a variant where useful).
SPRITES: list[tuple[str, str, int, int]] = [
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
    # mixed-sheet.webp (leafy / pine / blossom rows) is kept for reference only: its rows touch, and the big
    # blossom's crown is hidden behind the pine block above it. A single-row blossom sheet can replace it.
]


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


def split_tiles(keyed: Image.Image) -> list[list[Image.Image]]:
    """Tiles as rows[row][column], each cropped to its silhouette plus PAD.

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
    boundaries = [(clean[i][1] + clean[i + 1][0]) // 2 for i in range(row_count - 1)]
    for index, ranges in enumerate(per_column):
        if len(ranges) == row_count:
            continue
        strip = strips[index]
        sw = strip.width
        widths = []
        for y in range(h):
            bbox = strip.crop((0, y, sw, y + 1)).getbbox()
            widths.append(bbox[2] - bbox[0] if bbox else 0)
        cuts = [min(range(max(0, b - 30), min(h, b + 30)), key=lambda y: widths[y]) for b in boundaries]
        print(f"  column {index}: rows touch, cutting at {cuts} (widths {[widths[c] for c in cuts]} px)")
        top = min(y for y in range(h) if widths[y] > 0)
        bottom = max(y for y in range(h) if widths[y] > 0) + 1
        edges = [top] + cuts + [bottom]
        per_column[index] = [(edges[i], edges[i + 1]) for i in range(row_count)]
    columns: list[list[Image.Image]] = []
    for (x0, x1), ranges in zip(column_ranges, per_column):
        tiles: list[Image.Image] = []
        for y0, y1 in ranges:
            tile = keyed.crop((max(0, x0 - PAD), max(0, y0 - PAD), min(w, x1 + PAD), min(h, y1 + PAD)))
            bbox = tile.getchannel("A").point(lambda a: 255 if a > 24 else 0).getbbox()
            tiles.append(tile.crop((max(0, bbox[0] - PAD), max(0, bbox[1] - PAD), bbox[2] + PAD, bbox[3] + PAD)))
        columns.append(tiles)
    return [[column[r] for column in columns] for r in range(row_count)]


def measure(tile: Image.Image) -> Tile:
    """Find the block: the widest band of the silhouette, whose top row is the top face's corners.

    A canopy nearly as wide as the block can fool this on tree tiles, so callers take the block size from
    the tile of the sheet with the smallest measured depth (bare block or sprout) and apply it to the rest.
    """
    mask = tile.getchannel("A").point(lambda a: 255 if a > 128 else 0)
    w, h = mask.size
    widths: list[tuple[int, int, int]] = []  # (width, left, right) per row
    for y in range(h):
        bbox = mask.crop((0, y, w, y + 1)).getbbox()
        widths.append((bbox[2] - bbox[0], bbox[0], bbox[2]) if bbox else (0, 0, 0))
    bottom = max(y for y in range(h) if widths[y][0] > 0)
    # The block's side faces are vertical, so the widest rows form a band ending near the bottom tip.
    # Scan up from the bottom: the width grows until the corners, then stays (sides) or shrinks (canopy).
    band_width = 0
    for y in range(bottom, max(bottom - w, 0), -1):
        if widths[y][0] >= band_width:
            band_width = widths[y][0]
        elif widths[y][0] < band_width * 0.97:
            break
    # The band's bottom is where the tip starts narrowing; its top row is the corners = the top face's centre line.
    band_bottom = next(y for y in range(bottom, -1, -1) if widths[y][0] >= band_width * 0.985)
    face_y = band_bottom
    while face_y > 0 and widths[face_y - 1][0] >= band_width * 0.985:
        face_y -= 1
    tips = [widths[y] for y in range(max(0, bottom - 2), bottom + 1) if widths[y][0] > 0]
    centre_x = sum((t[1] + t[2]) / 2 for t in tips) / len(tips)
    return Tile(tile, band_width, bottom, face_y, centre_x)


def calibrate(rows: list[list[Tile]]) -> None:
    """Give every tile of a sheet the block size of its most reliable tile (the one with the smallest depth)."""
    tiles = [t for r in rows for t in r]
    reference = min(tiles, key=lambda t: t.bottom - t.face_y)
    depth = reference.bottom - reference.face_y
    for t in tiles:
        t.block_width = reference.block_width
        t.face_y = t.bottom - depth


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    sheets: dict[str, list[list[Tile]]] = {}
    manifest: list[tuple[str, int, int, int, int]] = []  # name, width, height, anchor x, anchor y
    for name, sheet_file, row, col in SPRITES:
        if sheet_file not in sheets:
            path = os.path.join(SOURCE, sheet_file)
            print(f"keying {sheet_file} ...", flush=True)
            rows = split_tiles(key_magenta(Image.open(path)))
            sheets[sheet_file] = [[measure(t) for t in r] for r in rows]
            calibrate(sheets[sheet_file])
            print(f"  {len(rows)} row(s): {[len(r) for r in rows]} tiles")
        tile = sheets[sheet_file][row][col]
        scale = BLOCK_WIDTH / tile.block_width
        img = tile.image
        resized = img.resize((round(img.width * scale), round(img.height * scale)), Image.Resampling.LANCZOS)
        anchor_x = round(tile.centre_x * scale)
        anchor_y = round(tile.face_y * scale)
        out_path = os.path.join(OUT, f"{name}.webp")
        resized.save(out_path, "WEBP", quality=88, method=6, alpha_quality=92)
        manifest.append((name, resized.width, resized.height, anchor_x, anchor_y))
        print(f"  {name}: {resized.width}x{resized.height} anchor ({anchor_x}, {anchor_y}) block {tile.block_width}px "
              f"depth {(tile.bottom - tile.face_y) * scale:.0f}px -> {os.path.getsize(out_path) // 1024} KB")

    lines = [
        "// Generated by frontend/scripts/world-sprites.py from design/world/grove; do not edit by hand.",
        "// Every sprite's block is BLOCK_WIDTH px wide; the anchor is the centre of the block's top face.",
        "",
    ]
    for name, *_ in manifest:
        lines.append(f"import {name.replace('-', '_')} from './{name}.webp';")
    lines += [
        "",
        f"export const BLOCK_WIDTH = {BLOCK_WIDTH};",
        "",
        "export interface Sprite {",
        "  url: string;",
        "  width: number;",
        "  height: number;",
        "  /** Centre of the block's top face, in sprite pixels. */",
        "  anchorX: number;",
        "  anchorY: number;",
        "}",
        "",
        "export const GROVE_SPRITES = {",
    ]
    for name, w, h, ax, ay in manifest:
        lines.append(f"  '{name}': {{ url: {name.replace('-', '_')}, width: {w}, height: {h}, anchorX: {ax}, anchorY: {ay} }},")
    lines += ["} satisfies Record<string, Sprite>;", "", "export type GroveSpriteName = keyof typeof GROVE_SPRITES;", ""]
    with open(os.path.join(OUT, "sprites.ts"), "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))
    print("wrote sprites.ts")
    return 0


if __name__ == "__main__":
    sys.exit(main())
