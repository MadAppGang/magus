/**
 * Deterministic markdown for the facts a session must not lose across a compaction.
 *
 * This is what the SessionStart hook injects and what `collect.ts --md` prints. It is
 * facts only: the narrative sections (the idea, why something is not done) are the
 * model's job in commands/status.md. The top three lines follow `/modernize-status`
 * ("Where you are / What's stale / Next command") because a reader who stops after the
 * first line must still have the answer.
 */
import type { Bundle, VerificationEvent } from "./types.ts";

/** One line, at most n chars: newlines inside a quoted prompt would break the bullet. */
const short = (s: string, n: number): string => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};
const when = (iso: string | undefined): string => (iso ? iso.replace("T", " ").replace(/\.\d+Z$/, "Z") : "");

function verifyLine(v: VerificationEvent): string {
  const mark = v.ok === true ? "ok" : v.ok === false ? "FAILED" : "no result";
  return `- ${when(v.at)} ${v.kind}: \`${short(v.command, 90)}\` → ${mark}${v.detail ? ` (${v.detail})` : ""}`;
}

export function whereYouAre(b: Bundle): string {
  const g = b.git;
  const parts: string[] = [];
  if (g.isRepo) {
    parts.push(g.detached ? "detached HEAD" : `on ${g.branch ?? "?"}`);
    if (g.commits.length) parts.push(`${g.commits.length} commit${g.commits.length === 1 ? "" : "s"} since base`);
    const dirty = g.dirty.tracked.length + g.dirty.untracked.length;
    if (dirty) parts.push(`${dirty} uncommitted`);
    if (g.unpushed.length) parts.push(`${g.unpushed.length} unpushed`);
  }
  if (b.pr.number) parts.push(`PR #${b.pr.number} ${b.pr.state?.toLowerCase() ?? ""}`.trim());
  const t = b.transcript;
  const last = [...t.turns].reverse().find((x) => x.kind === "prompt" || x.command);
  if (last) parts.push(`last asked: "${short(last.kind === "command" ? `/${last.command} ${last.text}` : last.text, 100)}"`);
  if (t.compactions.length) parts.push(`${t.compactions.length} compaction${t.compactions.length === 1 ? "" : "s"}`);
  return parts.join("; ") || "no evidence collected";
}

export function whatIsStale(b: Bundle): string {
  const out: string[] = [];
  const lastCommitAt = b.git.commits[0]?.at ?? b.git.unpushed[0]?.at;
  const lastVerify = [...b.transcript.verifications].reverse().find((v) => v.kind !== "commit" && v.kind !== "push" && v.kind !== "pr");
  const dirty = b.git.dirty.tracked.length + b.git.dirty.untracked.length;
  if (dirty && (!lastVerify || lastVerify.ok !== true)) out.push("uncommitted edits with no passing verification after them");
  else if (lastCommitAt && lastVerify && lastVerify.at < lastCommitAt) out.push("last passing verification predates the last commit");
  else if (!lastVerify && (dirty || b.git.commits.length)) out.push("no test, typecheck or build was run this session");
  if (b.planFile?.exists && lastCommitAt && b.planFile.modifiedAt && b.planFile.modifiedAt < lastCommitAt)
    out.push("plan file predates the last commit (plan may not reflect what was built)");
  if (!b.pr.available) out.push(`PR state unknown: ${b.pr.reason}`);
  if (!b.git.fetched && b.git.isRepo) out.push("remote not fetched this run");
  if (!b.transcript.parsed) out.push(`transcript not read: ${b.transcript.skippedReason}`);
  return out.join("; ") || "nothing";
}

