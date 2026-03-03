/**
 * compare.test.ts — Unit tests for the compare.ts comparison engine.
 *
 * Fixtures are generated programmatically using sharp; no external files needed.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "fs";
import path from "path";
import sharp from "sharp";
import { PNG } from "pngjs";

// ---------------------------------------------------------------------------
// Helper: generate test fixture images via sharp
// ---------------------------------------------------------------------------

async function makeSolidPng(
  r: number,
  g: number,
  b: number,
  width = 100,
  height = 100
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png()
    .toBuffer();
}

/**
 * Create a solid red image with ONE blue pixel at (50, 50).
 */
async function makeOnePixelDiff(width = 100, height = 100): Promise<Buffer> {
  // Start with solid red, then overlay a 1x1 blue pixel using composite
  const base = await makeSolidPng(255, 0, 0, width, height);
  const bluePixel = await sharp({
    create: { width: 1, height: 1, channels: 3, background: { r: 0, g: 0, b: 255 } },
  })
    .png()
    .toBuffer();

  return sharp(base)
    .composite([{ input: bluePixel, left: 50, top: 50 }])
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Helper: write a fixture file and return the path
// ---------------------------------------------------------------------------

async function writeFixture(dir: string, name: string, buf: Buffer): Promise<string> {
  const p = path.join(dir, name);
  await Bun.write(p, buf);
  return p;
}

// ---------------------------------------------------------------------------
// Helper: invoke compare.ts as a subprocess
// ---------------------------------------------------------------------------

interface CompareResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCompare(args: string[]): Promise<CompareResult> {
  const scriptPath = path.join(import.meta.dir, "..", "scripts", "compare.ts");
  const proc = Bun.spawn(["bun", scriptPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode, stdout, stderr };
}

// ---------------------------------------------------------------------------
// Helpers: parse pixel-diff.json from output dir
// ---------------------------------------------------------------------------

async function readResult(outputDir: string): Promise<Record<string, unknown>> {
  const jsonPath = path.join(outputDir, "pixel-diff.json");
  const text = await Bun.file(jsonPath).text();
  return JSON.parse(text) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Severity mapping — tested independently (pure function reimplemented here)
// ---------------------------------------------------------------------------

function mapSeverity(pct: number): string {
  if (pct <= 0.5) return "PASS";
  if (pct <= 2.0) return "WARN";
  if (pct <= 10.0) return "FAIL";
  return "CRITICAL";
}

// ---------------------------------------------------------------------------
// Test setup: temp directories
// ---------------------------------------------------------------------------

const TMP_BASE = path.join(import.meta.dir, "..", ".test-tmp");

let refIdentical: string;
let implIdentical: string;
let implOnePixel: string;
let implDifferent: string;

beforeAll(async () => {
  mkdirSync(TMP_BASE, { recursive: true });

  const [solidRed, solidBlue, onePixel] = await Promise.all([
    makeSolidPng(255, 0, 0),
    makeSolidPng(0, 0, 255),
    makeOnePixelDiff(),
  ]);

  [refIdentical, implIdentical, implOnePixel, implDifferent] = await Promise.all([
    writeFixture(TMP_BASE, "ref-identical.png", solidRed),
    writeFixture(TMP_BASE, "impl-identical.png", solidRed),
    writeFixture(TMP_BASE, "impl-one-pixel.png", onePixel),
    writeFixture(TMP_BASE, "impl-different.png", solidBlue),
  ]);
});

afterAll(() => {
  rmSync(TMP_BASE, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("severity mapping", () => {
  it("maps 0.0% to PASS", () => {
    expect(mapSeverity(0.0)).toBe("PASS");
  });
  it("maps 0.5% to PASS (boundary, inclusive)", () => {
    expect(mapSeverity(0.5)).toBe("PASS");
  });
  it("maps 0.51% to WARN", () => {
    expect(mapSeverity(0.51)).toBe("WARN");
  });
  it("maps 2.0% to WARN (boundary, inclusive)", () => {
    expect(mapSeverity(2.0)).toBe("WARN");
  });
  it("maps 2.01% to FAIL", () => {
    expect(mapSeverity(2.01)).toBe("FAIL");
  });
  it("maps 10.0% to FAIL (boundary, inclusive)", () => {
    expect(mapSeverity(10.0)).toBe("FAIL");
  });
  it("maps 10.01% to CRITICAL", () => {
    expect(mapSeverity(10.01)).toBe("CRITICAL");
  });
  it("maps 100% to CRITICAL", () => {
    expect(mapSeverity(100)).toBe("CRITICAL");
  });
});

describe("identical images produce 0% diff and PASS severity", () => {
  it("runs successfully and reports no diff", async () => {
    const outputDir = path.join(TMP_BASE, "out-identical");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
    ]);

    expect(exitCode).toBe(0);

    const result = await readResult(outputDir);
    expect(result.success).toBe(true);
    expect(result.diffPixelCount).toBe(0);
    expect(result.diffPercentage).toBe(0);
    expect(result.severity).toBe("PASS");
  });
});

describe("single pixel difference", () => {
  it("produces a small but non-zero diff percentage", async () => {
    const outputDir = path.join(TMP_BASE, "out-one-pixel");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode } = await runCompare([
      "--ref", refIdentical,
      "--impl", implOnePixel,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
    ]);

    expect(exitCode).toBe(0);

    const result = await readResult(outputDir);
    expect(result.success).toBe(true);
    // 1 pixel out of 10000 = 0.01%
    expect(result.diffPixelCount).toBeGreaterThanOrEqual(1);
    expect(result.diffPercentage as number).toBeGreaterThan(0);
    expect(result.diffPercentage as number).toBeLessThan(1);
    // 0.01% is well under 0.5%, so severity should be PASS
    expect(result.severity).toBe("PASS");
  });
});

describe("completely different images", () => {
  it("produces high diff percentage and CRITICAL severity", async () => {
    const outputDir = path.join(TMP_BASE, "out-different");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode } = await runCompare([
      "--ref", refIdentical,
      "--impl", implDifferent,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
    ]);

    expect(exitCode).toBe(0);

    const result = await readResult(outputDir);
    expect(result.success).toBe(true);
    // Red vs blue — essentially every pixel differs
    expect(result.diffPercentage as number).toBeGreaterThan(50);
    expect(result.severity).toBe("CRITICAL");
  });
});

describe("output artifacts are created", () => {
  it("writes all 5 artifact files", async () => {
    const outputDir = path.join(TMP_BASE, "out-artifacts");
    mkdirSync(outputDir, { recursive: true });

    await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
    ]);

    const files = [
      "reference-normalized.png",
      "implementation-normalized.png",
      "diff-raw.png",
      "diff.png",
      "pixel-diff.json",
    ];

    for (const f of files) {
      expect(existsSync(path.join(outputDir, f))).toBe(true);
    }
  });
});

