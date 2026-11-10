// Pure core of herdr sidebar publishing: the herdr ids a record stores, and the
// `herdr pane report-metadata` argv for a record. No IO.
//
// herdr's behaviour this encodes: the pane id must come before the options; a
// report that sets anything replaces the source's whole entry, so every publish
// carries the full title and all four labels; `--seq` is compared per pane and
// source and must strictly increase, or the report is ignored; `--clear-title`
// alone keeps the labels; an empty label value is refused.

import type { SessionMux } from "./mux-choice.ts";
import { type OrchestratorDep, type OrchestratorHerdr, type OrchestratorRecord, progressOf } from "./state-core.ts";

/** The `--source` every orchestrator report carries. */
export const HERDR_SOURCE = "orchestrator";

/**
 * The herdr ids a record stores for this session: the pane, tab and workspace
 * from `HERDR_PANE_ID`, `HERDR_TAB_ID` and `HERDR_WORKSPACE_ID`, or null unless
 * `session` says this session runs in herdr. tmux started inside herdr inherits
 * those variables, so they alone prove nothing. An empty tab or workspace is null.
 */
export function herdrIdsOf(env: Readonly<Record<string, string | undefined>>, session: SessionMux): OrchestratorHerdr | null {
  if (!session.ok || session.mux !== "herdr") return null;
  return { pane: env.HERDR_PANE_ID ?? "", tab: env.HERDR_TAB_ID || null, workspace: env.HERDR_WORKSPACE_ID || null };
}

type MetaRecord =Pick<OrchestratorRecord, "key" | "role" | "name" | "ticket" | "herdr" | "tasks" | "deps" | "blocked" | "updatedAt">;

/** What a label names the session by: its ticket id, else its name, else its key. */
function subjectOf(record: MetaRecord): string {
  return record.ticket?.id ?? record.name ?? record.key;
}

/** The first open `pr` or `release` dependency; session dependencies are left out of herdr. */
function firstOpenExternalDep(deps: readonly OrchestratorDep[]): OrchestratorDep | null {
  return deps.find((d) => d.kind !== "session" && d.doneAt === null) ?? null;
}

/**
 * The title herdr shows for the record: `<role> · <ticket id or name>`, plus
 * ` · blocked` only while `blocked` is set. The key stands in when there is
 * neither a ticket nor a name.
 */
export function herdrTitle(record: MetaRecord): string {
  const base = `${record.role} · ${subjectOf(record)}`;
  return record.blocked !== null ? `${base} · blocked` : base;
}

/**
 * The four state labels, in the order `working`, `idle`, `blocked`, `done`:
 *
 *   working=<subject>[ <d>/<t>]
 *   idle=<subject>[ <d>/<t>][ · waits <kind> <ref>]
 *   blocked=<subject> needs you
 *   done=<subject> done
 *
 * `<d>/<t>` is `progressOf(tasks)` and is left out when there are no tasks;
 * the dependency is the first open `pr` or `release` one.
 */
export function herdrLabels(record: MetaRecord): string[] {
  const subject = subjectOf(record);
  const progress = progressOf(record.tasks);
  const counted = progress === null ? subject : `${subject} ${progress.done}/${progress.total}`;
  const dep = firstOpenExternalDep(record.deps);
  const idle = dep === null ? counted : `${counted} · waits ${dep.kind} ${dep.ref}`;
  return [`working=${counted}`, `idle=${idle}`, `blocked=${subject} needs you`, `done=${subject} done`];
}

/**
 * The argv that publishes `record` to its herdr pane, or null when the record
 * has no herdr ids:
 *
 *   herdr pane report-metadata <pane> --source orchestrator --title <title>
 *     --state-label working=… --state-label idle=… --state-label blocked=… --state-label done=…
 *     --seq <record.updatedAt>
 *
 * `--seq` is the record's `updatedAt` (the larger of its two files'), which
 * strictly increases with every write. `now` is not used: a publish must carry
 * the record's own sequence, so a late report of an older state is ignored.
 */
export function herdrMetaArgv(record: MetaRecord, now?: number): string[] | null {
  void now;
  if (record.herdr === null) return null;
  const argv = ["herdr", "pane", "report-metadata", record.herdr.pane, "--source", HERDR_SOURCE, "--title", herdrTitle(record)];
  for (const label of herdrLabels(record)) argv.push("--state-label", label);
  argv.push("--seq", String(Math.floor(record.updatedAt)));
  return argv;
}

/**
 * The argv that removes the orchestrator's title and labels from `pane` in one
 * report: `--clear-title --clear-state-labels`, with `--seq <now>`, which is
 * later than the last write.
 */
export function herdrClearArgv(pane: string, now: number): string[] {
  return ["herdr", "pane", "report-metadata", pane, "--source", HERDR_SOURCE, "--clear-title", "--clear-state-labels", "--seq", String(Math.floor(now))];
}
