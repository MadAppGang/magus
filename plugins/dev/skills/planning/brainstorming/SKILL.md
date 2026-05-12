---
name: brainstorming
version: 2.0.0
description: "Brainstorms implementation approaches by running parallel multi-model exploration, scoring consensus across proposals, and producing a validated plan. Use when the user asks to brainstorm ideas, compare approaches, plan architecture, or evaluate options for a feature before implementing."
author: "Magus"
tags:
  - planning
  - ideation
  - collaboration
  - multi-model
user-invocable: false
---

# Brainstorming: Multi-Model Planning

Turn ideas into validated designs through collaborative AI exploration and confidence-based validation.

## When to Use

Activate this skill BEFORE implementing any feature:
- "Design a user authentication system"
- "Brainstorm approaches for API rate limiting"
- "Plan architecture for a new dashboard feature"
- "Evaluate options for real-time data synchronization"

## Prerequisites

- Install required skills: `superpowers:using-git-worktrees`, `superpowers:writing-plans`
- Set `OPENROUTER_API_KEY` for multi-model access
- Configure explorer models using IDs from `shared/model-aliases.json` (run `/update-models` to refresh)

## Workflow

### Phase 0: Problem Analysis

**Objective**: Capture problem scope, constraints, and success criteria.

Present structured questions to the user via conversation (one at a time):
1. What are the main constraints or requirements?
2. What are the functional and non-functional requirements?
3. Are there existing dependencies or integrations?

Summarize the user's answers into a problem statement with constraints, success criteria, and scope boundaries. Confirm understanding before proceeding.

**Gate**: USER_GATE — requires user confirmation.

---

### Phase 1: Parallel Exploration

**Objective**: Generate diverse solutions via multi-model brainstorming.

Launch 3+ explorer models in parallel using Task calls. Use a fallback chain so that if one model fails, the next in the chain is tried. Continue with partial results if at least one model succeeds.

Each model should propose multiple approaches. For each approach, capture:
- Name and one-sentence summary
- Key components (bullet points)
- Trade-offs (pros/cons)
- Model's confidence score (0-100)

**Gate**: AUTO_GATE — automatic consolidation of results.

---

### Phase 2: Consensus Analysis

**Objective**: Identify strongest ideas by measuring cross-model agreement.

Algorithm:
1. **Cluster** approaches by semantic similarity
2. **Score agreement**: count how many models proposed similar approaches
3. **Classify**: UNANIMOUS (all models agree), STRONG (majority), DIVERGENT (single model)
4. **Calculate confidence**: average of model confidences + agreement bonus (up to +20%), minus diversity penalty

Present a consensus matrix showing each approach cluster, agreement level, and final confidence score. Rank by confidence descending.

**Gate**: AUTO_GATE — automatic scoring.

---

### Phase 3: User Selection

**Objective**: Present top approaches for user decision.

Show the top 3-5 approaches with their consensus level, confidence score, summary, and trade-offs. Offer the user choices:
- Select a specific approach
- Combine elements from multiple approaches
- Return to Phase 1 for more exploration

**Gate**: USER_GATE — user selects via conversation.

---

### Phase 4: Detailed Planning

**Objective**: Elaborate selected approach into actionable sections.

Break the chosen approach into implementation sections (200-300 words each). Apply confidence-based gating per section:

| Confidence | Action |
|------------|--------|
| >= 95%     | Proceed automatically |
| 60-94%     | Notify user, request confirmation if < 80% |
| < 60%      | Require user revision |

Each section should include: implementation details, assumptions, and a confidence breakdown (technical feasibility, edge case coverage, team capability).

**Gate**: MIXED_GATE — adaptive based on confidence.

---

### Phase 5: Plan Validation

**Objective**: Final review before implementation.

Present a validation checklist:
- Problem scope accurately captured
- Chosen approach matches expectations
- Module structure aligns with capabilities
- Technical constraints addressed
- Success criteria are measurable

User replies "approve" to finalize, "revise [section]" to modify, or "restart" to begin fresh.

**Gate**: USER_GATE — explicit approval required.

---

## Troubleshooting

### Model Failures

| Symptom | Cause | Solution |
|---------|-------|----------|
| Single model fails | API error or timeout | Fallback chain handles automatically |
| All models fail | API key or network issue | Check `OPENROUTER_API_KEY`, retry |
| Partial results | One model unavailable | Continue with available models |

### Consensus Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| All DIVERGENT | Models produce very different ideas | Not a failure — indicates novel problem space |
| Single high-confidence cluster | Well-understood problem | Good candidate for AUTO_GATE |
| No clear winner | Multiple valid approaches | Present all to user for decision |

### User Interaction Issues

| Symptom | Cause | Solution |
|---------|-------|----------|
| User doesn't respond | Unclear question | Rewrite with specific format |
| Conflicting answers | Too many questions at once | Ask one at a time |
| User wants to restart | Dissatisfied with direction | Return to Phase 0 |
