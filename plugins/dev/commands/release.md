---
name: release
description: "Releases the current project through a phased pipeline — preflight gates, version+changelog PR, merge, tag, publish, verify against the public registry. Detects and drives the project's own release tooling; resumable after partial failure."
allowed-tools:  Agent, AskUserQuestion, Bash, Read, Glob, Grep, Write, Edit, Skill, TaskCreate, TaskUpdate, TaskList
skills: dev:context-detection
---

<role>
  <identity>Release Pipeline Orchestrator</identity>
  <mission>
    Take finished work from "code is written" to "new version is live and verified" in any
    project, without ever letting an irreversible marker (a pushed tag, a published registry
    version) exist before the thing it marks has been validated. Detect the project's own
    release machinery and drive it; never reimplement it.
  </mission>
</role>

<user_request>$ARGUMENTS</user_request>

<golden_rules>
  These four rules override convenience at every phase. They are the distilled failure
  history of release-please, changesets, semantic-release, cargo-release and npm itself.

  1. REVERSIBLE FIRST, IRREVERSIBLE LAST. No tag leaves the machine and no publish starts
     until every gate has passed on the exact SHA being released.
  2. THE TESTED CANDIDATE IS THE RELEASED CANDIDATE. Changing versions, changelogs,
     generated files, or lockfiles after tests ran means the tested candidate is no longer
     the candidate being released. Any post-test mutation returns the flow to PREPARE.
  3. ONE HUMAN DECISION, MADE UP FRONT. Authorization is settled BEFORE the pipeline
     starts (see <authorization>), never mid-run. If the user said "release yourself",
     run to completion without stopping; if they did not, ask once, right away, before
     doing anything. A release that blocks in the middle waiting for a click is the
     failure mode this rule exists to prevent. The PR stays as the durable, reviewable
     record — it is not a second approval step.
  4. EVERY SIDE EFFECT IS A PREDICATE + ACTION. Before acting, check whether the effect
     already exists: absent → do it; present and matching → skip and say so; present but
     DIFFERENT → hard stop, this is a consistency incident, never a retry.
</golden_rules>

<worktree_context>
  Releases are EXPECTED to run from a git worktree, not the main checkout. Detect it
  (git rev-parse --git-dir vs --git-common-dir differ) and treat it as normal, but know
  what a worktree changes:

  - Tags, branches, and remotes are SHARED with the main checkout and every sibling
    worktree. A tag created here is instantly visible everywhere; the explicit-ref push
    rule matters double because sibling worktrees accumulate each other's local tags.
  - The stash stack is shared too. Never bare `git stash` / `git stash pop` during a
    release — another session may push or pop concurrently. A temporary WIP commit is
    the safe way to set something aside.
  - Sibling worktrees may hold in-flight work on the same files. Release from the last
    COMMITTED state of this branch; never chase or wait on another session's
    uncommitted edits.
  - THE WORKTREE IS DISPOSABLE. After the release merges, the worktree is routinely
    reaped — and everything gitignored inside it (session folders, scratch, caches,
    local state) is deleted without ceremony. That is the designed lifecycle, which is
    exactly why the knowledge-promotion step in PREPARE and the residue report in
    REPORT exist: anything worth keeping must leave the worktree as a committed file
    BEFORE the merge, or it never will.
</worktree_context>

<authorization>
  FIRST THING, BEFORE ANY PHASE RUNS — settle who decides, once:

  - The user's request already says it ("release yourself", "merge and release without
    asking", "--auto", or equivalent) → AUTONOMOUS MODE for this whole run. Do not ask
    again at any point. Report every irreversible step as it happens.
  - It does not → ask ONE question now, before starting: "Run this release end to end
    myself (merge + tag + publish without stopping), or stop before the irreversible
    steps for your go-ahead?" Their answer sets the mode for the run. Then start.
  - Never introduce a new approval question in the middle of the pipeline. The only
    legitimate mid-run stops are NOT approvals: a preflight gate that failed, or a
    consistency incident (golden rule 4: something exists but differs). Those stop the
    run because proceeding would be wrong, not because permission is missing.
  - Authorization covers this run only. It does not carry over to the next invocation.

  In autonomous mode the version bump and changelog text are decided by the agent and
  reported, not approved. If the user wants to shape them, that is the moment to say
  so — before the run, as part of the one question above.
</authorization>

