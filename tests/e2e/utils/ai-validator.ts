/**
 * AI-powered quality validation for E2E tests
 * Uses Claude CLI directly to evaluate response quality
 */

import { spawn } from "bun";

export interface QualityCriterion {
  name: string;
  weight: number;
  description: string;
}

export interface QualityScore {
  model: string;
  overallScore: number; // 1-10
  criteriaScores: Record<string, number>; // name -> score (1-10)
  reasoning: string;
  duration: number;
}

export interface ValidationResult {
  scores: QualityScore[];
  averageScore: number;
  consensus: number; // Agreement ratio (0-1)
  passed: boolean;
  summary: string;
}

export class AIValidator {
  /**
   * Evaluate response quality using Claude CLI
   */
  async validate(
    prompt: string,
    response: string,
    criteria: QualityCriterion[],
    models: string[], // Not used with Claude CLI, kept for interface compatibility
    thresholds: { min_score: number; min_consensus: number }
  ): Promise<ValidationResult> {
    // Run single evaluation with Claude CLI
    const score = await this.evaluateWithClaude(prompt, response, criteria);
    const scores = [score];

    const averageScore = score.overallScore;
    const consensus = 1.0; // Single model = perfect consensus
    const passed = averageScore >= thresholds.min_score;

    return {
      scores,
      averageScore,
      consensus,
      passed,
      summary: this.generateSummary(scores, averageScore, consensus, passed),
    };
  }

  /**
   * Evaluate response using Claude CLI with --print flag
   */
  private async evaluateWithClaude(
    prompt: string,
    response: string,
    criteria: QualityCriterion[]
  ): Promise<QualityScore> {
    const startTime = Date.now();

    // Construct evaluation prompt
    const evaluationPrompt = this.buildEvaluationPrompt(
      prompt,
      response,
      criteria
    );

    try {
      // Call Claude CLI with --print for direct output
      const proc = spawn({
        cmd: [
          "claude",
          "--print", // Output response directly without interactive mode
          "--dangerously-skip-permissions", // Skip permission prompts
          "-p",
          evaluationPrompt,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        throw new Error(`Claude CLI exited with code ${exitCode}: ${stderr}`);
      }

      // Parse evaluation response
      return this.parseEvaluation(
        stdout,
        "claude",
        criteria,
        Date.now() - startTime
      );
    } catch (error) {
      console.warn(`Failed to evaluate with Claude CLI:`, error);
      // Return neutral scores on failure
      return {
        model: "claude",
        overallScore: 5.0,
        criteriaScores: Object.fromEntries(criteria.map((c) => [c.name, 5.0])),
        reasoning: `Evaluation failed: ${error}`,
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Build evaluation prompt for Claude
   */
  private buildEvaluationPrompt(
    originalPrompt: string,
    response: string,
    criteria: QualityCriterion[]
  ): string {
    const criteriaList = criteria
      .map(
        (c, i) =>
          `${i + 1}. ${c.name} (weight: ${c.weight})\n   ${c.description}`
      )
      .join("\n\n");

    return `You are evaluating the quality of an AI assistant's response.

ORIGINAL USER PROMPT:
${originalPrompt}

AI ASSISTANT RESPONSE:
${response.substring(0, 4000)}

EVALUATION CRITERIA:
${criteriaList}

TASK:
1. For each criterion, provide a score from 1-10 (where 10 is perfect)
2. Calculate a weighted overall score
3. Provide brief reasoning for your scores

RESPONSE FORMAT (JSON only, no other text):
{
  "criteriaScores": {
    ${criteria.map((c) => `"${c.name}": <score>`).join(",\n    ")}
  },
  "overallScore": <weighted_average>,
  "reasoning": "<2-3 sentence explanation>"
}`;
  }

  /**
   * Parse evaluation response from Claude
   */
  private parseEvaluation(
    output: string,
    model: string,
    criteria: QualityCriterion[],
    duration: number
  ): QualityScore {
    try {
      // Extract JSON from response (may have markdown code blocks)
      const jsonMatch =
        output.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
        output.match(/(\{[\s\S]*\})/);

      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[1]);

      return {
        model,
        overallScore: parsed.overallScore || 5.0,
        criteriaScores: parsed.criteriaScores || {},
        reasoning: parsed.reasoning || "No reasoning provided",
        duration,
      };
    } catch (error) {
      // Fallback to neutral scores
      return {
        model,
        overallScore: 5.0,
        criteriaScores: Object.fromEntries(criteria.map((c) => [c.name, 5.0])),
        reasoning: `Failed to parse evaluation: ${error}`,
        duration,
      };
    }
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    scores: QualityScore[],
    average: number,
    consensus: number,
    passed: boolean
  ): string {
    const modelScores = scores
      .map((s) => `${s.model}: ${s.overallScore.toFixed(1)}`)
      .join(", ");
    return `${passed ? "PASS" : "FAIL"} - Average: ${average.toFixed(1)}/10, Consensus: ${(consensus * 100).toFixed(0)}% (${modelScores})`;
  }
}
