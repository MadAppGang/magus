/**
 * E2E tests for skill activation
 * Tests that skills activate correctly based on prompts
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { join } from "path";
import { ScenarioLoader } from "./utils/scenario-loader";
import { ClaudeRunner } from "./utils/claude-runner";
import { SkillDetector } from "./utils/skill-detector";
import { AIValidator } from "./utils/ai-validator";
import { ReportGenerator } from "./utils/report-generator";
import type { TestResult } from "./utils/report-generator";

const SCENARIOS_DIR = join(import.meta.dir, "scenarios");
const SESSIONS_DIR = join(
  import.meta.dir,
  "../../ai-docs/sessions/e2e-test-results"
);

describe("E2E Skill Activation Tests", () => {
  let scenarioLoader: ScenarioLoader;
  let claudeRunner: ClaudeRunner;
  let skillDetector: SkillDetector;
  let aiValidator: AIValidator;
  let reportGenerator: ReportGenerator;
  const testResults: TestResult[] = [];

  beforeAll(() => {
    scenarioLoader = new ScenarioLoader();
    claudeRunner = new ClaudeRunner();
    skillDetector = new SkillDetector();
    aiValidator = new AIValidator();
    reportGenerator = new ReportGenerator(SESSIONS_DIR);
  });

  describe("Dev Plugin Scenarios", () => {
    test(
      "Load and run dev scenarios",
      async () => {
        let scenarios;
        try {
          scenarios = await scenarioLoader.load(
            join(SCENARIOS_DIR, "dev-skills.yaml")
          );
        } catch (error) {
          console.log(
            "Skipping: dev-skills.yaml not found or invalid:",
            error
          );
          return;
        }

        for (const scenario of scenarios) {
          const startTime = Date.now();

          try {
            // Phase 1: Execute prompt
            const runResult = await claudeRunner.run(scenario.prompt, {
              timeout: scenario.timeout,
            });

            // Allow test to continue even if Claude fails
            if (runResult.error || runResult.exitCode !== 0) {
              console.warn(
                `Warning: Claude execution issue for "${scenario.name}"`
              );
            }

            // Phase 2: Detect skills
            const detectedSkills = skillDetector.detect(runResult.response);
            const skillComparison = skillDetector.compare(
              detectedSkills,
              scenario.expectations.skills.required,
              scenario.expectations.skills.optional,
              scenario.expectations.skills.forbidden
            );

            // Phase 3: Validate quality
            const qualityResult = await aiValidator.validate(
              scenario.prompt,
              runResult.response,
              scenario.expectations.quality.criteria,
              scenario.expectations.quality.models,
              scenario.expectations.quality.thresholds
            );

            // Phase 4: Determine pass/fail
            const passed =
              skillComparison.matchRatio >= 0.8 && qualityResult.passed;

            // Record result
            testResults.push({
              scenario: scenario.name,
              plugin: scenario.plugin,
              passed,
              duration: Date.now() - startTime,
              skillDetection: {
                detected: skillComparison.detected,
                missing: skillComparison.missing,
                unexpected: skillComparison.unexpected,
                matchRatio: skillComparison.matchRatio,
              },
              qualityValidation: {
                averageScore: qualityResult.averageScore,
                consensus: qualityResult.consensus,
                scores: qualityResult.scores.map((s) => ({
                  model: s.model,
                  score: s.overallScore,
                })),
              },
            });
          } catch (error) {
            // Record failure
            testResults.push({
              scenario: scenario.name,
              plugin: scenario.plugin,
              passed: false,
              duration: Date.now() - startTime,
              skillDetection: {
                detected: [],
                missing: scenario.expectations.skills.required,
                unexpected: [],
                matchRatio: 0,
              },
              qualityValidation: {
                averageScore: 0,
                consensus: 0,
                scores: [],
              },
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
      120000
    ); // 2 minute timeout
  });

  describe("Multimodel Plugin Scenarios", () => {
    test(
      "Load and run multimodel scenarios",
      async () => {
        let scenarios;
        try {
          scenarios = await scenarioLoader.load(
            join(SCENARIOS_DIR, "multimodel-skills.yaml")
          );
        } catch (error) {
          console.log(
            "Skipping: multimodel-skills.yaml not found or invalid:",
            error
          );
          return;
        }

        for (const scenario of scenarios) {
          const startTime = Date.now();

          try {
            const runResult = await claudeRunner.run(scenario.prompt, {
              timeout: scenario.timeout,
            });

            const detectedSkills = skillDetector.detect(runResult.response);
            const skillComparison = skillDetector.compare(
              detectedSkills,
              scenario.expectations.skills.required,
              scenario.expectations.skills.optional,
              scenario.expectations.skills.forbidden
            );

            const qualityResult = await aiValidator.validate(
              scenario.prompt,
              runResult.response,
              scenario.expectations.quality.criteria,
              scenario.expectations.quality.models,
              scenario.expectations.quality.thresholds
            );

            const passed =
              skillComparison.matchRatio >= 0.8 && qualityResult.passed;

            testResults.push({
              scenario: scenario.name,
              plugin: scenario.plugin,
              passed,
              duration: Date.now() - startTime,
              skillDetection: {
                detected: skillComparison.detected,
                missing: skillComparison.missing,
                unexpected: skillComparison.unexpected,
                matchRatio: skillComparison.matchRatio,
              },
              qualityValidation: {
                averageScore: qualityResult.averageScore,
                consensus: qualityResult.consensus,
                scores: qualityResult.scores.map((s) => ({
                  model: s.model,
                  score: s.overallScore,
                })),
              },
            });
          } catch (error) {
            testResults.push({
              scenario: scenario.name,
              plugin: scenario.plugin,
              passed: false,
              duration: Date.now() - startTime,
              skillDetection: {
                detected: [],
                missing: scenario.expectations.skills.required,
                unexpected: [],
                matchRatio: 0,
              },
              qualityValidation: {
                averageScore: 0,
                consensus: 0,
                scores: [],
              },
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      },
      120000
    );
  });

  // After all tests, generate report
  afterAll(async () => {
    if (testResults.length > 0) {
      const reportPath = await reportGenerator.generate(testResults);
      console.log(`\n📊 Test report saved to: ${reportPath}`);
    }
  });
});
