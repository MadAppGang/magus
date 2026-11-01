/**
 * worktree.ts — which working tree is this, and where do its settings come from.
 *
 * Pure: no `node:` import and no engine id. The filesystem arrives as a `ReadPort`
 * (a `CheckIo` is one), paths are POSIX strings, and nothing here writes.
 *
 * A linked git worktree has no `settings.local.json` of its own, so setup done in the main
 * tree (the engine, "ignore for this project", `grep.route`) would be lost to it. The
 * reader therefore sees the main tree's files too, read-through and never copied:
 * `inheritedLayerPaths`.
 *
 * Main-tree resolution does not spawn git. It reads the `.git` pointer file and the
 * `commondir` file git keeps in the worktree's admin directory, then checks the back-links
 * so a hostile `.git` pointer cannot send reads somewhere else. The value equals
 * `git rev-parse --git-common-dir`.
 */

import type { Env, FileKind, IndexDescriptor, IndexState } from "./index-descriptor";

export type { Env, FileKind };

/** The read-only slice of the filesystem the resolver needs. A `CheckIo` is a `ReadPort`. */
export interface ReadPort {
  /** undefined = absent or unreadable. */
  readText(path: string): string | undefined;
  /** Follows symlinks. */
  kind(path: string): "missing" | "file" | "directory" | "other";
  realpath(path: string): string | undefined;
  mtimeMs(path: string): number | undefined;
}

export type WorktreeLayout =
  | { kind: "main" }
  | { kind: "unknown"; reason: "not_git" | "no_main_tree" }
  | {
      kind: "linked";
      /** The worktree's own root: the directory holding the `.git` pointer file. */
      root: string;
      mainRoot: string;
      /** `projectDir` relative to `root` ("" when they are the same directory). */
      relative: string;
      /** The same project directory inside the main tree. */
      mainProjectDir: string;
      /** `<worktree admin dir name>@<mtimeMs of its gitdir file>`: changes when a name is recycled. */
      incarnation: string;
    };

const MAIN: WorktreeLayout = { kind: "main" };

/**
 * Where is `projectDir`: the main tree, a linked worktree, or somewhere this module cannot
 * place. `main` is also the answer for any directory with a real `.git` directory, whether
 * or not git is installed.
 */
