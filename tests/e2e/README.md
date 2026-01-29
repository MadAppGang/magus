# E2E Skill Testing System

End-to-end testing system for validating Claude Code skill activation and response quality.

## Overview

This test suite validates that:
1. **Skills Activate Correctly** - The right skills trigger for specific prompts
2. **Response Quality** - AI evaluates adherence to skill guidance
3. **Multi-Model Validation** - Multiple AI models assess quality for consensus

## Architecture

```
tests/e2e/
├── scenarios/           # YAML test scenario definitions
│   ├── dev-skills.yaml
│   ├── multimodel-skills.yaml
│   └── README.md        # Scenario authoring guide
├── utils/               # E2E testing utilities
│   ├── claude-runner.ts      # Claude Code process spawner
│   ├── skill-detector.ts     # Skill activation parser
│   ├── ai-validator.ts       # AI quality evaluation
│   ├── scenario-loader.ts    # YAML scenario parser
│   └── report-generator.ts   # Test report generation
├── fixtures/            # Test data (if needed)
└── skill-activation.e2e.test.ts  # Main test suite
```

## Quick Start

### Prerequisites

1. **Claude Code CLI** - Installed and accessible in PATH
2. **Claudish CLI** - For AI validation: `npm install -g claudish`
3. **API Keys** - Set environment variables for AI models:
   ```bash
   export ANTHROPIC_API_KEY=your-key
   export OPENAI_API_KEY=your-key  # If using OpenAI models
   export GEMINI_API_KEY=your-key  # If using Gemini models
   ```

### Running Tests

```bash
# Run all E2E tests
bun run test:e2e

# Run specific plugin tests
bun run test:e2e:dev         # Dev plugin scenarios only
bun run test:e2e:multimodel  # Multimodel plugin scenarios only

# Watch mode
bun run test:e2e:watch
```

## How It Works

### Phase 1: Load Scenarios
- Reads YAML scenario files from `scenarios/` directory
- Validates scenario structure (required fields, weight sums, etc.)
- Filters scenarios based on test filters

### Phase 2: Execute Against Claude Code
- Spawns Claude Code process for each scenario
- Injects prompt via stdin
- Captures stdout/stderr with timeout handling
- Records response and execution metadata

### Phase 3: Skill Detection
- Parses response for skill activation markers:
  - Explicit: "Using skill: skill-name"
  - Tool calls: Read operations on `skills/*/SKILL.md`
  - Path mentions: References to skill directories
- Compares detected vs expected skills
- Calculates match ratio

### Phase 4: AI Quality Validation
- Constructs evaluation prompt with quality criteria
- Calls claudish with specified AI models (parallel execution)
- Parses AI evaluation scores (JSON format)
- Calculates average score and consensus
- Determines pass/fail based on thresholds

### Phase 5: Report Generation
- Aggregates all test results
- Generates JSON report for CI/CD consumption
- Generates Markdown summary for human review
- Saves to `ai-docs/sessions/e2e-test-results/{timestamp}/`

## Writing Test Scenarios

See [scenarios/README.md](./scenarios/README.md) for detailed guide.

Quick example:

```yaml
scenarios:
  - name: "Skill Name Test"
    description: "What this tests"
    plugin: "plugin-name"
    prompt: "Your test prompt here"

    expectations:
      skills:
        required: ["required-skill"]
        optional: ["optional-skill"]
        forbidden: ["wrong-skill"]

      quality:
        criteria:
          - name: "criterion_1"
            weight: 0.5
            description: "What to check"
          - name: "criterion_2"
            weight: 0.5
            description: "Another aspect"

        models:
          - "anthropic/claude-opus-4.5"

        thresholds:
          min_score: 7.0
          min_consensus: 0.7

    timeout: 60000
```

## Configuration

### Environment Variables

```bash
# Required for AI validation
ANTHROPIC_API_KEY=your-key

# Optional (based on models used)
OPENAI_API_KEY=your-key
GEMINI_API_KEY=your-key

# Optional configuration
E2E_TIMEOUT=60000                    # Default timeout (ms)
E2E_CLAUDE_PATH=claude               # Path to Claude Code binary
E2E_SESSIONS_DIR=ai-docs/sessions/e2e-test-results
```

### Test Timeouts

- Single scenario: 60 seconds (default, configurable per scenario)
- Full test suite: Determined by Bun test runner
- Claude Code execution: Configurable per scenario

## Understanding Test Results

### Console Output

During test execution, you'll see:
- Scenario name and status
- Skill detection results
- Quality validation scores
- Warnings for failures

### Reports

Reports are saved to `ai-docs/sessions/e2e-test-results/{timestamp}/`:

**results.json** - Machine-readable format:
```json
{
  "timestamp": "2026-01-29T12:00:00.000Z",
  "totalScenarios": 5,
  "passed": 4,
  "failed": 1,
  "duration": 120000,
  "results": [...]
}
```

**summary.md** - Human-readable summary:
- Overall pass/fail rate
- Summary by plugin
- Detailed results per scenario
- Skill detection breakdown
- Quality scores from each model

### Pass/Fail Criteria

