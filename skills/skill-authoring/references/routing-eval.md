# Routing evaluation

Read this when a skill must trigger reliably and you are willing to spend runs proving it
does. Skip it for a hidden skill — a skill nothing routes to has no routing to evaluate.

A description is a classifier. Until it has been tested against prompts it should *and
should not* match, its quality is an opinion.

## The dataset

About 20 prompts, split roughly evenly:

**8–10 that should trigger.** Mix registers deliberately:

- direct — "review this API design"
- indirect intent, skill never named — "these endpoints feel inconsistent, sort them out"
- casual and abbreviated — "api looks messy, fix"
- typo'd, because users type badly
- one long and detailed, one three words
- one uncommon but genuinely valid use

**8–10 hard near-misses that should NOT trigger.** These carry the signal; obviously
unrelated prompts prove nothing:

- prompts that share the skill's vocabulary but need a different workflow
- prompts a neighbouring skill should win
- prompts the base model handles fine unaided

Trivial one-step prompts are a poor test either way. A model that can just do the thing
will not consult a skill, so test with substantive, multi-step requests.

## The procedure

1. Hold the body and the installed catalog constant. Change **one metadata field at a
   time** — otherwise you cannot attribute the difference.
2. Split 60 % development / 40 % held out.
3. Run every prompt at least three times, each in a fresh session. Triggering is
   stochastic; a single run is an anecdote.
4. Improve the description using **development failures only**.
5. Select the winning version on **held-out** score. Choosing on development score
   overfits to the prompts you wrote.
6. Run 5–10 untouched prompts before release.
7. Repeat per model you actually deploy. Haiku needs more explicit triggers than Opus.

A useful cheap probe: ask the model "when would you use the `<name>` skill?" It quotes the
description back, which exposes what the text actually communicates as opposed to what
you meant.

## What to record

| Metric | Question |
|---|---|
| precision | of the times it fired, how often was that right? |
| recall | of the prompts that needed it, how often did it fire? |
| sibling confusion | when it lost, which skill won instead? |
| consistency | did repeated runs of the same prompt agree? |
| catalog cost | description characters, and the share of the budget |

A reasonable starting gate: ≥90 % precision, ≥90 % recall, no repeated confusion with the
same sibling, no truncation. Raise it with risk. **If a workflow genuinely requires 100 %
invocation, routing is the wrong mechanism** — use a hook or a validation gate, and stop
relying on the model's judgement.

## Routing success is not usefulness

A skill that always fires can still make the output worse. Compare four conditions:

| Condition | Tells you |
|---|---|
| no skill | the base-model baseline |
| previous version | whether you regressed |
| new skill, model-invoked | routing and instructions together |
| new skill, invoked by name | instructions alone |

- named works, model-invoked fails → the description is the problem
- both fail → the body is the problem
- both match the no-skill baseline → **the skill may not be worth keeping**
- worse than baseline → it contains something actively misleading; cut it

Prefer deterministic verification. For subjective output, use blinded pairwise comparison
with more than one judge — and be aware that judges sharing an input share its defects,
so convergence between them is not corroboration.

## Maintenance

Record the skill version, commit SHA, model and harness with every evaluation, and re-run
after a model or harness upgrade — a description tuned for one model is not evidence about
another. Turn real user corrections into regression prompts. Periodically re-run the
no-skill condition: models improve, and a skill that once helped can become noise the
model would have got right anyway.
