# ADR-XXXX: [Short Decision Title]

## Status
Proposed | Accepted | Deprecated | Superseded by ADR-YYYY

## Date
YYYY-MM-DD

## Context

[What is the issue that we're seeing that motivates this decision?]

[Describe the forces at play:]
- Technical constraints
- Business requirements
- Team capabilities
- Timeline pressures
- Budget considerations
- Environmental factors (existing systems, integrations)

[Example structure:]
Our [project/system] needs to [requirement]. Key requirements:

**Functional:**
- [Requirement 1]
- [Requirement 2]

**Non-Functional:**
- [Performance/scale requirement]
- [Uptime/reliability requirement]
- [Security requirement]

**Team & Environment:**
- [Team expertise]
- [Existing systems]
- [Budget/timeline constraints]

## Decision

[What is the change that we're proposing and/or doing?]

[Be specific about:]
- What technology/pattern/approach is being adopted
- Scope and boundaries of the decision
- What is explicitly NOT included

[Example:]
We will use [technology/pattern] for [purpose]. [Additional details about configuration, deployment, or usage.]

**Scope:**
- [What's included]
- [What's included]
- [What's NOT included]

## Consequences

### Positive
- [Benefit 1: Describe how this helps the project]
- [Benefit 2: Describe another advantage]
- [Benefit 3: What problems does this solve?]

### Negative
- [Drawback 1: What limitations are we accepting?]
- [Drawback 2: What new problems might this create?]
- [Drawback 3: What costs are we taking on?]

### Neutral
- [Trade-off 1: What needs to be done as a result?]
- [Trade-off 2: What new processes are needed?]
- [Trade-off 3: What must be monitored or maintained?]

## Alternatives Considered

### Alternative 1: [Technology/Pattern Name]

**Description**: [Brief overview of what this alternative is]

**Pros**:
- [Advantage 1]
- [Advantage 2]
- [Advantage 3]

**Cons**:
- [Disadvantage 1]
- [Disadvantage 2]

**Why Rejected**: [Honest explanation of why this wasn't chosen. Be specific about which requirements it doesn't meet or which trade-offs were unacceptable.]

### Alternative 2: [Technology/Pattern Name]

**Description**: [Brief overview]

**Pros**:
- [Advantage 1]
- [Advantage 2]

**Cons**:
- [Disadvantage 1]
- [Disadvantage 2]

**Why Rejected**: [Explain the rejection reasoning]

### Alternative 3: [Technology/Pattern Name]

**Description**: [Brief overview]

**Pros**:
- [Advantage 1]
- [Advantage 2]

**Cons**:
- [Disadvantage 1]
- [Disadvantage 2]

**Why Rejected**: [Explain the rejection reasoning]

## Related ADRs

- ADR-XXXX: [Related decision that influenced this one]
- ADR-YYYY: [Related decision that this one influences]
- ADR-ZZZZ: [Decision this one depends on]

[Use this section to create a decision graph showing how decisions relate to each other over time.]

## References

- [Link to relevant documentation]
- [Blog post or article that influenced the decision]
- [Benchmark results]
- [Proof of concept code]
- [External specifications or standards]

---

## Usage Instructions

1. **Copy this template** to `ai-docs/decisions/ADR-XXXX-short-title.md`
2. **Replace XXXX** with the next sequential number (pad with zeros: 0001, 0002, etc.)
3. **Fill in all sections** - don't leave placeholders
4. **Start with "Proposed" status** while under discussion
5. **Update to "Accepted"** once decision is final
6. **Don't edit after acceptance** - create new ADR to supersede if needed

## Section Tips

**Context**: Answer "What problem are we solving?" and "What constraints do we have?"

**Decision**: Answer "What did we choose?" - be specific and actionable

**Consequences**: Answer "What happens because of this?" - be honest about trade-offs

**Alternatives**: Answer "What else did we consider?" - represent alternatives fairly

**Related ADRs**: Answer "What other decisions does this connect to?"

**References**: Answer "Where can I learn more?"
