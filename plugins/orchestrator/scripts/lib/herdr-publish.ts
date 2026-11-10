// Runs the herdr sidebar reports `herdr-meta.ts` builds. Only the session that
// owns a record calls this, and only a record bound in herdr carries the ids a
// report needs; a nested session owns no record and so never publishes. Each
// call runs once with a 2 s timeout, and its failure is reported, never thrown.

import { homedir } from "node:os";
import { resolveHerdrBin } from "./herdr-cli.ts";
import { herdrClearArgv, herdrMetaArgv } from "./herdr-meta.ts";
import type { OrchestratorRecord } from "./state-core.ts";

/** What a publish did: `reported`, `skipped` (no herdr ids), or `failed: <reason>`. */
export type HerdrOutcome = "reported" | "skipped" | `failed: ${string}`;

type Env = Readonly<Record<string, string | undefined>>;

const PUBLISH_TIMEOUT_MS = 2_000;
const REASON_MAX = 160;

/** Runs one herdr argv through the resolved binary. Never throws. */
export function runHerdr(argv: readonly string[], env: Env = process.env): HerdrOutcome {
  try {
    const bin = resolveHerdrBin(env, env.HOME || homedir()) ?? "herdr";
    const p = Bun.spawnSync([bin, ...argv.slice(1)], { stdout: "ignore", stderr: "pipe", stdin: "ignore", timeout: PUBLISH_TIMEOUT_MS });
    if (p.exitCode === 0) return "reported";
    if (p.exitCode === null) return `failed: no answer within ${PUBLISH_TIMEOUT_MS} ms`;
    const err = p.stderr.toString().trim().split("\n")[0]?.slice(0, REASON_MAX) ?? "";
    return `failed: exit ${p.exitCode}${err === "" ? "" : `: ${err}`}`;
  } catch (err) {
    return `failed: ${(err instanceof Error ? err.message : String(err)).slice(0, REASON_MAX)}`;
  }
}

/**
 * Publishes `record`'s title and labels to its herdr pane: a full snapshot,
 * with `--seq` from the record's `updatedAt`. Skipped when the record has no
 * herdr ids. `env` only finds the binary.
 */
export function publishRecord(record: OrchestratorRecord, env: Env): HerdrOutcome {
  const argv = herdrMetaArgv(record);
  return argv === null ? "skipped" : runHerdr(argv, env);
}

/**
 * Removes the orchestrator's title and labels from the record's herdr pane in
 * one report, with `--seq` = `now`. Skipped when the record has no herdr ids.
 * `env` only finds the binary.
 */
export function clearRecord(record: Pick<OrchestratorRecord, "herdr">, env: Env, now: number): HerdrOutcome {
  return record.herdr === null ? "skipped" : runHerdr(herdrClearArgv(record.herdr.pane, now), env);
}