export function nextCommand(b: Bundle): string {
  const g = b.git;
  // Only the LATEST run of each kind counts: a failure followed by a passing run is fixed.
  const latestByKind = new Map<string, VerificationEvent>();
  for (const v of b.transcript.verifications) if (["test", "typecheck", "lint", "build", "check"].includes(v.kind)) latestByKind.set(v.kind, v);
  const failing = [...latestByKind.values()].reverse().find((v) => v.ok === false);
  const dirty = g.dirty.tracked.length + g.dirty.untracked.length;
  if (failing) return `fix the failing ${failing.kind} (\`${short(failing.command, 60)}\`)`;
  if (b.tasks.some((t) => t.status === "in_progress")) return `finish task "${b.tasks.find((t) => t.status === "in_progress")!.subject}"`;
  if (dirty) return "run the tests, then commit";
  if (g.unpushed.length) return g.upstream ? "git push" : `git push -u origin ${g.branch ?? ""}`.trim();
  if (b.pr.state === "OPEN") {
    const c = b.pr.checks;
    return c && c.failing ? `fix ${c.failing} failing check(s) on PR #${b.pr.number}` : `wait for PR #${b.pr.number} to merge`;
  }
  if (b.gate.verdict === "SAFE" || b.gate.verdict === "SAFE_WITH_CONFIRMATION") return "worktree can go: /dev:status offers the removal";
  if (b.pr.none && g.commits.length) return "gh pr create --fill";
  const open = b.tasks.filter((t) => t.status !== "completed");
  if (open.length) return `next task: "${open[0]!.subject}"`;
  if (b.git.trailers.remaining.length) return `remaining: ${short(b.git.trailers.remaining[0]!, 80)}`;
  return "nothing pending in the evidence; continue from the last prompt";
}

export interface RenderOptions {
  maxChars: number;
  /** "compact" | "resume" | "manual" — named in the header so the reader knows why it appeared. */
  source?: string;
  includePriorReport?: boolean;
}

/** True when there is nothing worth injecting: fresh session, clean tree, no decisions. */
export function nothingToReport(b: Bundle): boolean {
  const g = b.git;
  const t = b.transcript;
  return (
    t.decisions.length === 0 &&
    t.verifications.length === 0 &&
    t.compactions.length === 0 &&
    b.tasks.length === 0 &&
    g.commits.length === 0 &&
    g.unpushed.length === 0 &&
    g.dirty.tracked.length + g.dirty.untracked.length === 0 &&
    !b.pr.number &&
    !b.priorReport &&
    g.trailers.remaining.length + g.trailers.decisions.length + g.trailers.tried.length === 0
  );
}

