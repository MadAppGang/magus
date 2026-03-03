/**
 * Black Box Tests: compare.ts
 *
 * These tests validate the BEHAVIORAL contract of compare.ts based on
 * requirements.md and architecture.md ONLY. No implementation details.
 *
 * Test approach:
 * - Invoke compare.ts as a subprocess via Bun.spawn
 * - Generate fixture images programmatically with sharp
 * - Validate outputs (exit code, pixel-diff.json schema, artifact files, image dimensions)
 *
 * Requirements source:
 *   ai-docs/sessions/dev-feature-designer-plugin-20260303-112015-10eb624b/requirements.md
 * Architecture source:
 *   ai-docs/sessions/dev-arch-ui-validation-20260303-103732-842055d3/architecture.md
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import sharp from "sharp";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ============================================================
// Constants from requirements
// ============================================================

const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;
const SEVERITY_PASS_MAX = 0.5;   // 0 – 0.5% → PASS
const SEVERITY_WARN_MAX = 2.0;   // 0.5 – 2% → WARN
const SEVERITY_FAIL_MAX = 10.0;  // 2 – 10% → FAIL
// > 10% → CRITICAL

const SCRIPT_PATH = path.resolve(
  path.dirname(import.meta.dir),
  "scripts",
  "compare.ts"
);

// ============================================================
// Fixture management
// ============================================================

let FIXTURE_DIR: string;
let OUTPUT_ROOT: string;

/** Create a solid-color PNG using sharp */
async function createSolidImage(
  filePath: string,
  width: number,
  height: number,
  r: number,
  g: number,
  b: number
): Promise<void> {
  await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r, g, b },
    },
  })
    .png()
    .toFile(filePath);
}

/**
 * Create an image that is mostly solid blue but has a rectangular
 * red region, allowing us to control differing pixel percentage.
 */
async function createImageWithRedRect(
  filePath: string,
  width: number,
  height: number,
  rectX: number,
  rectY: number,
  rectW: number,
  rectH: number
): Promise<void> {
  // Base: solid blue
  const base = await sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 0, g: 0, b: 255 },
    },
  })
    .png()
    .toBuffer();

  // Red rectangle overlay
  const redRect = await sharp({
    create: {
      width: rectW,
      height: rectH,
      channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();

  await sharp(base)
    .composite([{ input: redRect, left: rectX, top: rectY }])
    .png()
    .toFile(filePath);
}

/** Small JPEG image for format tests */
async function createSmallJpeg(filePath: string): Promise<void> {
  await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 128, g: 200, b: 50 },
    },
  })
    .jpeg()
    .toFile(filePath);
}

/** Small WEBP image for format tests */
async function createSmallWebp(filePath: string): Promise<void> {
  await sharp({
    create: {
      width: 400,
      height: 300,
      channels: 3,
      background: { r: 128, g: 200, b: 50 },
    },
  })
    .webp()
    .toFile(filePath);
}

/** Get image dimensions using sharp */
async function getImageDimensions(
  filePath: string
): Promise<{ width: number; height: number }> {
  const meta = await sharp(filePath).metadata();
  return { width: meta.width!, height: meta.height! };
}