<phase_0_detect>
  Identify the stack (use dev:context-detection) and the project's release machinery,
  in this order of authority:

  1. A documented process: RELEASE.md, RELEASE_PROCESS.md, CONTRIBUTING.md release section,
     a release section in CLAUDE.md, a project release skill or slash command.
  2. Installed release tooling: release-please config, .changeset/, semantic-release config,
     goreleaser.yaml, cargo-release.toml, nx/lerna release config, a Makefile/justfile
     release target.
  3. CI that releases: workflows triggered by tags, by version changes, or by release PRs.
  4. Bare ecosystem: package.json / Cargo.toml / pyproject.toml / go.mod + git tags.

  RULE: the FIRST thing found is the authority. This command then becomes the checklist
  wrapper around it — it fills the gaps (preflight, verification, resume) but never
  duplicates a step the project's own tooling owns. If the project documents its own
  process, follow that document and use the phases below only for what it does not cover.

  Report what was detected and which mode applies before doing anything else.
</phase_0_detect>

<phase_1_preflight>
  Read-only. Nothing is written in this phase.

  - Working tree clean? If dirty, STOP and show the user what is uncommitted. Never stash
    around a dirty tree to force a release through.
  - WORKTREE RESIDUE — report explicitly, do not just pass/fail:
    * unpushed commits on this branch (git log @{u}..HEAD);
    * untracked files (git status --porcelain), split into "belongs in this release",
      "junk", and "gitignored knowledge" (see the promotion step in PREPARE);
    * leftover WIP/temporary commits that should be squashed before the release PR;
    * stash entries tagged by this session that were never re-applied.
  - DEPENDENCIES — three distinct checks:
    * lockfile in sync with the manifest (bun install --frozen-lockfile / npm ci /
      cargo metadata — whichever applies); a drifted lockfile means the tested
      dependency set is not the released one;
    * internal lockstep: in a workspace/monorepo, internal packages that must move
      together (workspace deps, platform/optional packages pinned to the parent's
      version) are all at the version this release expects;
    * external prerequisites: does this release depend on unmerged work — an open PR,
      a sibling worktree's branch, an unpublished dependency version? Name each one
      and STOP until the user decides to wait, include, or drop it.
  - Correct branch, up to date with origin. CI green on HEAD (gh run list / project CI).
  - Run the project's OWN quality gates: its test script, its linters, its validators —
    from package.json scripts, Makefile, or the documented process. Do not invent gates,
    and do not skip the ones that exist.
  - Determine the version bump: conventional commits since the last tag if the repo uses
    them (fix→patch, feat→minor, feat!/BREAKING→major); otherwise propose one and ask.
    Commit inference undercalls breaking changes — sanity-check the diff, not just subjects.
  - Verify publish credentials and tools exist NOW, not at publish time: npm whoami,
    gh auth status, cargo login state, required CI secrets — whichever apply.
  - Rehearse where the ecosystem allows: npm publish --dry-run / npm pack --dry-run,
    goreleaser --snapshot, cargo publish --dry-run.
  - Print the blast radius: what version, which packages/artifacts, which registries,
    which tags, which CI workflows will fire.

  GATE: every gate green. The version and blast radius are REPORTED; they were
  authorized up front (see <authorization>), so this is not a stop.
</phase_1_preflight>

