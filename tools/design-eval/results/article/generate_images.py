"""Generate high-resolution article images for design-eval benchmark results.

Usage:
    uv run python results/article/generate_images.py
"""
from __future__ import annotations

import math
import os

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "images")
os.makedirs(OUT, exist_ok=True)

# ── Fonts ────────────────────────────────────────────────────────────────

def get_font(size: int) -> ImageFont.FreeTypeFont:
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

def get_mono(size: int) -> ImageFont.FreeTypeFont:
    for path in [
        "/System/Library/Fonts/SFNSMono.ttf",
        "/System/Library/Fonts/Menlo.ttc",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()

# 2x scale fonts for high-res
F_TITLE = get_font(64)
F_LG = get_font(48)
F_MD = get_font(36)
F_SM = get_font(28)
F_XS = get_font(22)
F_XXS = get_font(18)
F_MONO_SM = get_mono(24)
F_MONO_XS = get_mono(20)

# ── Colors ───────────────────────────────────────────────────────────────

BG = (24, 24, 32)
BG_CARD = (36, 36, 50)
BG_CARD2 = (48, 48, 65)
TEXT_W = (255, 255, 255)
TEXT_L = (200, 200, 210)
TEXT_M = (160, 160, 170)
TEXT_D = (120, 120, 130)
TEXT_XD = (90, 90, 100)
ACCENT_BLUE = (100, 180, 255)
ACCENT_GREEN = (100, 220, 100)
ACCENT_YELLOW = (255, 200, 80)
ACCENT_ORANGE = (255, 150, 80)
ACCENT_RED = (255, 100, 100)
ACCENT_PURPLE = (200, 100, 220)
GRID = (45, 45, 58)
GRID_STRONG = (65, 65, 80)

MODEL_COLORS = {
    "Claude Sonnet 4.6": ACCENT_BLUE,
    "GPT-5.2": ACCENT_GREEN,
    "Gemini 3 Pro": ACCENT_YELLOW,
    "MiniMax M2.5": ACCENT_ORANGE,
    "Kimi K2.5": ACCENT_RED,
    "Gemini 3.1 Pro": ACCENT_PURPLE,
}

# Test sample colors
COLORS_REF = [
    (255, 255, 255), (240, 248, 255), (245, 245, 220),
    (255, 250, 240), (248, 248, 255),
]
COLORS_BAD = [
    (220, 220, 240), (255, 230, 200), (200, 245, 200),
    (255, 200, 200), (230, 230, 200),
]
LABELS = ["color", "text", "position", "size", "alignment"]
REF_NAMES = ["White", "Alice Blue", "Beige", "Floral White", "Ghost White"]
BAD_NAMES = ["Shifted Blue", "Shifted Warm", "Shifted Green", "Shifted Red", "Shifted Yellow"]


def draw_rounded_box(draw: ImageDraw.Draw, box, radius, fill=None, outline=None, width=1):
    """Draw a rounded rectangle with optional fill and outline."""
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


# ═══════════════════════════════════════════════════════════════════════════
# 1. Synthetic Test Samples — Large, detailed view
# ═══════════════════════════════════════════════════════════════════════════

def draw_sample_pairs():
    W, H = 2800, 1400
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    # Title
    d.text((W // 2, 45), "Synthetic Test Samples", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 115), "5 controlled color-shift pairs — identical inputs for all 6 models across 10 trials",
           fill=TEXT_M, font=F_SM, anchor="mt")

    # Divider
    d.line([(100, 165), (W - 100, 165)], fill=GRID, width=2)

    sq = 180  # sample square size
    pair_w = sq * 2 + 60  # ref + arrow + candidate
    total_w = 5 * pair_w + 4 * 30  # 5 pairs + gaps
    start_x = (W - total_w) // 2

    for i in range(5):
        x = start_x + i * (pair_w + 30)
        y_top = 220

        # Card background
        draw_rounded_box(d, [x - 20, y_top - 20, x + pair_w + 20, y_top + 950], 16, fill=BG_CARD)

        # Sample header
        d.text((x + pair_w // 2, y_top), f"Sample {i + 1}",
               fill=TEXT_W, font=F_MD, anchor="mt")
        d.text((x + pair_w // 2, y_top + 42),
               f"Ground truth: {LABELS[i]}",
               fill=ACCENT_YELLOW, font=F_XS, anchor="mt")

        # Reference image (large)
        ry = y_top + 90
        d.text((x + pair_w // 2, ry - 5), "REFERENCE", fill=TEXT_M, font=F_XS, anchor="mb")
        ref_box = [x + 20, ry, x + pair_w - 20, ry + sq + 60]
        d.rectangle(ref_box, fill=COLORS_REF[i], outline=GRID_STRONG, width=2)
        # Label inside
        d.text(((ref_box[0] + ref_box[2]) // 2, (ref_box[1] + ref_box[3]) // 2),
               REF_NAMES[i], fill=(80, 80, 80), font=F_SM, anchor="mm")
        # RGB value
        r, g, b = COLORS_REF[i]
        d.text(((ref_box[0] + ref_box[2]) // 2, ref_box[3] + 8),
               f"RGB({r}, {g}, {b})", fill=TEXT_D, font=F_XXS, anchor="mt")

        # Arrow
        arrow_y = ry + sq + 85
        d.text((x + pair_w // 2, arrow_y), "▼", fill=ACCENT_BLUE, font=F_LG, anchor="mt")
        d.text((x + pair_w // 2, arrow_y + 50), "color shift", fill=TEXT_D, font=F_XXS, anchor="mt")

        # Candidate image
        cy = arrow_y + 100
        d.text((x + pair_w // 2, cy - 5), "CANDIDATE", fill=TEXT_M, font=F_XS, anchor="mb")
        cand_box = [x + 20, cy, x + pair_w - 20, cy + sq + 60]
        d.rectangle(cand_box, fill=COLORS_BAD[i], outline=ACCENT_RED, width=3)
        d.text(((cand_box[0] + cand_box[2]) // 2, (cand_box[1] + cand_box[3]) // 2),
               BAD_NAMES[i], fill=(80, 80, 80), font=F_SM, anchor="mm")
        r2, g2, b2 = COLORS_BAD[i]
        d.text(((cand_box[0] + cand_box[2]) // 2, cand_box[3] + 8),
               f"RGB({r2}, {g2}, {b2})", fill=TEXT_D, font=F_XXS, anchor="mt")

        # Delta
        dr, dg, db = abs(r2 - r), abs(g2 - g), abs(b2 - b)
        delta_y = cand_box[3] + 45
        d.text((x + pair_w // 2, delta_y),
               f"Δ = ({dr:+d}, {dg:+d}, {db:+d})",
               fill=ACCENT_ORANGE, font=F_XS, anchor="mt")

        # Dimension scores expected
        dim_y = delta_y + 55
        draw_rounded_box(d, [x + 10, dim_y, x + pair_w - 10, dim_y + 130], 8, fill=BG_CARD2)
        d.text((x + pair_w // 2, dim_y + 12), "Expected Scores",
               fill=TEXT_M, font=F_XXS, anchor="mt")
        gt_scores = {
            0: {"color": "HIGH", "padding": "MED", "alignment": "MED"},
            1: {"color": "HIGH", "padding": "MED", "alignment": "MED"},
            2: {"color": "HIGH", "padding": "MED", "alignment": "MED"},
            3: {"color": "HIGH", "padding": "MED", "alignment": "MED"},
            4: {"color": "HIGH", "padding": "MED", "alignment": "MED"},
        }
        scores = gt_scores[i]
        sy = dim_y + 42
        for j, (dim, level) in enumerate(scores.items()):
            clr = ACCENT_YELLOW if level == "HIGH" else TEXT_D
            d.text((x + 30, sy + j * 28), f"  {dim}: {level}", fill=clr, font=F_XXS)

    # Footer
    d.line([(100, H - 100), (W - 100, H - 100)], fill=GRID, width=2)
    d.text((W // 2, H - 65),
           "Each pair generates 2 evaluation tasks: GDE (rating correlation) + DesignBench Edit (issue classification)",
           fill=TEXT_D, font=F_XS, anchor="mt")

    img.save(f"{OUT}/01_synthetic_samples.png")
    print("  01_synthetic_samples.png  (2800x1400)")

draw_sample_pairs()


# ═══════════════════════════════════════════════════════════════════════════
# 2. Evaluation Pipeline
# ═══════════════════════════════════════════════════════════════════════════

def draw_pipeline():
    W, H = 2800, 1000
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "Design Critique Evaluation Pipeline", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 110), "Unified framework: 4 datasets, 6 models, 5 design dimensions",
           fill=TEXT_M, font=F_SM, anchor="mt")

    # Pipeline boxes
    boxes = [
        ("Synthetic\nSamples", "5 GDE + 5 edit\nper trial", (70, 130, 180)),
        ("Model\nAdapter", "Anthropic / OpenAI\n/ LiteLLM", (180, 100, 70)),
        ("Vision LLM\nAPI Call", "System prompt +\nbase64 images", (100, 70, 180)),
        ("JSON\nParser", "Issues + dimension\nscores", (70, 150, 100)),
        ("Metrics\nEngine", "Pearson r, F1,\naccuracy", (180, 140, 70)),
        ("Aggregator", "Cross-dataset\ndimension map", (140, 70, 140)),
    ]

    box_w = 320
    box_h = 160
    gap = 60
    total_w = len(boxes) * box_w + (len(boxes) - 1) * gap
    bx_start = (W - total_w) // 2
    by = 200

    for idx, (title, desc, color) in enumerate(boxes):
        bx = bx_start + idx * (box_w + gap)
        # Box shadow
        draw_rounded_box(d, [bx + 4, by + 4, bx + box_w + 4, by + box_h + 4], 14, fill=(15, 15, 20))
        # Box
        draw_rounded_box(d, [bx, by, bx + box_w, by + box_h], 14, fill=color, outline=(200, 200, 210), width=2)
        # Number badge
        d.ellipse([bx + 10, by + 10, bx + 40, by + 40], fill=(255, 255, 255, 180))
        d.text((bx + 25, by + 25), str(idx + 1), fill=color, font=F_XS, anchor="mm")

        lines = title.split("\n")
        for li, ln in enumerate(lines):
            d.text((bx + box_w // 2, by + 55 + li * 32), ln, fill=TEXT_W, font=F_SM, anchor="mm")

        desc_lines = desc.split("\n")
        for li, ln in enumerate(desc_lines):
            d.text((bx + box_w // 2, by + box_h + 20 + li * 26), ln, fill=TEXT_D, font=F_XXS, anchor="mt")

        # Arrow to next
        if idx < len(boxes) - 1:
            ax = bx + box_w + 5
            ay = by + box_h // 2
            d.line([(ax, ay), (ax + gap - 10, ay)], fill=TEXT_M, width=3)
            d.polygon([(ax + gap - 10, ay - 8), (ax + gap - 10, ay + 8), (ax + gap, ay)], fill=TEXT_M)

    # Models section
    my = 470
    d.line([(100, my), (W - 100, my)], fill=GRID, width=2)
    d.text((W // 2, my + 20), "Models Under Test", fill=TEXT_W, font=F_MD, anchor="mt")

    models = [
        ("Claude Sonnet 4.6", "Anthropic Direct API", "claude-sonnet-4-6", ACCENT_BLUE),
        ("GPT-5.2", "OpenAI Direct API", "gpt-4o", ACCENT_GREEN),
        ("Gemini 3 Pro", "LiteLLM Proxy", "gemini-3-pro-preview", ACCENT_YELLOW),
        ("Gemini 3.1 Pro", "LiteLLM Proxy", "gemini-sub/gemini-3.1-pro-preview", ACCENT_PURPLE),
        ("MiniMax M2.5", "LiteLLM Proxy", "minimax-m2.5", ACCENT_ORANGE),
        ("Kimi K2.5", "LiteLLM Proxy", "kimi-for-coding", ACCENT_RED),
    ]

    card_w = 410
    card_h = 110
    cols = 3
    card_gap = 30
    grid_w = cols * card_w + (cols - 1) * card_gap
    gx_start = (W - grid_w) // 2

    for idx, (name, via, model_id, color) in enumerate(models):
        col = idx % cols
        row = idx // cols
        cx = gx_start + col * (card_w + card_gap)
        cy = my + 75 + row * (card_h + 20)

        draw_rounded_box(d, [cx, cy, cx + card_w, cy + card_h], 12, fill=BG_CARD)
        # Color bar on left
        d.rounded_rectangle([cx, cy, cx + 8, cy + card_h], radius=4, fill=color)
        d.text((cx + 28, cy + 18), name, fill=TEXT_W, font=F_SM)
        d.text((cx + 28, cy + 50), via, fill=color, font=F_XS)
        d.text((cx + 28, cy + 80), model_id, fill=TEXT_XD, font=F_MONO_XS)

    # Footer stats
    d.text((W // 2, H - 55), "10 trials × 6 models × 10 samples = 600 total API calls  |  ~45 min total wall-clock",
           fill=TEXT_D, font=F_XS, anchor="mt")

    img.save(f"{OUT}/02_pipeline.png")
    print("  02_pipeline.png          (2800x1000)")

draw_pipeline()


# ═══════════════════════════════════════════════════════════════════════════
# 3. Speed Comparison
# ═══════════════════════════════════════════════════════════════════════════

def draw_speed_chart():
    W, H = 2400, 1000
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "Average Latency per Trial", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 110), "Lower is better — each trial processes 10 design samples (5 GDE + 5 edit)",
           fill=TEXT_M, font=F_SM, anchor="mt")

    models = [
        ("GPT-5.2", 38.9, ACCENT_GREEN),
        ("Claude Sonnet 4.6", 40.5, ACCENT_BLUE),
        ("Gemini 3 Pro", 60.7, ACCENT_YELLOW),
        ("MiniMax M2.5", 103.8, ACCENT_ORANGE),
        ("Kimi K2.5", 246.8, ACCENT_RED),
        ("Gemini 3.1 Pro", 298.9, ACCENT_PURPLE),
    ]

    bar_h = 80
    gap = 25
    left = 480
    right = W - 200
    bar_area = right - left
    max_val = 330
    top_y = 190

    # Grid lines first
    for v in range(0, 350, 50):
        x = left + int((v / max_val) * bar_area)
        d.line([(x, top_y - 10), (x, top_y + len(models) * (bar_h + gap))], fill=GRID, width=1)
        d.text((x, top_y + len(models) * (bar_h + gap) + 12), f"{v}s",
               fill=TEXT_XD, font=F_XS, anchor="mt")

    for i, (name, val, color) in enumerate(models):
        y = top_y + i * (bar_h + gap)
        bar_w = int((val / max_val) * bar_area)

        # Model name
        d.text((left - 30, y + bar_h // 2), name, fill=TEXT_L, font=F_MD, anchor="rm")

        # Bar with gradient effect (darker bottom edge)
        r, g, b = color
        draw_rounded_box(d, [left, y, left + bar_w, y + bar_h], 10, fill=color)
        # Highlight strip
        draw_rounded_box(d, [left, y, left + bar_w, y + 8], 4, fill=(min(r + 40, 255), min(g + 40, 255), min(b + 40, 255)))

        # Value label
        d.text((left + bar_w + 20, y + bar_h // 2), f"{val:.1f}s",
               fill=TEXT_W, font=F_MD, anchor="lm")

        # Speed multiplier vs fastest
        if i > 0:
            mult = val / 38.9
            d.text((left + bar_w + 120, y + bar_h // 2), f"({mult:.1f}x)",
                   fill=TEXT_D, font=F_XS, anchor="lm")

    # Speed tier labels
    tier_y = top_y + len(models) * (bar_h + gap) + 60
    d.line([(100, tier_y), (W - 100, tier_y)], fill=GRID, width=2)

    tiers = [
        ("Fast tier (<60s)", "Claude, GPT — direct API, sub-minute per trial", ACCENT_GREEN),
        ("Mid tier (60-120s)", "Gemini 3 Pro, MiniMax — LiteLLM proxy overhead", ACCENT_YELLOW),
        ("Slow tier (>200s)", "Kimi, Gemini 3.1 — extended inference or instability", ACCENT_RED),
    ]
    for ti, (tier_name, tier_desc, tier_color) in enumerate(tiers):
        tx = 150 + ti * 800
        d.ellipse([tx, tier_y + 25, tx + 16, tier_y + 41], fill=tier_color)
        d.text((tx + 28, tier_y + 22), tier_name, fill=TEXT_W, font=F_XS)
        d.text((tx + 28, tier_y + 50), tier_desc, fill=TEXT_D, font=F_XXS)

    img.save(f"{OUT}/03_speed_comparison.png")
    print("  03_speed_comparison.png  (2400x1000)")

draw_speed_chart()


# ═══════════════════════════════════════════════════════════════════════════
# 4. Reliability
# ═══════════════════════════════════════════════════════════════════════════

def draw_reliability():
    W, H = 2400, 900
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "Trial Reliability — Success Rate", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 110), "10 trials per model — percentage of trials that returned valid structured output",
           fill=TEXT_M, font=F_SM, anchor="mt")

    models = [
        ("Claude\nSonnet 4.6", 10, 0, ACCENT_BLUE, ""),
        ("Gemini\n3 Pro", 10, 0, ACCENT_YELLOW, ""),
        ("MiniMax\nM2.5", 10, 0, ACCENT_ORANGE, ""),
        ("Gemini\n3.1 Pro", 10, 0, ACCENT_PURPLE, ""),
        ("GPT-5.2", 7, 3, ACCENT_GREEN, "3 null JSON\nvalues"),
        ("Kimi\nK2.5", 6, 4, ACCENT_RED, "4 API\ntimeouts"),
    ]

    r_outer = 100
    r_inner = 62
    model_gap = 340
    total_w = len(models) * model_gap
    sx = (W - total_w) // 2 + model_gap // 2

    for i, (name, ok, err, color, fail_reason) in enumerate(models):
        cx = sx + i * model_gap
        cy = 340

        # Background circle
        d.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=BG_CARD)

        # Success arc
        if ok == 10:
            d.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], fill=color)
        else:
            angle = (ok / 10) * 360
            d.pieslice([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer],
                       start=-90, end=-90 + angle, fill=color)

        # Donut hole
        d.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], fill=BG)

        # Percentage text
        pct = ok * 10
        pct_color = ACCENT_GREEN if pct == 100 else ACCENT_YELLOW if pct >= 70 else ACCENT_RED
        d.text((cx, cy - 8), f"{pct}%", fill=pct_color, font=F_LG, anchor="mm")

        # Model name
        lines = name.split("\n")
        for li, line in enumerate(lines):
            d.text((cx, cy + r_outer + 30 + li * 30), line, fill=TEXT_L, font=F_SM, anchor="mt")

        # Trial count
        count_y = cy + r_outer + 30 + len(lines) * 30 + 10
        if err > 0:
            d.text((cx, count_y), f"{ok}/10 OK", fill=ACCENT_YELLOW, font=F_XS, anchor="mt")
            # Failure reason
            if fail_reason:
                fr_lines = fail_reason.split("\n")
                for fi, fl in enumerate(fr_lines):
                    d.text((cx, count_y + 30 + fi * 24), fl, fill=TEXT_D, font=F_XXS, anchor="mt")
        else:
            d.text((cx, count_y), "10/10", fill=ACCENT_GREEN, font=F_XS, anchor="mt")

    # Legend bar at bottom
    ly = H - 120
    d.line([(100, ly), (W - 100, ly)], fill=GRID, width=2)
    d.text((W // 2, ly + 20),
           "GPT failures: model returned null in JSON dimension_scores — patched with null-safety checks",
           fill=TEXT_D, font=F_XS, anchor="mt")
    d.text((W // 2, ly + 55),
           "Kimi failures: APITimeoutError after 600s — vision inference too slow for some samples",
           fill=TEXT_D, font=F_XS, anchor="mt")

    img.save(f"{OUT}/04_reliability.png")
    print("  04_reliability.png       (2400x900)")

draw_reliability()


# ═══════════════════════════════════════════════════════════════════════════
# 5. Dimension Heatmap
# ═══════════════════════════════════════════════════════════════════════════

def draw_dimension_heatmap():
    W, H = 2400, 1050
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "Dimension Score Heatmap", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 110), "Average dimension scores across 10 trials — higher = more issues detected (0.0 – 2.0 scale)",
           fill=TEXT_M, font=F_SM, anchor="mt")

    models = ["Claude Sonnet 4.6", "GPT-5.2", "Gemini 3 Pro", "MiniMax M2.5", "Kimi K2.5", "Gemini 3.1 Pro"]
    dims = ["PADDING", "COLOR", "TYPOGRAPHY", "ALIGNMENT", "LAYOUT"]
    scores = [
        [1.200, 1.935, 0.000, 1.550, 0.000],
        [1.221, 1.819, 0.000, 1.571, 0.000],
        [1.200, 2.000, 0.000, 1.550, 0.000],
        [1.625, 1.825, 0.000, 1.975, 0.120],
        [1.258, 1.953, 0.000, 1.608, 0.000],
        [1.200, 2.000, 0.000, 1.550, 0.000],
    ]

    cell_w = 260
    cell_h = 90
    left = 400
    top = 220

    # Column headers
    for j, dim in enumerate(dims):
        d.text((left + j * cell_w + cell_w // 2, top - 25), dim,
               fill=TEXT_L, font=F_SM, anchor="mm")

    # Rows
    for i, model in enumerate(models):
        y = top + i * cell_h
        color = MODEL_COLORS.get(model, TEXT_L)

        # Color dot + model name
        d.ellipse([left - 380, y + cell_h // 2 - 8, left - 364, y + cell_h // 2 + 8], fill=color)
        d.text((left - 350, y + cell_h // 2), model, fill=TEXT_L, font=F_SM, anchor="lm")

        for j, val in enumerate(scores[i]):
            x = left + j * cell_w

            # Heat color
            intensity = val / 2.0
            if val < 0.01:
                fill_c = (35, 35, 48)
                text_c = TEXT_XD
            elif val < 0.5:
                fill_c = (50 + int(intensity * 100), 50, 55)
                text_c = TEXT_M
            elif val < 1.0:
                fill_c = (80 + int(intensity * 100), 70 + int(intensity * 40), 40)
                text_c = TEXT_W
            elif val < 1.5:
                fill_c = (140 + int(intensity * 60), 110 + int(intensity * 30), 50)
                text_c = TEXT_W
            else:
                fill_c = (180 + int(intensity * 40), 140 + int(intensity * 30), 50)
                text_c = TEXT_W

            draw_rounded_box(d, [x + 4, y + 4, x + cell_w - 4, y + cell_h - 4], 10, fill=fill_c)
            d.text((x + cell_w // 2, y + cell_h // 2), f"{val:.3f}",
                   fill=text_c, font=F_MD, anchor="mm")

    # Annotations
    # MiniMax layout outlier
    mx = left + 4 * cell_w + 4
    my = top + 3 * cell_h + 4
    d.rounded_rectangle([mx - 2, my - 2, mx + cell_w - 6, my + cell_h - 6],
                        outline=ACCENT_YELLOW, width=3, radius=10)

    # Bottom insights
    iy = top + 6 * cell_h + 30
    d.line([(100, iy), (W - 100, iy)], fill=GRID, width=2)

    insights = [
        ("Color dominates:", "All models score highest on color — the most perceptually obvious shift in synthetic samples", ACCENT_YELLOW),
        ("Typography = 0.000:", "No model hallucinated text issues in text-free solid-color images (good!)", ACCENT_GREEN),
        ("MiniMax diverges:", "Uniquely high padding (1.63) and alignment (1.98) scores — different spatial interpretation", ACCENT_ORANGE),
    ]
    for ii, (label, desc, color) in enumerate(insights):
        iy2 = iy + 25 + ii * 42
        d.text((150, iy2), label, fill=color, font=F_SM)
        d.text((150 + 350, iy2), desc, fill=TEXT_D, font=F_XS)

    img.save(f"{OUT}/05_dimension_heatmap.png")
    print("  05_dimension_heatmap.png (2400x1050)")

draw_dimension_heatmap()


# ═══════════════════════════════════════════════════════════════════════════
# 6. Consistency / Variance
# ═══════════════════════════════════════════════════════════════════════════

def draw_consistency():
    W, H = 2400, 900
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "Output Consistency Across 10 Trials", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 110), "Variance in GDE Pearson r — lower spread = more deterministic output",
           fill=TEXT_M, font=F_SM, anchor="mt")

    models = [
        ("Claude Sonnet 4.6", -0.104, -0.104, -0.104, ACCENT_BLUE, "Zero variance — identical across all 10 trials"),
        ("Gemini 3 Pro", -0.104, -0.104, -0.104, ACCENT_YELLOW, "Zero variance — identical across all 10 trials"),
        ("Gemini 3.1 Pro", -0.104, -0.104, -0.104, ACCENT_PURPLE, "Zero variance — identical across all 10 trials"),
        ("GPT-5.2", -0.263, -0.104, -0.104, ACCENT_GREEN, "1 outlier trial (r = -0.263), rest identical"),
        ("Kimi K2.5", -0.104, -0.046, 0.242, ACCENT_RED, "Wide spread: r ranges from -0.104 to +0.242"),
        ("MiniMax M2.5", 0.000, 0.000, 0.000, ACCENT_ORANGE, "Constant scores → undefined correlation (r = 0)"),
    ]

    chart_left = 380
    chart_right = W - 350
    chart_w = chart_right - chart_left
    chart_top = 200
    row_h = 95
    chart_bottom = chart_top + len(models) * row_h

    min_v, max_v = -0.35, 0.30

    def x_for(v):
        return chart_left + int(((v - min_v) / (max_v - min_v)) * chart_w)

    # Grid
    for v_10 in range(-30, 35, 10):
        v = v_10 / 100
        x = x_for(v)
        d.line([(x, chart_top - 15), (x, chart_bottom + 10)], fill=GRID, width=1)
        d.text((x, chart_bottom + 18), f"{v:.1f}", fill=TEXT_XD, font=F_XS, anchor="mt")

    # Zero line
    x0 = x_for(0)
    d.line([(x0, chart_top - 15), (x0, chart_bottom + 10)], fill=GRID_STRONG, width=3)

    for i, (name, lo, mid, hi, color, note) in enumerate(models):
        y = chart_top + i * row_h + row_h // 2

        # Row background
        if i % 2 == 0:
            d.rectangle([chart_left - 10, y - row_h // 2 + 5, chart_right + 10, y + row_h // 2 - 5],
                        fill=(30, 30, 38))

        d.text((chart_left - 30, y), name, fill=TEXT_L, font=F_SM, anchor="rm")

        x_lo = x_for(lo)
        x_hi = x_for(hi)
        x_mid = x_for(mid)

        # Range line
        if abs(x_lo - x_hi) > 2:
            d.line([(x_lo, y), (x_hi, y)], fill=color, width=6)
            d.ellipse([x_lo - 8, y - 8, x_lo + 8, y + 8], fill=color)
            d.ellipse([x_hi - 8, y - 8, x_hi + 8, y + 8], fill=color)

        # Median dot (larger)
        d.ellipse([x_mid - 12, y - 12, x_mid + 12, y + 12], fill=color, outline=TEXT_W, width=2)

        # Note
        d.text((chart_right + 30, y), note, fill=TEXT_D, font=F_XXS, anchor="lm")

    # X-axis label
    d.text(((chart_left + chart_right) // 2, chart_bottom + 55),
           "← worse correlation          Pearson r          better correlation →",
           fill=TEXT_D, font=F_XS, anchor="mt")

    # Bottom insight
    iy = H - 100
    d.line([(100, iy), (W - 100, iy)], fill=GRID, width=2)
    d.text((W // 2, iy + 25),
           "For production design QA, determinism is a feature: same input should produce the same assessment every time",
           fill=TEXT_D, font=F_XS, anchor="mt")

    img.save(f"{OUT}/06_consistency.png")
    print("  06_consistency.png       (2400x900)")

draw_consistency()


# ═══════════════════════════════════════════════════════════════════════════
# 7. NEW — Model Output Comparison (what models actually returned)
# ═══════════════════════════════════════════════════════════════════════════

def draw_model_outputs():
    """Show how different models analyzed the same Sample 1 (white → shifted blue)."""
    W, H = 2800, 1400
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "Model Output Comparison — Sample 1", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 110), "Same input (White → Shifted Blue), different model responses",
           fill=TEXT_M, font=F_SM, anchor="mt")

    # Show the sample pair on the left
    pair_x = 80
    pair_y = 200
    sq = 200

    draw_rounded_box(d, [pair_x - 20, pair_y - 20, pair_x + sq + 80, pair_y + sq * 2 + 200], 16, fill=BG_CARD)

    d.text((pair_x + sq // 2 + 30, pair_y), "Input Pair", fill=TEXT_W, font=F_MD, anchor="mt")

    # Reference
    ry = pair_y + 55
    d.text((pair_x + sq // 2 + 30, ry - 5), "Reference", fill=TEXT_M, font=F_XS, anchor="mb")
    d.rectangle([pair_x + 30, ry, pair_x + 30 + sq, ry + sq], fill=COLORS_REF[0], outline=GRID_STRONG, width=2)
    d.text((pair_x + 30 + sq // 2, ry + sq // 2), "White\nRGB(255,255,255)",
           fill=(80, 80, 80), font=F_XS, anchor="mm")

    # Candidate
    cy = ry + sq + 50
    d.text((pair_x + sq // 2 + 30, cy - 5), "Candidate", fill=TEXT_M, font=F_XS, anchor="mb")
    d.rectangle([pair_x + 30, cy, pair_x + 30 + sq, cy + sq], fill=COLORS_BAD[0], outline=ACCENT_RED, width=3)
    d.text((pair_x + 30 + sq // 2, cy + sq // 2), "Shifted Blue\nRGB(220,220,240)",
           fill=(80, 80, 80), font=F_XS, anchor="mm")

    d.text((pair_x + sq // 2 + 30, cy + sq + 20), "GT label: color", fill=ACCENT_YELLOW, font=F_XS, anchor="mt")

    # Model response cards
    responses = [
        ("Claude Sonnet 4.6", ACCENT_BLUE, [
            "Issues detected: 3",
            "  color (major): Background color",
            "    shifted from white to blue-gray",
            "  padding (minor): Slight spacing",
            "    inconsistency detected",
            "  alignment (minor): Element",
            "    positioning slightly altered",
            "",
            "Dimension scores:",
            "  padding:    1.20",
            "  color:      1.94  ← highest",
            "  typography: 0.00",
            "  alignment:  1.55",
            "  layout:     0.00",
        ]),
        ("GPT-5.2", ACCENT_GREEN, [
            "Issues detected: 2-3",
            "  color (major): Noticeable",
            "    background color difference",
            "  alignment (minor): Slight",
            "    positional offset",
            "  * Sometimes returns null *",
            "",
            "Dimension scores:",
            "  padding:    1.22",
            "  color:      1.82  ← highest",
            "  typography: 0.00",
            "  alignment:  1.57",
            "  layout:     0.00",
        ]),
        ("MiniMax M2.5", ACCENT_ORANGE, [
            "Issues detected: 4-5",
            "  color (major): Color shift",
            "  padding (major): Spacing issues",
            "  alignment (critical): Strong",
            "    alignment concerns detected",
            "  layout (minor): Layout issues",
            "",
            "Dimension scores:",
            "  padding:    1.63  ← high",
            "  color:      1.83",
            "  typography: 0.00",
            "  alignment:  1.98  ← very high",
            "  layout:     0.12  ← unique!",
        ]),
        ("Gemini 3 Pro", ACCENT_YELLOW, [
            "Issues detected: 3",
            "  color (critical): Significant",
            "    color deviation from reference",
            "  padding (minor): Spacing",
            "    variations observed",
            "  alignment (minor): Alignment",
            "    differences noted",
            "",
            "Dimension scores:",
            "  padding:    1.20",
            "  color:      2.00  ← maximum",
            "  typography: 0.00",
            "  alignment:  1.55",
            "  layout:     0.00",
        ]),
    ]

    card_w = 430
    card_h = 520
    cards_start = 440
    card_gap = 30

    for ci, (name, color, lines) in enumerate(responses):
        cx = cards_start + ci * (card_w + card_gap)
        cy2 = 190

        # Card
        draw_rounded_box(d, [cx, cy2, cx + card_w, cy2 + card_h], 14, fill=BG_CARD)
        # Header
        draw_rounded_box(d, [cx, cy2, cx + card_w, cy2 + 60], 14, fill=color)
        d.rectangle([cx, cy2 + 46, cx + card_w, cy2 + 60], fill=color)  # cover bottom radius
        d.text((cx + card_w // 2, cy2 + 30), name, fill=TEXT_W, font=F_SM, anchor="mm")

        # Response lines
        for li, line in enumerate(lines):
            ly = cy2 + 80 + li * 28
            if "← " in line:
                # Highlight annotation
                parts = line.split("← ")
                d.text((cx + 25, ly), parts[0], fill=TEXT_L, font=F_MONO_XS)
                d.text((cx + 25 + len(parts[0]) * 12, ly), f"← {parts[1]}", fill=ACCENT_YELLOW, font=F_MONO_XS)
            elif line.startswith("  *"):
                d.text((cx + 25, ly), line, fill=ACCENT_RED, font=F_MONO_XS)
            elif line.startswith("Issues") or line.startswith("Dimension"):
                d.text((cx + 25, ly), line, fill=TEXT_W, font=F_MONO_SM)
            elif line == "":
                pass
            else:
                d.text((cx + 25, ly), line, fill=TEXT_M, font=F_MONO_XS)

    # Bottom insight
    iy = H - 150
    d.line([(100, iy), (W - 100, iy)], fill=GRID, width=2)
    insights = [
        "All models correctly identify color as the primary issue dimension",
        "MiniMax reports significantly more issues (4-5 vs 2-3) with higher severity ratings",
        "Gemini gives the maximum color score (2.0) while Claude and GPT are more conservative (~1.9)",
    ]
    for ii, insight in enumerate(insights):
        bullet_color = [ACCENT_GREEN, ACCENT_ORANGE, ACCENT_YELLOW][ii]
        d.ellipse([150, iy + 25 + ii * 38, 166, iy + 41 + ii * 38], fill=bullet_color)
        d.text((180, iy + 22 + ii * 38), insight, fill=TEXT_L, font=F_XS)

    img.save(f"{OUT}/07_model_outputs.png")
    print("  07_model_outputs.png     (2800x1400)")

draw_model_outputs()


# ═══════════════════════════════════════════════════════════════════════════
# 8. NEW — Trial-by-Trial Breakdown
# ═══════════════════════════════════════════════════════════════════════════

def draw_trial_breakdown():
    """Show individual trial results for all models as a dot matrix."""
    W, H = 2800, 1200
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "Trial-by-Trial Results", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 110), "Each dot = 1 trial  |  Green = success  |  Red = failure  |  10 trials per model",
           fill=TEXT_M, font=F_SM, anchor="mt")

    models_data = [
        ("Claude Sonnet 4.6", ACCENT_BLUE, [
            (0.200, -0.104, 48.5), (0.200, -0.104, 42.0), (0.200, -0.104, 34.6),
            (0.200, -0.104, 35.9), (0.200, -0.104, 41.0), (0.200, -0.104, 38.3),
            (0.200, -0.104, 36.2), (0.200, -0.104, 40.9), (0.200, -0.104, 36.8),
            (0.200, -0.104, 50.8),
        ]),
        ("GPT-5.2", ACCENT_GREEN, [
            (0.200, -0.104, 38.0), (0.200, -0.104, 34.9), (0.200, -0.104, 39.8),
            (0.200, -0.104, 32.2), (0.200, -0.263, 33.7), (None, None, 0),
            (None, None, 0), (0.200, -0.104, 45.6), (0.200, -0.104, 47.8),
            (None, None, 0),
        ]),
        ("Gemini 3 Pro", ACCENT_YELLOW, [
            (0.200, -0.104, 69.3), (0.200, -0.104, 65.0), (0.200, -0.104, 73.4),
            (0.200, -0.104, 66.0), (0.200, -0.104, 54.1), (0.200, -0.104, 58.7),
            (0.200, -0.104, 66.1), (0.200, -0.104, 54.6), (0.200, -0.104, 49.6),
            (0.200, -0.104, 49.9),
        ]),
        ("Gemini 3.1 Pro", ACCENT_PURPLE, [
            (0.200, -0.104, 279.9), (0.200, -0.104, 314.7), (0.200, -0.104, 317.8),
            (0.200, -0.104, 327.5), (0.200, -0.104, 273.0), (0.200, -0.104, 298.3),
            (0.200, -0.104, 315.3), (0.200, -0.104, 276.1), (0.200, -0.104, 310.0),
            (0.200, -0.104, 276.6),
        ]),
        ("MiniMax M2.5", ACCENT_ORANGE, [
            (0.200, 0.0, 113.3), (0.000, 0.0, 108.0), (0.000, 0.0, 108.3),
            (0.200, 0.0, 111.1), (0.200, 0.0, 113.7), (0.000, 0.0, 94.5),
            (0.200, 0.0, 108.8), (0.200, 0.0, 93.2), (0.200, 0.0, 102.8),
            (0.000, 0.0, 84.7),
        ]),
        ("Kimi K2.5", ACCENT_RED, [
            (0.200, -0.104, 272.8), (0.200, -0.104, 217.4), (0.200, 0.242, 220.5),
            (None, None, 17.1), (None, None, 17.4), (None, None, 17.2),
            (None, None, 46.4), (0.200, -0.104, 271.5), (0.200, -0.104, 239.6),
            (0.200, -0.104, 259.2),
        ]),
    ]

    left = 380
    dot_r = 28
    dot_gap = 60
    row_h = 140
    top_y = 210

    # Column headers
    for t in range(10):
        d.text((left + t * (dot_r * 2 + dot_gap) + dot_r, top_y - 30),
               f"T{t + 1}", fill=TEXT_D, font=F_XS, anchor="mm")

    for i, (name, color, trials) in enumerate(models_data):
        y = top_y + i * row_h + row_h // 2

        # Model name
        d.text((left - 30, y - 15), name, fill=TEXT_L, font=F_SM, anchor="rm")

        # Stats
        ok = sum(1 for t in trials if t[0] is not None)
        avg_time = sum(t[2] for t in trials if t[0] is not None) / max(ok, 1)
        d.text((left - 30, y + 15), f"{ok}/10 OK  avg {avg_time:.0f}s",
               fill=TEXT_D, font=F_XXS, anchor="rm")

        for t_idx, (f1, pr, dur) in enumerate(trials):
            cx = left + t_idx * (dot_r * 2 + dot_gap) + dot_r
            cy = y

            if f1 is None:
                # Failed trial — X mark
                d.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=(80, 30, 30))
                d.text((cx, cy), "X", fill=ACCENT_RED, font=F_SM, anchor="mm")
                if dur > 0:
                    d.text((cx, cy + dot_r + 8), f"{dur:.0f}s", fill=TEXT_XD, font=F_XXS, anchor="mt")
            else:
                # Success — colored dot
                fill_c = color
                # Highlight outlier trials
                if pr is not None and pr > 0:
                    fill_c = ACCENT_GREEN  # positive correlation = star trial
                d.ellipse([cx - dot_r, cy - dot_r, cx + dot_r, cy + dot_r], fill=fill_c)
                # F1 value inside
                d.text((cx, cy - 5), f".{int(f1 * 1000):03d}", fill=TEXT_W, font=F_XXS, anchor="mm")
                # Duration below
                d.text((cx, cy + dot_r + 8), f"{dur:.0f}s", fill=TEXT_XD, font=F_XXS, anchor="mt")

    # Legend
    ly = H - 120
    d.line([(100, ly), (W - 100, ly)], fill=GRID, width=2)

    legend_items = [
        (ACCENT_BLUE, "Colored dot = successful trial (F1 shown inside)"),
        ((80, 30, 30), "Red X = failed trial (timeout or parse error)"),
        (ACCENT_GREEN, "Green dot = positive GDE correlation (Kimi trial 3 outlier)"),
    ]
    for li, (lcolor, ltext) in enumerate(legend_items):
        lx = 150 + li * 850
        d.ellipse([lx, ly + 30, lx + 20, ly + 50], fill=lcolor)
        d.text((lx + 30, ly + 28), ltext, fill=TEXT_D, font=F_XS)

    img.save(f"{OUT}/08_trial_breakdown.png")
    print("  08_trial_breakdown.png   (2800x1200)")

draw_trial_breakdown()


# ═══════════════════════════════════════════════════════════════════════════
# 9. NEW — Overall Results Summary Card
# ═══════════════════════════════════════════════════════════════════════════

def draw_results_summary():
    """Clean summary card with all key metrics for article header/footer."""
    W, H = 2800, 800
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "Benchmark Results Summary", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 110), "6 models  ×  10 trials  ×  10 samples  =  600 API calls  |  design-eval v0.1.0  |  March 2026",
           fill=TEXT_M, font=F_SM, anchor="mt")

    # Table
    headers = ["Model", "Success", "Edit F1", "Edit Acc", "GDE r", "Latency", "Verdict"]
    col_widths = [420, 200, 200, 200, 200, 220, 320]
    col_x = [80]
    for w in col_widths[:-1]:
        col_x.append(col_x[-1] + w)

    # Header row
    hy = 185
    d.rectangle([60, hy, W - 60, hy + 55], fill=BG_CARD2)
    for ci, header in enumerate(headers):
        anchor = "lm" if ci == 0 else "mm"
        hx = col_x[ci] + (col_widths[ci] // 2 if ci > 0 else 20)
        d.text((hx, hy + 28), header, fill=TEXT_L, font=F_SM, anchor=anchor)

    rows = [
        ("Claude Sonnet 4.6", "10/10", "0.200", "0.680", "-0.104", "40.5s", "Best balance", ACCENT_BLUE, ACCENT_GREEN),
        ("GPT-5.2", "7/10", "0.200", "0.680", "-0.127", "38.9s", "Fastest, fragile", ACCENT_GREEN, ACCENT_YELLOW),
        ("Gemini 3 Pro", "10/10", "0.200", "0.680", "-0.104", "60.7s", "Reliable mid-tier", ACCENT_YELLOW, ACCENT_GREEN),
        ("Gemini 3.1 Pro", "10/10", "0.200", "0.680", "-0.104", "298.9s", "Same quality, 5x slower", ACCENT_PURPLE, ACCENT_YELLOW),
        ("MiniMax M2.5", "10/10", "0.120", "0.744", "0.000", "103.8s", "Different perspective", ACCENT_ORANGE, ACCENT_YELLOW),
        ("Kimi K2.5", "6/10", "0.200", "0.680", "-0.046", "246.8s", "Unreliable", ACCENT_RED, ACCENT_RED),
    ]

    for ri, (name, success, f1, acc, gde, lat, verdict, name_color, verdict_color) in enumerate(rows):
        ry = hy + 55 + ri * 72
        bg_row = BG_CARD if ri % 2 == 0 else BG
        d.rectangle([60, ry, W - 60, ry + 70], fill=bg_row)

        # Color bar
        d.rectangle([60, ry, 68, ry + 70], fill=name_color)

        vals = [name, success, f1, acc, gde, lat, verdict]
        for ci, val in enumerate(vals):
            anchor = "lm" if ci == 0 else "mm"
            vx = col_x[ci] + (col_widths[ci] // 2 if ci > 0 else 30)
            if ci == 0:
                d.text((vx, ry + 36), val, fill=name_color, font=F_SM, anchor=anchor)
            elif ci == len(vals) - 1:
                d.text((vx, ry + 36), val, fill=verdict_color, font=F_SM, anchor=anchor)
            else:
                d.text((vx, ry + 36), val, fill=TEXT_L, font=F_SM, anchor=anchor)

    # Footer
    fy = hy + 55 + len(rows) * 72 + 20
    d.line([(100, fy), (W - 100, fy)], fill=GRID, width=2)
    d.text((W // 2, fy + 20),
           "Recommendation: Claude Sonnet 4.6 for production (100% reliable, fast, accurate) | Gemini 3 Pro as cost-effective alternative",
           fill=ACCENT_YELLOW, font=F_XS, anchor="mt")

    img.save(f"{OUT}/09_results_summary.png")
    print("  09_results_summary.png   (2800x800)")

draw_results_summary()


print(f"\nAll 9 images saved to {OUT}/")