// ============================================================
// Test runner helper
// ============================================================

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runCompare(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn(["bun", SCRIPT_PATH, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { exitCode: exitCode ?? 1, stdout, stderr };
}

/** Create a fresh output directory for each test */
function makeOutputDir(suffix: string): string {
  const dir = path.join(OUTPUT_ROOT, suffix);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read and parse pixel-diff.json from an output directory */
function readPixelDiffJson(outputDir: string): Record<string, unknown> {
  const jsonPath = path.join(outputDir, "pixel-diff.json");
  const content = fs.readFileSync(jsonPath, "utf-8");
  return JSON.parse(content);
}

// ============================================================
// Fixtures: paths
// ============================================================

function fixturePath(name: string): string {
  return path.join(FIXTURE_DIR, name);
}

// ============================================================
// Setup & teardown
// ============================================================

beforeAll(async () => {
  // Create temp directories
  FIXTURE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "designer-bb-fixtures-"));
  OUTPUT_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "designer-bb-output-"));

  // Generate all fixture images
  await Promise.all([
    // Solid blue 1440x900 (primary reference)
    createSolidImage(fixturePath("blue-1440x900.png"), 1440, 900, 0, 0, 255),
    // Solid red 1440x900 (100% diff vs blue)
    createSolidImage(fixturePath("red-1440x900.png"), 1440, 900, 255, 0, 0),
    // Small image for normalization test (800x600)
    createSolidImage(fixturePath("green-800x600.png"), 800, 600, 0, 128, 0),
    // Small image for custom viewport test
    createSolidImage(fixturePath("blue-400x300.png"), 400, 300, 0, 0, 255),
    createSolidImage(fixturePath("red-400x300.png"), 400, 300, 255, 0, 0),
    // JPEG format test
    createSmallJpeg(fixturePath("test-image.jpg")),
    // WEBP format test
    createSmallWebp(fixturePath("test-image.webp")),
  ]);

  // Images with specific diff percentages (1440x900 = 1296000 total pixels)
  // WARN range: 0.5% - 2%. We want ~1%: 1% of 1296000 = 12960 pixels
  // A 114x114 = 12996 pixel rect ~= 1.002%
  await createImageWithRedRect(
    fixturePath("warn-diff.png"),
    1440, 900,
    0, 0, 114, 114  // ~1% diff
  );

  // FAIL range: 2% - 10%. We want ~5%: 5% of 1296000 = 64800 pixels
  // A 255x255 = 65025 pixel rect ~= 5.02%
  await createImageWithRedRect(
    fixturePath("fail-diff.png"),
    1440, 900,
    0, 0, 255, 255  // ~5% diff
  );

  // Mask region diff: differs only in top-left 100x100
  await createImageWithRedRect(
    fixturePath("mask-region-diff.png"),
    1440, 900,
    0, 0, 100, 100
  );
});

afterAll(() => {
  // Clean up temp directories
  fs.rmSync(FIXTURE_DIR, { recursive: true, force: true });
  fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true });
});

// ============================================================
// Category A: Happy Path — Identical Images
// ============================================================

describe("Category A: Happy Path — Identical Images", () => {
  it("TEST-01: Identical images produce 0% diff and PASS severity", async () => {
    const outDir = makeOutputDir("test-01");
    const ref = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,  // same file
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);

    const json = readPixelDiffJson(outDir);
    expect(json.success).toBe(true);
    expect(json.diffPercentage).toBe(0);
    expect(json.severity).toBe("PASS");
  });

  it("TEST-02: Identical images produce all output artifacts", async () => {
    const outDir = makeOutputDir("test-02");
    const ref = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);

    const files = fs.readdirSync(outDir);
    expect(files).toContain("reference-normalized.png");
    expect(files).toContain("implementation-normalized.png");
    expect(files).toContain("diff.png");
    expect(files).toContain("pixel-diff.json");
  });
});

// ============================================================
// Category B: Severity Thresholds
// ============================================================

describe("Category B: Severity Thresholds", () => {
  it("TEST-03: PASS severity for diff < 0.5%", async () => {
    const outDir = makeOutputDir("test-03");
    const ref = fixturePath("blue-1440x900.png");

    // Identical images → 0% diff → well within PASS range
    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    expect(json.severity).toBe("PASS");
    expect((json.diffPercentage as number)).toBeLessThan(SEVERITY_PASS_MAX);
  });

  it("TEST-04: WARN severity for diff between 0.5% and 2%", async () => {
    const outDir = makeOutputDir("test-04");
    const ref = fixturePath("blue-1440x900.png");
    const impl = fixturePath("warn-diff.png");  // ~1% diff

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", impl,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    expect(json.severity).toBe("WARN");
    const pct = json.diffPercentage as number;
    expect(pct).toBeGreaterThanOrEqual(SEVERITY_PASS_MAX);
    expect(pct).toBeLessThan(SEVERITY_WARN_MAX);
  });

  it("TEST-05: FAIL severity for diff between 2% and 10%", async () => {
    const outDir = makeOutputDir("test-05");
    const ref = fixturePath("blue-1440x900.png");
    const impl = fixturePath("fail-diff.png");  // ~5% diff

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", impl,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    expect(json.severity).toBe("FAIL");
    const pct = json.diffPercentage as number;
    expect(pct).toBeGreaterThanOrEqual(SEVERITY_WARN_MAX);
    expect(pct).toBeLessThan(SEVERITY_FAIL_MAX);
  });

  it("TEST-06: CRITICAL severity for diff > 10%", async () => {
    const outDir = makeOutputDir("test-06");
    const ref = fixturePath("blue-1440x900.png");
    const impl = fixturePath("red-1440x900.png");  // ~100% diff

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", impl,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    expect(json.severity).toBe("CRITICAL");
    expect((json.diffPercentage as number)).toBeGreaterThan(SEVERITY_FAIL_MAX);
  });
});

