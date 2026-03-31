/**
 * Stage 4: LLM Signal Classifier
 *
 * Uses the Anthropic API (via curl) to classify learnings from a session summary.
 * Requires ANTHROPIC_API_KEY in the environment.
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";
import type { SessionSummary, ClassifierResult, Learning } from "./types";

export const CLASSIFIER_SYSTEM_PROMPT = `You are a session learning classifier for Claude Code. You analyze session summaries to extract learnable patterns.

You MUST respond with ONLY valid JSON matching this schema:
{
  "learnings": [
    {
      "type": "correction|explicit_rule|repeated_pattern|failed_attempt|delegation_pattern|user_frustration|user_praise",
      "confidence": "HIGH|MEDIUM|LOW",
      "is_project_specific": true|false,
      "scope": "claude_md|memory|coaching|discard",
      "rule_text": "Concise, actionable rule (1 line)",
      "evidence": "What the user said/did (with message index)",
      "subsection": "Code Style|Project Structure|Tools & Commands|Conventions|Workflow",
      "line_cost": 1
    }
  ],
  "session_quality": "high|medium|low",
  "summary": "One sentence describing the session's learning value"
}

Classification rules:
- HIGH confidence: Explicit rules stated by user ("we always...", "our convention...") OR same correction repeated 3+ times
- MEDIUM confidence: Single clear correction with intent to teach
- LOW confidence: Inferred from behavior, ambiguous
- scope "claude_md": HIGH confidence + project-specific learnings only
- scope "memory": MEDIUM confidence learnings
- scope "coaching": Failed attempts, behavioral suggestions
- scope "discard": General best practices (not project-specific), noise, LOW confidence
- is_project_specific: TRUE only if the learning is about THIS project's conventions, not general programming
- rule_text: Must be actionable and concise (under 80 chars)
- Only extract learnings that would help future Claude sessions with this project`;

export function buildClassifierPrompt(summary: SessionSummary): string {
  return JSON.stringify(
    {
      system: CLASSIFIER_SYSTEM_PROMPT,
      session: {
        session_id: summary.session_id,
        cwd: summary.cwd,
        learning_score: summary.learning_score,
        user_messages: summary.user_messages,
        tool_call_summary: summary.tool_call_summary,
        rule_based_signals: summary.rule_based_signals,
      },
    },
    null,
    2
  );
}

export function parseClassifierResponse(response: string): ClassifierResult {
  // Extract JSON from response (handle markdown code blocks)
  let jsonStr = response.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }

  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

  // Validate and add IDs
  const rawLearnings = (parsed.learnings ?? []) as Record<string, unknown>[];
  const learnings: Learning[] = rawLearnings.map((l) => {
    const ruleText = String(l.rule_text ?? "");
    const hash = createHash("sha256")
      .update(ruleText)
      .digest("hex")
      .slice(0, 8);
    return {
      id: `learning-${hash}`,
      type: l.type ?? "correction",
      confidence: l.confidence ?? "LOW",
      is_project_specific: Boolean(l.is_project_specific ?? false),
      scope: l.scope ?? "discard",
      rule_text: ruleText,
      evidence: String(l.evidence ?? ""),
      subsection: String(l.subsection ?? "Conventions"),
      line_cost: Number(l.line_cost ?? 1),
    } as Learning;
  });

  return {
    learnings,
    session_quality: (parsed.session_quality as "high" | "medium" | "low") ?? "low",
    summary: String(parsed.summary ?? "No summary"),
  };
}

function getClassifierModel(): string {
  try {
    const aliasesPath = join(__dirname, "../../../../../shared/model-aliases.json");
    const aliases = JSON.parse(readFileSync(aliasesPath, "utf-8"));
    return aliases.roles?.coaching_classifier?.modelId ?? "claude-sonnet-4-20250514";
  } catch {
    return "claude-sonnet-4-20250514";
  }
}

export async function classifySession(
  summary: SessionSummary,
  options: { maxRetries?: number; tmpDir?: string } = {}
): Promise<ClassifierResult> {
  const maxRetries = options.maxRetries ?? 3;
  const tmpDir = options.tmpDir ?? "/tmp";

  const requestPath = join(
    tmpDir,
    `learn-classify-${summary.session_id}-req.json`
  );

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY not set — cannot run LLM classifier"
    );
  }

  const prompt = buildClassifierPrompt(summary);

  const requestBody = JSON.stringify({
    model: getClassifierModel(),
    max_tokens: 2048,
    system: CLASSIFIER_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Analyze this Claude Code session and extract learnable patterns.\n\n${prompt}`,
      },
    ],
  });

  writeFileSync(requestPath, requestBody);

  let lastError: Error | null = null;

  try {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const curlCmd = `curl -s --max-time 60 -X POST https://api.anthropic.com/v1/messages \
          -H "Content-Type: application/json" \
          -H "x-api-key: ${apiKey.replace(/'/g, "'\\''")}\" \
          -H "anthropic-version: 2023-06-01" \
          -d @"${requestPath.replace(/"/g, '\\"')}"`;

        const response = execSync(curlCmd, {
          timeout: 90_000,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });

        const apiResponse = JSON.parse(response) as Record<string, unknown>;

        if (apiResponse.error) {
          const err = apiResponse.error as Record<string, unknown>;
          throw new Error(
            `API error: ${err.message ?? JSON.stringify(apiResponse.error)}`
          );
        }

        // Extract text content from response
        const content = apiResponse.content as
          | Array<Record<string, unknown>>
          | undefined;
        const textContent = content?.find((b) => b.type === "text");
        if (!textContent?.text) {
          throw new Error("No text content in API response");
        }

        const result = parseClassifierResponse(String(textContent.text));
        return result;
      } catch (err) {
        lastError =
          err instanceof Error ? err : new Error(String(err));
        if (attempt < maxRetries) {
          // Exponential backoff: 1s, 2s, 4s
          await new Promise((resolve) =>
            setTimeout(resolve, 1000 * Math.pow(2, attempt - 1))
          );
        }
      }
    }
  } finally {
    // Cleanup temp request file
    try {
      unlinkSync(requestPath);
    } catch {
      // Ignore cleanup errors
    }
  }

  throw lastError ?? new Error("Classification failed after all retries");
}
