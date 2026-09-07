/**
 * The worktree gate: can this worktree be removed without losing anything?
 *
 * Pure. Every check names its evidence and, when it fails, the exact next step, so the
 * report never says "not safe" without saying why and what to do. The verdicts:
 *
 *   SAFE                    nothing here that is not already on the default branch
 *   SAFE_WITH_CONFIRMATION  the PR is merged but the commits are not ancestors of the
 *                           default branch (squash or rebase merge). Removal needs
 *                           `discard_changes: true`, so the user confirms after seeing
 *                           the merge commit that proves the content landed.
 *   NOT_SAFE                something would be lost, or someone is still working here
 *   UNKNOWN                 no PR record and no git-only proof of a merge
 *   NOT_APPLICABLE          not a linked worktree
 *
 * Removal never uses `rm -rf` or `--force`. For a Claude-managed worktree the tool is
 * `ExitWorktree`, which refuses on its own when uncommitted files or unmerged commits
 * exist; for a hand-made worktree the report prints the manual commands.
 */
import type { Gate, GateCheck, GitFacts, LiveSession, PrFacts } from "./types.ts";

export interface GateInput {
  git: GitFacts;
  pr: PrFacts;
  otherSessions: LiveSession[];
  /** The worktree lock is held by a live process that is not this session. */
  lockHeldByOther: boolean;
}

const list = (items: string[], max = 8): string =>
  items.length <= max ? items.join(", ") : `${items.slice(0, max).join(", ")} (+${items.length - max} more)`;

