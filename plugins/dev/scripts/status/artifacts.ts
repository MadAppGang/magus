/**
 * Files the session itself produced: the plan-mode plan, `/dev:dev` session artifacts, and
 * the last /dev:status report.
 *
 * Only directories the transcript shows THIS session writing to are read. CLAUDE.md is
 * explicit that another session's `ai-docs/sessions/` output is one model's opinion at one
 * moment and never authority; reading it to reconstruct context is exactly the misuse it
 * forbids.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { DevSessionFacts, PlanFileFacts, PriorReport } from "./types.ts";

/** Where /dev:status writes its report. Under `ai-docs/sessions/`, so already git-ignored. */
export const REPORT_DIR = "ai-docs/sessions/status";

export function reportPath(cwd: string, sessionId: string): string {
  return join(cwd, REPORT_DIR, `${sessionId}.md`);
}

function readSafe(p: string): string | undefined {
  try {
    return readFileSync(p, "utf-8");
  } catch {
    return undefined;
  }
}

export function planFileFacts(path: string): PlanFileFacts {
  if (!existsSync(path)) return { path, exists: false };
  const st = statSync(path);
  const text = readSafe(path) ?? "";
  const title = text.split("\n").find((l) => l.startsWith("# "))?.slice(2).trim();
  const done = (text.match(/^\s*[-*]\s+\[[xX]\]/gm) ?? []).length;
  const open = (text.match(/^\s*[-*]\s+\[ \]/gm) ?? []).length;
  return {
    path,
    exists: true,
    sizeBytes: st.size,
    modifiedAt: st.mtime.toISOString(),
    title,
    checkboxes: done + open > 0 ? { done, open } : undefined,
  };
}

export function devSessionFacts(cwd: string, dirs: string[]): DevSessionFacts[] {
  const out: DevSessionFacts[] = [];
  for (const rel of dirs) {
    const dir = join(cwd, rel);
    if (!existsSync(dir)) continue;
    const f: DevSessionFacts = { dir: rel, verdicts: [], hasReport: existsSync(join(dir, "report.md")) };
    const meta = readSafe(join(dir, "session-meta.json"));
    if (meta) {
      try {
        const j = JSON.parse(meta) as Record<string, unknown>;
        if (typeof j.status === "string") f.status = j.status;
        const c = j.checkpoint as Record<string, unknown> | undefined;
        if (c && typeof c === "object")
          f.checkpoint = {
            lastCompletedPhase: typeof c.lastCompletedPhase === "string" ? c.lastCompletedPhase : null,
            nextPhase: String(c.nextPhase ?? ""),
            resumable: c.resumable === true,
          };
      } catch {
        // malformed meta: the directory still counts as a session
      }
    }
    const reviews = join(dir, "reviews");
    if (existsSync(reviews))
      for (const kind of readdirSync(reviews)) {
        const text = readSafe(join(reviews, kind, "consolidated.md"));
        const v = text?.match(/VERDICT:\s*([A-Z_]+)/)?.[1] ?? text?.match(/\b(PASS|FAIL|CONDITIONAL)\b/)?.[1];
        if (v) f.verdicts.push(`${kind}: ${v}`);
      }
    const validation = readSafe(join(dir, "validation", "result.md"));
    const vs = validation?.match(/status.*?:\s*(PASS|FAIL|PARTIAL)/i)?.[1];
    if (vs) f.validation = vs.toUpperCase();
    out.push(f);
  }
  return out;
}

export function priorReport(cwd: string, sessionId: string | undefined, maxChars = 2_500): PriorReport | undefined {
  if (!sessionId) return undefined;
  const p = reportPath(cwd, sessionId);
  if (!existsSync(p)) return undefined;
  const text = readSafe(p);
  if (!text) return undefined;
  const head = text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
  return { path: p, modifiedAt: statSync(p).mtime.toISOString(), head };
}
