/**
 * The session's built-in task list, when the model in use still has the task tools.
 *
 * Stored one task per file under `<config>/tasks/<session-id>/N.json`; some builds key the
 * directory as `session-<first 8 hex>`. hooks/hooks.json records that the task-list tools
 * no longer exist on Opus 4.8 / Sonnet 5 and newer, so an empty result is the common case
 * and never an error. The plan file and commit trailers carry "not done" for those sessions.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Task } from "./types.ts";

const arr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function readTasks(sessionId: string | undefined, configDir: string): Task[] {
  if (!sessionId) return [];
  const candidates = [join(configDir, "tasks", sessionId), join(configDir, "tasks", `session-${sessionId.slice(0, 8)}`)];
  const dir = candidates.find((d) => existsSync(d));
  if (!dir) return [];
  const out: Task[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const j = JSON.parse(readFileSync(join(dir, f), "utf-8")) as Record<string, unknown>;
      if (typeof j.subject !== "string") continue;
      out.push({
        id: String(j.id ?? f.replace(/\.json$/, "")),
        subject: j.subject,
        status: typeof j.status === "string" ? j.status : "pending",
        blockedBy: arr(j.blockedBy),
        blocks: arr(j.blocks),
      });
    } catch {
      // one bad task file is not a reason to lose the rest
    }
  }
  return out.sort((a, b) => Number(a.id) - Number(b.id));
}