describe("3-panel diff.png has correct dimensions", () => {
  it("produces a 300x100 image for a 100x100 viewport", async () => {
    const outputDir = path.join(TMP_BASE, "out-dimensions");
    mkdirSync(outputDir, { recursive: true });

    await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
    ]);

    const diffPath = path.join(outputDir, "diff.png");
    const metadata = await sharp(diffPath).metadata();
    expect(metadata.width).toBe(300);  // 3 * 100
    expect(metadata.height).toBe(100);
  });
});

describe("missing input file returns exit code 1 and error JSON", () => {
  it("exits with code 1 when --ref file does not exist", async () => {
    const outputDir = path.join(TMP_BASE, "out-missing-ref");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode } = await runCompare([
      "--ref", "/nonexistent/path/ref.png",
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
    ]);

    expect(exitCode).toBe(1);

    // pixel-diff.json should still be written with success: false
    const result = await readResult(outputDir);
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });

  it("exits with code 1 when --impl file does not exist", async () => {
    const outputDir = path.join(TMP_BASE, "out-missing-impl");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode } = await runCompare([
      "--ref", refIdentical,
      "--impl", "/nonexistent/path/impl.png",
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
    ]);

    expect(exitCode).toBe(1);

    const result = await readResult(outputDir);
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe("string");
  });
});

describe("content masks exclude regions from diff", () => {
  it("reports 0 diff when only the changed pixel is masked", async () => {
    const outputDir = path.join(TMP_BASE, "out-masked");
    mkdirSync(outputDir, { recursive: true });

    // The single blue pixel is at (50, 50). Mask a 3x3 region around it.
    const masks = JSON.stringify([{ x: 48, y: 48, width: 5, height: 5, reason: "test mask" }]);

    const { exitCode } = await runCompare([
      "--ref", refIdentical,
      "--impl", implOnePixel,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
      "--masks", masks,
    ]);

    expect(exitCode).toBe(0);

    const result = await readResult(outputDir);
    expect(result.success).toBe(true);
    expect(result.masksApplied).toBe(1);
    // With the mask applied both images have the same zeroed region → 0 diff
    expect(result.diffPixelCount).toBe(0);
    expect(result.severity).toBe("PASS");
  });
});

