---
name: aggregate-reviews
description: "Merges independent reviews of one target into one report with a consensus tag per finding and a verdict from supplied thresholds; also synthesises research findings. Use when several reviews or votes must become one file a gate reads."
---

# Aggregating reviews and research findings

Turn several independent reports into one, marking where they agree and where they
diverge, and compute the verdict the dispatcher's thresholds define. You are handed
reports, never the thing they judged. You do not review, you do not re-derive findings
from code, and you do not soften or sharpen what a reviewer said. You count it.

## Two forms

Decide the form from the first lines of the prompt.

| Form | Marker | Dispatched by | Follow |
|---|---|---|---|
| Review consolidation | a `REVIEWS:` line | `/dev:audit`, `/dev:fix` Phase B, Phase 3 plan review, Phase 5 code review, the multimodel skills | [Review consolidation](#review-consolidation) |
| Research synthesis | `SESSION_PATH:` with `ITERATION:` or `MODE: final_report`, and no `REVIEWS:` | `/dev:research` | [Research synthesis](#research-synthesis) |

A `SESSION_PATH:` line beside `REVIEWS:` is context only; `REVIEWS:` wins.

## Two rules that hold in both forms

**Given reports, never code.** Read only the paths the prompt names. Do not open the
files a review talks about, do not run a capture script, do not grep the codebase to
check whether a reviewer was right. The moment you look at code you become a reviewer
whose findings nobody else saw, and the consolidated report stops being a consolidation.
A finding you doubt is reported with its consensus level. It is not dropped, and not
re-investigated.

**No rules of your own.** The severity scale and the verdict thresholds belong to the
reviewer that produced the reports. The dispatcher quotes the thresholds on
`THRESHOLDS:`; apply those words and nothing else. Never recall a threshold from memory,
never invent one when the line is missing, never restate one as if it were yours. Cite
it as "per THRESHOLDS". If THRESHOLDS says WARN, the verdict is WARN.

## Review consolidation

### Contract

```
REVIEWS:      one path per line (absolute, or relative to the working directory).
              The internal review first, then one per external slot that completed.
              Every line is an input you must account for.
THRESHOLDS:   the verdict rules, quoted verbatim by the dispatcher: each rule a verdict
              word and the condition that earns it, in the vocabulary of the reviewer
              whose reports these are. A code review quotes dev:reviewer's three
              lines; a plan review states Phase 3's own rule; a design review passes
              the designer's percentage scale; a docs audit passes dev:docs' score
              bands; a /dev:fix patch vote passes fix.md's report-to-vote mapping and
              consensus rules.
OUTPUT:       path of the consolidated report. You write exactly this one file.
N:            optional; the panel size a vote tally is over. Only a /dev:fix patch
              vote carries it: every slot is a line under REVIEWS whether or not its
              file exists, so N equals the line count.
SESSION_PATH: optional context. Not a file to read.
```

- No `REVIEWS:` → this is not a review consolidation; see the two forms.
- No `OUTPUT:` → write nothing. Return the completion message with Artifact
  "Not written — no OUTPUT: line", and put the complete consolidation, every finding
  in the file layout, under Outcome, so nothing is lost for want of a path.
- No `THRESHOLDS:` → do the whole consolidation, then end the report with
  `VERDICT: none — THRESHOLDS absent from dispatch` in place of a verdict. The gate
  that reads the file is meant to fail on that.
- Reviews of different targets → do not consolidate. Consolidation needs reviews of one
  target that share a location scheme, a severity scale and a verdict vocabulary; a
  Figma design review, a browser usability test and a code review share none of those.
  Name each review and what it covers, write no verdict, and say they belong side by
  side in the dispatcher's summary.

### N = 1 is a passthrough with a verdict

When exactly one review is counted, OUTPUT is that review's content, unchanged,
followed by a blank line and the terminal `VERDICT:` line computed from that review's
own measure (its severity counts, its percentage or its score, whichever THRESHOLDS is
over) against THRESHOLDS. No `[CONSENSUS: …]` tags, no `Raised by`, no `Reviews
consolidated`, no reworded findings, no reordered sections. The merge and consensus
phases do not run.

Consolidating one review can only subtract from it. Dispatchers avoid sending N = 1 at
all where they can (`/dev:fix`, `/dev:audit`, Phase 3, Phase 5 skip the dispatch and
use the single review's verdict directly); when one arrives anyway, pass it through.

If `REVIEWS:` listed more paths than were counted, add one line naming each uncounted
path and why, directly above the `VERDICT:` line. That and the verdict are the only
additions. Obstacles Encountered lives only in the returned message at N = 1, never in
OUTPUT: the gate needs the review unchanged, the orchestrator needs to know what went
wrong.

### Workflow

**Phase 1: read every review.**

1. Read each path under `REVIEWS:` with the Read tool. Do not Glob for more.
2. Classify each file by its fields, never by its filename. A counted input has one of
   three shapes:
   - **Severity-graded report**: findings keyed by `file:line` under CRITICAL / HIGH /
     MEDIUM / LOW and a `**Verdict**:` line. `dev:reviewer`, the Phase 3 plan reviewers
     and `dev:docs` write this. Its measure is its four counts, or, when the reviewer
     states a score and THRESHOLDS is over that score (`dev:docs`: `**Total Score**:
     N/52`), the score.
   - **Design report**: a pixel-difference percentage and a severity word from
     PASS | WARN | FAIL | CRITICAL (`Diff Percentage` and `Severity` rows of the Pixel
     Diff Result table in `summary.md`, or the same two values in a slot's
     `response-<slot>.md`). Findings, when semantic analysis ran, are keyed by category
     or region (Colors, Typography, Spacing, Layout, Imagery, Content, States), each with
     a severity. A pixel-only report has no findings and is still counted: the
     percentage is its measure and the severity word is its verdict.
   - **Vote file**: `VERDICT: APPROVE|REJECT|ABSTAIN`, `CONFIDENCE`, `REGRESSION_RISK`,
     `PATCH_SCOPE_ASSESSMENT`, `KEY_ISSUES`. An explicit ABSTAIN is a counted vote that
     keeps its CONFIDENCE. Only `/dev:fix` Phase B sends these; see vote-shaped reviews.

   Anything else is **no-verdict** (the reviewer reported nothing to review and emitted
   no verdict) or **absent** (missing, empty, or not a review: a launch receipt, a stack
   trace). Either contributes no findings and no vote; the report names it and why.
3. Record, per counted input: its verdict, the measure THRESHOLDS is over, and the
   surfaces and base it says it reviewed.
4. If no review is counted: write OUTPUT stating that, listing each path and why it was
   not counted, with no `VERDICT:` line at all. A verdict over nothing is how a phase
   certifies work nobody saw.

**Phase 2: merge findings** (N ≥ 2 only).

1. Two findings are the same finding when they name the same location (`file:line`;
   in a plan review the same section of `architecture.md`; in a design review the same
   category or region) and the same problem, however differently worded. Merge them:
   keep the clearest statement of the problem and every distinct suggestion.
2. Severity of a merged finding is the severity most of its reviewers gave it; on a
   tie, the higher. Say when reviewers disagreed.
3. Never drop a finding because one reviewer raised it and the others did not. A
   security finding one model saw and four missed is the usual shape of a real one. It
   is kept, marked divergent, and counted.
4. Positive observations merge the same way.

**Phase 3: consensus** (N ≥ 2 only). A finding raised by:

- all N → **unanimous**
- at least two thirds, but not all → **strong**
- more than half, but under two thirds → **majority**
- half or fewer → **divergent**

N = 2: both is unanimous, one is divergent. Tag every finding
`[CONSENSUS: level, k/N]` and name the reviews that raised it by file basename.

**Phase 4: count and compute the verdict.**

1. Count the merged findings by severity. Merged, not summed: the same HIGH raised by
   three reviewers is one HIGH. At N = 1 the counts are the review's own.
2. Apply `THRESHOLDS:` to whatever its rules are over, top rule first, and take the
   first that matches. The verdict is the word that rule names. Quote the rule you
   matched in Verdict Details.
3. Several counted reports that each state their own measure (two design reports at
   different percentages, two scores) are not averaged. Apply THRESHOLDS to each; the
   verdict is the worst band any counted report reached. List every value and its band.
4. Sanity check at N = 1: the word you computed should be the word the review itself
   stated. If they differ, recount once. If they still differ, the rule wins, and you
   say so in the return message.

**Phase 5: write OUTPUT.** N = 1: the review unchanged, then the `VERDICT:` line.
N ≥ 2: the layout under "Output file layout". Either way the file's last line is
`VERDICT: <word>`, bare, nothing after it. Then return the completion message: the file
is the deliverable, the message says where it is and what it concluded.

### Vote-shaped reviews (`/dev:fix` Phase B)

`/dev:fix` dispatches only at N ≥ 2 and its `REVIEWS:` is mixed: the first path,
`claude-vote-patch.md`, is a code-review report from `dev:reviewer` ending
`**Verdict**: PASS | CONDITIONAL | FAIL`; every path after it is a vote file from an
external slot.

The dispatcher's `THRESHOLDS:` carries the mapping that turns the report into a vote
(`PASS → APPROVE`, `FAIL → REJECT`, `CONDITIONAL → ABSTAIN`) beside its fault tolerance
and its tally rule, fix.md's `<consensus_rules>`, over the counts and the panel size
`N:`. Apply the mapping to the report before tallying. Its row shows the mapped vote
with the source verdict in parentheses, `APPROVE (PASS)`, and `—` under Confidence,
Regression Risk and Patch Scope. A report that is missing or has no `**Verdict**:`
line, and a vote file that is missing, malformed or whose slot reported FAILED, are
each ABSTAIN with CONFIDENCE 0. A well-formed `VERDICT: ABSTAIN` keeps its CONFIDENCE.

Then the same phases in THRESHOLDS' vocabulary: parse vote fields case-insensitively;
tabulate `| Model | Verdict | Confidence | Regression Risk | Patch Scope |`; count
APPROVE / REJECT / ABSTAIN as `A-R-X`; merge `KEY_ISSUES` with the report's CRITICAL and
HIGH findings, naming who raised each; state which row of the tally rule the counts
meet at that N. The rule names exactly three terminal words — `STRONG`, `REJECT` or `DIVERGENT` —
and one row matches every tally at every N, so there is never a count with no word and
never a reason for a word of your own. The last line is `VERDICT:` followed by the word
the matched row names.

### Error handling

- A `REVIEWS:` path is missing or unreadable: name it in the report as absent and go
  on. Never Glob for a replacement.
- Reviews disagree on the base or surfaces they reviewed: report both under "Surfaces
  reviewed". Do not pick one; the dispatcher has to see that before it trusts the count.
- A review has findings but no verdict line: count its findings; it has no vote of its
  own. Say so by name.

### Output file layout (N ≥ 2)

The word in the verdict positions is the one the matched THRESHOLDS rule names. The
`VERDICT:` line is the last line of the file.

```markdown
## {Code Review | Plan Review | UI Validation Report — whichever heading the reviews use}: {target}

**Verdict**: {word from THRESHOLDS}

**Summary**: {2-3 sentences: what the reviews agreed on, and the one thing that decides the verdict}

**Reviews consolidated**: {N} — {basename, basename, …}. {Each no-verdict or absent path, by name, with why.}
**Surfaces reviewed**: {as the reviews state them; flag any review that named a different base}

### CRITICAL Issues ({count})
#### Issue N: {title} [CONSENSUS: {level}, {k}/{N}]
- **Raised by**: {basenames}
- **Location**: {file:line, or the category or region}
- **Problem**: {one sentence}
- **Why problematic**: {from the reviews}
- **Impact**: {from the reviews}
- **Suggestion**: {every distinct suggestion, attributed where they differ}

### HIGH Issues ({count})
### MEDIUM Issues ({count})
### LOW Issues ({count})
{same format}

### Positive Observations
{merged, each with its consensus tag}

### Obstacles Encountered
{An unreadable, empty or non-review REVIEWS path; a path that resolved only after
adjustment; a missing, ambiguous or self-contradictory dispatch line; a review whose
shape or vocabulary did not match the others; a file a review depended on that was not
listed and therefore not opened. Name the path or line, the workaround, and any limit it
leaves. "None" when there were none.}

### Verdict Details
- **CRITICAL**: {count}
- **HIGH**: {count}
- **MEDIUM**: {count}
- **LOW**: {count}
- **Measured**: {only when THRESHOLDS is over a percentage or a score: each report's value and band}
- **Result**: {word} — per THRESHOLDS: "{the rule matched, quoted}"
- **Divergent findings counted**: {count} — {severity, title, raised by; one line each}

VERDICT: {word from THRESHOLDS}
```

## Research synthesis

### Contract

```
SESSION_PATH: {path}        mandatory; every read and write is under it
ITERATION:    {N}           default 1
MODE:         synthesis | final_report   (default synthesis)
```

Reads `${SESSION_PATH}/findings/*.md` (explorer-N.md, local.md),
`${SESSION_PATH}/research-plan.md`, and for ITERATION > 1 the previous
`${SESSION_PATH}/synthesis/iteration-{N-1}.md`. Writes
`${SESSION_PATH}/synthesis/iteration-{N}.md`, or `${SESSION_PATH}/report.md` when MODE
is final_report. If `SESSION_PATH:` is missing, say so and stop.

### Workflow

1. **Read all findings.** Glob `${SESSION_PATH}/findings/*.md` and read each; read the
   research plan for the sub-questions; read the previous iteration when there is one.
   No findings at all → report that; the exploration phase has to run first.
2. **Extract themes and claims.** Group related findings, map each back to a
   sub-question, and extract every claim with its sources and their quality ratings.
3. **Consensus across sources.** Agreement = supporting sources / total sources.
   UNANIMOUS 100% · STRONG 67-99% · MODERATE 50-66% · WEAK below 50% · CONTRADICTORY
   when sources explicitly disagree: present both sides and say which is more credible
   (quality, recency, count). Never hide a contradiction.
4. **Quality metrics.** Factual Integrity = sourced claims / total claims × 100 (target
   90%+). Agreement Score = findings with 2+ sources / total findings × 100 (target
   60%+). Source quality: high / medium / low counts and percentages. Below target is
   NEEDS_IMPROVEMENT, reported with the causes.
5. **Knowledge gaps.** Sub-questions fully, partly or not answered; gaps the explorers
   named; gaps the synthesis exposed. For each: why it exists, a refined query, and a
   priority (CRITICAL, IMPORTANT, NICE-TO-HAVE).
6. **Convergence (ITERATION > 1).** Compare key findings with the previous iterations:
   intersection over union of their keyword sets, converged at 80%+ across three
   consecutive iterations (k = 3); saturation when under 10% of the current findings
   are new. Report EARLY, EXPLORING, NEAR_CONVERGENCE or SATURATED.
7. **Write and summarise.** Write the file, then return the completion message: the
   path under Artifact; findings count, the two metrics, gap count and convergence
   status under Outcome; then Obstacles Encountered and Completion Status.

### Synthesis file

```markdown
# Research Synthesis: Iteration {N}

**Sources processed**: {count} · **Iteration**: {N}

## Key Findings
### 1. {finding} [CONSENSUS: {level}]
**Summary** · **Evidence** (each point with its sources) · **Supporting sources**: {count} · **Quality**

## Evidence Quality Assessment
By consensus level (UNANIMOUS / STRONG / MODERATE / WEAK / CONTRADICTORY counts); by source count (3+ / 2 / 1).

## Quality Metrics
Factual Integrity {pct}% (target 90%+) · Agreement Score {pct}% (target 60%+) · source quality distribution · status PASS | NEEDS_IMPROVEMENT for each.

## Knowledge Gaps
CRITICAL / IMPORTANT / NICE-TO-HAVE, each with why, a suggested query, priority.

## Convergence Assessment (ITERATION > 1)
Overlap with previous iterations, new-information ratio, status.

## Recommendations
Next steps; where to focus; query refinements.
```

### Final report file

```markdown
# Research Report: {topic}

## Executive Summary — 200 words
## Research Questions — each with its answer, confidence, source count
## Key Findings — by theme; each finding with consensus, evidence, sources with quality and date
## Evidence Quality Assessment — the metrics, consensus distribution, source-quality distribution
## Source Analysis — high / medium / low quality sources, where each was used
## Methodology — iterations, convergence criterion, search strategy, models
## Recommendations — each with rationale and the findings behind it
## Limitations — what was not covered, and suggested future research
## Appendix — unresolved gaps, contradictions needing expert resolution, session metadata
```

## Completion message (every path)

Four sections, in this order; writing Completion Status ends the task.

```markdown
## Artifact
{The file written, or "Not written — {reason}". Never invent a verdict for a file that was not produced.}

## Outcome
{Reviews: the verdict word, the four severity counts, N and how many were counted, the divergent findings. Research: the metrics, the convergence assessment and the gaps. When no verdict was computed, say so here.}

## Obstacles Encountered
{Repeats the file's Obstacles section so a dispatcher that reads only the message still learns it; at N = 1 and for research this is its only home. "None" when there were none.}

## Completion Status
{COMPLETE | PARTIAL | BLOCKED} — one sentence: what was consolidated, what was not, and the missing input or decision if any.
```

## Worked example: three code reviews, Phase 5

Prompt: `REVIEWS:` lists `claude-internal.md`, `response-01.md`, `response-02.md`;
`THRESHOLDS:` quotes dev:reviewer's three verdict lines; `OUTPUT:` names
`consolidated.md`.

1. Read the three files. All carry a Verdict line → N = 3.
2. Merge: the unbounded retry loop is raised by all three (unanimous, HIGH); a missing
   null check by two (strong, HIGH); one review alone reports a credential in a test
   file (divergent, CRITICAL). Three response mappers are called MEDIUM by two and LOW
   by one → MEDIUM.
3. Counts: CRITICAL 1, HIGH 2, MEDIUM 1, LOW 0.
4. Apply THRESHOLDS top-down; the CRITICAL rule matches first.
5. Write `consolidated.md` in the reviewer's layout; the divergent CRITICAL sits in the
   CRITICAL section with "Raised by: response-02.md" and under Divergent findings
   counted. Last line: `VERDICT: FAIL`.
6. Return the completion message; Outcome reads "FAIL — 1 CRITICAL (divergent,
   response-02.md), 2 HIGH, 1 MEDIUM, 0 LOW across 3 reviews".

## Worked example: patch votes, /dev:fix Phase B

Prompt: `REVIEWS:` lists `claude-vote-patch.md`, `response-01.md`, `response-02.md`;
`THRESHOLDS:` carries fix.md's report-to-vote mapping (PASS → APPROVE, FAIL → REJECT,
CONDITIONAL → ABSTAIN), its fault tolerance and its tally rule; `OUTPUT:` names
`patch-consolidated.md`; `N: 3`.

Mixed inputs. `claude-vote-patch.md` is a code-review report ending `**Verdict**: PASS`,
mapped per THRESHOLDS to `APPROVE (PASS)`, `—` in the three vote-only columns, its two
HIGH findings kept as evidence. `response-01.md` is a vote file: APPROVE, CONFIDENCE
0.8, REGRESSION_RISK LOW, PATCH_SCOPE_ASSESSMENT APPROPRIATE, two KEY_ISSUES.
`response-02.md`'s slot reported FAILED → ABSTAIN, CONFIDENCE 0. Tally 2-0-1 at N = 3.
Table of Model / Verdict / Confidence / Regression Risk / Patch Scope; the KEY_ISSUES
and the report's HIGH findings merged, with who raised each; the tally-rule row the
2-0-1 count meets, quoted (V = 2 and A / V = 1 ≥ 2/3, STRONG). Last line `VERDICT: STRONG`.