export function renderHead(b: Bundle, opts: RenderOptions): string {
  const L: string[] = [];
  const sid = b.sessionId ? b.sessionId.slice(0, 8) : "unknown session";
  const reinjected = opts.source && opts.source !== "manual";
  L.push(`## Status${reinjected ? ` re-injected after ${opts.source}` : ""} — ${when(b.generatedAt)} (session ${sid})`);
  L.push("");
  L.push(`**Where you are:** ${whereYouAre(b)}`);
  L.push(`**What's stale:** ${whatIsStale(b)}`);
  L.push(`**Next command:** ${nextCommand(b)}`);

  const t = b.transcript;
  if (t.firstPrompt) {
    L.push("", `**Started with:** ${short(t.firstPrompt.replace(/\s+/g, " "), 300)}`);
    if (t.title) L.push(`**Title:** ${t.title}`);
  }

  if (t.decisions.length || b.git.trailers.decisions.length) {
    L.push("", `### Decisions (${t.decisions.length + b.git.trailers.decisions.length})`);
    for (const d of t.decisions.slice(-8))
      L.push(`- ${when(d.at)} ${d.header ? `[${d.header}] ` : ""}${short(d.question, 120)} → **${short(d.chosen, 120)}**${d.rejected.length ? ` (rejected: ${d.rejected.map((r) => short(r, 40)).join(", ")})` : ""}`);
    for (const d of b.git.trailers.decisions.slice(-5)) L.push(`- (commit trailer) ${short(d, 160)}`);
  }

  if (t.planEvents.length) {
    const approvals = t.planEvents.filter((p) => p.kind === "approved");
    const edits = t.planEvents.filter((p) => p.kind === "edit");
    L.push("", "### Plan");
    if (t.planFile) L.push(`- file: ${t.planFile}${b.planFile?.exists === false ? " (missing)" : ""}${b.planFile?.checkboxes ? ` — ${b.planFile.checkboxes.done} done / ${b.planFile.checkboxes.open} open` : ""}`);
    L.push(`- approved ${approvals.length}× ${approvals.map((a) => when(a.at)).join(", ")}; edited ${edits.length}×${edits.length ? `, last ${when(edits[edits.length - 1]!.at)}` : ""}`);
    if (t.compactions.length) L.push(`- compacted ${t.compactions.length}×: ${t.compactions.map((c) => when(c.at)).join(", ")}`);
  }

  if (t.verifications.length) {
    L.push("", `### Verification (last ${Math.min(6, t.verifications.length)} of ${t.verifications.length})`);
    for (const v of t.verifications.slice(-6)) L.push(verifyLine(v));
  }

  const open = b.tasks.filter((x) => x.status !== "completed");
  if (open.length || b.git.trailers.remaining.length) {
    L.push("", "### Not done");
    for (const x of open.slice(0, 10)) L.push(`- [${x.status}] ${short(x.subject, 120)}${x.blockedBy.length ? ` (blocked by ${x.blockedBy.join(", ")})` : ""}`);
    for (const r of b.git.trailers.remaining.slice(-5)) L.push(`- (commit trailer) ${short(r, 160)}`);
  }

  const blocked: string[] = [];
  for (const x of open.filter((x) => x.blockedBy.length)) blocked.push(`task "${short(x.subject, 80)}" blocked by ${x.blockedBy.join(", ")}`);
  for (const s of b.otherSessions) blocked.push(`another session here: ${s.name ?? s.sessionId.slice(0, 8)} (pid ${s.pid}, ${s.status ?? "live"})`);
  if (b.pr.state === "OPEN") blocked.push(`PR #${b.pr.number} awaiting ${b.pr.checks && b.pr.checks.failing ? "fixed checks" : b.pr.reviewDecision === "APPROVED" ? "merge" : "review"}`);
  if (blocked.length) {
    L.push("", "### Blocked / waiting on");
    for (const x of blocked) L.push(`- ${x}`);
  }

  if (b.git.trailers.tried.length || t.friction.length) {
    L.push("", "### Tried / friction");
    for (const x of b.git.trailers.tried.slice(-5)) L.push(`- (commit trailer) ${short(x, 160)}`);
    for (const f of t.friction.slice(-5)) L.push(`- ${when(f.at)} ${f.tool}: ${short(f.error, 140)}`);
  }

  const g = b.git;
  if (g.isRepo) {
    L.push("", "### Git and PR");
    L.push(`- branch ${g.branch ?? "(detached)"}${g.upstream ? ` → ${g.upstream} (ahead ${g.ahead}, behind ${g.behind})` : " (no upstream)"}; base ${g.base ? `${g.base.slice(0, 7)} (${g.baseSource})` : "unknown"}; default ${g.defaultBranch ?? "unknown"}${g.fetched ? "" : ", not fetched"}`);
    if (g.commits.length) L.push(`- commits: ${g.commits.slice(0, 6).map((c) => `${c.sha.slice(0, 7)} ${short(c.subject, 60)}`).join("; ")}${g.commits.length > 6 ? ` (+${g.commits.length - 6})` : ""}`);
    const dirty = [...g.dirty.tracked, ...g.dirty.untracked];
    if (dirty.length) L.push(`- dirty: ${dirty.slice(0, 8).join(", ")}${dirty.length > 8 ? ` (+${dirty.length - 8})` : ""}`);
    if (g.unpushed.length) L.push(`- unpushed: ${g.unpushed.length}`);
    L.push(
      `- PR: ${
        b.pr.number
          ? `#${b.pr.number} ${b.pr.state}${b.pr.mergedAt ? ` merged ${when(b.pr.mergedAt)}` : ""}${b.pr.checks ? `, checks ${b.pr.checks.passing}/${b.pr.checks.total} ok` : ""}`
          : b.pr.available
            ? "none"
            : `unknown (${b.pr.reason})`
      }`,
    );
    L.push(`- worktree gate: **${b.gate.verdict}**${b.gate.reasons.length ? ` — ${b.gate.reasons.join("; ")}` : ""}${b.gate.removal ? ` — removal: ${b.gate.removal}` : ""}`);
  }

  if (opts.includePriorReport && b.priorReport) {
    L.push("", `### From the last /dev:status report (${when(b.priorReport.modifiedAt)}, ${b.priorReport.path})`);
    L.push(b.priorReport.head);
  }

  let text = L.join("\n");
  if (text.length > opts.maxChars) {
    const cut = text.lastIndexOf("\n", opts.maxChars - 60);
    text = `${text.slice(0, cut > 0 ? cut : opts.maxChars - 60)}\n… (truncated; run /dev:status for the full report)`;
  }
  return text;
}
