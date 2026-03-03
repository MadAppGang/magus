#!/usr/bin/env bun
/**
 * compare.ts — Pixel-diff comparison engine for the designer plugin.
 *
 * Usage:
 *   bun scripts/compare.ts \
 *     --ref <path> \
 *     --impl <path> \
 *     --output <dir> \
 *     [--width 1440] \
 *     [--height 900] \
 *     [--threshold 0.1] \
 *     [--masks '[{"x":0,"y":0,"width":100,"height":50}]']
 *
 * Exit codes:
 *   0 — success
 *   1 — input validation error
 *   2 — normalization error
 *   3 — pixelmatch error
 *   4 — output write error
 */

import { parseArgs } from "util";
import { randomBytes } from "crypto";
import { existsSync, mkdirSync } from "fs";
import path from "path";
import sharp from "sharp";
// @ts-ignore — pixelmatch has no bundled types, but @types/pixelmatch is available
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentMask {
  x: number;
  y: number;
  width: number;
  height: number;
  reason?: string;
}

type Severity = "PASS" | "WARN" | "FAIL" | "CRITICAL";

interface PixelDiffResult {
  success: boolean;
  runId: string;
  diffPixelCount: number;
  totalPixels: number;
  diffPercentage: number;
  severity: Severity;
  threshold: number;
  viewport: { width: number; height: number };
  artifacts: {
    referenceNormalized: string;
    implementationNormalized: string;
    diffRaw: string;
    diffImage: string;
  };
  masksApplied: number;
  duration: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateRunId(): string {
  const now = new Date();
  const iso = now.toISOString(); // e.g. "2026-03-03T14:30:22.000Z"
  const dateStr = iso.slice(0, 10).replace(/-/g, ""); // "20260303"
  const timeStr = iso.slice(11, 19).replace(/:/g, ""); // "143022"
  const hex = randomBytes(4).toString("hex");
  return `ui-val-${dateStr}-${timeStr}-${hex}`;
}

function mapSeverity(diffPercentage: number): Severity {
  if (diffPercentage <= 0.5) return "PASS";
  if (diffPercentage <= 2.0) return "WARN";
  if (diffPercentage <= 10.0) return "FAIL";
  return "CRITICAL";
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Apply rectangular masks to a raw RGBA pixel buffer by zeroing out
 * the masked regions so they appear identical in both images and do not
 * contribute to the diff.
 */
function applyMasks(
  buffer: Buffer,
  width: number,
  height: number,
  masks: ContentMask[]
): void {
  for (const mask of masks) {
    const x1 = Math.max(0, Math.floor(mask.x));
    const y1 = Math.max(0, Math.floor(mask.y));
    const x2 = Math.min(width, Math.ceil(mask.x + mask.width));
    const y2 = Math.min(height, Math.ceil(mask.y + mask.height));

    for (let row = y1; row < y2; row++) {
      for (let col = x1; col < x2; col++) {
        const idx = (row * width + col) * 4;
        buffer[idx] = 0;     // R
        buffer[idx + 1] = 0; // G
        buffer[idx + 2] = 0; // B
        buffer[idx + 3] = 255; // A — fully opaque black
      }
    }
  }
}

/**
 * Normalize an image to exact pixel dimensions, sRGB PNG, using
 * contain-fit with white background.
 */
async function normalizeImage(
  inputPath: string,
  width: number,
  height: number
): Promise<Buffer> {
  return sharp(inputPath)
    .resize(width, height, {
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .toColorspace("srgb")
    .png()
    .toBuffer();
}

/**
 * Convert a raw PNG buffer (from sharp) to an RGBA Uint8Array
 * suitable for pixelmatch.
 */
function pngBufferToRgba(buffer: Buffer): Uint8Array {
  const png = PNG.sync.read(buffer);
  return new Uint8Array(png.data);
}

/**
 * Build a 3-panel side-by-side composite image:
 * [reference | implementation | diff]
 * Total width = 3 * panelWidth, height = panelHeight.
 */
async function compose3Panel(
  refBuffer: Buffer,
  implBuffer: Buffer,
  diffRawBuffer: Buffer,
  panelWidth: number,
  panelHeight: number
): Promise<Buffer> {
  // Create a blank white canvas of 3x width
  const totalWidth = panelWidth * 3;
  const canvas = sharp({
    create: {
      width: totalWidth,
      height: panelHeight,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  });

  return canvas
    .composite([
      { input: refBuffer, left: 0, top: 0 },
      { input: implBuffer, left: panelWidth, top: 0 },
      { input: diffRawBuffer, left: panelWidth * 2, top: 0 },
    ])
    .png()
    .toBuffer();
}

/**
 * Write an RGBA Uint8Array as a PNG file via pngjs.
 */
function rgbaToBuffer(rgba: Uint8Array, width: number, height: number): Buffer {
  const png = new PNG({ width, height });
  png.data = Buffer.from(rgba);
  return PNG.sync.write(png);
}

// ---------------------------------------------------------------------------
// Error output helper — always write pixel-diff.json before exiting
// ---------------------------------------------------------------------------

async function writeErrorResult(
  outputDir: string,
  runId: string,
  error: string,
  startTime: number,
  viewport: { width: number; height: number },
  threshold: number,
  code: number,
  phase: string
): Promise<void> {
  const result: Partial<PixelDiffResult> & { success: false; error: string; code: number; phase: string } = {
    success: false,
    runId,
    error,
    code,
    phase,
    diffPixelCount: 0,
    totalPixels: viewport.width * viewport.height,
    diffPercentage: 0,
    severity: "FAIL",
    threshold,
    viewport,
    artifacts: {
      referenceNormalized: "reference-normalized.png",
      implementationNormalized: "implementation-normalized.png",
      diffRaw: "diff-raw.png",
      diffImage: "diff.png",
    },
    masksApplied: 0,
    duration: Date.now() - startTime,
  };
  try {
    ensureDir(outputDir);
    await Bun.write(
      path.join(outputDir, "pixel-diff.json"),
      JSON.stringify(result, null, 2)
    );
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const startTime = Date.now();

  // --- Parse arguments --------------------------------------------------------
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      ref: { type: "string" },
      impl: { type: "string" },
      output: { type: "string" },
      width: { type: "string", default: "1440" },
      height: { type: "string", default: "900" },
      threshold: { type: "string", default: "0.1" },
      masks: { type: "string", default: "[]" },
    },
  });

  const refPath = values.ref ?? "";
  const implPath = values.impl ?? "";
  const outputDir = values.output ?? "";
  const viewport = {
    width: parseInt(values.width ?? "1440", 10),
    height: parseInt(values.height ?? "900", 10),
  };
  if (isNaN(viewport.width) || viewport.width < 1 || viewport.width > 3840) {
    console.error("ERROR: --width must be an integer between 1 and 3840");
    process.exit(1);
  }
  if (isNaN(viewport.height) || viewport.height < 1 || viewport.height > 2160) {
    console.error("ERROR: --height must be an integer between 1 and 2160");
    process.exit(1);
  }
  const threshold = parseFloat(values.threshold ?? "0.1");
  if (isNaN(threshold) || threshold < 0 || threshold > 1) {
    console.error("ERROR: --threshold must be a number between 0.0 and 1.0");
    process.exit(1);
  }

  let masks: ContentMask[] = [];
  try {
    masks = JSON.parse(values.masks ?? "[]") as ContentMask[];
  } catch {
    console.error("ERROR: --masks must be a valid JSON array");
    process.exit(1);
  }
  if (!Array.isArray(masks)) {
    console.error("ERROR: --masks must be a JSON array");
    process.exit(1);
  }
  for (const [i, m] of masks.entries()) {
    if (
      typeof m.x !== "number" ||
      typeof m.y !== "number" ||
      typeof m.width !== "number" ||
      typeof m.height !== "number"
    ) {
      console.error(`ERROR: Mask at index ${i} must have numeric x, y, width, height`);
      process.exit(1);
    }
  }

  const runId = generateRunId();

  // --- Input validation -------------------------------------------------------
  if (!refPath) {
    console.error("ERROR: --ref is required");
    await writeErrorResult(outputDir, runId, "--ref is required", startTime, viewport, threshold, 1, "validation");
    process.exit(1);
  }
  if (!implPath) {
    console.error("ERROR: --impl is required");
    await writeErrorResult(outputDir, runId, "--impl is required", startTime, viewport, threshold, 1, "validation");
    process.exit(1);
  }
  if (!outputDir) {
    console.error("ERROR: --output is required");
    process.exit(1);
  }

  if (!existsSync(refPath)) {
    console.error(`ERROR: Reference file not found: ${refPath}`);
    await writeErrorResult(outputDir, runId, `Reference file not found: ${refPath}`, startTime, viewport, threshold, 1, "validation");
    process.exit(1);
  }
  if (!existsSync(implPath)) {
    console.error(`ERROR: Implementation file not found: ${implPath}`);
    await writeErrorResult(outputDir, runId, `Implementation file not found: ${implPath}`, startTime, viewport, threshold, 1, "validation");
    process.exit(1);
  }

  // Validate file extensions — only supported image types accepted
  const SUPPORTED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".tiff", ".avif"]);
  const refExt = path.extname(refPath).toLowerCase();
  const implExt = path.extname(implPath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(refExt)) {
    const msg = `Unsupported file format for --ref: ${refExt}. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`;
    console.error(`ERROR: ${msg}`);
    await writeErrorResult(outputDir, runId, msg, startTime, viewport, threshold, 1, "validation");
    process.exit(1);
  }
  if (!SUPPORTED_EXTENSIONS.has(implExt)) {
    const msg = `Unsupported file format for --impl: ${implExt}. Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}`;
    console.error(`ERROR: ${msg}`);
    await writeErrorResult(outputDir, runId, msg, startTime, viewport, threshold, 1, "validation");
    process.exit(1);
  }

  // Validate output dir is writable
  try {
    ensureDir(outputDir);
    const probe = path.join(outputDir, `.write-probe-${randomBytes(4).toString("hex")}`);
    await Bun.write(probe, "");
    // Clean up probe file
    const { unlink } = await import("fs/promises");
    await unlink(probe);
  } catch (err) {
    console.error(`ERROR: Output directory is not writable: ${outputDir}`);
    process.exit(1);
  }

  // --- Normalization ----------------------------------------------------------
  let refNorm: Buffer;
  let implNorm: Buffer;

  try {
    [refNorm, implNorm] = await Promise.all([
      normalizeImage(refPath, viewport.width, viewport.height),
      normalizeImage(implPath, viewport.width, viewport.height),
    ]);
  } catch (err) {
    const msg = `Normalization failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`ERROR: ${msg}`);
    await writeErrorResult(outputDir, runId, msg, startTime, viewport, threshold, 2, "normalization");
    process.exit(2);
  }

  // --- Apply content masks ----------------------------------------------------
  let refRgba: Uint8Array;
  let implRgba: Uint8Array;

  try {
    refRgba = pngBufferToRgba(refNorm);
    implRgba = pngBufferToRgba(implNorm);
  } catch (err) {
    const msg = `PNG decode failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`ERROR: ${msg}`);
    await writeErrorResult(outputDir, runId, msg, startTime, viewport, threshold, 2, "normalization");
    process.exit(2);
  }

