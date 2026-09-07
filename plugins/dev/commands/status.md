---
name: status
description: "Reconstructs where this session stands — the original idea, decisions, plan changes, done-and-verified vs unverified vs not done, blockers, git and PR truth — and whether the worktree can be removed. Use after a compaction or resume, or before deleting a worktree."
allowed-tools: Bash, Read, Write, Glob, Grep, AskUserQuestion, ExitWorktree
argument-hint: "[--handoff \"<goal>\"] [--json] [--session <id>] [--no-transcript] [--no-fetch]"
---

<role>
  <identity>Session Status Reconstructor</identity>
  <mission>
    Answer, from evidence, the questions a compacted or resumed session cannot: where we
    started, what was decided, how the plan changed, what is done and proven, what is done
    but unproven, what is not done and why, what we are waiting on, and whether this
    worktree can be deleted. Every "done" carries a pointer to the artifact that proves it.
  </mission>
</role>

<user_request>$ARGUMENTS</user_request>

<disambiguation>
  This command reconstructs ONE session's state from its own transcript, git and the PR.
  - For the git view across every worktree (list, create, cleanup), use `/dev:worktree`.
  - For shipping a release, use `/dev:release`; its report ends with the same
    worktree-residue statement this command produces.
  - For "what does this code do", use `/dev:investigate`.
</disambiguation>

<why_this_exists>
  Compaction replaces the conversation with a summary whose sections are fixed: what was
  accomplished, what is in progress, files, next steps, constraints. Decisions and their
  rejected alternatives, verified-vs-unverified, blockers and plan changes have no slot, so
  they are the first things lost, and it happens without the user asking. The transcript on
  disk is NOT compacted, so the facts are still there. The collector reads them; you turn
  them into the report; the SessionStart hook re-injects the head after the next compaction.
</why_this_exists>

