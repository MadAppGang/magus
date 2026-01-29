# E2E Test Scenarios

This directory contains YAML test scenarios for E2E skill activation testing.

## Scenario Structure

Each scenario YAML file should follow this structure:

```yaml
scenarios:
  - name: "Human-readable scenario name"
    description: "Detailed description of what this tests"
    plugin: "plugin-name"  # e.g., "dev", "multimodel"

    prompt: |
      Multi-line prompt that will be sent to Claude Code.
      This should be realistic and trigger the expected skills.

    expectations:
      skills:
        required:  # Skills that MUST activate
          - "skill-name-1"
          - "skill-name-2"
        optional:  # Skills that MAY activate (won't fail test if missing)
          - "optional-skill"
        forbidden:  # Skills that should NOT activate (will fail if present)
          - "wrong-skill"

      quality:
        criteria:  # Quality evaluation criteria (weights must sum to 1.0)
          - name: "criterion_1"
            weight: 0.4
            description: "What makes a good response for this criterion"
          - name: "criterion_2"
            weight: 0.3
            description: "Another quality aspect to evaluate"
          - name: "criterion_3"
            weight: 0.3
            description: "Final quality aspect"

        models:  # AI models to use for quality evaluation
          - "anthropic/claude-opus-4.5"
          - "google/gemini-3-pro-preview"

        thresholds:
          min_score: 7.0        # Minimum average score (1-10)
          min_consensus: 0.7    # Minimum agreement ratio (0-1)

    timeout: 60000  # Timeout in milliseconds (optional, default 60000)
```

## Writing Good Scenarios

### 1. Skill Selection

**Required Skills:** Choose skills that should definitely activate for this prompt.
- Use exact skill directory names (e.g., `test-driven-development`, not `TDD`)
- Check plugin's skills directory to verify names

**Optional Skills:** Skills that might activate but aren't critical.
- Use for related skills that could reasonably be triggered

**Forbidden Skills:** Skills that would indicate the wrong approach.
- Example: Don't activate `code-review` when creating new code

### 2. Quality Criteria

**Good Criteria:**
- Specific and measurable
- Directly related to skill effectiveness
- Different aspects (not overlapping)
- Clear descriptions for AI evaluators

**Weights:**
- Must sum to exactly 1.0
- Higher weight = more important
- Typical range: 0.1 to 0.4 per criterion

**Example Criteria:**
```yaml
- name: "follows_pattern"
  weight: 0.4
  description: "Response follows the specified pattern from the skill"

- name: "provides_examples"
  weight: 0.3
  description: "Includes concrete code examples"

- name: "explains_reasoning"
  weight: 0.2
  description: "Explains why this approach is recommended"

- name: "handles_edge_cases"
  weight: 0.1
  description: "Considers edge cases or error handling"
```

### 3. Prompts

**Good Prompts:**
- Clear and specific
- Realistic user requests
- Trigger skills naturally
- Include enough context

**Bad Prompts:**
- Vague or ambiguous
- Explicitly mention skill names (defeats the purpose)
- Too short or too long
- Artificial or contrived

### 4. Models

Choose models based on availability and purpose:
- `anthropic/claude-opus-4.5` - Best quality, slower
- `google/gemini-3-pro-preview` - Good alternative
- `x-ai/grok-code-fast-1` - Fast for code evaluation

Use 1-2 models for faster tests, 2-3 for consensus validation.

### 5. Thresholds

**min_score:**
- 8.0+ : High quality responses only
- 7.0-7.9 : Good quality (typical)
- 6.0-6.9 : Acceptable quality
- Below 6.0 : Basic requirements only

**min_consensus:**
- 0.8+ : High agreement required
- 0.7 : Standard (typical)
- 0.6 : Moderate agreement acceptable

## Validation

Before committing scenarios, validate them:

```bash
# Load and validate without running tests
bun test tests/e2e/skill-activation.e2e.test.ts --dry-run
```

Common validation errors:
- Weights don't sum to 1.0
- Missing required fields
- Invalid skill names
- Invalid model IDs

## Tips

1. **Start Simple:** Begin with 1-2 scenarios per skill
2. **Test Locally:** Run scenarios individually before batching
3. **Iterate:** Refine criteria based on actual AI evaluations
4. **Document:** Add clear descriptions for future maintainers
5. **Realistic:** Use actual use cases from documentation/issues

## Example Files

- `dev-skills.yaml` - Dev plugin skill scenarios
- `multimodel-skills.yaml` - Multimodel plugin scenarios

Add new files following the pattern: `{plugin-name}-skills.yaml`
