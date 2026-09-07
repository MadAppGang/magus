/**
 * Shapes for the /dev:status evidence bundle.
 *
 * Everything here is a FACT the collector measured, never a judgement. Two consumers read
 * the bundle: commands/status.md has the model turn it into the narrative sections
 * (idea, plan changes, why not done), and hooks/status-reinject.ts renders the
 * deterministic head after a compaction. A "done" claim in the report must point at one
 * of these facts — a commit, a verification event, a file — or it is not a "done" claim.
 */

/** Result of running a subprocess. `timedOut` and `missing` are split out because the
 *  gate treats "gh took too long" and "gh is not installed" as different reasons. */
export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** The executable was not found (ENOENT). */
  missing: boolean;
}

export type Runner = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
) => RunResult;

// ---------------------------------------------------------------------------
// transcript
// ---------------------------------------------------------------------------

export interface Turn {
  at: string;
  /** `command` is a slash command the user typed; `prompt` is free text. */
  kind: "prompt" | "command";
  command?: string;
  text: string;
}

/** One AskUserQuestion, paired with the answer the user gave. */
export interface Decision {
  at: string;
  header?: string;
  question: string;
  chosen: string;
  rejected: string[];
}

export interface PlanEvent {
  at: string;
  /** `file`: plan mode named the plan file. `approved`: ExitPlanMode succeeded.
   *  `edit`: the plan file was written or edited. */
  kind: "file" | "approved" | "edit";
  path?: string;
}

export interface CompactionPoint {
  at: string;
  /** The opening of the summary Claude Code injected — what survived. */
  summary: string;
}

export type VerificationKind =
  | "test"
  | "typecheck"
  | "lint"
  | "build"
  | "check"
  | "commit"
  | "push"
  | "pr";

/** A Bash command that verifies or ships work, with the outcome its result reported. */
export interface VerificationEvent {
  at: string;
  kind: VerificationKind;
  command: string;
  /** null when no result was recorded for the call (interrupted, or still pending). */
  ok: boolean | null;
  /** The one result line that decides it, e.g. ` 12 pass` / ` 2 fail`. */
  detail?: string;
}

export interface Friction {
  at: string;
  tool: string;
  error: string;
}

export interface Delegation {
  at: string;
  agent: string;
  description: string;
}

export interface TranscriptFacts {
  path: string;
  sizeBytes: number;
  /** false when the file was missing, too large, or unreadable; see `skippedReason`. */
  parsed: boolean;
  skippedReason?: string;
  sessionId?: string;
  title?: string;
  startedAt?: string;
  lastAt?: string;
  /** The opening prompt, in full up to a cap — "where we started". */
  firstPrompt?: string;
  turns: Turn[];
  decisions: Decision[];
  planFile?: string;
  planEvents: PlanEvent[];
  compactions: CompactionPoint[];
  verifications: VerificationEvent[];
  friction: Friction[];
  delegations: Delegation[];
  prLink?: { number: number; url: string; repository: string };
  worktree?: {
    path: string;
    name: string;
    branch: string;
    originalBranch: string;
    baseCommit: string;
  };
  /** `ai-docs/sessions/<dir>` directories this session wrote into. Only these may be
   *  read back — another session's artifacts are never authority. */
  sessionDirs: string[];
  cost?: {
    totalCostUSD?: number;
    linesAdded?: number;
    linesRemoved?: number;
    durationMs?: number;
  };
  lastAssistantText?: string;
}

// ---------------------------------------------------------------------------
// git / gh
// ---------------------------------------------------------------------------

export interface Commit {
  sha: string;
  subject: string;
  at: string;
}

/** `Decisions:` / `Remaining:` / `Tried:` lines found in commit bodies. Same three fields
 *  gstack's continuous-checkpoint trailer writes, so those sessions get them for free. */
export interface Trailers {
  decisions: string[];
  remaining: string[];
  tried: string[];
}