export function evaluateGate(input: GateInput): Gate {
  const { git, pr, otherSessions } = input;
  const checks: GateCheck[] = [];
  const reasons: string[] = [];

  if (!git.isRepo) return { verdict: "NOT_APPLICABLE", checks, reasons: ["not a git repository"] };
  if (!git.worktree.linked)
    return { verdict: "NOT_APPLICABLE", checks, reasons: ["this is the main checkout, not a linked worktree"] };

  // 1 — identity
  checks.push({
    id: 1,
    name: "linked worktree",
    result: "pass",
    evidence: git.worktree.managedByClaude
      ? `Claude-managed worktree "${git.worktree.name}" at ${git.root}`
      : `hand-made worktree "${git.worktree.name}" at ${git.root}`,
  });

  // 2 — clean tree
  const dirtyCount = git.dirty.tracked.length + git.dirty.untracked.length;
  const clean = dirtyCount === 0;
  const ignoredNote = git.dirty.machineOwned.length ? ` (ignored ${git.dirty.machineOwned.length} machine-owned: ${list(git.dirty.machineOwned, 3)})` : "";
  checks.push({
    id: 2,
    name: "clean tree",
    result: clean ? "pass" : "fail",
    evidence:
      (clean
        ? "no tracked changes, no untracked files"
        : `${git.dirty.tracked.length} tracked changed, ${git.dirty.untracked.length} untracked: ${list([...git.dirty.tracked, ...git.dirty.untracked])}`) + ignoredNote,
    fix: clean ? undefined : "commit what should ship, delete or move what should not, then run /dev:status again",
  });
  if (!clean) reasons.push("uncommitted or untracked files");

  // 3 — nothing unpushed
  const nothingToPush = git.commits.length === 0;
  let pushed: GateCheck["result"];
  let pushEvidence: string;
  const liveUpstream = !!git.upstream && !git.upstreamGone;
  if (nothingToPush) {
    pushed = "pass";
    pushEvidence = "no commits on this branch beyond its base";
  } else if (liveUpstream) {
    pushed = git.unpushed.length === 0 ? "pass" : "fail";
    pushEvidence = git.unpushed.length === 0 ? `upstream ${git.upstream} has every commit` : `${git.unpushed.length} unpushed: ${list(git.unpushed.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`), 5)}`;
  } else if (git.mergedIntoDefault === true) {
    pushed = "pass";
    pushEvidence = `${git.upstreamGone ? `upstream ${git.upstream} is gone` : "no upstream"}, but HEAD is already on origin/${git.defaultBranch}`;
  } else {
    pushed = "fail";
    pushEvidence = git.upstreamGone
      ? `upstream ${git.upstream} was deleted on the remote and ${git.unpushed.length} commit(s) are not on origin/${git.defaultBranch}: ${list(git.unpushed.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`), 5)}`
      : `${git.commits.length} commits and no upstream branch`;
  }
  checks.push({
    id: 3,
    name: "pushed",
    result: pushed,
    evidence: pushEvidence + (git.fetched ? "" : " (no fetch this run; remote state may be stale)"),
    fix: pushed === "fail" ? (liveUpstream ? "git push" : `git push -u origin ${git.branch ?? "<branch>"}`) : undefined,
  });
  if (pushed === "fail") reasons.push("unpushed commits");

  // 4 — PR merged
  let prResult: GateCheck["result"];
  let prEvidence: string;
  let prFix: string | undefined;
  if (nothingToPush && (!pr.available || pr.none)) {
    // Nothing on this branch beyond its base, so there is nothing a PR could carry.
    // Measured in the DST-1 probe: a fresh worktree with gh disabled scored UNKNOWN here
    // and blocked a SAFE verdict over a merge state that does not exist.
    prResult = "skip";
    prEvidence = pr.available ? "no PR, and nothing to merge" : `nothing to merge; gh not consulted (${pr.reason ?? "unavailable"})`;
  } else if (!pr.available) {
    prResult = "unknown";
    prEvidence = pr.reason ?? "gh unavailable";
    prFix = "make `gh` work (install, `gh auth login`) or check the PR by hand";
  } else if (pr.none) {
    prResult = "unknown";
    prEvidence = "no PR found for this branch";
    prFix = "gh pr create --fill, then merge it";
  } else if (pr.state === "MERGED") {
    prResult = "pass";
    prEvidence = `PR #${pr.number} merged ${pr.mergedAt ?? ""}${pr.mergeCommit ? ` as ${pr.mergeCommit.slice(0, 7)}` : ""}`;
  } else if (pr.state === "OPEN") {
    prResult = "fail";
    const c = pr.checks;
    prEvidence = `PR #${pr.number} is open${pr.isDraft ? " (draft)" : ""}${c ? `; checks ${c.passing}/${c.total} passing, ${c.failing} failing, ${c.pending} pending` : ""}${pr.reviewDecision ? `; review ${pr.reviewDecision}` : ""}`;
    prFix = c && c.failing > 0 ? `fix the ${c.failing} failing check(s) on PR #${pr.number}, then merge` : `merge PR #${pr.number} (${pr.url ?? ""})`;
  } else {
    prResult = "fail";
    prEvidence = `PR #${pr.number} is ${pr.state ?? "in an unknown state"} and not merged`;
    prFix = "reopen or recreate the PR, then merge";
  }
  checks.push({ id: 4, name: "PR merged", result: prResult, evidence: prEvidence, fix: prFix });
  if (prResult === "fail") reasons.push(pr.state === "OPEN" ? "PR still open" : "PR not merged");

  // 5 — squash/rebase merge: PR says merged, ancestry says no
  const squash = pr.state === "MERGED" && git.mergedIntoDefault === false && git.commits.length > 0;
  checks.push({
    id: 5,
    name: "commits on default branch",
    result: git.mergedIntoDefault === true || nothingToPush ? "pass" : squash ? "unknown" : git.mergedIntoDefault === null ? "unknown" : "fail",
    evidence:
      git.mergedIntoDefault === true || nothingToPush
        ? `HEAD is an ancestor of origin/${git.defaultBranch ?? "<default>"}`
        : squash
          ? `PR merged but the ${git.commits.length} branch commits are not ancestors of origin/${git.defaultBranch} (squash or rebase merge)`
          : git.mergedIntoDefault === null
            ? "could not compare against the default branch"
            : `${git.commits.length} commits not on origin/${git.defaultBranch}`,
  });

  // 6 — nobody else here
  const others = otherSessions.length === 0 && !input.lockHeldByOther;
  checks.push({
    id: 6,
    name: "no other live session",
    result: others ? "pass" : "fail",
    evidence: others
      ? "no other Claude Code session has this directory as cwd"
      : otherSessions.length
        ? `live sessions here: ${list(otherSessions.map((s) => `${s.name ?? s.sessionId.slice(0, 8)} (pid ${s.pid})`))}`
        : `worktree lock held by another live process${git.worktree.lockPid ? ` (pid ${git.worktree.lockPid})` : ""}`,
    fix: others ? undefined : "finish or close the other session first",
  });
  if (!others) reasons.push("another session is working here");

  // Verdict
  const hardFail = !clean || pushed === "fail" || prResult === "fail" || !others;
  let verdict: Gate["verdict"];
  if (hardFail) verdict = "NOT_SAFE";
  else if (nothingToPush) verdict = "SAFE"; // clean, nothing beyond base: nothing a removal could lose
  else if (squash) verdict = "SAFE_WITH_CONFIRMATION";
  else if (prResult === "pass") verdict = "SAFE";
  else if (git.mergedIntoDefault === true && git.remoteBranchExists === false) {
    // Claude Code's own rule for a merged worktree: remote branch gone, commits on default.
    verdict = "SAFE";
    reasons.push(`merged detected from git alone: origin/${git.branch} is gone and HEAD is on origin/${git.defaultBranch}`);
  } else verdict = "UNKNOWN";

  if (verdict === "UNKNOWN" && reasons.length === 0)
    reasons.push(prResult === "unknown" ? (prFix ? `${prEvidence}; ${prFix}` : prEvidence) : "merge state could not be established");

  const gate: Gate = { verdict, checks, reasons };
  if (squash) gate.discards = git.commits.map((c) => `${c.sha.slice(0, 7)} ${c.subject}`);
  if (verdict === "SAFE" || verdict === "SAFE_WITH_CONFIRMATION") {
    gate.removal = git.worktree.managedByClaude
      ? squash
        ? 'ExitWorktree({ action: "remove", discard_changes: true }) — after the user confirms the list above'
        : 'ExitWorktree({ action: "remove" })'
      : `from the main checkout: git worktree remove "${git.root}" && git branch -d ${git.branch ?? "<branch>"}`;
  }
  return gate;
}
