/**
 * SQLite database module for the stats plugin.
 * Uses bun:sqlite (zero external dependencies).
 */

import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  chmodSync,
  statSync,
} from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import type {
  SessionMetrics,
  ToolCallRecord,
  ActivityCounts,
  SessionSummary,
  SessionRow,
  TopToolRow,
  DailyTrendRow,
} from "./types.ts";

const SCHEMA_VERSION = 1;

/**
 * Ensure the stats directory exists with correct permissions.
 * Called by initDb before opening the database.
 */
export function ensureStatsDir(statsDir: string): void {
  if (!existsSync(statsDir)) {
    mkdirSync(statsDir, { recursive: true, mode: 0o700 });
  } else {
    // Verify/correct permissions
    try {
      chmodSync(statsDir, 0o700);
    } catch {
      // Best-effort permission fix
    }
  }
}

/**
 * Open the SQLite database, initializing schema if needed.
 */
export function openDb(dbPath: string): Database {
  ensureStatsDir(dirname(dbPath));
  const db = new Database(dbPath, { create: true });
  // Enforce file permissions
  try {
    chmodSync(dbPath, 0o600);
  } catch {
    // Best-effort
  }
  initSchema(db);
  return db;
}

/**
 * Initialize the database schema (idempotent via IF NOT EXISTS).
 * Enables WAL mode for concurrent write safety.
 */
export function initSchema(db: Database): void {
  // Enable WAL mode and safe synchronous mode
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  // Schema version tracking
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  // Check if schema already applied
  const existing = db
    .query("SELECT version FROM schema_version WHERE version = ?")
    .get(SCHEMA_VERSION);
  if (existing) return;

  // Sessions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      project TEXT NOT NULL,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      total_tool_calls INTEGER NOT NULL DEFAULT 0,
      inter_message_gap_sec INTEGER NOT NULL DEFAULT 0,
      research_calls INTEGER NOT NULL DEFAULT 0,
      coding_calls INTEGER NOT NULL DEFAULT 0,
      testing_calls INTEGER NOT NULL DEFAULT 0,
      delegation_calls INTEGER NOT NULL DEFAULT 0,
      other_calls INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
  `);

  // Tool calls table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      tool_name TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      activity_category TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);

  // Daily stats table (pre-aggregated)
  db.exec(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      date TEXT NOT NULL,
      project TEXT NOT NULL,
      session_count INTEGER NOT NULL DEFAULT 0,
      total_tool_calls INTEGER NOT NULL DEFAULT 0,
      total_duration_sec INTEGER NOT NULL DEFAULT 0,
      research_calls INTEGER NOT NULL DEFAULT 0,
      coding_calls INTEGER NOT NULL DEFAULT 0,
      testing_calls INTEGER NOT NULL DEFAULT 0,
      delegation_calls INTEGER NOT NULL DEFAULT 0,
      other_calls INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (date, project)
    );
  `);

  // Indexes for common query patterns
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
    CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project);
    CREATE INDEX IF NOT EXISTS idx_sessions_date_project ON sessions(date, project);
    CREATE INDEX IF NOT EXISTS idx_sessions_project_created_at ON sessions(project, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);
    CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
  `);

  // Record schema version
  db.exec(
    `INSERT INTO schema_version (version, applied_at) VALUES (${SCHEMA_VERSION}, '${new Date().toISOString()}');`
  );
}

/**
 * Insert a session record. Returns false if session_id already exists (dedup guard).
 */
export function insertSession(db: Database, metrics: SessionMetrics): boolean {
  const existing = db
    .query("SELECT id FROM sessions WHERE id = ?")
    .get(metrics.session_id);
  if (existing) return false;

  db.run(
    `INSERT INTO sessions (
      id, date, project, duration_sec, total_tool_calls, inter_message_gap_sec,
      research_calls, coding_calls, testing_calls, delegation_calls, other_calls, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      metrics.session_id,
      metrics.date,
      metrics.project,
      metrics.duration_sec,
      metrics.tool_calls.length,
      metrics.inter_message_gap_sec,
      metrics.activity_counts.research,
      metrics.activity_counts.coding,
      metrics.activity_counts.testing,
      metrics.activity_counts.delegation,
      metrics.activity_counts.other,
      new Date().toISOString(),
    ]
  );
  return true;
}

/**
 * Batch insert tool call records for a session.
 */