export interface GitFacts {
  isRepo: boolean;
  root?: string;
  headSha?: string;
  branch?: string;
  detached: boolean;
  upstream?: string;
  /** The upstream is configured but no longer exists on the remote (`[gone]`), the
   *  normal state after a merged PR's branch is deleted. */
  upstreamGone: boolean;
  ahead: number;
  behind: number;
  /** `machineOwned` are untracked paths written by Claude Code or its plugins
   *  (`.claude/.coaching/`, `.claude/settings.local.json`, `ai-docs/sessions/`, …). They are
   *  listed, but they never make a tree "dirty": nobody loses work when they go. */
  dirty: { tracked: string[]; untracked: string[]; machineOwned: string[] };
  /** Commits not on the upstream; with no live upstream, commits not on origin/<default>. */
  unpushed: Commit[];
  /** Commits on this branch since `base`. */
  commits: Commit[];
  base?: string;
  baseSource?: "CLAUDE_BASE" | "worktree-state" | "merge-base";
  defaultBranch?: string;
  /** Whether `git fetch origin <default>` ran this time. When false, `mergedIntoDefault`
   *  and `remoteBranchExists` reflect the last fetch, which may be stale. */
  fetched: boolean;
  /** HEAD is an ancestor of origin/<default>. null when it could not be determined. */
  mergedIntoDefault: boolean | null;
  remoteBranchExists: boolean | null;
  worktree: {
    linked: boolean;
    gitDir?: string;
    commonDir?: string;
    name?: string;
    /** Under `<repo>/.claude/worktrees/`, i.e. created by Claude Code. */
    managedByClaude: boolean;
    lockReason?: string;
    lockPid?: number;
    claudeBase?: string;
  };
  trailers: Trailers;
  errors: string[];
}

export interface PrChecks {
  total: number;
  passing: number;
  failing: number;
  pending: number;
}

export interface PrFacts {
  /** false when gh could not answer at all (missing, unauthenticated, timed out). */
  available: boolean;
  reason?: string;
  /** true when gh answered and there is no PR for this branch. */
  none?: boolean;
  number?: number;
  url?: string;
  state?: "OPEN" | "MERGED" | "CLOSED";
  mergedAt?: string | null;
  mergeCommit?: string | null;
  isDraft?: boolean;
  reviewDecision?: string | null;
  baseRefName?: string;
  checks?: PrChecks;
}

// ---------------------------------------------------------------------------
// local session state
// ---------------------------------------------------------------------------

export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  name?: string;
  status?: string;
  startedAt?: number;
}

export interface Task {
  id: string;
  subject: string;
  status: string;
  blockedBy: string[];
  blocks: string[];
}

export interface PlanFileFacts {
  path: string;
  exists: boolean;
  sizeBytes?: number;
  modifiedAt?: string;
  title?: string;
  /** Markdown checkboxes, when the plan uses them. */
  checkboxes?: { done: number; open: number };
}

export interface DevSessionFacts {
  dir: string;
  checkpoint?: { lastCompletedPhase: string | null; nextPhase: string; resumable: boolean };
  status?: string;
  verdicts: string[];
  validation?: string;
  hasReport: boolean;
}

export interface PriorReport {
  path: string;
  modifiedAt: string;
  head: string;
}

// ---------------------------------------------------------------------------
// gate
// ---------------------------------------------------------------------------

export type GateVerdict =
  | "SAFE"
  | "SAFE_WITH_CONFIRMATION"
  | "NOT_SAFE"
  | "UNKNOWN"
  | "NOT_APPLICABLE";

export interface GateCheck {
  id: number;
  name: string;
  result: "pass" | "fail" | "unknown" | "skip";
  evidence: string;
  /** The exact next step when the check fails. */
  fix?: string;
}

export interface Gate {
  verdict: GateVerdict;
  checks: GateCheck[];
  reasons: string[];
  /** What removal would discard when the verdict is SAFE_WITH_CONFIRMATION. */
  discards?: string[];
  /** How to remove: the tool call for a Claude-managed worktree, manual commands otherwise. */
  removal?: string;
}

// ---------------------------------------------------------------------------
// bundle
// ---------------------------------------------------------------------------

export interface Bundle {
  generatedAt: string;
  cwd: string;
  sessionId?: string;
  sessionIdSource?: string;
  transcript: TranscriptFacts;
  git: GitFacts;
  pr: PrFacts;
  otherSessions: LiveSession[];
  tasks: Task[];
  planFile?: PlanFileFacts;
  devSessions: DevSessionFacts[];
  priorReport?: PriorReport;
  gate: Gate;
  errors: string[];
}
