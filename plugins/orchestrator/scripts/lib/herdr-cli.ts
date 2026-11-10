// Runs the herdr CLI: finds the binary and calls it with a timeout on every
// call, so a herdr that hangs cannot hang the caller. A failed call is an
// answer, never an exception. Also applies a layout plan to a live tab.

import { accessSync, constants, statSync } from "node:fs";
import { join } from "node:path";
import {
  checkApplied,
  type LayoutName,
  type LayoutPlan,
  type LivePanes,
  type PaneLayoutView,
  parsePaneLayout,
  parsePaneList,
  planArgs,
  planLayout,
  recoveryTarget,
} from "./pane-layout.ts";

export interface HerdrResult {
  ok: boolean;
  /** null when the process was killed or could not start. */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The answer as JSON: stdout, or stderr, where herdr prints its error bodies. null when neither parses. */
  json: unknown;
  /** The answer's `.error.code`, or null. */
  errorCode: string | null;
}

/** `args` exclude the binary name. */
export type HerdrRunner = (args: readonly string[], timeoutMs?: number) => HerdrResult;

export const HERDR_TIMEOUT_MS = 5_000;

function isExecutableFile(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * herdr on `env.PATH`, else an executable at `<home>/.local/bin/herdr`, else
 * null. Availability and execution both use this result, so a binary that was
 * offered can also be run.
 */
export function resolveHerdrBin(env: Readonly<Record<string, string | undefined>>, home: string): string | null {
  const onPath = Bun.which("herdr", { PATH: env.PATH ?? "" });
  if (onPath !== null) return onPath;
  if (!home.startsWith("/")) return null;
  const fallback = join(home, ".local", "bin", "herdr");
  return isExecutableFile(fallback) ? fallback : null;
}

function parseAnswer(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function errorCodeOf(answer: unknown): string | null {
  const code = (answer as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "string" ? code : null;
}

/** A runner for `bin`. Never throws. */
export function herdrRunner(bin = "herdr"): HerdrRunner {
  return (args, timeoutMs = HERDR_TIMEOUT_MS) => {
    try {
      const p = Bun.spawnSync([bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: timeoutMs });
      const stdout = p.stdout.toString();
      const stderr = p.stderr.toString();
      const json = parseAnswer(stdout) ?? parseAnswer(stderr);
      return { ok: p.exitCode === 0, exitCode: p.exitCode, stdout, stderr, timedOut: p.exitedDueToTimeout === true, json, errorCode: errorCodeOf(json) };
    } catch (err) {
      // A missing binary throws instead of exiting non-zero.
      return { ok: false, exitCode: null, stdout: "", stderr: err instanceof Error ? err.message : String(err), timedOut: false, json: null, errorCode: null };
    }
  };
}

/** Why a call failed, in one phrase. */
export function failureDetail(result: HerdrResult): string {
  if (result.timedOut) return "timed out";
  const message = (result.json as { error?: { message?: unknown } } | null)?.error?.message;
  if (typeof message === "string" && message !== "") return message;
  return result.errorCode ?? (result.stderr.trim() || `exit ${String(result.exitCode)}`);
}

function command(args: readonly string[]): string {
  return `herdr ${args.join(" ")}`;
}

export function readTabLayout(run: HerdrRunner, pane: string): { ok: true; view: PaneLayoutView } | { ok: false; error: string } {
  const args = ["pane", "layout", "--pane", pane];
  const result = run(args);
  if (!result.ok) return { ok: false, error: `${command(args)}: ${failureDetail(result)}` };
  const view = parsePaneLayout(result.stdout);
  return view === null ? { ok: false, error: `${command(args)}: unreadable answer` } : { ok: true, view };
}

export function readLivePanes(run: HerdrRunner): { ok: true; live: LivePanes } | { ok: false; error: string } {
  const args = ["pane", "list"];
  const result = run(args);
  if (!result.ok) return { ok: false, error: `${command(args)}: ${failureDetail(result)}` };
  const live = parsePaneList(result.stdout);
  return live === null ? { ok: false, error: `${command(args)}: unreadable answer` } : { ok: true, live };
}

export interface LayoutOutcome {
  status: "applied" | "unchanged" | "refused" | "failed";
  /** The tab's panes in tree order, as last seen. */
  order: string[];
  /** The caller's slots, handed back. */
  slots: string[];
  /** Panes that made the layout refuse, in tree order. */
  foreign: string[];
  /** Panes a failed layout put back in the tab. */
  restored: string[];
  /** Panes a failed layout could not put back. */
  stranded: string[];
  /** The failure, plus the command that puts back each stranded pane. */
  error: string | null;
}

export interface LayoutCommand {
  layout: LayoutName;
  main: string;
  /** When given, a pane in the tab outside these and `main` makes the layout refuse. */
  members?: readonly string[];
  slots?: readonly string[];
  mainMin?: number;
  mainShare?: number;
  columnSize?: number;
}

function paneIds(view: PaneLayoutView): string[] {
  return view.panes.map((pane) => pane.id);
}

/** A park can answer success without moving the pane, which leaves it in the tab. */
function parkDidNotMove(result: HerdrResult): boolean {
  const move = (result.json as { result?: { move_result?: { changed?: unknown; reason?: unknown } } } | null)?.result?.move_result;
  return move?.changed === false || move?.reason === "same_tab";
}

/** The result of `runPlan`. `uncertain` names the pane of a move that timed out, which herdr may still have carried out. */
interface PlanRun {
  done: number;
  error: string | null;
  uncertain: string | null;
}

/** Runs parks then replays, stopping at the first failure. `done` counts the calls that worked. */
function runPlan(run: HerdrRunner, plan: LayoutPlan, tab: string): PlanRun {
  const calls = planArgs(plan, tab);
  for (const [index, args] of calls.entries()) {
    const result = run(args);
    if (!result.ok) {
      const pane = index < plan.park.length ? plan.park[index] : plan.moves[index - plan.park.length]?.pane;
      return { done: index, error: `${command(args)}: ${failureDetail(result)}`, uncertain: result.timedOut ? (pane ?? null) : null };
    }
    if (index < plan.park.length && parkDidNotMove(result)) {
      return { done: index, error: `${command(args)}: the pane did not leave the tab`, uncertain: null };
    }
  }
  return { done: calls.length, error: null, uncertain: null };
}

/** What must still be in the tab after `done` calls, for when herdr cannot be asked. The uncertain pane counts as out, so it is moved back. */
function expectedInTab(plan: LayoutPlan, done: number, uncertain: string | null): Set<string> {
  const parksDone = Math.min(done, plan.park.length);
  const replaysDone = Math.max(0, done - plan.park.length);
  const inTab = new Set([plan.anchor, ...plan.park.slice(parksDone), ...plan.moves.slice(0, replaysDone).map((move) => move.pane)]);
  if (uncertain !== null) inTab.delete(uncertain);
  return inTab;
}

/**
 * Puts every parked pane back after a failed plan, walking `plan.order` and
 * inserting each pane directly after its nearest predecessor in the tab, so
 * no partial state can invert two panes. The pane that held the focus takes it
 * back as it returns. A pane that cannot go back does not stop the others; one
 * that no longer exists is reported as closed, since nothing can put it back.
 * The tab is read once more at the end and the report is built from that read,
 * since a move that timed out can land at any time: a planned pane missing then
 * is reported the same way, and one it shows is back whatever its move answered.
 */
function restoreParked(run: HerdrRunner, plan: LayoutPlan, tab: string, ran: PlanRun, cause: string, focused: string | null): Pick<LayoutOutcome, "order" | "restored" | "stranded" | "error"> {
  const read = readTabLayout(run, plan.anchor);
  const inTab = read.ok ? new Set(paneIds(read.view)) : expectedInTab(plan, ran.done, ran.uncertain);
  const parked = new Set(plan.park);
  const restored = new Set<string>();
  const missing = new Map<string, { closed: boolean; note: string }>();
  const moveBack = (pane: string, present: ReadonlySet<string>): string[] => [
    "pane",
    "move",
    pane,
    "--tab",
    tab,
    "--target-pane",
    recoveryTarget(plan.order, pane, present),
    "--split",
    "right",
    "--ratio",
    "0.5",
    "--no-focus",
  ];
  const reportMissing = (pane: string, args: readonly string[]): void => {
    const closed = run(["pane", "get", pane]).errorCode === "pane_not_found";
    missing.set(pane, { closed, note: closed ? `${pane} closed during the layout` : `${pane} is still outside the tab: ${command(args)}` });
  };
  const report = (order: string[]): Pick<LayoutOutcome, "order" | "restored" | "stranded" | "error"> => ({
    order,
    restored: plan.order.filter((pane) => restored.has(pane)),
    stranded: [...missing].filter(([, entry]) => !entry.closed).map(([pane]) => pane),
    error: [cause, ...[...missing.values()].map((entry) => entry.note)].join("; "),
  });

  for (const pane of plan.order) {
    if (!parked.has(pane) || inTab.has(pane)) continue;
    const args = moveBack(pane, inTab);
    const focusFlag = pane === focused ? "--focus" : "--no-focus";
    if (run([...args.slice(0, -1), focusFlag]).ok) {
      restored.add(pane);
      inTab.add(pane);
    } else {
      reportMissing(pane, args);
    }
  }

  const after = readTabLayout(run, plan.anchor);
  if (!after.ok) return report(plan.order.filter((pane) => inTab.has(pane)));
  const present = new Set(paneIds(after.view));
  for (const pane of plan.order) {
    if (present.has(pane)) {
      if (missing.delete(pane)) restored.add(pane);
    } else if (!missing.has(pane)) {
      restored.delete(pane);
      reportMissing(pane, moveBack(pane, present));
    }
  }
  return report(paneIds(after.view));
}

/**
 * Lays out the tab holding `main`: parks every pane but the anchor in a tab of
 * its own, replays them with their planned splits, and verifies the result.
 * Panes keep their ids and terminals. One attempt per call: a layout that comes
 * out wrong is reported, never replayed. Never throws on a failed herdr call.
 */
export function applyLayout(run: HerdrRunner, req: LayoutCommand): LayoutOutcome {
  const outcome = (status: LayoutOutcome["status"], order: string[], rest: Partial<LayoutOutcome> = {}): LayoutOutcome => ({
    status,
    order,
    slots: [...(req.slots ?? [])],
    foreign: [],
    restored: [],
    stranded: [],
    error: null,
    ...rest,
  });

  const before = readTabLayout(run, req.main);
  if (!before.ok) return outcome("failed", [], { error: before.error });
  const { view } = before;
  const order = paneIds(view);

  if (req.members !== undefined) {
    const allowed = new Set([...req.members, req.main]);
    const foreign = order.filter((pane) => !allowed.has(pane));
    if (foreign.length > 0) return outcome("refused", order, { foreign });
  }
  if (order.length === 1 && order[0] === req.main) return outcome("unchanged", order);

  const focusedBefore = view.focused;
  const planned = planLayout({
    layout: req.layout,
    panes: order,
    main: req.main,
    focused: focusedBefore,
    mainMin: req.mainMin,
    mainShare: req.mainShare,
    columnSize: req.columnSize,
  });
  if (!planned.ok) return outcome("failed", order, { error: planned.error });
  const { plan } = planned;

  if (view.zoomed) {
    const args = ["pane", "zoom", focusedBefore ?? req.main, "--off"];
    const zoom = run(args);
    if (!zoom.ok) return outcome("failed", order, { error: `${command(args)}: ${failureDetail(zoom)}` });
  }

  const ran = runPlan(run, plan, view.tabId);
  if (ran.error !== null) return outcome("failed", order, restoreParked(run, plan, view.tabId, ran, ran.error, focusedBefore));

  const after = readTabLayout(run, plan.anchor);
  if (!after.ok) return outcome("failed", plan.order, { error: after.error });
  const broken = checkApplied(after.view, plan, focusedBefore);
  return broken === null
    ? outcome("applied", paneIds(after.view))
    : outcome("failed", paneIds(after.view), { error: broken });
}