describe("viewport dimension validation", () => {
  it("exits with code 1 for --width 0", async () => {
    const outputDir = path.join(TMP_BASE, "out-width-zero");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "0",
      "--height", "100",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--width");
  });

  it("exits with code 1 for --width 9999 (above 3840)", async () => {
    const outputDir = path.join(TMP_BASE, "out-width-large");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "9999",
      "--height", "100",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--width");
  });

  it("exits with code 1 for --width abc (non-integer)", async () => {
    const outputDir = path.join(TMP_BASE, "out-width-nan");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "abc",
      "--height", "100",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--width");
  });

  it("exits with code 1 for --height 0", async () => {
    const outputDir = path.join(TMP_BASE, "out-height-zero");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "0",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--height");
  });

  it("exits with code 1 for --height 9999 (above 2160)", async () => {
    const outputDir = path.join(TMP_BASE, "out-height-large");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "9999",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--height");
  });

  it("exits with code 1 for --height abc (non-integer)", async () => {
    const outputDir = path.join(TMP_BASE, "out-height-nan");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "abc",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--height");
  });
});

describe("threshold validation", () => {
  it("exits with code 1 for --threshold abc (NaN)", async () => {
    const outputDir = path.join(TMP_BASE, "out-threshold-nan");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
      "--threshold", "abc",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--threshold");
  });

  it("exits with code 1 for --threshold -0.1 (negative)", async () => {
    const outputDir = path.join(TMP_BASE, "out-threshold-negative");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
      "--threshold", "-0.1",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--threshold");
  });

  it("exits with code 1 for --threshold 1.5 (above 1.0)", async () => {
    const outputDir = path.join(TMP_BASE, "out-threshold-high");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
      "--threshold", "1.5",
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("--threshold");
  });

  it("accepts --threshold 0.0 (boundary)", async () => {
    const outputDir = path.join(TMP_BASE, "out-threshold-zero");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
      "--threshold", "0.0",
    ]);

    expect(exitCode).toBe(0);
  });

  it("accepts --threshold 1.0 (boundary)", async () => {
    const outputDir = path.join(TMP_BASE, "out-threshold-one");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
      "--threshold", "1.0",
    ]);

    expect(exitCode).toBe(0);
  });
});

describe("masks structural validation", () => {
  it("exits with code 1 when --masks is not an array", async () => {
    const outputDir = path.join(TMP_BASE, "out-masks-not-array");
    mkdirSync(outputDir, { recursive: true });

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
      "--masks", '{"x":0,"y":0,"width":10,"height":10}',
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("array");
  });

  it("exits with code 1 when mask element has non-numeric x", async () => {
    const outputDir = path.join(TMP_BASE, "out-masks-bad-x");
    mkdirSync(outputDir, { recursive: true });

    const masks = JSON.stringify([{ x: "foo", y: 0, width: 10, height: 10 }]);

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
      "--masks", masks,
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Mask at index 0");
  });

  it("exits with code 1 when mask element is missing height", async () => {
    const outputDir = path.join(TMP_BASE, "out-masks-missing-height");
    mkdirSync(outputDir, { recursive: true });

    const masks = JSON.stringify([{ x: 0, y: 0, width: 10 }]);

    const { exitCode, stderr } = await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
      "--masks", masks,
    ]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Mask at index 0");
  });
});

describe("pixel-diff.json schema", () => {
  it("contains all required top-level fields", async () => {
    const outputDir = path.join(TMP_BASE, "out-schema");
    mkdirSync(outputDir, { recursive: true });

    await runCompare([
      "--ref", refIdentical,
      "--impl", implIdentical,
      "--output", outputDir,
      "--width", "100",
      "--height", "100",
    ]);

    const result = await readResult(outputDir);

    const required = [
      "success",
      "runId",
      "diffPixelCount",
      "totalPixels",
      "diffPercentage",
      "severity",
      "threshold",
      "viewport",
      "artifacts",
      "masksApplied",
      "duration",
    ];

    for (const key of required) {
      expect(result).toHaveProperty(key);
    }

    // Validate nested shapes
    const viewport = result.viewport as Record<string, unknown>;
    expect(viewport).toHaveProperty("width", 100);
    expect(viewport).toHaveProperty("height", 100);

    const artifacts = result.artifacts as Record<string, unknown>;
    expect(artifacts.referenceNormalized).toBe("reference-normalized.png");
    expect(artifacts.implementationNormalized).toBe("implementation-normalized.png");
    expect(artifacts.diffRaw).toBe("diff-raw.png");
    expect(artifacts.diffImage).toBe("diff.png");

    // runId format: ui-val-YYYYMMDD-HHmmss-{8hex}
    expect(result.runId as string).toMatch(/^ui-val-\d{8}-\d{6}-[0-9a-f]{8}$/);
  });
});
