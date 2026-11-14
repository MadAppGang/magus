---
name: troubleshoot
description: Fixes a failed meroku apply, plan, destroy or AWS SSO setup from its Fix with AI briefing. Use when meroku opened you or names a .meroku/claude file.
argument-hint: <briefing path>
---

# Troubleshoot a meroku failure

meroku's "Fix with AI" writes a briefing to `.meroku/claude/<YYYYMMDD-HHMMSS>-<operation>.md`
at the project root and starts Claude Code there. Your job: find why the operation failed,
explain it with evidence, and fix it the way meroku can keep, so the next meroku run
succeeds instead of reverting or drifting from your change.

You work in a meroku **project**: `infrastructure/` (meroku's templates and modules),
the env YAML (`<env>.yaml` at the root, else `project/<env>.yaml`), and the generated
`env/<env>/`. Not the meroku source tree.

Written against meroku 6.1.0, YAML schema v32. When this text disagrees with the briefing,
the project's own `infrastructure/` copy, or the YAML's `schema_version`, those win.

## THE RULES

They come from the user and hold for the whole session. The briefing states them too.

1. **No direct writes to AWS.** No console changes, no AWS CLI or SDK writes
   (`create-*`, `put-*`, `update-*`, `delete-*`, `attach-*`, `tag-*`, …). A change made in
   AWS is not in the YAML or the Terraform state, so the next meroku run reverts it or
   fails on the drift.
2. **Never edit the generated Terraform in `env/<env>/`.** meroku rewrites every file
   there from the YAML on each run.
3. **Investigate and explain first; ask before any write.** Wait for a yes before you
   change a file, run anything that changes AWS or Terraform state, or rerun meroku.
4. **Fix in this order.**
   - (a) **meroku bug** — a template, module, migration or the binary does the wrong
     thing for a valid configuration. Give the evidence: file, line, and the input that
     triggers it. Ask the user for the path to their local meroku checkout and fix it
     there. `infrastructure/` is a copy meroku replaces on update: edit it only as a
     stop-gap, and only when the user asks for one.
   - (b) **Edge case no migration handles** — a resource that already exists under
     another name, state that has to move, something created outside meroku. Interview
     the user first (what they expect, what is deployed, what may be lost), agree each
     command before it runs, and keep a written log of commands and results.
   - (c) **Configuration problem** — the YAML asks for something invalid or
     inconsistent. Change the env YAML, then the user reruns meroku.

   None fits: stop and ask the user.
5. **Read-only inspection is always fine:**
   - `aws … describe-*`, `list-*`, `get-*`, `aws sts get-caller-identity`
   - `terraform state list`, `terraform state show <address>`, and `terraform plan`
     without `-out`, run from `env/<env>/`
   - reading any file in the project

   Anything not on this list counts as a write. That includes `terraform init`,
   `import`, `state mv|rm|push`, `force-unlock`, and every meroku command in the
   briefing's "How to rerun", even the read-only ones: the briefing says to run those
   only after the user agrees.

## Workflow

1. **Find the briefing.** Use the path in `$ARGUMENTS`. Without one, take the newest
   `.meroku/claude/*.md` under the working directory (`ls -t .meroku/claude/*.md`). None
   there: ask the user for it.
2. **Read the whole briefing** before running anything: Goal, Where it ran, What failed,
   How meroku works, How to rerun.
3. **State what you are working on** in one short block: operation, environment, AWS
   profile, region, account, meroku version. A field reading `(not recorded)` or `<env>`
   is unknown; ask about it rather than guess.
4. **Pick the profile.** Prefix every AWS and Terraform command with
   `AWS_PROFILE=<profile>`, using the profile the briefing names, which comes from
   `aws_profile` in the env YAML. Never use whatever the shell has: this pane may not have
   inherited meroku's profile. When the briefing says no profile is set, the AWS default
   credential chain applies; say so.
5. **Classify the failure** by operation. Read `references/operations.md` now, for the
   section matching the briefing's operation (apply, plan, destroy, sso, menu).
6. **Investigate read-only** (rule 5). Trace any `env/<env>/…tf:<line>` location back to
   what produced it: `infrastructure/env/main.hbs`, a module under
   `infrastructure/modules/`, user Terraform in `custom/terraform/`, and the YAML key that
   fed it.
7. **Explain** the cause with its evidence: the command you ran and the lines of output,
   the file and line. Separate what you verified from what you infer.
8. **Propose ONE fix**, the first of (a), (b), (c) that fits, and say why the earlier
   ones do not. Name what the user reruns afterwards. Then stop and wait for a yes.
9. **Apply** exactly what was agreed, nothing more.
10. **Hand back the rerun** to the user, with the command from the briefing's
    "How to rerun" (for example `meroku --env <env>` then "🚀 Deploy environment").
    If it fails again, start over at step 2 with the new briefing.

## Where the depth is

- Read `references/operations.md` only when classifying (step 5): per-operation
  playbooks for apply, plan, destroy, sso and menu, and a `vaults` section to read as well
  whenever the output names a vault or a vault secret.
- Read `references/manual-step-log.md` only when the fix is (b): the interview and the
  log template to fill in as each agreed command runs.
- Read `../yaml/SKILL.md` only when the fix is (c), or when a cause points at a YAML
  value: how to change an env YAML safely, and which fields force replacement.
- Read `../extend/references/places.md` only when the failure is in `custom/`: a hook's
  `variables.tf`, or a custom file referencing a meroku module or output.
- Read `../meroku/SKILL.md` only when you need the pipeline itself: YAML → migrations →
  templates → `env/<env>/` → Terraform, the commands, and the project layout.

## Failure modes

- **Fixing the symptom where it shows.** The error names a resource in `env/<env>/` or in
  AWS; the fix belongs in the YAML, in meroku, or in an agreed manual step. Rules 1 and 2
  exist because the easy fix there does not survive the next run.
- **Running a write to "check".** `terraform apply`, `import`, `state rm`, an AWS
  `put-*` "just to see": all writes. Ask first.
- **Editing `infrastructure/` as the fix.** It is meroku's copy and is replaced on
  update; the real fix for a bug there is (a), in the meroku checkout.
- **Several fixes at once.** Propose one; a second change hides which one worked.
- **Writing `secrets: []` to get past a generate refusal.** meroku 6.1.0 refuses a vault
  without a `secrets` list (`vault "<name>" has no secrets list: …`). An empty list on a
  vault whose parameters are in use makes the next apply drop every vault secret from
  every connected task definition. The fix is the names already in SSM: the web UI's
  Vaults tab, **Import names from AWS**. Read the `vaults` section of
  `references/operations.md`.