export function insertToolCalls(
  db: Database,
  calls: ToolCallRecord[],
  sessionId: string
): void {
  const stmt = db.prepare(`
    INSERT INTO tool_calls (id, session_id, tool_name, duration_ms, success, activity_category, timestamp)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const call of calls) {
    stmt.run([
      randomUUID(),
      sessionId,
      call.tool_name,
      call.duration_ms,
      call.success ? 1 : 0,
      call.activity_category,
      call.timestamp,
    ]);
  }
}

/**
 * Upsert daily_stats counters for a given (date, project) pair.
 */
export function upsertDailyStats(
  db: Database,
  date: string,
  project: string,
  counts: ActivityCounts,
  toolCount: number,
  durationSec: number
): void {
  db.run(
    `INSERT INTO daily_stats (date, project, session_count, total_tool_calls, total_duration_sec,
      research_calls, coding_calls, testing_calls, delegation_calls, other_calls)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(date, project) DO UPDATE SET
      session_count = session_count + 1,
      total_tool_calls = total_tool_calls + excluded.total_tool_calls,
      total_duration_sec = total_duration_sec + excluded.total_duration_sec,
      research_calls = research_calls + excluded.research_calls,
      coding_calls = coding_calls + excluded.coding_calls,
      testing_calls = testing_calls + excluded.testing_calls,
      delegation_calls = delegation_calls + excluded.delegation_calls,
      other_calls = other_calls + excluded.other_calls`,
    [
      date,
      project,
      toolCount,
      durationSec,
      counts.research,
      counts.coding,
      counts.testing,
      counts.delegation,
      counts.other,
    ]
  );
}

/**
 * Delete sessions older than retentionDays from both sessions and tool_calls tables.
 * Returns the count of deleted sessions and affected (date, project) pairs for
 * daily_stats rebuild.
 */
export function deleteOldSessions(
  db: Database,
  retentionDays: number
): { deletedCount: number; affectedPairs: Array<{ date: string; project: string }> } {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  // Use local date components to match the local-time format stored in sessions.date
  const pad = (n: number) => String(n).padStart(2, "0");
  const cutoffDate = `${cutoff.getFullYear()}-${pad(cutoff.getMonth() + 1)}-${pad(cutoff.getDate())}`; // YYYY-MM-DD local

  // Get affected (date, project) pairs and session count before deletion
  const affectedPairs = db
    .query("SELECT DISTINCT date, project FROM sessions WHERE date < ?")
    .all(cutoffDate) as Array<{ date: string; project: string }>;

  if (affectedPairs.length === 0) {
    return { deletedCount: 0, affectedPairs: [] };
  }

  // Count sessions to delete (before cascades inflate result.changes)
  const countRow = db
    .query("SELECT COUNT(*) as n FROM sessions WHERE date < ?")
    .get(cutoffDate) as { n: number };
  const deletedCount = countRow.n;

  // Delete old sessions (tool_calls deleted via ON DELETE CASCADE)
  db.run("DELETE FROM sessions WHERE date < ?", [cutoffDate]);

  return {
    deletedCount,
    affectedPairs,
  };
}

/**
 * Rebuild daily_stats rows for a set of (date, project) pairs.
 * Called after retention deletes to keep daily_stats consistent.
 */
export function rebuildDailyStatsRows(
  db: Database,
  affectedPairs: Array<{ date: string; project: string }>
): void {
  for (const { date, project } of affectedPairs) {
    db.run("DELETE FROM daily_stats WHERE date = ? AND project = ?", [date, project]);
    db.run(
      `INSERT INTO daily_stats (date, project, session_count, total_tool_calls, total_duration_sec,
        research_calls, coding_calls, testing_calls, delegation_calls, other_calls)
      SELECT date, project, COUNT(*), SUM(total_tool_calls), SUM(duration_sec),
        SUM(research_calls), SUM(coding_calls), SUM(testing_calls), SUM(delegation_calls), SUM(other_calls)
      FROM sessions
      WHERE date = ? AND project = ?
      GROUP BY date, project`,
      [date, project]
    );
  }
}

/**
 * Query session summary for a time window, optionally filtered by project.
 */
export function getSessionSummary(
  db: Database,
  days: number,
  project?: string
): SessionSummary {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  let query: string;
  let params: string[];

  if (project) {
    query = `
      SELECT
        COUNT(*) as session_count,
        AVG(duration_sec) as avg_duration_sec,
        SUM(total_tool_calls) as total_tool_calls,
        AVG(CASE WHEN total_tool_calls > 0 THEN CAST(research_calls AS REAL) / total_tool_calls ELSE 0 END) as avg_research_ratio,
        AVG(CASE WHEN total_tool_calls > 0 THEN CAST(coding_calls AS REAL) / total_tool_calls ELSE 0 END) as avg_coding_ratio,
        AVG(CASE WHEN total_tool_calls > 0 THEN CAST(testing_calls AS REAL) / total_tool_calls ELSE 0 END) as avg_testing_ratio,
        AVG(CASE WHEN total_tool_calls > 0 THEN CAST(delegation_calls AS REAL) / total_tool_calls ELSE 0 END) as avg_delegation_ratio
      FROM sessions
      WHERE date >= ? AND project = ?
    `;
    params = [cutoff, project];
  } else {
    query = `
      SELECT
        COUNT(*) as session_count,
        AVG(duration_sec) as avg_duration_sec,
        SUM(total_tool_calls) as total_tool_calls,
        AVG(CASE WHEN total_tool_calls > 0 THEN CAST(research_calls AS REAL) / total_tool_calls ELSE 0 END) as avg_research_ratio,
        AVG(CASE WHEN total_tool_calls > 0 THEN CAST(coding_calls AS REAL) / total_tool_calls ELSE 0 END) as avg_coding_ratio,
        AVG(CASE WHEN total_tool_calls > 0 THEN CAST(testing_calls AS REAL) / total_tool_calls ELSE 0 END) as avg_testing_ratio,
        AVG(CASE WHEN total_tool_calls > 0 THEN CAST(delegation_calls AS REAL) / total_tool_calls ELSE 0 END) as avg_delegation_ratio
      FROM sessions
      WHERE date >= ?
    `;
    params = [cutoff];
  }

  const row = db.query(query).get(...params) as Record<string, number> | null;
  if (!row) {
    return {
      session_count: 0,
      avg_duration_sec: 0,
      total_tool_calls: 0,
      avg_research_ratio: 0,
      avg_coding_ratio: 0,
      avg_testing_ratio: 0,
      avg_delegation_ratio: 0,
    };
  }

  return {
    session_count: row.session_count ?? 0,
    avg_duration_sec: row.avg_duration_sec ?? 0,
    total_tool_calls: row.total_tool_calls ?? 0,
    avg_research_ratio: row.avg_research_ratio ?? 0,
    avg_coding_ratio: row.avg_coding_ratio ?? 0,
    avg_testing_ratio: row.avg_testing_ratio ?? 0,
    avg_delegation_ratio: row.avg_delegation_ratio ?? 0,
  };
}

/**
 * Get top tools by call count for a time window.
 */
export function getTopTools(
  db: Database,
  days: number,
  project?: string,
  limit = 10
): TopToolRow[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  let query: string;
  let params: (string | number)[];

  if (project) {
    query = `
      SELECT tc.tool_name, COUNT(*) as call_count,
        SUM(tc.duration_ms) as total_duration_ms,
        AVG(tc.duration_ms) as avg_duration_ms,
        tc.activity_category
      FROM tool_calls tc
      JOIN sessions s ON tc.session_id = s.id
      WHERE s.date >= ? AND s.project = ?
      GROUP BY tc.tool_name, tc.activity_category
      ORDER BY call_count DESC
      LIMIT ?
    `;
    params = [cutoff, project, limit];
  } else {
    query = `
      SELECT tc.tool_name, COUNT(*) as call_count,
        SUM(tc.duration_ms) as total_duration_ms,
        AVG(tc.duration_ms) as avg_duration_ms,
        tc.activity_category
      FROM tool_calls tc
      JOIN sessions s ON tc.session_id = s.id
      WHERE s.date >= ?
      GROUP BY tc.tool_name, tc.activity_category
      ORDER BY call_count DESC
      LIMIT ?
    `;
    params = [cutoff, limit];
  }

  return db.query(query).all(...params) as TopToolRow[];
}

/**
 * Get session duration trend for the last N days.
 */
export function getDurationTrend(
  db: Database,
  days: number,
  project?: string
): DailyTrendRow[] {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoff = cutoffDate.toISOString().slice(0, 10);

  let query: string;
  let params: string[];

  if (project) {
    query = `
      SELECT date, SUM(duration_sec) as total_duration_sec, COUNT(*) as session_count
      FROM sessions
      WHERE date >= ? AND project = ?
      GROUP BY date
      ORDER BY date ASC
      LIMIT ?
    `;
    params = [cutoff, project, String(days)];
  } else {
    query = `
      SELECT date, SUM(duration_sec) as total_duration_sec, COUNT(*) as session_count
      FROM sessions
      WHERE date >= ?
      GROUP BY date
      ORDER BY date ASC
      LIMIT ?
    `;
    params = [cutoff, String(days)];
  }

  return db.query(query).all(...params) as DailyTrendRow[];
}

/**
 * Get the last N sessions for a project (for SessionStart summary injection).
 */
export function getLastNSessions(
  db: Database,
  n: number,
  project?: string
): SessionRow[] {
  if (project) {
    return db
      .query(
        "SELECT * FROM sessions WHERE project = ? ORDER BY created_at DESC LIMIT ?"
      )
      .all(project, n) as SessionRow[];
  }
  return db
    .query("SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?")
    .all(n) as SessionRow[];
}

/**
 * Get all distinct project paths from the sessions table.
 */
export function getAllProjects(db: Database): string[] {
  const rows = db
    .query("SELECT DISTINCT project FROM sessions ORDER BY project")
    .all() as Array<{ project: string }>;
  return rows.map((r) => r.project);
}
