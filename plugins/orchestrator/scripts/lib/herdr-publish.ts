// Runs the herdr sidebar reports `herdr-meta.ts` builds. Only the session that
// owns a record calls this, and only when herdr is detected; a nested session
// owns no record and so never publishes. Each call runs once with a 2 s
// timeout, and its failure is reported, never thrown.

import { herdrClearArgv, herdrDetected, herdrMetaArgv } from "./herdr-meta.ts";
import type { OrchestratorRecord } from "./state-core.ts";

/** What a publish did: `reported`, `skipped` (not herdr, or no herdr ids), or `failed: <reason>`. */
export type HerdrOutcome = "reported" | "skipped" | `failed: ${string}`;

const HERDR_TIMEOUT_MS = 2_000;
const REASON_MAX = 160;

/** Runs one herdr argv. Never throws. */
export function runHerdr(argv: readonly string[]): HerdrOutcome {
  try {
    const p = Bun.spawnSync([...argv], { stdout: "ignore", stderr: "pipe", stdin: "ignore", timeout: HERDR_TIMEOUT_MS });
    if (p.exitCode === 0) return "reported";
    if (p.exitCode === null) return `failed: no answer within ${HERDR_TIMEOUT_MS} ms`;
    const err = p.stderr.toString().trim().split("\n")[0]?.slice(0, REASON_MAX) ?? "";
    return `failed: exit ${p.exitCode}${err === "" ? "" : `: ${err}`}`;
  } catch (err) {
    return `failed: ${(err instanceof Error ? err.message : String(err)).slice(0, REASON_MAX)}`;
  }
}

/**
 * Publishes `record`'s title and labels to its herdr pane: a full snapshot,
 * with `--seq` from the record's `updatedAt`. Skipped when herdr is not
 * detected in `env` or the record has no herdr ids.
 */
export function publishRecord(record: OrchestratorRecord, env: Readonly<Record<string, string | undefined>>): HerdrOutcome {
  if (!herdrDetected(env)) return "skipped";
  const argv = herdrMetaArgv(record);
  return argv === null ? "skipped" : runHerdr(argv);
}

/**
 * Removes the orchestrator's title and labels from the record's herdr pane in
 * one report, with `--seq` = `now`. Skipped when herdr is not detected in
 * `env` or the record has no herdr ids.
 */
export function clearRecord(record: Pick<OrchestratorRecord, "herdr">, env: Readonly<Record<string, string | undefined>>, now: number): HerdrOutcome {
  if (!herdrDetected(env) || record.herdr === null) return "skipped";
  return runHerdr(herdrClearArgv(record.herdr.pane, now));
}
