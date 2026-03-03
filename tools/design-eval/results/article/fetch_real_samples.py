"""Fetch real samples from HuggingFace datasets and create article images.

Downloads examples from:
  - GraphicDesignEvaluation: graphic designs with human quality ratings
  - DesignBench edit=vanilla: before/after UI edit pairs (real web screenshots)
  - DesignBench repair=vanilla: buggy/fixed/marked UI triples

Usage:
    uv run python results/article/fetch_real_samples.py
"""
from __future__ import annotations

import os

import datasets as hf_datasets
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "images")
os.makedirs(OUT, exist_ok=True)

def get_font(size: int):
    for path in [
        "/System/Library/Fonts/Helvetica.ttc",
        "/System/Library/Fonts/SFNSMono.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()

def get_mono(size: int):
    for path in [
        "/System/Library/Fonts/SFNSMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()

F_TITLE = get_font(56)
F_MD = get_font(32)
F_SM = get_font(24)
F_XS = get_font(20)
F_XXS = get_font(16)
F_MONO = get_mono(18)

BG = (24, 24, 32)
BG_CARD = (36, 36, 50)
TEXT_W = (255, 255, 255)
TEXT_L = (200, 200, 210)
TEXT_M = (160, 160, 170)
TEXT_D = (120, 120, 130)
ACCENT_BLUE = (100, 180, 255)
ACCENT_GREEN = (100, 220, 100)
ACCENT_YELLOW = (255, 200, 80)
ACCENT_ORANGE = (255, 150, 80)
ACCENT_RED = (255, 100, 100)
GRID = (45, 45, 58)


def fit_image(pil_img: Image.Image, max_w: int, max_h: int) -> Image.Image:
    """Resize preserving aspect ratio."""
    pil_img = pil_img.convert("RGB")
    w, h = pil_img.size
    scale = min(max_w / w, max_h / h, 1.0)
    new_w, new_h = int(w * scale), int(h * scale)
    if new_w != w or new_h != h:
        return pil_img.resize((new_w, new_h), Image.LANCZOS)
    return pil_img


# ═══════════════════════════════════════════════════════════════════════════
# 13. GDE — Real graphic design images with human ratings
# ═══════════════════════════════════════════════════════════════════════════

def fetch_gde():
    print("Downloading GraphicDesignEvaluation (absolute-human-alignment)...")
    ds = hf_datasets.load_dataset(
        "creative-graphic-design/GraphicDesignEvaluation",
        "absolute-human-alignment",
        split="train",
    )
    print(f"  {len(ds)} rows: {ds.column_names}")

    # Pick 6 varied samples
    indices = [0, 30, 80, 150, 250, 350]
    samples = [ds[i] for i in indices if i < len(ds)]

    # Save individuals
    sdir = os.path.join(OUT, "real_samples", "gde")
    os.makedirs(sdir, exist_ok=True)
    for i, row in enumerate(samples):
        row["image"].convert("RGB").save(f"{sdir}/gde_{indices[i]}.png")

    # Composite
    W, H = 2800, 1200
    max_img = 380
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 35), "Real Dataset: GraphicDesignEvaluation",
           fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 95),
           "400 graphic designs rated by human evaluators on alignment quality (1-10 scale)",
           fill=TEXT_M, font=F_SM, anchor="mt")
    d.text((W // 2, 128), "HuggingFace: creative-graphic-design/GraphicDesignEvaluation",
           fill=ACCENT_BLUE, font=F_XS, anchor="mt")

    n = len(samples)
    col_w = (W - 100) // n
    sx = 50

    for i, row in enumerate(samples):
        cx = sx + i * col_w + col_w // 2
        card_x = sx + i * col_w + 8
        card_w = col_w - 16
        card_top = 175

        d.rounded_rectangle([card_x, card_top, card_x + card_w, H - 30],
                            radius=12, fill=BG_CARD)

        # Image
        fitted = fit_image(row["image"], card_w - 30, max_img)
        px = cx - fitted.width // 2
        py = card_top + 15
        img.paste(fitted, (px, py))
        d.rectangle([px - 1, py - 1, px + fitted.width + 1, py + fitted.height + 1],
                    outline=GRID, width=2)

        # Size
        orig_w, orig_h = row["image"].size
        d.text((cx, py + fitted.height + 8), f"{orig_w}x{orig_h}",
               fill=TEXT_D, font=F_XXS, anchor="mt")

        # Perturbation
        pert = row.get("perturbation", "?")
        pert_label = "original" if pert == 0 else f"degraded (level {pert})"
        pert_color = ACCENT_GREEN if pert == 0 else ACCENT_ORANGE
        d.text((cx, py + fitted.height + 30), pert_label,
               fill=pert_color, font=F_XS, anchor="mt")

        # Scores
        scores = row.get("scores", [])
        avg = row.get("avg", 0)

        sy = py + fitted.height + 60
        d.text((cx, sy), "Human scores:", fill=TEXT_M, font=F_XXS, anchor="mt")
        sy += 22
        scores_str = ", ".join(str(s) for s in scores[:8])
        d.text((cx, sy), f"[{scores_str}]", fill=TEXT_L, font=F_MONO, anchor="mt")
        sy += 25

        # Average bar
        avg_pct = avg / 10.0
        bar_w = card_w - 60
        bar_x = card_x + 30
        d.rounded_rectangle([bar_x, sy, bar_x + bar_w, sy + 20],
                            radius=4, fill=(40, 40, 55))
        fill_w = int(bar_w * avg_pct)
        bar_color = ACCENT_GREEN if avg >= 7 else ACCENT_YELLOW if avg >= 5 else ACCENT_RED
        if fill_w > 0:
            d.rounded_rectangle([bar_x, sy, bar_x + fill_w, sy + 20],
                                radius=4, fill=bar_color)
        d.text((cx, sy + 28), f"avg: {avg:.1f}/10",
               fill=bar_color, font=F_SM, anchor="mt")

    img.save(f"{OUT}/13_real_gde_samples.png")
    print(f"  13_real_gde_samples.png  ({W}x{H})")


# ═══════════════════════════════════════════════════════════════════════════
# 14. DesignBench Edit — Real before/after UI screenshots
# ═══════════════════════════════════════════════════════════════════════════

def fetch_designbench_edit():
    print("\nDownloading DesignBench edit=vanilla...")
    ds = hf_datasets.load_dataset(
        "creative-graphic-design/DesignBench",
        "edit=vanilla",
        split="test",
    )
    print(f"  {len(ds)} rows: {ds.column_names}")

    # Pick 4 samples
    indices = [0, 20, 40, 60]
    samples = [ds[i] for i in indices if i < len(ds)]

    # Save individuals
    sdir = os.path.join(OUT, "real_samples", "designbench_edit")
    os.makedirs(sdir, exist_ok=True)
    for i, row in enumerate(samples):
        row["src_screenshot"].convert("RGB").save(f"{sdir}/edit_{i}_before.png")
        row["dst_screenshot"].convert("RGB").save(f"{sdir}/edit_{i}_after.png")

    # These are tall UI screenshots (1349x2605) — show top portion
    W, H = 2800, 1600
    max_img_w = 280
    max_img_h = 500
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 35), "Real Dataset: DesignBench — Edit Pairs",
           fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 95),
           "80 web UI screenshots: before edit (source) vs after edit (destination) with natural language instructions",
           fill=TEXT_M, font=F_SM, anchor="mt")
    d.text((W // 2, 128), "HuggingFace: creative-graphic-design/DesignBench (edit=vanilla)",
           fill=ACCENT_BLUE, font=F_XS, anchor="mt")

    n = len(samples)
    col_w = (W - 80) // n
    sx = 40

    for i, row in enumerate(samples):
        cx = sx + i * col_w + col_w // 2
        card_x = sx + i * col_w + 8
        card_w = col_w - 16
        card_top = 175

        d.rounded_rectangle([card_x, card_top, card_x + card_w, H - 30],
                            radius=12, fill=BG_CARD)

        d.text((cx, card_top + 12), f"Edit #{indices[i]}",
               fill=TEXT_W, font=F_MD, anchor="mt")

        # Before (source)
        by = card_top + 55
        d.text((cx - max_img_w // 2 - 30, by), "BEFORE", fill=ACCENT_RED, font=F_XS, anchor="mt")
        d.text((cx + max_img_w // 2 + 30, by), "AFTER", fill=ACCENT_GREEN, font=F_XS, anchor="mt")
        by += 28

        src = fit_image(row["src_screenshot"], max_img_w, max_img_h)
        dst = fit_image(row["dst_screenshot"], max_img_w, max_img_h)

        # Place side by side
        gap = 20
        total_pair_w = src.width + gap + dst.width
        pair_x = cx - total_pair_w // 2

        img.paste(src, (pair_x, by))
        d.rectangle([pair_x - 1, by - 1, pair_x + src.width + 1, by + src.height + 1],
                    outline=ACCENT_RED, width=2)

        img.paste(dst, (pair_x + src.width + gap, by))
        d.rectangle([pair_x + src.width + gap - 1, by - 1,
                    pair_x + src.width + gap + dst.width + 1, by + dst.height + 1],
                    outline=ACCENT_GREEN, width=2)

        # Sizes
        max_h = max(src.height, dst.height)
        d.text((cx, by + max_h + 8),
               f"{row['src_screenshot'].size[0]}x{row['src_screenshot'].size[1]}",
               fill=TEXT_D, font=F_XXS, anchor="mt")

        # Prompt
        prompt = ""
        json_data = row.get("json", {})
        if isinstance(json_data, dict):
            prompt = json_data.get("prompt", "")

        if prompt:
            # Wrap to fit card
            max_chars = 50
            py = by + max_h + 35
            d.text((cx, py), "Edit instruction:", fill=ACCENT_YELLOW, font=F_XS, anchor="mt")
            py += 25
            words = prompt.split()
            lines = []
            current = ""
            for w in words:
                if len(current) + len(w) + 1 > max_chars:
                    lines.append(current)
                    current = w
                else:
                    current = (current + " " + w).strip()
            if current:
                lines.append(current)
            for li, line in enumerate(lines[:6]):
                d.text((card_x + 20, py + li * 20), line,
                       fill=TEXT_M, font=F_XXS)
            if len(lines) > 6:
                d.text((card_x + 20, py + 6 * 20), "...", fill=TEXT_D, font=F_XXS)

    img.save(f"{OUT}/14_real_designbench_edit.png")
    print(f"  14_real_designbench_edit.png ({W}x{H})")


# ═══════════════════════════════════════════════════════════════════════════
# 15. DesignBench Repair — Buggy + Mark + Fixed triples
# ═══════════════════════════════════════════════════════════════════════════

def fetch_designbench_repair():
    print("\nDownloading DesignBench repair=vanilla...")
    ds = hf_datasets.load_dataset(
        "creative-graphic-design/DesignBench",
        "repair=vanilla",
        split="test",
    )
    print(f"  {len(ds)} rows: {ds.column_names}")

    # Pick 3 samples (only 28 total)
    indices = [0, 10, 20]
    samples = [ds[i] for i in indices if i < len(ds)]

    # Save individuals
    sdir = os.path.join(OUT, "real_samples", "designbench_repair")
    os.makedirs(sdir, exist_ok=True)
    for i, row in enumerate(samples):
        row["original_screenshot"].convert("RGB").save(f"{sdir}/repair_{i}_buggy.png")
        row["repaired_screenshot"].convert("RGB").save(f"{sdir}/repair_{i}_fixed.png")
        row["mark_screenshot"].convert("RGB").save(f"{sdir}/repair_{i}_mark.png")

    W, H = 2800, 1500
    max_img_w = 750
    max_img_h = 350
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 35), "Real Dataset: DesignBench — Repair Triples",
           fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 95),
           "28 examples: buggy UI + visual issue markers + repaired UI — real web page screenshots",
           fill=TEXT_M, font=F_SM, anchor="mt")
    d.text((W // 2, 128), "HuggingFace: creative-graphic-design/DesignBench (repair=vanilla)",
           fill=ACCENT_BLUE, font=F_XS, anchor="mt")

    n = len(samples)
    col_w = (W - 80) // n
    sx = 40

    for i, row in enumerate(samples):
        cx = sx + i * col_w + col_w // 2
        card_x = sx + i * col_w + 8
        card_w = col_w - 16
        card_top = 175

        d.rounded_rectangle([card_x, card_top, card_x + card_w, H - 30],
                            radius=12, fill=BG_CARD)

        d.text((cx, card_top + 12), f"Repair #{indices[i]}",
               fill=TEXT_W, font=F_MD, anchor="mt")

        # Three images stacked: buggy → mark → fixed
        triples = [
            ("original_screenshot", "BUGGY (has issues)", ACCENT_RED),
            ("mark_screenshot", "MARKED (issues highlighted)", ACCENT_YELLOW),
            ("repaired_screenshot", "REPAIRED (fixed)", ACCENT_GREEN),
        ]

        y = card_top + 55
        for field, label, color in triples:
            d.text((cx, y), label, fill=color, font=F_XS, anchor="mt")
            y += 26

            fitted = fit_image(row[field], max_img_w, max_img_h)
            px = cx - fitted.width // 2
            img.paste(fitted, (px, y))
            d.rectangle([px - 1, y - 1, px + fitted.width + 1, py + fitted.height + 1
                        if 'py' in dir() else y + fitted.height + 1],
                       outline=color, width=2)
            # Fix: always use current y
            d.rectangle([px - 1, y - 1, px + fitted.width + 1, y + fitted.height + 1],
                       outline=color, width=2)
            y += fitted.height + 15

        # JSON metadata
        json_data = row.get("json", {}) or {}
        if isinstance(json_data, dict):
            code = json_data.get("code", "")
            if code and isinstance(code, str):
                d.text((cx, y + 5), "Has original HTML source",
                       fill=TEXT_D, font=F_XXS, anchor="mt")

    img.save(f"{OUT}/15_real_designbench_repair.png")
    print(f"  15_real_designbench_repair.png ({W}x{H})")


if __name__ == "__main__":
    fetch_gde()
    fetch_designbench_edit()
    fetch_designbench_repair()
    print(f"\nAll real sample images saved to {OUT}/")