// ============================================================
// Category C: Image Normalization
// ============================================================

describe("Category C: Image Normalization", () => {
  it("TEST-07: Different-sized images are normalized to target viewport", async () => {
    const outDir = makeOutputDir("test-07");
    const ref = fixturePath("blue-1440x900.png");    // 1440x900
    const impl = fixturePath("green-800x600.png");   // 800x600

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", impl,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);

    const refDims = await getImageDimensions(
      path.join(outDir, "reference-normalized.png")
    );
    const implDims = await getImageDimensions(
      path.join(outDir, "implementation-normalized.png")
    );

    expect(refDims.width).toBe(DEFAULT_WIDTH);
    expect(refDims.height).toBe(DEFAULT_HEIGHT);
    expect(implDims.width).toBe(DEFAULT_WIDTH);
    expect(implDims.height).toBe(DEFAULT_HEIGHT);
  });

  it("TEST-08: Custom viewport dimensions are respected", async () => {
    const outDir = makeOutputDir("test-08");
    const ref = fixturePath("blue-400x300.png");
    const impl = fixturePath("red-400x300.png");
    const customW = 320;
    const customH = 568;

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", impl,
      "--output", outDir,
      "--width", String(customW),
      "--height", String(customH),
    ]);

    expect(exitCode).toBe(0);

    const refDims = await getImageDimensions(
      path.join(outDir, "reference-normalized.png")
    );
    const implDims = await getImageDimensions(
      path.join(outDir, "implementation-normalized.png")
    );
    const diffDims = await getImageDimensions(
      path.join(outDir, "diff.png")
    );

    expect(refDims.width).toBe(customW);
    expect(refDims.height).toBe(customH);
    expect(implDims.width).toBe(customW);
    expect(implDims.height).toBe(customH);
    // 3-panel composite: width * 3 by height
    expect(diffDims.width).toBe(customW * 3);
    expect(diffDims.height).toBe(customH);
  });

  it("TEST-09: JPEG input images are accepted", async () => {
    const outDir = makeOutputDir("test-09");
    const jpg = fixturePath("test-image.jpg");

    const { exitCode } = await runCompare([
      "--ref", jpg,
      "--impl", jpg,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    expect(json.success).toBe(true);
  });

  it("TEST-10: WEBP input images are accepted", async () => {
    const outDir = makeOutputDir("test-10");
    const webp = fixturePath("test-image.webp");

    const { exitCode } = await runCompare([
      "--ref", webp,
      "--impl", webp,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    expect(json.success).toBe(true);
  });
});

// ============================================================
// Category D: Diff Composite Image
// ============================================================

describe("Category D: Diff Composite Image", () => {
  it("TEST-11: diff.png has correct 3-panel dimensions (default viewport)", async () => {
    const outDir = makeOutputDir("test-11");
    const ref = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);

    const dims = await getImageDimensions(path.join(outDir, "diff.png"));
    expect(dims.width).toBe(DEFAULT_WIDTH * 3);
    expect(dims.height).toBe(DEFAULT_HEIGHT);
  });

  it("TEST-12: diff.png dimensions match custom viewport", async () => {
    const outDir = makeOutputDir("test-12");
    const ref = fixturePath("blue-400x300.png");
    const customW = 400;
    const customH = 300;

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,
      "--output", outDir,
      "--width", String(customW),
      "--height", String(customH),
    ]);

    expect(exitCode).toBe(0);

    const dims = await getImageDimensions(path.join(outDir, "diff.png"));
    expect(dims.width).toBe(customW * 3);
    expect(dims.height).toBe(customH);
  });
});

// ============================================================
// Category E: pixel-diff.json Schema
// ============================================================