  if (masks.length > 0) {
    applyMasks(Buffer.from(refRgba.buffer, refRgba.byteOffset, refRgba.byteLength), viewport.width, viewport.height, masks);
    applyMasks(Buffer.from(implRgba.buffer, implRgba.byteOffset, implRgba.byteLength), viewport.width, viewport.height, masks);
  }

  // --- Pixelmatch -------------------------------------------------------------
  let diffPixelCount: number;
  let diffRgba: Uint8Array;

  try {
    diffRgba = new Uint8Array(viewport.width * viewport.height * 4);
    diffPixelCount = pixelmatch(
      refRgba,
      implRgba,
      diffRgba,
      viewport.width,
      viewport.height,
      {
        threshold,
        includeAA: false,
        alpha: 0.1,
        aaColor: [255, 255, 0],
        diffColor: [255, 0, 0],
      }
    );
  } catch (err) {
    const msg = `Pixelmatch failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`ERROR: ${msg}`);
    await writeErrorResult(outputDir, runId, msg, startTime, viewport, threshold, 3, "comparison");
    process.exit(3);
  }

  const totalPixels = viewport.width * viewport.height;
  const diffPercentage = Math.round((diffPixelCount / totalPixels) * 10000) / 100;
  const severity = mapSeverity(diffPercentage);

  // Convert diff RGBA back to PNG buffer
  const diffRawBuffer = rgbaToBuffer(diffRgba, viewport.width, viewport.height);

  // --- Build 3-panel composite ------------------------------------------------
  let compositePng: Buffer;
  try {
    compositePng = await compose3Panel(
      refNorm,
      implNorm,
      diffRawBuffer,
      viewport.width,
      viewport.height
    );
  } catch (err) {
    const msg = `Compositing failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`ERROR: ${msg}`);
    await writeErrorResult(outputDir, runId, msg, startTime, viewport, threshold, 3, "comparison");
    process.exit(3);
  }

  // --- Write outputs ----------------------------------------------------------
  try {
    await Promise.all([
      Bun.write(path.join(outputDir, "reference-normalized.png"), refNorm),
      Bun.write(path.join(outputDir, "implementation-normalized.png"), implNorm),
      Bun.write(path.join(outputDir, "diff-raw.png"), diffRawBuffer),
      Bun.write(path.join(outputDir, "diff.png"), compositePng),
    ]);
  } catch (err) {
    const msg = `Writing artifacts failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`ERROR: ${msg}`);
    await writeErrorResult(outputDir, runId, msg, startTime, viewport, threshold, 4, "output");
    process.exit(4);
  }

  const duration = Date.now() - startTime;

  const result: PixelDiffResult = {
    success: true,
    runId,
    diffPixelCount,
    totalPixels,
    diffPercentage,
    severity,
    threshold,
    viewport,
    artifacts: {
      referenceNormalized: "reference-normalized.png",
      implementationNormalized: "implementation-normalized.png",
      diffRaw: "diff-raw.png",
      diffImage: "diff.png",
    },
    masksApplied: masks.length,
    duration,
  };

  try {
    await Bun.write(
      path.join(outputDir, "pixel-diff.json"),
      JSON.stringify(result, null, 2)
    );
  } catch (err) {
    console.error(`ERROR: Writing pixel-diff.json failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(4);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(`FATAL: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