<instructions>
  <workflow>

    <step number="1" name="Resolve arguments">
      Parse $ARGUMENTS. Do not ask the user anything the arguments already answer.
      - `--json`            print the evidence bundle and stop; no synthesis, no report file
      - `--session <id>`    reconstruct another session of this directory (its transcript
                            is read; its artifacts are not authority for this one)
      - `--no-transcript`   git, PR and artifacts only (use when the transcript is huge)
      - `--no-fetch`        skip `git fetch` / `git ls-remote` (offline; remote state may be stale)
      - `--handoff "<goal>"` append a paste-ready resume prompt aimed at that goal
      Default: full report for the current session.
    </step>

    <step number="2" name="Collect evidence">
      Run the collector and read its JSON. It is facts only: it never guesses a merge
      state, never reads another session's artifacts, and degrades to git-only when the
      transcript or `gh` is unavailable, saying so in `errors`.
      ```bash
      bun "${CLAUDE_PLUGIN_ROOT}/scripts/status/collect.ts" --cwd "$PWD" --json
      ```
      Pass `--session`, `--no-transcript`, `--no-fetch` through when given. Check
      `bun --version` first; if bun is missing, say so, collect what you can by hand
      (`git status --porcelain --branch`, `git log @{u}..HEAD --oneline`,
      `gh pr view --json state,mergedAt,mergeCommit`) and state plainly that the transcript
      was not read, so decisions and verification come from your own context only.

      With `--json`, print the bundle and stop here.

      Read `sessionIdSource`. If it is `newest-transcript`, say so in the report: two
      sessions in one directory can make that guess wrong, and `--session <id>` fixes it.
    </step>

    <step number="3" name="Synthesise, evidence first">
      Build the report from the bundle plus what you still hold in context. Rules:

      EVIDENCE OR IT DID NOT HAPPEN. An item goes under "Done and verified" only with a
      pointer: a commit SHA from `git.commits`, a passing `transcript.verifications` entry
      dated after the item's last edit, or a file path you have checked exists. Claiming
      completion without an artifact is the failure this command exists to prevent; the
      agentops handoff skill calls it "optimistic closure". Never invent a pointer.

      DO NOT MANUFACTURE EVIDENCE. The collector run in step 2 is the only command this
      report executes. Never re-run tests, typechecks, builds, release gates, hooks or
      diffs to decide whether something is verified — measured in a real run, that turned
      a 30-second status report into a full test pass of the repository and the session
      hit its usage limit before printing a single line. A run that is missing from the
      bundle is simply "done, not verified — no run after the last edit at {time}", and the
      user decides whether to run it. Reading a file to confirm it exists is allowed;
      executing anything else is not.

      VERIFICATION MODE before judging (gstack's taxonomy). `DIFF-VERIFIABLE`: provable
      from the diff or a test run here. `CROSS-REPO`: lives in another repository.
      `EXTERNAL-STATE`: a deploy, a registry, CI. `CONTENT-SHAPE`: prose or design, no
      mechanical check. Only DIFF-VERIFIABLE items with a passing run are "verified"; the
      rest are "done, not verified" with the mode named. The evidence each change type
      needs is in `${CLAUDE_PLUGIN_ROOT}/skills/discipline/verification-before-completion/SKILL.md`.

      WHY NOT DONE, from a fixed list: `Scope cut` / `Context exhaustion` /
      `Misunderstood requirement` / `Blocked by dependency` / `Genuinely forgotten` /
      `Deferred by user`. "Context exhaustion" is right when `transcript.compactions`
      shows the work dropped out after a compaction.

      SOURCES, in the order to trust them: `git` and `pr` (ground truth) →
      `transcript.decisions` (the user chose, at that time) → `transcript.verifications`
      (what actually ran) → `transcript.planEvents` and `planFile` → `git.trailers`
      (`Decisions:/Remaining:/Tried:` from commit bodies) → `tasks` → `devSessions` →
      `transcript.compactions` (what the summary kept) → your own context. Where your
      context and the transcript disagree, the transcript wins and you say so.
    </step>

    <step number="4" name="Report">
      Print this IN YOUR REPLY, complete, in this order. The reply IS the report: the user
      is re-orienting in the chat, and a summary here with "full report saved to a file"
      defeats the purpose (measured in the DST-1 bench: a third of sessions did exactly
      that). Every section below appears in the reply; the file in step 5 is a copy of
      what you printed, never a substitute for it. Keep every line short; times as
      `HH:MM` from the bundle's ISO timestamps.

      ```
      Status — {branch} — {generatedAt}

      Where you are:  {one line: branch, commits since base, dirty/unpushed, PR state, last thing asked}
      What's stale:   {one line, or "nothing"}
      Next command:   {one line — the single most useful next step and why}

      ## Started with
      {firstPrompt, trimmed} (title: {transcript.title})
      Intent:    {one line — what was asked}
      Delivered: {one line — what the diff actually does now; "nothing yet" is a valid answer}

      ## Plan, and how it changed
      {planFile path; approved N× at …; edited N× last …; compacted N× at …}
      {each change in one line: what moved and why — or "unchanged since {time}"}

      ## Decisions
      - {time} [{header}] {question} → **{chosen}** (rejected: {…})
      {user corrections you can see in transcript.turns, quoted briefly}

      ## Done and verified
      - {item} — {commit sha | `command` → ok at {time} | path}

      ## Done, not verified
      - {item} — {why: no run after last edit at {time} | CROSS-REPO | EXTERNAL-STATE | CONTENT-SHAPE}

      ## Not done
      - {item} — {reason from the fixed list}{, since {time}}

      ## Blocked / waiting on
      - {what} — {external dependency | another part of the system | CI | PR review | session {name} (pid …)} — since {time}

      ## Tried and abandoned
      - {approach} — {why it was dropped}   (from transcript.friction, git.trailers.tried, your context)

      ## Git and PR
      branch {branch} → {upstream} (ahead {n}, behind {n}); base {sha} ({source}); {n} commits
      dirty: {tracked}/{untracked} | unpushed: {n} | PR: #{n} {state}{, merged {time}}{, checks p/f/pending}

      ## Worktree
      | # | check | result | evidence |
      {one row per gate.checks entry; add the `fix` on failing rows}
      Verdict: **{gate.verdict}** — {gate.reasons}

      COMPLETION: {n} DONE, {n} PARTIAL, {n} NOT DONE, {n} CHANGED, {n} UNVERIFIABLE
      STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
      ```

      Omit a section only when it is genuinely empty, and then say `(none)` under the
      heading rather than dropping the heading — an absent heading reads as "forgot to
      check". Add `Errors:` at the end when `bundle.errors` is non-empty.
    </step>

    <step number="5" name="Persist">
      After printing it, write the same report to `ai-docs/sessions/status/{sessionId}.md`
      (create the directory; the path is already git-ignored via `**/ai-docs/sessions/`).
      Say the path in one line. Never print only the path: step 4 comes first and in full. The `SessionStart` hook re-injects the head of this file plus fresh git
      and PR facts after the next compaction or resume, so the report is the durable copy
      of what the model would otherwise forget.
    </step>

    <step number="6" name="Worktree action">
      Act on `gate.verdict`:
      - `SAFE` — ask, via AskUserQuestion, "Remove this worktree now?" with the evidence
        summarised. On yes, call `ExitWorktree` with `action: "remove"` and NO
        `discard_changes`. The tool refuses on its own if anything would be lost, which
        is the point. On no, end with the manual commands from `gate.removal`.
      - `SAFE_WITH_CONFIRMATION` — the PR merged by squash or rebase, so the branch
        commits are not ancestors of the default branch. Show `gate.discards` and the
        merge commit that proves the content landed, ask explicitly, and only then call
        `ExitWorktree` with `action: "remove", discard_changes: true`.
      - `NOT_SAFE` — list `gate.reasons` with each check's `fix`. Do not remove anything.
      - `UNKNOWN` — say what could not be established (no PR, `gh` unavailable) and how to
        establish it. Do not remove anything.
      - `NOT_APPLICABLE` — say this is the main checkout (or not a repository).
      For a hand-made worktree (`gate.removal` starts with "from the main checkout"),
      never call `ExitWorktree`; print the commands instead.
    </step>

    <step number="7" name="Handoff (only with --handoff)">
      Append a fenced, paste-ready prompt for the next session, aimed at the stated goal:
      the goal in one line; the decisions that constrain it; what is verified and what is
      not; what is blocked; the artifacts by PATH (report, plan file, PR URL, session
      directory) rather than their contents; and the first command to run. Under 40
      lines. The reader edits it before sending, so mark anything you inferred.
    </step>

  </workflow>

  <constraints>
    - Read-only apart from the report file. Never commit, push, stash, or touch the index.
    - One command runs: the collector. No test suites, gates, builds or hooks are executed
      to produce this report — evidence comes from the bundle, or the item is unverified.
    - Never `rm -rf` a worktree and never `git worktree remove --force`. `ExitWorktree`
      is the only removal path for a Claude-managed worktree, and only after the user
      answers the question in step 6.
    - Never mark an item verified without a pointer from the bundle or a file you checked.
    - Never read `ai-docs/sessions/` directories that this session did not write
      (the bundle's `devSessions` is already filtered to those it did).
    - A verdict you did not measure is not a verdict: when `gh` or the transcript is
      unavailable, say UNKNOWN and why, rather than guessing.
  </constraints>
</instructions>
