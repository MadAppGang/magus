/**
 * Stage 4: LLM Signal Classifier
 *
 * Uses the Anthropic API (via curl) to classify learnings from a session summary.
 * Requires ANTHROPIC_API_KEY in the environment.
 */

import { execSync } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
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

  // Every field below is attacker-shaped: it is whatever an LLM emitted. The
  // previous implementation cast the object to `Learning` and trusted it, so an
  // out-of-range `line_cost` (negative, NaN, enormous) flowed into
  // `checkBudget`'s `current + newLineCost <= 200` arithmetic, and an unknown
  // `type` or `confidence` silently defeated the routing rules that gate what
  // becomes persistent.
  const rawLearnings = (parsed.learnings ?? []) as Record<string, unknown>[];
  const learnings: Learning[] = [];

  for (const l of Array.isArray(rawLearnings) ? rawLearnings : []) {
    const ruleText = String(l.rule_text ?? "").trim();
    // A learning with no text cannot be applied, deduped, or reviewed.
    if (!ruleText || ruleText.length > MAX_RULE_TEXT_CHARS) continue;

    const type = oneOf(l.type, LEARNING_TYPES);
    const confidence = oneOf(l.confidence, CONFIDENCES);
    const scope = oneOf(l.scope, SCOPES);
    // Reject rather than coerce: an unrecognised enum means the classifier
    // returned something we do not understand, and guessing "correction" would
    // route an unknown thing through a rule written for a known one.
    if (!type || !confidence || !scope) continue;

    const hash = createHash("sha256").update(ruleText).digest("hex").slice(0, 8);

    learnings.push({
      id: `learning-${hash}`,
      type,
      confidence,
      is_project_specific: l.is_project_specific === true,
      scope,
      rule_text: ruleText,
      evidence: String(l.evidence ?? "").slice(0, MAX_EVIDENCE_CHARS),
      subsection: String(l.subsection ?? "Conventions").slice(0, MAX_SUBSECTION_CHARS),
      line_cost: clampLineCost(l.line_cost),
    });
  }

  return {
    learnings,
    session_quality: oneOf(parsed.session_quality, SESSION_QUALITIES) ?? "low",
    summary: String(parsed.summary ?? "No summary").slice(0, MAX_SUMMARY_CHARS),
  };
}

const LEARNING_TYPES = [
  "correction",
  "explicit_rule",
  "repeated_pattern",
  "failed_attempt",
  "delegation_pattern",
  "user_frustration",
  "user_praise",
] as const;
const CONFIDENCES = ["HIGH", "MEDIUM", "LOW"] as const;
const SCOPES = ["claude_md", "memory", "coaching", "discard"] as const;
const SESSION_QUALITIES = ["high", "medium", "low"] as const;

const MAX_RULE_TEXT_CHARS = 500;
const MAX_EVIDENCE_CHARS = 1000;
const MAX_SUBSECTION_CHARS = 100;
const MAX_SUMMARY_CHARS = 2000;
/** A single learning may never claim more than this share of the line budget. */
const MAX_LINE_COST = 10;

/** Returns the value when it is a member of `allowed`, else undefined. */
function oneOf<T extends readonly string[]>(
  value: unknown,
  allowed: T,
): T[number] | undefined {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

/** Coerce line_cost into [1, MAX_LINE_COST]; NaN and Infinity become 1. */
function clampLineCost(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 1;
  return Math.min(Math.max(n, 1), MAX_LINE_COST);
}

// Cheap classifier tier. Uses the "-latest" alias deliberately: it tracks the
// current Haiku, so this ID cannot go stale the way a pinned snapshot does.
// One ID, no fallback — a fallback is where staleness hides.
function getClassifierModel(): string {
  return "claude-haiku-latest";
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