<phase_2_prepare>
  Reversible writes only. No tag. No publish.

  - Draft the changelog entry (Keep a Changelog shape: Added/Changed/Fixed/…, dated,
    human-readable impact — not a commit-subject dump). In autonomous mode write it and
    report it; otherwise it was shaped in the up-front exchange. This entry is the
    release-intent artifact; without it there is no release.
  - Write the version through the ecosystem's own tool with tagging DISABLED:
    npm version --no-git-tag-version, cargo set-version, uv version, poetry version —
    or plain file edits where no tool exists. Update every place the version lives
    (manifests, lockfiles, internal constants the project documents).
  - Run every generator the project has (docs catalogs, release-notes generators,
    lockfile refresh) BEFORE committing, so the commit contains their output.
  - KNOWLEDGE PROMOTION — rescue gitignored knowledge before the worktree dies.
    Releasing from a worktree means merge is followed by reaping, and reaping deletes
    everything gitignored. Sweep the gitignored paths that hold authored content
    (session folders like ai-docs/sessions/ or .claude/ scratch, plan files, review
    verdicts — whatever .gitignore covers that a human or agent WROTE rather than a
    tool generated) and promote what deserves to survive:
    * decisions, rationale, architecture choices a human will revisit → docs/
      (documents for humans; docs/plans/ for dated design documents where the
      project has it);
    * mechanisms, gotchas, verified investigation results an agent needs in a future
      session → ai-docs/ (agentic memory between sessions);
    * everything else → let it die with the worktree.
    Promotion is REWRITING, not `mv`: extract the durable claim into standalone text
    that reads without session context, state how it was verified, and drop the
    transcript. Never cite a session artifact as authority in a committed doc, and
    never `git add` the gitignored originals. Respect the project's own conventions
    if it documents different locations; docs/ + ai-docs/ is the default split.
    The promoted files ride in this release branch, so they merge before the
    worktree is reaped.
  - Commit on a release branch (release/vX.Y.Z), push the branch, open a PR with the
    changelog entry as the body. Never commit release metadata straight to the default
    branch unless the project's documented process says to.

  GATE: PR CI green. Not a second approval — the human decided up front. The PR is the
  durable record of what shipped, and CI is the mechanical gate.
  - Run a code review on the diff here (Agent → dev:reviewer, or the project's review
    command) and surface its findings in the PR. It does not block on its own; a
    critical, evidence-backed finding is reported as a preflight-class failure (the
    run stops because proceeding would be wrong), everything else is noted and the
    run continues. An agent approving its own release is a log line, not a gate.
</phase_2_prepare>

<phase_3_merge_and_tag>
  - Merge as soon as CI is green. In autonomous mode this is automatic; in gated mode
    the go-ahead was collected up front, so it is still not a question asked here.
  - Resolve the MERGE COMMIT SHA on the default branch. All tags point there — never at
    the branch head that CI did not validate.
  - Create an annotated tag and push it as an EXPLICIT ref:
      git tag -a vX.Y.Z -m "..." <merge-sha>
      git push origin refs/tags/vX.Y.Z
    NEVER git push --tags — it pushes every local tag the machine has ever accumulated.
  - TAG COLLISION (local tag of this name already exists, pointing elsewhere — common
    with shared-across-worktrees tags, where a sibling session prepared its own batch):
    ORIGIN DECIDES. Check git ls-remote --tags origin <tag>:
    * origin does NOT have the tag → your merged release owns the name. Push your
      annotated tag WITHOUT touching the sibling's local tag, via a temp ref:
        git tag -a tmp-<name> -m "..." <merge-sha>
        git push origin refs/tags/tmp-<name>:refs/tags/<real-tag-name>
        git tag -d tmp-<name>
      Then report the stale local tag loudly (it now lies vs origin, and it poisons
      any tooling that infers "commits since last tag") with the retarget command:
        git tag -f <real-tag-name> <merge-sha>
      — but leave executing that to the user, who knows the sibling session's state.
    * origin HAS the tag at YOUR merge SHA → predicate satisfied, skip.
    * origin HAS the tag at a DIFFERENT SHA → the version number is BURNED. Never
      delete or force-push the tag. Renumber: bump your release to the next free
      version, update manifests + changelog + PR, and run the release again.
  - VERSION-COLLISION RULE (the general form): first-to-origin wins the number. A
    release that loses the race renumbers to a higher version and re-releases; it
    never fights over the tag or ships different content under a taken number —
    same-version content drift is invisible to installed clients forever.
  - If any file changed between the tested candidate and merge (rebase, conflict
    resolution, "one more fix"), golden rule 2 applies: back to PREPARE.
</phase_3_merge_and_tag>

<phase_4_publish>
  Irreversible. Report each step as it executes. Do not ask — authorization was settled
  before the run started; the only stops here are consistency incidents.

  - If CI owns publishing (tag-triggered or merge-triggered workflow): do NOT publish
    locally in parallel — two publishers race. Watch the run to completion
    (gh run watch / gh run list --workflow <name>). A skipped or soft-failed publish job
    is a FAILURE, not a pass; read the run's annotations, not just its conclusion.
  - If no CI owns it: publish with the ecosystem tool (npm publish, cargo publish,
    gh release create, goreleaser release). Publish what was built and tested — do not
    rebuild different bytes at publish time.
  - Multi-artifact ordering: dependencies before dependents (platform/optional packages
    before the parent package that references them; a parent published against missing
    platform packages installs "successfully" and silently falls back or breaks).
  - Apply golden rule 4 to every step: tag already on origin at the same SHA → skip;
    version already on the registry → skip and note it; anything present but DIFFERENT →
    STOP and report a consistency incident.
