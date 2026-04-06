import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import {
  writePreEvent,
  writePostEvent,
  readEvents,
  cleanupStaging,
} from "../lib/collector.ts";

describe("collector", () => {
  let tempDir: string;
  let stagingPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `stats-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    stagingPath = join(tempDir, "test-session.jsonl");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test("writePreEvent appends a pre record", () => {
    writePreEvent(stagingPath, "Read");

    const events = readEvents(stagingPath);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("pre");
    expect(events[0].tool_name).toBe("Read");
    expect(events[0].timestamp).toBeTruthy();
  });

  test("writePostEvent appends a post record", () => {
    writePostEvent(stagingPath, "Read", true);

    const events = readEvents(stagingPath);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("post");
    expect(events[0].tool_name).toBe("Read");
    expect((events[0] as { success: boolean }).success).toBe(true);
  });

  test("writePostEvent with failure", () => {
    writePostEvent(stagingPath, "Bash", false);

    const events = readEvents(stagingPath);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("post");
    expect((events[0] as { success: boolean }).success).toBe(false);
  });

  test("multiple events append sequentially", () => {
    writePreEvent(stagingPath, "Read");
    writePreEvent(stagingPath, "Grep");
    writePostEvent(stagingPath, "Read", true);
    writePostEvent(stagingPath, "Grep", true);

    const events = readEvents(stagingPath);
    expect(events).toHaveLength(4);
    expect(events[0].type).toBe("pre");
    expect(events[0].tool_name).toBe("Read");
    expect(events[1].type).toBe("pre");
    expect(events[1].tool_name).toBe("Grep");
    expect(events[2].type).toBe("post");
    expect(events[2].tool_name).toBe("Read");
    expect(events[3].type).toBe("post");
    expect(events[3].tool_name).toBe("Grep");
  });

  test("readEvents returns empty array for missing file", () => {
    const nonExistent = join(tempDir, "missing.jsonl");
    expect(readEvents(nonExistent)).toEqual([]);
  });

  test("cleanupStaging deletes the file", () => {
    writePreEvent(stagingPath, "Read");
    expect(existsSync(stagingPath)).toBe(true);
    cleanupStaging(stagingPath);
    expect(existsSync(stagingPath)).toBe(false);
  });

  test("cleanupStaging is safe for non-existent file", () => {
    const nonExistent = join(tempDir, "missing.jsonl");
    expect(() => cleanupStaging(nonExistent)).not.toThrow();
  });
});