export function resolveWorktree(projectDir: string, read: ReadPort): WorktreeLayout {
  const start = normalize(projectDir);

  // 1. The first `.git`, walking up.
  let dir = start;
  let dotGit: string | undefined;
  let kind: FileKind = "missing";
  for (;;) {
    const candidate = joinPath(dir, ".git");
    kind = read.kind(candidate);
    if (kind === "directory" || kind === "file") {
      dotGit = candidate;
      break;
    }
    const parent = dirnameOf(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (dotGit === undefined) return { kind: "unknown", reason: "not_git" };
  if (kind === "directory") return MAIN;

  const noMain: WorktreeLayout = { kind: "unknown", reason: "no_main_tree" };

  // `gitdir: <G>`; a relative G resolves against the directory holding the `.git` file.
  const pointer = read.readText(dotGit);
  const gitdirLine = pointer === undefined ? undefined : /^gitdir:[ \t]*(.+?)[ \t]*(?:\r?\n|$)/u.exec(pointer);
  const rawG = gitdirLine?.[1];
  if (rawG === undefined || rawG === "") return noMain;
  const g = resolvePath(dir, rawG);

  // 2. `G/commondir`, written by git relative to G (or absolute by some tools).
  const commondir = read.readText(joinPath(g, "commondir"))?.trim();
  if (commondir === undefined || commondir === "") return noMain;
  const c = resolvePath(g, commondir);
  if (basenameOf(c) !== ".git") return noMain;
  const mainRoot = dirnameOf(c);

  // 3. The back-links. All required.
  if (read.kind(c) !== "directory") return noMain;
  const adminName = basenameOf(g);
  const adminReal = read.realpath(g);
  const listedReal = read.realpath(joinPath(c, "worktrees", adminName));
  if (adminReal === undefined || listedReal === undefined || adminReal !== listedReal) return noMain;

  const back = read.readText(joinPath(g, "gitdir"))?.trim();
  if (back === undefined || back === "") return noMain;
  const backReal = read.realpath(resolvePath(g, back));
  const dotGitReal = read.realpath(dotGit);
  if (backReal === undefined || dotGitReal === undefined || backReal !== dotGitReal) return noMain;

  // 4. The result.
  const mtime = read.mtimeMs(joinPath(g, "gitdir"));
  if (mtime === undefined) return noMain;
  const relative = start === dir ? "" : start.slice(dir.length === 1 ? 1 : dir.length + 1);
  return {
    kind: "linked",
    root: dir,
    mainRoot,
    relative,
    mainProjectDir: relative === "" ? mainRoot : joinPath(mainRoot, relative),
    incarnation: `${adminName}@${mtime}`,
  };
}

/**
 * The settings files the reader consults, lowest precedence first: three, or five in a
 * linked worktree, where the main tree's file sits under the worktree's file in the same
 * slot:
 *
 *   [user, main/settings.json, worktree/settings.json, main/settings.local.json, worktree/settings.local.json]
 *
 * Within a slot the worktree wins. Across slots local outranks project, so the main tree's
 * private `settings.local.json` outranks the worktree's committed `settings.json`.
 */
export function inheritedLayerPaths(home: string, projectDir: string, layout: WorktreeLayout): string[] {
  const paths = [`${trimSlash(home)}/.claude/settings.json`];
  if (projectDir === "") return paths;
  const dir = trimSlash(projectDir);
  if (layout.kind !== "linked") {
    paths.push(`${dir}/.claude/settings.json`, `${dir}/.claude/settings.local.json`);
    return paths;
  }
  const main = trimSlash(layout.mainProjectDir);
  paths.push(
    `${main}/.claude/settings.json`,
    `${dir}/.claude/settings.json`,
    `${main}/.claude/settings.local.json`,
    `${dir}/.claude/settings.local.json`,
  );
  return paths;
}

/** The names of the layers `inheritedLayerPaths` returns, in the same order. */
export function inheritedLayerNames(layout: WorktreeLayout, hasProject: boolean): string[] {
  if (!hasProject) return ["user"];
  return layout.kind === "linked"
    ? ["user", "main project", "project", "main local", "local"]
    : ["user", "project", "local"];
}

// ---------------------------------------------------------------------------
// Index inheritance: pure decisions
// ---------------------------------------------------------------------------

export type Staleness = "fresh" | "stale";

/**
 * `fresh` iff `state.complete`, `state.commit === mainHead`, `state.dirtyPaths` is empty AND
 * `mainDirty` is defined and empty. Everything else is `stale`: a dirty main is never fresh
 * (a path name carries no evidence of content), and an unknown `mainHead` or `mainDirty`
 * (the VCS did not answer) is stale. Both dirty lists are pre-filtered by the caller.
 */
export function staleness(
  state: IndexState,
  mainHead: string | undefined,
  mainDirty: readonly string[] | undefined,
): Staleness {
  if (!state.complete) return "stale";
  if (mainHead === undefined || state.commit !== mainHead) return "stale";
  if (state.dirtyPaths === undefined || state.dirtyPaths.length > 0) return "stale";
  if (mainDirty === undefined || mainDirty.length > 0) return "stale";
  return "fresh";
}

export type BlockStage = "probe" | "copy" | "catchup" | "verify" | "state" | "timeout" | "path";

/** The record of one run, one JSON object in the user cache. */
export interface WorktreeState {
  phase: "copying" | "complete" | "failed";
  /** Engine id of the run; rollback uses THIS engine's descriptor. */
  engine: string;
  /** From the layout; another incarnation's state is absent. */
  incarnation: string;
  /** ms */
  updatedAt: number;
  /** phase "failed" only */
  stage?: BlockStage;
  reason?: string;
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;

/** 64-bit FNV-1a of the UTF-8 bytes, as 16 lower-case hex digits. */
export function fnv1a64(text: string): string {
  let hash = FNV64_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

/** `<XDG_CACHE_HOME or <home>/.cache>/magus/code-search`: user cache, outside both trees. */
function cacheRoot(env: Env, home: string): string {
  const xdg = env["XDG_CACHE_HOME"];
  const base = xdg !== undefined && xdg.startsWith("/") ? trimSlash(xdg) : `${trimSlash(home)}/.cache`;
  return `${base}/magus/code-search`;
}

/** Keyed by the PROJECT dir: two project dirs in one worktree are independent. */
export function worktreeStatePath(env: Env, home: string, projectDir: string): string {
  return `${cacheRoot(env, home)}/worktrees/${fnv1a64(trimSlash(projectDir))}.json`;
}

/** The one lock of a main tree: every worktree of it queues behind the same file. */
export function worktreeLockPath(env: Env, home: string, mainRoot: string): string {
  return `${cacheRoot(env, home)}/locks/${fnv1a64(trimSlash(mainRoot))}.lock`;
}

const PHASES: ReadonlySet<string> = new Set(["copying", "complete", "failed"]);
const STAGES: ReadonlySet<string> = new Set(["probe", "copy", "catchup", "verify", "state", "timeout", "path"]);

/** Never throws. Unparseable, malformed or another incarnation's record is absent. */
export function parseWorktreeState(text: string | undefined, incarnation: string): WorktreeState | undefined {
  if (text === undefined) return undefined;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const o = raw as Record<string, unknown>;
    const phase = o["phase"];
    const engine = o["engine"];
    const updatedAt = o["updatedAt"];
    if (typeof phase !== "string" || !PHASES.has(phase)) return undefined;
    if (typeof engine !== "string" || engine === "") return undefined;
    if (o["incarnation"] !== incarnation) return undefined;
    if (typeof updatedAt !== "number" || !Number.isFinite(updatedAt)) return undefined;
    const state: WorktreeState = { phase: phase as WorktreeState["phase"], engine, incarnation, updatedAt };
    const stage = o["stage"];
    if (typeof stage === "string" && STAGES.has(stage)) state.stage = stage as BlockStage;
    if (typeof o["reason"] === "string") state.reason = o["reason"];
    return state;
  } catch {
    return undefined;
  }
}

/** One reason per row of the hook's decision table, in table order (row 6, state `copying`, is not one). */
export type SkipReason =
  | "claudish_child"
  | "not_linked_worktree"
  | "main_tree_unknown"
  | "no_engine"
  | "setup_dismissed"
  | "no_copy_descriptor"
  | "command_missing"
  | "main_has_no_index"
  | "previous_attempt_failed"
  | "path_unsafe"
  | "worktree_has_index";

export interface EligibilityInput {
  /** env CLAUDISH_PANE_CHILD === "1" */
  claudishChild: boolean;
  layout: WorktreeLayout;
  /** From the inherited settings. */
  engineId: string | false | undefined;
  setup: "dismissed" | "active" | undefined;
  descriptor: IndexDescriptor | undefined;
  /** copy.update[0] */
  commandOnPath: boolean;
  /** containedKind(mainRoot, mainProjectDir/path): "file" only for a regular file whose every ancestor is a real directory inside mainRoot. */
  mainMarker: FileKind;
  /** containedKind(worktree root, projectDir/path) */
  worktreeMarker: FileKind;
  /** true = the VCS tracks a file under an `owned` path (or could not answer): path_unsafe. */
  ownedTracked: boolean;
  /** Already incarnation-filtered. */
  state: WorktreeState | undefined;
}

/** First failing check wins, in the order of the decision table (row 7 before row 8). */
export function eligibility(i: EligibilityInput): { ok: true } | { ok: false; reason: SkipReason } {
  const skip = (reason: SkipReason): { ok: false; reason: SkipReason } => ({ ok: false, reason });
  if (i.claudishChild) return skip("claudish_child");
  if (i.layout.kind === "unknown") return skip(i.layout.reason === "no_main_tree" ? "main_tree_unknown" : "not_linked_worktree");
  if (i.layout.kind !== "linked") return skip("not_linked_worktree");
  if (i.engineId === undefined || i.engineId === false) return skip("no_engine");
  if (i.setup === "dismissed") return skip("setup_dismissed");
  if (i.descriptor === undefined || i.descriptor.worktrees !== "copy") return skip("no_copy_descriptor");
  if (!i.commandOnPath) return skip("command_missing");
  if (i.mainMarker !== "file") return skip("main_has_no_index");
  // Row 6: a `copying` record is the use case's to recover, not a reason to skip.
  if (i.state?.phase === "copying") return { ok: true };
  if (i.state?.phase === "failed") return skip("previous_attempt_failed");
  // Row 7: a `complete` record whose marker is gone is a start-over. A tracked file under `owned`
  // is not a veto here (rollback checks the VCS itself before it deletes anything).
  if (i.state?.phase === "complete" && i.worktreeMarker === "missing") return { ok: true };
  // A link, an escaping directory, a directory where the marker file belongs, or a tracked file
  // under `owned`: a copy cannot be placed here and nothing may be deleted.
  if (i.worktreeMarker === "other" || i.worktreeMarker === "directory" || i.ownedTracked) return skip("path_unsafe");
  if (i.worktreeMarker !== "missing") return skip("worktree_has_index");
  return { ok: true };
}

/**
 * Who raises `index_missing`. "engine": an engine-managed descriptor in a linked worktree whose
 * main marker is a file (the engine serves the worktree; the evaluator stays silent). "hook":
 * the start hook will copy, or has not failed yet. "evaluator": everything else, today's flow.
 * Static facts plus the state record, so offer-setup and the hook cannot both ask.
 */
export function indexQuestionOwner(i: EligibilityInput): "hook" | "engine" | "evaluator" {
  if (i.layout.kind !== "linked") return "evaluator";
  if (i.engineId === undefined || i.engineId === false || i.setup === "dismissed") return "evaluator";
  if (i.mainMarker !== "file") return "evaluator";
  if (i.descriptor?.worktrees === "engine-managed") return "engine";
  // A worktree marker that is a link, escapes the worktree or is a directory is never copied over
  // (the hook records `failed` and asks once it has looked, as `path_unsafe`); with no record yet
  // the hook has not looked, and the evaluator is the one that asks.
  if (
    !i.claudishChild &&
    i.descriptor?.worktrees === "copy" &&
    i.commandOnPath &&
    (i.worktreeMarker === "missing" || i.worktreeMarker === "file") &&
    i.state?.phase !== "failed"
  ) {
    return "hook";
  }
  return "evaluator";
}

/** The facade gate: false only when the state says `copying` or the marker is not a regular file. */
export function indexReady(marker: FileKind, state: WorktreeState | undefined): boolean {
  return state?.phase !== "copying" && marker === "file";
}

/**
 * Both outputs unique and sorted. `changed` = files to re-index (kind "file"); `deleted` =
 * paths to drop: kind "missing", "other" or "directory" (a file that became a directory or a
 * symlink; files beneath a new directory arrive as ordinary entries).
 */
export function mergeChanged(
  parts: { committed: readonly string[]; uncommitted: readonly string[] },
  kindOf: (rel: string) => FileKind,
): { changed: string[]; deleted: string[] } {
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const rel of new Set([...parts.committed, ...parts.uncommitted])) {
    if (kindOf(rel) === "file") changed.push(rel);
    else deleted.push(rel);
  }
  return { changed: changed.sort(), deleted: deleted.sort() };
}

export type InheritOutcome =
  | { kind: "skipped"; reason: SkipReason }
  | { kind: "inherited"; refresh: "fresh" | "refreshed" | "not_refreshed"; changed: number | undefined }
  | { kind: "blocked"; stage: BlockStage; reason: string; advice: boolean };

const PROBE_MESSAGE = "The main project's search index could not be used, so this worktree has no index yet.";
const FAILED_MESSAGE = "Could not start from the main project's index, so this worktree has no index yet.";
const TIMEOUT_MESSAGE =
  "Another start is still preparing the search index for this project, so this worktree has no index yet.";

/**
 * The user-facing text of an outcome. `skipped` has none. `adviceNeeded` is true only for a
 * blocked outcome whose `advice` is true. No path and no mechanism word appears in a message.
 */
export function renderOutcome(o: InheritOutcome): { systemMessage?: string; adviceNeeded: boolean } {
  if (o.kind === "skipped") return { adviceNeeded: false };
  if (o.kind === "blocked") {
    // `copy`, `catchup`, `verify`, `state` and `path` share one message.
    const systemMessage = o.stage === "probe" ? PROBE_MESSAGE : o.stage === "timeout" ? TIMEOUT_MESSAGE : FAILED_MESSAGE;
    return { systemMessage, adviceNeeded: o.advice };
  }
  const tail =
    o.changed === undefined ? "changed files updated." : o.changed === 0 ? "nothing to update." : `${o.changed} changed files updated.`;
  const head =
    o.refresh === "fresh"
      ? "Started from the main project's index;"
      : o.refresh === "refreshed"
        ? "Started from the main project's index, brought up to date first;"
        : "Started from the main project's index, which is behind and could not be brought up to date first;";
  return { systemMessage: `${head} ${tail}`, adviceNeeded: false };
}

// ---------------------------------------------------------------------------
// POSIX path helpers — this module may not import node:path
// ---------------------------------------------------------------------------

function trimSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** Collapse `.`, `..` and repeated slashes. Absolute in, absolute out. */
function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function joinPath(...segments: string[]): string {
  return normalize(segments.join("/"));
}

function resolvePath(base: string, path: string): string {
  return path.startsWith("/") ? normalize(path) : joinPath(base, path);
}

function dirnameOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut <= 0 ? "/" : path.slice(0, cut);
}

function basenameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