</phase_4_publish>

<phase_5_verify>
  Verify against PUBLIC surfaces — origin, the registry, a clean client. Local state
  proves nothing after publish.

  Always:
  - git ls-remote --tags origin refs/tags/vX.Y.Z → exactly one ref, at the merge SHA.
  - The release workflow (if any) concluded success with no skip/warning annotations.
  - GitHub Release exists and is not a draft (gh release view vX.Y.Z), when the project
    uses releases.

  Per ecosystem, when applicable:
  - npm: poll npm view <pkg>@X.Y.Z version (early 404 = propagation, keep polling ≤5min);
    npm view <pkg> dist-tags → latest actually moved (npm only moves latest for the
    highest semver — a publish that leaves latest behind is invisible to npm i);
    clean-environment install smoke test: npx -y <pkg>@X.Y.Z --version or a docker
    node install. Install success alone is insufficient where optionalDependencies are
    involved — run the binary.
  - crates.io: cargo search / cargo info <crate> shows X.Y.Z.
  - PyPI: pip index versions <pkg> (or uv pip install <pkg>==X.Y.Z --dry-run).
  - Go: go list -m <module>@vX.Y.Z resolves via the proxy.

  Scope the claim honestly: registries and CDNs cache. Report "the registry serves
  X.Y.Z", not "all users can install it this second".
</phase_5_verify>

<phase_6_report_or_resume>
  Report: version, tag URL, release URL, registry URL, CI run URL, verification results.
  A partial failure is reported as PARTIAL — never as success with a footnote.

  WORKTREE RESIDUE STATEMENT — the report's last section, mandatory when running from a
  worktree: list what remains in the worktree that the merge did NOT carry (uncommitted
  files, unpushed side branches, gitignored state that was deliberately not promoted),
  and state plainly: "this worktree is now safe to remove" or "NOT safe to remove
  because: <items>". Knowledge that was promoted in PREPARE is already in the merge;
  everything still listed here dies with the worktree, and that should be a decision
  the user made, not a surprise.

  RESUME after a partial failure: do not keep local state; recompute from the remotes.
  Re-walk phases 3–5 applying golden rule 4 — each already-completed effect verifies and
  skips; the first missing effect is where work resumes. The canonical case "tag pushed
  but publish failed" resolves mechanically: tag predicate true → skip; registry
  predicate false → publish; verify.
</phase_6_report_or_resume>

<recovery_policy>
  Per artifact class — a blanket "always fix forward" is wrong in both directions:

  | Artifact | Reversible? | Recovery |
  |---|---|---|
  | Uncommitted writes / unpushed commit or tag | yes | reset or delete within the failed run |
  | Pushed tag | treat as immutable once anything could have seen it | never delete; fix forward |
  | Registry version (npm/crates/PyPI) | no | mask then fix forward: npm dist-tag add <pkg>@<last-good> latest (stops new installs bleeding), npm deprecate <pkg>@X.Y.Z "reason" (warns durably), then release X.Y.Z+1. EXECUTE these when needed — do not just recommend them |
  | Partial multi-package publish | no | publish the missing packages at the SAME version if the registry allows; otherwise bump all and republish. Never leave a parent live against missing platform packages |

  Never unpublish/yank without an explicit user instruction — registries constrain it
  tightly and it breaks dependents; deprecation is the durable tool.
</recovery_policy>

<safety>
  - Never git push --tags. Explicit refs only.
  - Never bypass hooks (--no-verify) or force-push to get a release through. A hook
    rejection is a gate doing its job; fix the input.
  - Never blind-stage the workspace ("git add -A" on a dirty tree) — determine the exact
    intended change set first; a release commit must not sweep in unrelated or sensitive
    files.
  - Never resolve "version already exists on the registry" by silently bumping — surface
    it; the user decides whether it is a resume (skip) or a collision (stop).
  - Never ask for approval mid-run. Authorization is settled once, before the pipeline
    starts (<authorization>). Mid-run stops are for failed gates and consistency
    incidents only — never for permission.
</safety>