describe("Category E: pixel-diff.json Schema", () => {
  it("TEST-13: pixel-diff.json success schema contains all required fields", async () => {
    const outDir = makeOutputDir("test-13");
    const ref = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);

    // Required top-level fields (from architecture PixelDiffOutput interface)
    expect(json).toHaveProperty("success", true);
    expect(json).toHaveProperty("runId");
    expect(json).toHaveProperty("diffPixelCount");
    expect(json).toHaveProperty("totalPixels");
    expect(json).toHaveProperty("diffPercentage");
    expect(json).toHaveProperty("severity");
    expect(json).toHaveProperty("artifacts");
    expect(json).toHaveProperty("masksApplied");
    expect(json).toHaveProperty("duration");

    // Types
    expect(typeof json.runId).toBe("string");
    expect(typeof json.diffPixelCount).toBe("number");
    expect(typeof json.totalPixels).toBe("number");
    expect(typeof json.diffPercentage).toBe("number");
    expect(typeof json.severity).toBe("string");
    expect(typeof json.masksApplied).toBe("number");
    expect(typeof json.duration).toBe("number");

    // artifacts object
    expect(typeof json.artifacts).toBe("object");
  });

  it("TEST-14: runId matches expected format ui-val-YYYYMMDD-HHmmss-hex8", async () => {
    const outDir = makeOutputDir("test-14");
    const ref = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    const runId = json.runId as string;

    // Pattern: ui-val-YYYYMMDD-HHmmss-{8 hex chars}
    const RUN_ID_PATTERN = /^ui-val-\d{8}-\d{6}-[0-9a-f]{8}$/;
    expect(runId).toMatch(RUN_ID_PATTERN);
  });

  it("TEST-15: totalPixels equals width * height", async () => {
    const outDir = makeOutputDir("test-15");
    const ref = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,
      "--output", outDir,
      "--width", "1440",
      "--height", "900",
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    expect(json.totalPixels).toBe(1440 * 900);  // 1296000
  });

  it("TEST-16: diffPercentage has at most 2 decimal places", async () => {
    const outDir = makeOutputDir("test-16");
    const ref = fixturePath("blue-1440x900.png");
    const impl = fixturePath("warn-diff.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", impl,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    const pct = json.diffPercentage as number;

    // Check: converting to string and counting decimals
    const str = pct.toString();
    const decimalIndex = str.indexOf(".");
    if (decimalIndex !== -1) {
      const decimals = str.slice(decimalIndex + 1).length;
      expect(decimals).toBeLessThanOrEqual(2);
    }
    // 0 decimal places is also valid (e.g., 1.0 or 0)
  });

  it("TEST-17: artifacts field contains correct filenames (not full paths)", async () => {
    const outDir = makeOutputDir("test-17");
    const ref = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    const artifacts = json.artifacts as Record<string, string>;

    expect(artifacts.referenceNormalized).toBe("reference-normalized.png");
    expect(artifacts.implementationNormalized).toBe("implementation-normalized.png");
    expect(artifacts.diffImage).toBe("diff.png");

    // Must be filenames only, no directory separators
    expect(artifacts.referenceNormalized).not.toContain("/");
    expect(artifacts.implementationNormalized).not.toContain("/");
    expect(artifacts.diffImage).not.toContain("/");
  });

  it("TEST-18: runId is auto-generated (no --run-id flag in requirements)", async () => {
    // NOTE: --run-id flag is NOT specified in requirements.md or architecture.md.
    // The prompt context mentioned it but architecture shows runId is always auto-generated
    // via generateRunId() which produces "ui-val-{YYYYMMDD-HHmmss}-{8char-hex}".
    // This test validates that runId is present and non-empty in the success output.
    const outDir = makeOutputDir("test-18");
    const ref = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    expect(typeof json.runId).toBe("string");
    expect((json.runId as string).length).toBeGreaterThan(0);
    expect(json.runId).toMatch(/^ui-val-/);  // Must start with the required prefix
  });
});

// ============================================================
// Category F: Mask Application
// ============================================================

