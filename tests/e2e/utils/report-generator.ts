/**
 * Test report generator for E2E tests
 * Generates JSON and Markdown reports for test results
 */

import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

export interface TestResult {
  scenario: string;
  plugin: string;
  passed: boolean;
  duration: number;
  skillDetection: {
    detected: string[];
    missing: string[];
    unexpected: string[];
    matchRatio: number;
  };
  qualityValidation: {
    averageScore: number;
    consensus: number;
    scores: Array<{
      model: string;
      score: number;
    }>;
  };
  error?: string;
}

export interface TestReport {
  timestamp: string;
  totalScenarios: number;
  passed: number;
  failed: number;
  duration: number;
  results: TestResult[];
}

export class ReportGenerator {
  private sessionsDir: string;

  constructor(sessionsDir: string = "ai-docs/sessions/e2e-test-results") {
    this.sessionsDir = sessionsDir;
  }

  /**
   * Generate and save test report
   */
  async generate(results: TestResult[]): Promise<string> {
    const timestamp = new Date().toISOString();
    const sessionDir = join(
      this.sessionsDir,
      timestamp.replace(/:/g, "-").split(".")[0]
    );

    await mkdir(sessionDir, { recursive: true });

    const report: TestReport = {
      timestamp,
      totalScenarios: results.length,
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      duration: results.reduce((sum, r) => sum + r.duration, 0),
      results,
    };

    // Save JSON report
    const jsonPath = join(sessionDir, "results.json");
    await writeFile(jsonPath, JSON.stringify(report, null, 2));

    // Save Markdown summary
    const markdownPath = join(sessionDir, "summary.md");
    await writeFile(markdownPath, this.generateMarkdown(report));

    return sessionDir;
  }

  /**
   * Generate Markdown summary
   */
  private generateMarkdown(report: TestReport): string {
    const passRate = ((report.passed / report.totalScenarios) * 100).toFixed(1);

    let md = `# E2E Test Report

**Timestamp:** ${report.timestamp}
**Total Scenarios:** ${report.totalScenarios}
**Passed:** ${report.passed} (${passRate}%)
**Failed:** ${report.failed}
**Duration:** ${(report.duration / 1000).toFixed(1)}s

---

## Summary

`;

    // Group by plugin
    const byPlugin = new Map<string, TestResult[]>();
    for (const result of report.results) {
      if (!byPlugin.has(result.plugin)) {
        byPlugin.set(result.plugin, []);
      }
      byPlugin.get(result.plugin)!.push(result);
    }

    for (const [plugin, results] of byPlugin) {
      const pluginPassed = results.filter((r) => r.passed).length;
      md += `### ${plugin} Plugin (${pluginPassed}/${results.length})\n\n`;

      for (const result of results) {
        const icon = result.passed ? "✅" : "❌";
        md += `${icon} **${result.scenario}**\n`;
        md += `- Skill Match: ${(result.skillDetection.matchRatio * 100).toFixed(0)}%\n`;
        md += `- Quality Score: ${result.qualityValidation.averageScore.toFixed(1)}/10\n`;
        md += `- Consensus: ${(result.qualityValidation.consensus * 100).toFixed(0)}%\n`;

        if (result.skillDetection.missing.length > 0) {
          md += `- Missing Skills: ${result.skillDetection.missing.join(", ")}\n`;
        }
        if (result.skillDetection.unexpected.length > 0) {
          md += `- Unexpected Skills: ${result.skillDetection.unexpected.join(", ")}\n`;
        }
        if (result.error) {
          md += `- Error: ${result.error}\n`;
        }

        md += "\n";
      }
    }

    md += "---\n\n## Detailed Results\n\n";

    for (const result of report.results) {
      md += `### ${result.scenario}\n\n`;
      md += `**Plugin:** ${result.plugin}  \n`;
      md += `**Status:** ${result.passed ? "PASSED" : "FAILED"}  \n`;
      md += `**Duration:** ${(result.duration / 1000).toFixed(1)}s\n\n`;

      md += "**Skill Detection:**\n";
      md += `- Detected: ${result.skillDetection.detected.join(", ") || "none"}\n`;
      md += `- Missing: ${result.skillDetection.missing.join(", ") || "none"}\n`;
      md += `- Unexpected: ${result.skillDetection.unexpected.join(", ") || "none"}\n`;
      md += `- Match Ratio: ${(result.skillDetection.matchRatio * 100).toFixed(0)}%\n\n`;

      md += "**Quality Validation:**\n";
      for (const score of result.qualityValidation.scores) {
        md += `- ${score.model}: ${score.score.toFixed(1)}/10\n`;
      }
      md += `- Average: ${result.qualityValidation.averageScore.toFixed(1)}/10\n`;
      md += `- Consensus: ${(result.qualityValidation.consensus * 100).toFixed(0)}%\n\n`;

      md += "---\n\n";
    }

    return md;
  }
}
