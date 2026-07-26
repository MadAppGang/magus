#!/usr/bin/env bun
/**
 * ansi-to-png.ts — Convert a captured ANSI terminal dump into a color-accurate PNG.
 *
 * This is the rendering half of the "screenshot a TUI with colors visible" workflow.
 * The capture half (getting ANSI text out of a running TUI) is session-specific and
 * lives in references/screenshot-workflow.md — feed its output here.
 *
 * Pipeline (each stage verified working):
 *   ANSI text (with SGR escapes) --aha--> HTML (inline truecolor) --chrome--> PNG
 *
 * aha preserves 24-bit truecolor, 256-color, bold, and Unicode (braille/block) glyphs.
 * Headless Chrome renders the HTML to a retina-crisp PNG that Claude can Read and inspect.
 *
 * Run it:
 *   bun run ansi-to-png.ts INPUT.ansi OUTPUT.png [WIDTHxHEIGHT]
 *
 *   INPUT.ansi    File of raw ANSI (capture with `tmux capture-pane -p -e`).
 *   OUTPUT.png    Destination PNG path.
 *   WIDTHxHEIGHT  Optional CSS pixel window (default 900x600). Rough sizing:
 *                 cols*9 x rows*20 for a default monospace font. Oversize is fine —
 *                 the unused area is rendered transparent.
 *
 * Exit codes: 0 ok, 1 usage, 2 missing dependency, 3 conversion failure.
 *
 * Why Bun, not bash: portable dependency detection, real error handling, no quoting
 * traps around the Chrome path, and it runs anywhere `bun` is on PATH.
 */

import { existsSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function die(code: number, msg: string): never {
  console.error(msg);
  process.exit(code);
}

// Resolve a Chromium-family browser cross-platform: PATH first, then known app bundles.
function findChrome(): string | null {
  const onPath = [
    "google-chrome", "google-chrome-stable", "chromium", "chromium-browser",
    "chrome", "brave", "thorium",
  ];
  for (const c of onPath) {
    if (Bun.which(c)) return c;
  }
  const bundles = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  for (const p of bundles) {
    if (existsSync(p)) return p;
  }
  return null;
}

const [input, output, winsize = "900x600"] = Bun.argv.slice(2);

if (!input || !output) {
  die(1, "usage: bun run ansi-to-png.ts INPUT.ansi OUTPUT.png [WIDTHxHEIGHT]");
}
if (!existsSync(input)) {
  die(1, `error: input file not found: ${input}`);
}

if (!Bun.which("aha")) {
  die(
    2,
    [
      "error: 'aha' not found. Install it:",
      "  macOS:         brew install aha",
      "  Debian/Ubuntu: sudo apt-get install aha",
      "  Arch:          sudo pacman -S aha",
    ].join("\n"),
  );
}

const chrome = findChrome();
if (!chrome) {
  die(
    2,
    [
      "error: no Chromium-family browser found (need Chrome/Chromium/Brave/Edge).",
      "  macOS:         brew install --cask google-chrome   (or chromium)",
      "  Debian/Ubuntu: sudo apt-get install chromium",
    ].join("\n"),
  );
}

const [width, height] = winsize.split("x");

const work = mkdtempSync(join(tmpdir(), "ansi2png-"));
const html = join(work, "render.html");

try {
  // ANSI -> HTML. --black sets a black page background so dark-terminal TUIs look right.
  const aha = Bun.spawnSync(["aha", "--black", "--title", "tui"], {
    stdin: Bun.file(input),
  });
  if (aha.exitCode !== 0) {
    die(3, `error: aha failed: ${aha.stderr.toString()}`);
  }
  writeFileSync(html, aha.stdout);

  // HTML -> PNG. 2x device scale = crisp blocks/braille/gradients when inspected.
  const render = Bun.spawnSync([
    chrome,
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    "--default-background-color=00000000",
    `--window-size=${width},${height}`,
    `--screenshot=${output}`,
    `file://${html}`,
  ]);
  if (render.exitCode !== 0) {
    die(3, `error: headless render failed via ${chrome}`);
  }

  const out = Bun.file(output);
  if (!(await out.exists()) || out.size === 0) {
    die(3, `error: no PNG produced at ${output}`);
  }
  console.log(`wrote ${output} (${out.size} bytes)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