describe("Category F: Mask Application", () => {
  it("TEST-19: Masks exclude differing regions from diff calculation", async () => {
    const outDir = makeOutputDir("test-19");
    const ref = fixturePath("blue-1440x900.png");
    // impl differs only in top-left 100x100
    const impl = fixturePath("mask-region-diff.png");

    // Mask that covers the entire diff region
    const masks = JSON.stringify([
      { x: 0, y: 0, width: 100, height: 100, reason: "dynamic content" },
    ]);

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", impl,
      "--output", outDir,
      "--masks", masks,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);

    // With the diff region fully masked, result should be 0%
    expect(json.diffPercentage).toBe(0);
    expect(json.severity).toBe("PASS");
    expect(json.masksApplied).toBe(1);
  });

  it("TEST-20: masksApplied count matches number of mask regions provided", async () => {
    const outDir = makeOutputDir("test-20");
    const ref = fixturePath("blue-1440x900.png");

    const masks = JSON.stringify([
      { x: 0, y: 0, width: 50, height: 50, reason: "region-1" },
      { x: 100, y: 100, width: 50, height: 50, reason: "region-2" },
    ]);

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", ref,
      "--output", outDir,
      "--masks", masks,
    ]);

    expect(exitCode).toBe(0);
    const json = readPixelDiffJson(outDir);
    expect(json.masksApplied).toBe(2);
  });
});

// ============================================================
// Category G: Error Handling — Exit Code 1 (Validation)
// ============================================================

describe("Category G: Error Handling — Exit Code 1 (Validation)", () => {
  it("TEST-21: Missing --ref flag exits with code 1", async () => {
    const outDir = makeOutputDir("test-21");
    const impl = fixturePath("blue-1440x900.png");

    const { exitCode, stderr } = await runCompare([
      "--impl", impl,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(1);
    // Should provide some error message
    expect(stderr.length + (await readOutputIfExists(outDir)).length).toBeGreaterThan(0);
  });

  it("TEST-22: Missing --impl flag exits with code 1", async () => {
    const outDir = makeOutputDir("test-22");
    const ref = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(1);
  });

  it("TEST-23: Non-existent reference file exits with code 1", async () => {
    const outDir = makeOutputDir("test-23");
    const impl = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", "/absolutely/nonexistent/path/image.png",
      "--impl", impl,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(1);
  });

  it("TEST-24: Non-existent implementation file exits with code 1", async () => {
    const outDir = makeOutputDir("test-24");
    const ref = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", "/absolutely/nonexistent/path/image.png",
      "--output", outDir,
    ]);

    expect(exitCode).toBe(1);
  });

  it("TEST-25: Unsupported file format exits with code 1", async () => {
    const outDir = makeOutputDir("test-25");
    const ref = fixturePath("blue-1440x900.png");

    // Create a fake BMP file (unsupported format)
    const bmpPath = path.join(FIXTURE_DIR, "fake.bmp");
    fs.writeFileSync(bmpPath, "BM fake bitmap data");

    const { exitCode } = await runCompare([
      "--ref", ref,
      "--impl", bmpPath,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(1);
  });
});

// ============================================================
// Category H: Error Case — pixel-diff.json on Failure
// ============================================================

describe("Category H: Error Case — pixel-diff.json Written on Failure", () => {
  it("TEST-26: pixel-diff.json is written with error schema on validation failure", async () => {
    const outDir = makeOutputDir("test-26");
    const impl = fixturePath("blue-1440x900.png");

    const { exitCode } = await runCompare([
      "--ref", "/absolutely/nonexistent/path/image.png",
      "--impl", impl,
      "--output", outDir,
    ]);

    expect(exitCode).toBe(1);

    // pixel-diff.json must be written even on failure
    const jsonPath = path.join(outDir, "pixel-diff.json");
    expect(fs.existsSync(jsonPath)).toBe(true);

    const json = readPixelDiffJson(outDir);
    // Error schema: success: false, error, code, phase
    expect(json.success).toBe(false);
    expect(typeof json.error).toBe("string");
    expect(json.code).toBe(1);
    expect(json.phase).toBe("validation");
  });
});

// ============================================================
// Helper: read combined output (stdout + stderr) for error tests
// ============================================================

async function readOutputIfExists(outDir: string): Promise<string> {
  const jsonPath = path.join(outDir, "pixel-diff.json");
  if (fs.existsSync(jsonPath)) {
    return fs.readFileSync(jsonPath, "utf-8");
  }
  return "";
}