A scenario passes if:
1. **Skill Match Ratio ≥ 80%** - Required skills detected, no forbidden skills
2. **Quality Score ≥ Threshold** - AI evaluation meets minimum score
3. **Consensus ≥ Threshold** - AI models agree sufficiently

## Troubleshooting

### Claude Code Not Found

```
Error: spawn claude ENOENT
```

**Solution:** Ensure Claude Code is installed and in PATH, or set `E2E_CLAUDE_PATH`:
```bash
export E2E_CLAUDE_PATH=/path/to/claude
```

### Claudish Not Found

```
Error: spawn npx ENOENT
```

**Solution:** Install claudish globally:
```bash
npm install -g claudish
```

### API Rate Limits

If you hit rate limits during AI validation:
1. Reduce number of models in scenarios
2. Increase timeout between tests
3. Use API key rotation (if available)
4. Run fewer scenarios at once

### Skills Not Detected

If expected skills aren't detected:
1. Check skill name matches directory name exactly
2. Verify skill file exists at `plugins/{plugin}/skills/{skill}/SKILL.md`
3. Check Claude Code actually activated the skill (look at response)
4. Update detection patterns in `skill-detector.ts` if needed

### Low Quality Scores

If AI validation scores are consistently low:
1. Review quality criteria - are they too strict?
2. Check if prompts actually trigger the skills
3. Verify skill guidance is being followed
4. Adjust thresholds in scenario

## Extending the System

### Adding New Scenarios

1. Create YAML file in `scenarios/` directory
2. Follow schema from `scenarios/README.md`
3. Validate weights sum to 1.0
4. Test locally before committing

### Adding Custom Detectors

Extend `SkillDetector` class in `utils/skill-detector.ts`:

```typescript
class CustomSkillDetector extends SkillDetector {
  detect(response: string): string[] {
    const skills = super.detect(response);

    // Add custom detection logic
    if (response.includes("custom pattern")) {
      skills.push("custom-skill");
    }

    return skills;
  }
}
```

### Adding Custom Validators

Extend `AIValidator` class in `utils/ai-validator.ts`:

```typescript
class CustomValidator extends AIValidator {
  async evaluateWithModel(...args) {
    // Use different CLI tool or API
    // Return QualityScore
  }
}
```

### Adding New Report Formats

Extend `ReportGenerator` class in `utils/report-generator.ts`:

```typescript
class HTMLReportGenerator extends ReportGenerator {
  private generateHTML(report: TestReport): string {
    // Generate HTML report
  }
}
```

## Best Practices

1. **Keep Scenarios Focused** - One skill or pattern per scenario
2. **Use Realistic Prompts** - Avoid artificial or contrived examples
3. **Set Appropriate Thresholds** - Too strict = flaky tests, too loose = false positives
4. **Review AI Feedback** - Use reasoning from evaluations to improve skills
5. **Version Scenarios** - Track scenario changes with git
6. **Document Edge Cases** - Note why certain scenarios are structured specifically
7. **Run Locally First** - Test new scenarios before CI/CD
8. **Monitor Trends** - Track quality scores over time

## CI/CD Integration

Example GitHub Actions workflow:

```yaml
name: E2E Skill Tests

on:
  pull_request:
  schedule:
    - cron: '0 0 * * *'  # Daily

jobs:
  e2e-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: |
          cd tests
          bun install
          npm install -g claudish

      - name: Run E2E tests
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          cd tests
          bun run test:e2e

      - name: Upload results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-results
          path: ai-docs/sessions/e2e-test-results/
```

## Performance

Expected performance:
- Single scenario: 30-90 seconds
- Full suite (5-10 scenarios): 3-8 minutes
- Per scenario breakdown:
  - Claude Code execution: 10-30 seconds
  - AI validation: 15-45 seconds per model
  - Report generation: <1 second

Tips for faster tests:
- Use fewer AI models (1 instead of 2-3)
- Run scenarios in parallel (test runner handles this)
- Use faster models (`grok-code-fast-1` vs `claude-opus-4.5`)
- Cache results for unchanged scenarios

## Limitations

Current limitations to be aware of:
1. **Claude Code Required** - Cannot mock real Claude Code behavior
2. **API Costs** - AI validation uses API credits
3. **Network Dependency** - Requires internet for claudish
4. **Non-Deterministic** - AI evaluations may vary slightly
5. **Skill Detection Heuristics** - May miss implicit skill usage

## Future Enhancements

Planned improvements:
- Baseline response comparison (regression detection)
- Interactive debugging mode
- Skill coverage metrics
- Performance trending dashboard
- Automated scenario generation from docs
- Support for skill version testing

## Contributing

When adding new scenarios:
1. Follow scenario schema strictly
2. Add clear descriptions
3. Test locally first
4. Document any special requirements
5. Update this README if adding new features

## Support

For issues or questions:
- Check troubleshooting section above
- Review scenario authoring guide
- Check test output and reports
- Open issue in repository

---

**Maintained by:** MAG Claude Plugins Team
**Last Updated:** 2026-01-29
**Version:** 1.0.0
