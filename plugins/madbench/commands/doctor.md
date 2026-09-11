---
name: doctor
description: Run the three madbench plugin checks — skill staleness against the installed madbench, bench layout, and the generated bench index — and print their output verbatim
allowed-tools: Bash, Read
---

# madbench doctor

Three checks, three commands, output printed as it came. **No agent is dispatched**, because
this command's whole value is being a mechanical answer a human can trust. An agent
summarising a gate is a gate you cannot cite.

## Run all three

Run each from the project root, one command per call, and paste its **complete** stdout and
stderr into the reply. Do not trim, do not paraphrase, do not stop at the first failure — a
reader wants all three verdicts side by side.

### 1. Staleness — does the skill mirror the installed madbench?

```bash
bun "${CLAUDE_PLUGIN_ROOT}/scripts/check-staleness.ts"
```

Runs `madbench version` and loads the plugin's example benches through `madbench list`. A
bench the skill teaches that the installed madbench refuses to load is the finding; the
version comparison above it is advisory and names how far behind the mirror is.

### 2. Layout — does the bench tree follow the standard?

```bash
if [ -n "$(find . -maxdepth 3 \( -name madbench.yaml -o -name '*.madbench.yaml' -o -name '*.eval.yaml' \) -not -path '*/node_modules/*' -print -quit)" ]; then bun "${CLAUDE_PLUGIN_ROOT}/scripts/check-bench-layout.ts"; else echo "skipped — this project has no bench file yet, so there is no layout to check"; fi
```

One bench root; every bench directory carries a bench or Eval file and a `README.md` with
the required frontmatter; no loose TypeScript at a bench root; no alias key in any bench
file.

**The probe is the point here too.** A project that has not written a bench yet has no
layout to hold, and the checker would honestly report exit 2, could not measure. That is
not a state the reader can act on, so the probe skips and says so. Once one bench file
exists, the checker runs, and a missing bench root is then a real red: it means a bench
file sits somewhere the standard does not allow.

### 3. Index — is the generated bench index current?

```bash
if [ -f benches/MADBENCH.md ]; then bun scripts/generate-madbench-index.ts --check; else echo "skipped — this project has no benches/MADBENCH.md, so there is no generated index to check"; fi
```

`benches/MADBENCH.md` is generated from the filesystem plus each README's frontmatter. Stale
means a bench was added, moved or re-described without regenerating; the fix it names is
the same command without `--check`.

**This check is repo-shaped, and the probe is the point.** `generate-madbench-index.ts` is a
magus-src script, not a plugin-shipped one — checks 1 and 2 address the plugin root because
they ship with the plugin, and this one deliberately does not. A project with no
`benches/MADBENCH.md` has nothing for it to check, so the probe **skips and says so**. Report
a skip as a skip, never as red: red is reserved for a state the reader can act on, and
"you are not magus-src" is not one.

## Reading the exits

All three exit the same way, and the middle value is the one to respect:

| Exit | Meaning | Report as |
|---|---|---|
| 0 | the check measured and passed — **or check 2 or 3 skipped**, which its own line says | green |
| 1 | the check measured and found a defect — its output names it | red |
| 2 | **could not measure** — no madbench binary, no bench root, a file that does not parse | **red** |

Exit 2 is red on purpose. A run that measured nothing is not a pass; reporting it as one
rebuilds the blind spot these checks exist to close.

Two exits of 0 are not verdicts of the same strength, and the output distinguishes them:

- **Check 1 without a madbench binary** is silent by design — a machine that never runs
  benches must not get a false failure. Quote its one line rather than inventing a verdict.
- **Check 2 in a project with no bench file**, and **check 3 outside magus-src**, print
  `skipped` and exit 0. Report them as `skipped`, not as green: nothing was measured, and
  nothing was meant to be.

If check 1 or check 2 reports `error: Module not found`, report that as exit 2 and name the
path — those two ship with the plugin, so a missing one means the plugin is installed
without its scripts and reinstalling it is the fix. **Check 3 is not covered by that
diagnosis**: it names a magus-src script that no plugin install delivers, which is why it
probes first instead of failing.

## Reply shape

```
madbench doctor

1. staleness   exit N
<verbatim output>

2. layout      exit N
<verbatim output>

3. index       exit N
<verbatim output>

Verdict: <green | red — which checks, in one line; name any that skipped>
```

Nothing else. The value of this command is that the reply can be pasted into a PR or an issue
as evidence, and evidence that has been summarised is no longer evidence.
