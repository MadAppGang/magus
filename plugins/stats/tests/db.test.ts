import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import {
  openDb,
  insertSession,
  insertToolCalls,
  upsertDailyStats,
  deleteOldSessions,
  rebuildDailyStatsRows,
  getLastNSessions,
  getSessionSummary,
  getTopTools,
  getAllProjects,
} from "../lib/db.ts";
import type { SessionMetrics, ToolCallRecord } from "../lib/types.ts";

describe("db", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `stats-db-test-${randomUUID()}`);
    mkdirSync(tempDir, { recursive: true });
    dbPath = join(tempDir, "test-stats.db");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function makeSession(id: string, project = "/test/project", date = "2026-03-26"): SessionMetrics {
    return {
      session_id: id,
      date,
      project,
      duration_sec: 600,
      inter_message_gap_sec: 120,
      tool_calls: [
        {
          tool_name: "Read",
          duration_ms: 50,
          success: true,
          activity_category: "research",
          timestamp: "2026-03-26T10:00:00.000Z",
        },
        {
          tool_name: "Write",
          duration_ms: 30,
          success: true,
          activity_category: "coding",
          timestamp: "2026-03-26T10:01:00.000Z",
        },
      ],
      activity_counts: {
        research: 1,
        coding: 1,
        testing: 0,
        delegation: 0,
        other: 0,
      },
    };
  }

  test("openDb creates database and schema", () => {
    const db = openDb(dbPath);
    expect(db).toBeTruthy();

    // Verify tables exist
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("tool_calls");
    expect(tableNames).toContain("daily_stats");
    expect(tableNames).toContain("schema_version");

    db.close();
  });

  test("insertSession inserts a session row", () => {
    const db = openDb(dbPath);
    const metrics = makeSession("session-1");

    const inserted = insertSession(db, metrics);
    expect(inserted).toBe(true);

    const row = db.query("SELECT * FROM sessions WHERE id = ?").get("session-1");
    expect(row).toBeTruthy();

    db.close();
  });

  test("insertSession returns false for duplicate session_id", () => {
    const db = openDb(dbPath);
    const metrics = makeSession("session-dup");

    expect(insertSession(db, metrics)).toBe(true);
    expect(insertSession(db, metrics)).toBe(false);

    const count = db.query("SELECT COUNT(*) as n FROM sessions").get() as { n: number };
    expect(count.n).toBe(1);

    db.close();
  });

  test("insertToolCalls inserts tool call rows", () => {
    const db = openDb(dbPath);
    const metrics = makeSession("session-tc");
    insertSession(db, metrics);

    insertToolCalls(db, metrics.tool_calls, "session-tc");

    const count = db
      .query("SELECT COUNT(*) as n FROM tool_calls WHERE session_id = ?")
      .get("session-tc") as { n: number };
    expect(count.n).toBe(2);

    db.close();
  });

  test("upsertDailyStats inserts new row", () => {
    const db = openDb(dbPath);
    upsertDailyStats(
      db,
      "2026-03-26",
      "/test/project",
      { research: 5, coding: 3, testing: 1, delegation: 0, other: 2 },
      11,
      600
    );

    const row = db
      .query("SELECT * FROM daily_stats WHERE date = ? AND project = ?")
      .get("2026-03-26", "/test/project") as Record<string, number> | null;
    expect(row).toBeTruthy();
    expect(row!.session_count).toBe(1);
    expect(row!.total_tool_calls).toBe(11);

    db.close();
  });

  test("upsertDailyStats accumulates on second call", () => {
    const db = openDb(dbPath);
    const counts = { research: 5, coding: 3, testing: 1, delegation: 0, other: 2 };
    upsertDailyStats(db, "2026-03-26", "/test/project", counts, 11, 600);
    upsertDailyStats(db, "2026-03-26", "/test/project", counts, 11, 600);

    const row = db
      .query("SELECT * FROM daily_stats WHERE date = ? AND project = ?")
      .get("2026-03-26", "/test/project") as Record<string, number> | null;
    expect(row!.session_count).toBe(2);
    expect(row!.total_tool_calls).toBe(22);

    db.close();
  });

  test("getLastNSessions returns most recent N sessions", () => {
    const db = openDb(dbPath);

    for (let i = 1; i <= 7; i++) {
      const metrics = makeSession(`session-${i}`, "/test/project", `2026-03-${String(i).padStart(2, "0")}`);
      insertSession(db, metrics);
    }

    const sessions = getLastNSessions(db, 5, "/test/project");
    expect(sessions).toHaveLength(5);

    db.close();
  });

  test("getLastNSessions filters by project", () => {
    const db = openDb(dbPath);

    insertSession(db, makeSession("s1", "/project-a"));
    insertSession(db, makeSession("s2", "/project-b"));
    insertSession(db, makeSession("s3", "/project-a"));

    const sessions = getLastNSessions(db, 10, "/project-a");
    expect(sessions).toHaveLength(2);
    expect(sessions.every((s) => s.project === "/project-a")).toBe(true);

    db.close();
  });

  test("getSessionSummary returns aggregate stats", () => {
    const db = openDb(dbPath);
    insertSession(db, makeSession("s1", "/test/project", "2026-03-26"));
    insertSession(db, makeSession("s2", "/test/project", "2026-03-26"));

    const summary = getSessionSummary(db, 7, "/test/project");
    expect(summary.session_count).toBe(2);
    expect(summary.avg_duration_sec).toBe(600);
    expect(summary.total_tool_calls).toBe(4); // 2 calls per session × 2 sessions

    db.close();
  });

  test("getAllProjects returns distinct project paths", () => {
    const db = openDb(dbPath);
    insertSession(db, makeSession("s1", "/project-a"));
    insertSession(db, makeSession("s2", "/project-b"));
    insertSession(db, makeSession("s3", "/project-a"));

    const projects = getAllProjects(db);
    expect(projects).toHaveLength(2);
    expect(projects).toContain("/project-a");
    expect(projects).toContain("/project-b");

    db.close();
  });

  test("deleteOldSessions removes rows older than retention window", () => {
    const db = openDb(dbPath);

    // Insert an old session (more than 90 days ago)
    const oldDate = "2025-01-01"; // well outside 90 days
    const metrics = makeSession("old-session", "/test/project", oldDate);
    insertSession(db, metrics);
    insertToolCalls(db, metrics.tool_calls, "old-session");

    // Insert a recent session
    const recent = makeSession("recent-session", "/test/project", "2026-03-26");
    insertSession(db, recent);

    const { deletedCount } = deleteOldSessions(db, 90);
    expect(deletedCount).toBe(1);

    const remaining = db.query("SELECT COUNT(*) as n FROM sessions").get() as { n: number };
    expect(remaining.n).toBe(1);

    // Tool calls should be deleted via CASCADE
    const tcCount = db
      .query("SELECT COUNT(*) as n FROM tool_calls WHERE session_id = ?")
      .get("old-session") as { n: number };
    expect(tcCount.n).toBe(0);

    db.close();
  });
});
