"""Generate actual test sample images and API payload visualizations.

Saves the real 300x200px images that were sent to each model,
plus composites showing what the full API call looked like.

Usage:
    uv run python results/article/generate_test_examples.py
"""
from __future__ import annotations

import os
import textwrap

from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), "images")
os.makedirs(OUT, exist_ok=True)

# ── Fonts ────────────────────────────────────────────────────────────────

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
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ]:
        try:
            return ImageFont.truetype(path, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()

F_TITLE = get_font(64)
F_LG = get_font(48)
F_MD = get_font(36)
F_SM = get_font(28)
F_XS = get_font(22)
F_XXS = get_font(18)
F_MONO = get_mono(22)
F_MONO_SM = get_mono(18)
F_MONO_LG = get_mono(26)

BG = (24, 24, 32)
BG_CARD = (36, 36, 50)
BG_CARD2 = (48, 48, 65)
BG_CODE = (20, 20, 28)
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

# ── Test sample data ─────────────────────────────────────────────────────

COLORS_REF = [
    (255, 255, 255), (240, 248, 255), (245, 245, 220),
    (255, 250, 240), (248, 248, 255),
]
COLORS_BAD = [
    (220, 220, 240), (255, 230, 200), (200, 245, 200),
    (255, 200, 200), (230, 230, 200),
]
REF_NAMES = ["White", "Alice Blue", "Beige", "Floral White", "Ghost White"]
BAD_NAMES = ["Shifted Blue", "Shifted Warm", "Shifted Green", "Shifted Red", "Shifted Yellow"]
LABELS = ["color", "text", "position", "size", "alignment"]


# ═══════════════════════════════════════════════════════════════════════════
# 10. Save individual test sample PNGs (actual 300x200 images)
# ═══════════════════════════════════════════════════════════════════════════

def save_individual_samples():
    """Save each actual test sample as a standalone image — these are
    the exact images (at original size) that were sent to the models."""
    samples_dir = os.path.join(OUT, "test_samples")
    os.makedirs(samples_dir, exist_ok=True)

    for i in range(5):
        ref = Image.new("RGB", (300, 200), COLORS_REF[i])
        bad = Image.new("RGB", (300, 200), COLORS_BAD[i])
        ref.save(f"{samples_dir}/sample_{i+1}_reference.png")
        bad.save(f"{samples_dir}/sample_{i+1}_candidate.png")

    print(f"  Saved 10 individual test samples to {samples_dir}/")

save_individual_samples()


# ═══════════════════════════════════════════════════════════════════════════
# 11. GDE Protocol — what the model sees (reference + candidate + prompt)
# ═══════════════════════════════════════════════════════════════════════════

def draw_gde_protocol():
    """Show the full GDE evaluation: reference + candidate → model → dimension scores."""
    W, H = 2800, 1500
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "GDE Protocol — What the Model Sees", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 110), "GraphicDesignEvaluation: model rates quality on 5 dimensions, we measure correlation with human raters",
           fill=TEXT_M, font=F_SM, anchor="mt")

    # ── Left side: the actual images ──
    left_x = 80
    section_w = 800

    d.text((left_x + section_w // 2, 180), "Input Images (actual size: 300x200)", fill=TEXT_L, font=F_MD, anchor="mt")

    # Sample 1 — show full-size images
    scale = 2  # show at 2x for visibility (600x400)
    img_w, img_h = 300 * scale, 200 * scale

    # Reference
    ry = 260
    d.text((left_x + 30, ry), "1. Reference design (correct/target):", fill=ACCENT_BLUE, font=F_SM)
    ref_img = Image.new("RGB", (img_w, img_h), COLORS_REF[0])
    img.paste(ref_img, (left_x + 30, ry + 40))
    # Border
    d.rectangle([left_x + 29, ry + 39, left_x + 31 + img_w, ry + 41 + img_h], outline=GRID, width=2)
    d.text((left_x + 35 + img_w, ry + 40), f"  {REF_NAMES[0]}", fill=TEXT_D, font=F_XS)
    d.text((left_x + 35 + img_w, ry + 70), f"  RGB{COLORS_REF[0]}", fill=TEXT_XD, font=F_MONO_SM)
    d.text((left_x + 35 + img_w, ry + 100), "  300 x 200 px", fill=TEXT_XD, font=F_MONO_SM)

    # Candidate
    cy = ry + img_h + 80
    d.text((left_x + 30, cy), "2. Candidate design (to evaluate):", fill=ACCENT_RED, font=F_SM)
    bad_img = Image.new("RGB", (img_w, img_h), COLORS_BAD[0])
    img.paste(bad_img, (left_x + 30, cy + 40))
    d.rectangle([left_x + 29, cy + 39, left_x + 31 + img_w, cy + 41 + img_h], outline=ACCENT_RED, width=3)
    d.text((left_x + 35 + img_w, cy + 40), f"  {BAD_NAMES[0]}", fill=TEXT_D, font=F_XS)
    d.text((left_x + 35 + img_w, cy + 70), f"  RGB{COLORS_BAD[0]}", fill=TEXT_XD, font=F_MONO_SM)

    # Delta
    r1, g1, b1 = COLORS_REF[0]
    r2, g2, b2 = COLORS_BAD[0]
    d.text((left_x + 35 + img_w, cy + 110),
           f"  Delta: R={abs(r2-r1):+d}  G={abs(g2-g1):+d}  B={abs(b2-b1):+d}",
           fill=ACCENT_ORANGE, font=F_MONO_SM)

    # ── Right side: system prompt + expected output ──
    right_x = 950
    code_w = W - right_x - 80

    d.text((right_x + code_w // 2, 180), "System Prompt + Expected JSON Response", fill=TEXT_L, font=F_MD, anchor="mt")

    # System prompt box
    prompt_y = 260
    prompt_h = 420
    d.rounded_rectangle([right_x, prompt_y, right_x + code_w, prompt_y + prompt_h],
                        radius=12, fill=BG_CODE, outline=GRID, width=2)

    # Prompt header
    d.rounded_rectangle([right_x, prompt_y, right_x + code_w, prompt_y + 40],
                        radius=12, fill=(40, 40, 55))
    d.rectangle([right_x, prompt_y + 28, right_x + code_w, prompt_y + 40], fill=(40, 40, 55))
    d.text((right_x + 20, prompt_y + 12), "system_prompt", fill=ACCENT_GREEN, font=F_MONO_SM)

    prompt_lines = [
        'You are a design critique expert.',
        'Analyze the provided design screenshot(s)',
        'and identify any visual design issues.',
        '',
        'For each issue found, provide:',
        '- category: one of "padding", "color",',
        '  "typography", "alignment", "layout"',
        '- severity: "critical" | "major" | "minor"',
        '- description: brief explanation',
        '- confidence: 0.0 to 1.0',
        '',
        'Also provide overall dimension scores',
        '(0.0 to 1.0) for each category.',
        '',
        'Respond in JSON format only, no markdown.',
    ]
    for li, line in enumerate(prompt_lines):
        d.text((right_x + 20, prompt_y + 55 + li * 24), line, fill=TEXT_M, font=F_MONO_SM)

    # Expected JSON response
    json_y = prompt_y + prompt_h + 30
    json_h = 620
    d.rounded_rectangle([right_x, json_y, right_x + code_w, json_y + json_h],
                        radius=12, fill=BG_CODE, outline=ACCENT_YELLOW, width=2)

    d.rounded_rectangle([right_x, json_y, right_x + code_w, json_y + 40],
                        radius=12, fill=(50, 45, 30))
    d.rectangle([right_x, json_y + 28, right_x + code_w, json_y + 40], fill=(50, 45, 30))
    d.text((right_x + 20, json_y + 12), "model_response.json (Claude Sonnet 4.6, Trial 1)", fill=ACCENT_YELLOW, font=F_MONO_SM)

    json_lines = [
        ('{', TEXT_M),
        ('  "issues": [', TEXT_M),
        ('    {', TEXT_M),
        ('      "category": "color",', ACCENT_YELLOW),
        ('      "severity": "major",', ACCENT_ORANGE),
        ('      "description": "Background color', TEXT_L),
        ('        shifted from white to blue-gray",', TEXT_L),
        ('      "confidence": 0.92', ACCENT_GREEN),
        ('    },', TEXT_M),
        ('    {', TEXT_M),
        ('      "category": "padding",', ACCENT_YELLOW),
        ('      "severity": "minor",', TEXT_M),
        ('      "description": "Spacing", "confidence": 0.6', TEXT_D),
        ('    }', TEXT_M),
        ('  ],', TEXT_M),
        ('  "dimension_scores": {', TEXT_M),
        ('    "padding":    0.60,', TEXT_L),
        ('    "color":      0.97,  // highest', ACCENT_YELLOW),
        ('    "typography": 0.00,  // no text present', TEXT_D),
        ('    "alignment":  0.78,', TEXT_L),
        ('    "layout":     0.00', TEXT_D),
        ('  }', TEXT_M),
        ('}', TEXT_M),
    ]
    for li, (line, color) in enumerate(json_lines):
        d.text((right_x + 20, json_y + 55 + li * 24), line, fill=color, font=F_MONO_SM)

    # Ground truth comparison at bottom-left
    gt_y = cy + img_h + 80
    d.rounded_rectangle([left_x, gt_y, left_x + section_w, gt_y + 250],
                        radius=12, fill=BG_CARD, outline=ACCENT_GREEN, width=2)
    d.text((left_x + section_w // 2, gt_y + 15), "Ground Truth (GDE)", fill=ACCENT_GREEN, font=F_MD, anchor="mt")

    gt_lines = [
        ("Human rater consensus (60 raters):", TEXT_L),
        ("  alignment:     3.50 / 5.0", TEXT_L),
        ("  whitespace:    3.00 / 5.0", TEXT_L),
        ("  color_harmony: 4.00 / 5.0", ACCENT_YELLOW),
        ("", TEXT_M),
        ("Metric: Pearson r between model & human scores", TEXT_D),
        ("Goal: r > 0 means model agrees with humans", TEXT_D),
    ]
    for li, (line, color) in enumerate(gt_lines):
        d.text((left_x + 30, gt_y + 60 + li * 28), line, fill=color, font=F_MONO)

    # Footer
    d.line([(80, H - 70), (W - 80, H - 70)], fill=GRID, width=2)
    d.text((W // 2, H - 40),
           "This exact payload is sent 10 times per model (10 trials) to measure output consistency and reliability",
           fill=TEXT_D, font=F_XS, anchor="mt")

    img.save(f"{OUT}/10_gde_protocol.png")
    print("  10_gde_protocol.png      (2800x1500)")

draw_gde_protocol()


# ═══════════════════════════════════════════════════════════════════════════
# 12. Edit Protocol — issue classification task
# ═══════════════════════════════════════════════════════════════════════════

def draw_edit_protocol():
    """Show the DesignBench Edit evaluation: paired images → issue classification."""
    W, H = 2800, 1400
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 40), "DesignBench Edit Protocol — Issue Classification", fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 110),
           "Model must identify the type of change: color, text, position, size, or alignment. Measured by F1 score.",
           fill=TEXT_M, font=F_SM, anchor="mt")

    # Show all 5 edit samples in a grid
    scale = 1.5
    img_w, img_h = int(300 * scale), int(200 * scale)
    pair_gap = 30
    pair_total_h = img_h * 2 + pair_gap + 80  # two images + arrow + label

    # 5 columns
    col_w = 480
    total_w = 5 * col_w
    sx = (W - total_w) // 2

    for i in range(5):
        cx = sx + i * col_w + col_w // 2
        card_x = cx - col_w // 2 + 15
        card_top = 185

        # Card background
        d.rounded_rectangle([card_x, card_top, card_x + col_w - 30, card_top + 930],
                            radius=14, fill=BG_CARD)

        # Header
        d.text((cx, card_top + 20), f"Edit Sample {i + 1}",
               fill=TEXT_W, font=F_MD, anchor="mt")

        # Reference image
        ry = card_top + 75
        d.text((cx, ry - 5), "REFERENCE", fill=ACCENT_BLUE, font=F_XS, anchor="mb")
        ref_img = Image.new("RGB", (img_w, img_h), COLORS_REF[i])
        paste_x = cx - img_w // 2
        img.paste(ref_img, (paste_x, ry))
        d.rectangle([paste_x - 1, ry - 1, paste_x + img_w + 1, ry + img_h + 1],
                    outline=GRID, width=2)
        d.text((cx, ry + img_h + 8), REF_NAMES[i], fill=TEXT_D, font=F_XXS, anchor="mt")

        # Arrow
        arrow_y = ry + img_h + 35
        d.text((cx, arrow_y), "vs", fill=ACCENT_ORANGE, font=F_MD, anchor="mt")

        # Candidate image
        cy2 = arrow_y + 50
        d.text((cx, cy2 - 5), "CANDIDATE", fill=ACCENT_RED, font=F_XS, anchor="mb")
        bad_img = Image.new("RGB", (img_w, img_h), COLORS_BAD[i])
        img.paste(bad_img, (paste_x, cy2))
        d.rectangle([paste_x - 1, cy2 - 1, paste_x + img_w + 1, cy2 + img_h + 1],
                    outline=ACCENT_RED, width=3)
        d.text((cx, cy2 + img_h + 8), BAD_NAMES[i], fill=TEXT_D, font=F_XXS, anchor="mt")

        # Ground truth label (the answer)
        gt_y = cy2 + img_h + 50
        d.rounded_rectangle([card_x + 30, gt_y, card_x + col_w - 60, gt_y + 55],
                            radius=8, fill=(50, 45, 30), outline=ACCENT_YELLOW, width=2)
        d.text((cx, gt_y + 28), f"Ground truth: {LABELS[i]}",
               fill=ACCENT_YELLOW, font=F_SM, anchor="mm")

        # Model prediction (what most models said)
        pred_y = gt_y + 75
        correct = (i == 0)  # only color is usually correctly matched
        pred_label = "color" if i == 0 else LABELS[i]

        pred_color = ACCENT_GREEN if correct else ACCENT_RED
        d.text((cx, pred_y), "Model predicted:", fill=TEXT_D, font=F_XXS, anchor="mt")
        d.text((cx, pred_y + 25), f"color (most models)", fill=pred_color, font=F_SM, anchor="mt")

        # Match indicator
        match_text = "MATCH" if correct else "MISMATCH"
        d.text((cx, pred_y + 65), match_text, fill=pred_color, font=F_XS, anchor="mt")

    # Bottom explanation
    ey = H - 160
    d.line([(80, ey), (W - 80, ey)], fill=GRID, width=2)

    explanations = [
        ("Why F1 = 0.200 for most models:", TEXT_W, F_SM),
        ("Models correctly detect color shifts (sample 1 = match), but classify ALL changes as 'color' issues.", TEXT_L, F_XS),
        ("The other 4 samples have GT labels 'text', 'position', 'size', 'alignment' — all misclassified as color.", TEXT_L, F_XS),
        ("This is expected: solid-color images with color shifts → model reasonably calls everything a color issue.", TEXT_D, F_XS),
    ]
    for ei, (text, color, font) in enumerate(explanations):
        d.text((120, ey + 18 + ei * 32), text, fill=color, font=font)

    img.save(f"{OUT}/11_edit_protocol.png")
    print("  11_edit_protocol.png     (2800x1400)")

draw_edit_protocol()


# ═══════════════════════════════════════════════════════════════════════════
# 13. Full test set grid — all 10 images at actual pixels
# ═══════════════════════════════════════════════════════════════════════════

def draw_full_test_set():
    """Grid of all 10 test images (5 references + 5 candidates) at real resolution."""
    W, H = 2800, 1500
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)

    d.text((W // 2, 35), "Complete Test Set — All 10 Images at Actual Resolution",
           fill=TEXT_W, font=F_TITLE, anchor="mt")
    d.text((W // 2, 105),
           "Each image is 300x200 pixels — exactly what the model's vision encoder received (shown here at 1.5x)",
           fill=TEXT_M, font=F_SM, anchor="mt")

    scale = 1.5
    img_w, img_h = int(300 * scale), int(200 * scale)
    gap = 30

    # Row 1: References
    row1_y = 210
    d.text((100, row1_y + img_h // 2), "Reference", fill=ACCENT_BLUE, font=F_SM, anchor="mm")
    d.text((100, row1_y + img_h // 2 + 32), "(target)", fill=ACCENT_BLUE, font=F_XS, anchor="mm")

    total_img_w = 5 * img_w + 4 * gap
    sx = (W - total_img_w) // 2 + 60

    for i in range(5):
        x = sx + i * (img_w + gap)

        # Label above
        d.text((x + img_w // 2, row1_y - 10), f"Sample {i + 1}", fill=TEXT_L, font=F_SM, anchor="mb")

        # Actual image
        ref_img = Image.new("RGB", (img_w, img_h), COLORS_REF[i])
        img.paste(ref_img, (x, row1_y))
        d.rectangle([x - 1, row1_y - 1, x + img_w + 1, row1_y + img_h + 1], outline=GRID, width=2)

        # Name + RGB below
        d.text((x + img_w // 2, row1_y + img_h + 10), REF_NAMES[i], fill=TEXT_L, font=F_XS, anchor="mt")
        r, g, b = COLORS_REF[i]
        d.text((x + img_w // 2, row1_y + img_h + 38), f"({r}, {g}, {b})", fill=TEXT_D, font=F_MONO_SM, anchor="mt")

    # Arrows between rows
    arrow_y = row1_y + img_h + 68
    for i in range(5):
        x = sx + i * (img_w + gap) + img_w // 2
        d.text((x, arrow_y), "▼ color shift", fill=ACCENT_ORANGE, font=F_SM, anchor="mt")

    # Row 2: Candidates
    row2_y = arrow_y + 65
    d.text((100, row2_y + img_h // 2), "Candidate", fill=ACCENT_RED, font=F_SM, anchor="mm")
    d.text((100, row2_y + img_h // 2 + 32), "(evaluate)", fill=ACCENT_RED, font=F_XS, anchor="mm")

    for i in range(5):
        x = sx + i * (img_w + gap)

        bad_img = Image.new("RGB", (img_w, img_h), COLORS_BAD[i])
        img.paste(bad_img, (x, row2_y))
        d.rectangle([x - 1, row2_y - 1, x + img_w + 1, row2_y + img_h + 1], outline=ACCENT_RED, width=3)

        d.text((x + img_w // 2, row2_y + img_h + 10), BAD_NAMES[i], fill=TEXT_L, font=F_XS, anchor="mt")
        r, g, b = COLORS_BAD[i]
        d.text((x + img_w // 2, row2_y + img_h + 38), f"({r}, {g}, {b})", fill=TEXT_D, font=F_MONO_SM, anchor="mt")

        # Delta
        r1, g1, b1 = COLORS_REF[i]
        dr, dg, db = r - r1, g - g1, b - b1
        d.text((x + img_w // 2, row2_y + img_h + 66),
               f"delta: ({dr:+d}, {dg:+d}, {db:+d})",
               fill=ACCENT_ORANGE, font=F_MONO_SM, anchor="mt")

    # Footer with GT labels
    fy = row2_y + img_h + 105
    d.line([(80, fy), (W - 80, fy)], fill=GRID, width=2)

    d.text((W // 2, fy + 20), "Ground Truth Labels:", fill=TEXT_L, font=F_MD, anchor="mt")
    label_colors = [ACCENT_YELLOW, ACCENT_BLUE, ACCENT_ORANGE, ACCENT_PURPLE, ACCENT_GREEN]
    for i in range(5):
        x = sx + i * (img_w + gap) + img_w // 2
        d.rounded_rectangle([x - 80, fy + 70, x + 80, fy + 115], radius=8,
                            fill=BG_CARD2, outline=label_colors[i], width=2)
        d.text((x, fy + 93), LABELS[i], fill=label_colors[i], font=F_MD, anchor="mm")

    img.save(f"{OUT}/12_full_test_set.png")
    print("  12_full_test_set.png     (2800x1500)")

draw_full_test_set()


print(f"\nAll test example images saved to {OUT}/")
