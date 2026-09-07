/**
 * Pull-request facts via the `gh` CLI.
 *
 * The PR number comes from the transcript's `pr-link` record when the session created the
 * PR, so no guessing; otherwise `gh pr list --head <branch>` finds it. The repo's only
 * existing `gh --json` reader is `mergeCommit` in skills/release (used to tag the merge
 * commit); this adds state, mergedAt and checks for the worktree gate.
 *
 * `gh` failing is a fact too: not installed, not logged in, or too slow all yield
 * `available: false` with the reason, and the gate reports UNKNOWN rather than inventing
 * a merge state.
 */
import type { PrChecks, PrFacts, Runner } from "./types.ts";

const FIELDS = "number,url,state,mergedAt,mergeCommit,isDraft,reviewDecision,statusCheckRollup,baseRefName";

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null;

export function summariseChecks(rollup: unknown): PrChecks | undefined {
  if (!Array.isArray(rollup) || rollup.length === 0) return undefined;
  const c: PrChecks = { total: 0, passing: 0, failing: 0, pending: 0 };
  for (const item of rollup) {
    if (!isRec(item)) continue;
    c.total += 1;
    const v = String(item.conclusion ?? item.state ?? item.status ?? "").toUpperCase();
    if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(v)) c.passing += 1;
    else if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"].includes(v)) c.failing += 1;
    else c.pending += 1;
  }
  return c;
}

export function prFromJson(obj: unknown): PrFacts {
  if (!isRec(obj)) return { available: true, none: true };
  const mc = obj.mergeCommit;
  const state = String(obj.state ?? "").toUpperCase();
  return {
    available: true,
    number: typeof obj.number === "number" ? obj.number : undefined,
    url: typeof obj.url === "string" ? obj.url : undefined,
    state: state === "OPEN" || state === "MERGED" || state === "CLOSED" ? state : undefined,
    mergedAt: typeof obj.mergedAt === "string" ? obj.mergedAt : null,
    mergeCommit: isRec(mc) && typeof mc.oid === "string" ? mc.oid : null,
    isDraft: obj.isDraft === true,
    reviewDecision: typeof obj.reviewDecision === "string" ? obj.reviewDecision : null,
    baseRefName: typeof obj.baseRefName === "string" ? obj.baseRefName : undefined,
    checks: summariseChecks(obj.statusCheckRollup),
  };
}

function failure(r: { missing: boolean; timedOut: boolean; stderr: string }, timeoutMs: number): PrFacts {
  if (r.missing) return { available: false, reason: "gh is not installed" };
  if (r.timedOut) return { available: false, reason: `gh timed out after ${timeoutMs} ms` };
  const err = r.stderr.trim();
  if (/not logged in|auth login|authentication|GH_TOKEN/i.test(err)) return { available: false, reason: "gh is not authenticated (run `gh auth login`)" };
  if (/no pull requests found|Could not resolve to a PullRequest/i.test(err)) return { available: true, none: true };
  return { available: false, reason: `gh failed: ${err.split("\n")[0] ?? "unknown error"}` };
}

export function collectPr(
  run: Runner,
  cwd: string,
  branch: string | undefined,
  hint: number | undefined,
  timeoutMs: number,
): PrFacts {
  if (hint === undefined && !branch) return { available: true, none: true };
  const args = hint !== undefined
    ? ["pr", "view", String(hint), "--json", FIELDS]
    : ["pr", "list", "--head", branch!, "--state", "all", "--limit", "1", "--json", FIELDS];
  const r = run("gh", args, { cwd, timeoutMs });
  if (!r.ok) return failure(r, timeoutMs);
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout);
  } catch {
    return { available: false, reason: "gh returned unparseable JSON" };
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return { available: true, none: true };
    return prFromJson(parsed[0]);
  }
  return prFromJson(parsed);
}

/** Only consulted when git could not name the default branch. */
export function defaultBranchFromGh(run: Runner, cwd: string, timeoutMs: number): string | undefined {
  const r = run("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], { cwd, timeoutMs });
  const name = r.ok ? r.stdout.trim() : "";
  return name || undefined;
}
