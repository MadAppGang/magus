# Fix (b): the one-off manual step and its log

Use this only for fix (b): an edge case meroku cannot migrate by itself. The log exists
so the step can be repeated in another environment or audited later. Write it as you go,
not from memory afterwards.

## Before any command

1. **Interview.** Ask, and record the answers in the log:
   - What do you expect to end up with?
   - What is deployed now, and what depends on it?
   - What may be lost: data, a DNS name, an endpoint, a resource other systems use?
2. **Agree a plan.** List every command in order, each with what it changes. Read-only
   checks you will run between steps go in the list too.
3. **Agree where the log goes.** `.meroku/` ignores itself in git, so a log kept beside
   the briefing stays on this machine. Ask whether the user wants it there or somewhere
   they commit.

## While running

- State each command exactly and wait for a yes before it runs. A yes for the plan is
  not a yes for every command in it.
- Paste each command into the log before it runs, and its result straight after.
- Stop at the first unexpected output. Record it, explain it, and agree the next step.
- Never write a secret into the log: no tokens, keys or passwords. Redact them in
  pasted output.

## After

Run `AWS_PROFILE=<profile> terraform plan` from `env/<env>/` and record what it shows,
then have the user rerun meroku and record the outcome. If meroku should have handled
the case, note that under follow-ups: it may be a migration meroku is missing.

## Template

````markdown
# Manual step: <one-line summary>

| | |
|---|---|
| Briefing | .meroku/claude/<time>-<operation>.md |
| Environment | <env> |
| AWS profile / account / region | <profile> / <account> / <region> |
| meroku version | <version> |
| Date | <YYYY-MM-DD> |
| Agreed by | <user> |

## Problem

<What failed, the cause, and the evidence. Why no meroku migration handles it.>

## Interview

- Expected outcome: <answer>
- Deployed now: <answer>
- May be lost: <answer>

## Plan

1. <command> — <what it changes>
2. <command> — <what it changes>

## Steps

### 1. <what this step does>

Agreed: <yes, when>

```sh
<exact command>
```

```text
<output, secrets redacted>
```

Result: <what changed; what was checked afterwards>

### 2. …

## Verification

- `terraform plan` after the steps: <summary of what it showed>
- meroku rerun: <command, and the outcome>

## Follow-ups

- <anything left to do; whether meroku should handle this case itself>
````
