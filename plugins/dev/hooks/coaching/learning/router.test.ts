/**
 * Tests for router.ts — Stage 5: Storage Router
 *
 * Tests cover:
 * - HIGH confidence corrections route to pendingClaudeMd
 * - MEDIUM confidence corrections route to coachingClaude + memoryFeedback
 * - failed_attempt routes to coachingHuman
 * - LOW confidence gets discarded
 * - Non-project-specific HIGH confidence does NOT go to claude_md
 */

import { describe, it, expect } from "bun:test";
import { routeLearnings } from "./router";
import type { ClassifierResult, Learning } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(learnings: Partial<Learning>[]): ClassifierResult {
  return {
    learnings: learnings.map((l, i) => ({
      id: `learning-${String(i).padStart(8, "0")}`,
      type: "correction" as const,
      confidence: "HIGH" as const,
      is_project_specific: true,
      scope: "claude_md" as const,
      rule_text: `Rule ${i}`,
      evidence: `evidence ${i}`,
      subsection: "Conventions",
      line_cost: 1,
      ...l,
    })),
    session_quality: "high",
    summary: "test",
  };
}

// ---------------------------------------------------------------------------
// routeLearnings()
// ---------------------------------------------------------------------------

describe("routeLearnings()", () => {
  it("routes HIGH confidence correction to pendingClaudeMd", () => {
    const result = makeResult([
      {
        type: "correction",
        confidence: "HIGH",
        is_project_specific: true,
      },
    ]);

    const routed = routeLearnings(result);

    expect(routed.pendingClaudeMd).toHaveLength(1);
    expect(routed.coachingClaude).toHaveLength(0);
    expect(routed.coachingHuman).toHaveLength(0);
    expect(routed.memoryFeedback).toHaveLength(0);
    expect(routed.discarded).toHaveLength(0);
  });

  it("routes HIGH confidence explicit_rule to pendingClaudeMd", () => {
    const result = makeResult([
      { type: "explicit_rule", confidence: "HIGH", is_project_specific: true },
    ]);
    const routed = routeLearnings(result);
    expect(routed.pendingClaudeMd).toHaveLength(1);
  });

  it("routes HIGH confidence repeated_pattern to pendingClaudeMd", () => {
    const result = makeResult([
      { type: "repeated_pattern", confidence: "HIGH", is_project_specific: true },
    ]);
    const routed = routeLearnings(result);
    expect(routed.pendingClaudeMd).toHaveLength(1);
  });

  it("routes HIGH confidence user_praise to pendingClaudeMd", () => {
    const result = makeResult([
      { type: "user_praise", confidence: "HIGH", is_project_specific: true },
    ]);
    const routed = routeLearnings(result);
    expect(routed.pendingClaudeMd).toHaveLength(1);
  });

  it("routes MEDIUM confidence correction to coachingClaude and memoryFeedback", () => {
    const result = makeResult([
      {
        type: "correction",
        confidence: "MEDIUM",
        is_project_specific: true,
      },
    ]);

    const routed = routeLearnings(result);

    expect(routed.coachingClaude).toHaveLength(1);
    expect(routed.memoryFeedback).toHaveLength(1);
    // Same learning object appears in both
    expect(routed.coachingClaude[0]).toBe(routed.memoryFeedback[0]);
    expect(routed.pendingClaudeMd).toHaveLength(0);
    expect(routed.discarded).toHaveLength(0);
  });

  it("routes MEDIUM confidence explicit_rule to coachingClaude and memoryFeedback", () => {
    const result = makeResult([
      { type: "explicit_rule", confidence: "MEDIUM", is_project_specific: false },
    ]);
    const routed = routeLearnings(result);
    expect(routed.coachingClaude).toHaveLength(1);
    expect(routed.memoryFeedback).toHaveLength(1);
  });

  it("routes failed_attempt (MEDIUM) to coachingHuman", () => {
    const result = makeResult([
      {
        type: "failed_attempt",
        confidence: "MEDIUM",
        is_project_specific: false,
      },
    ]);

    const routed = routeLearnings(result);

    expect(routed.coachingHuman).toHaveLength(1);
    expect(routed.pendingClaudeMd).toHaveLength(0);
    expect(routed.coachingClaude).toHaveLength(0);
    expect(routed.memoryFeedback).toHaveLength(0);
    expect(routed.discarded).toHaveLength(0);
  });

  it("routes failed_attempt (HIGH) to coachingHuman", () => {
    const result = makeResult([
      {
        type: "failed_attempt",
        confidence: "HIGH",
        is_project_specific: true,
      },
    ]);
    const routed = routeLearnings(result);
    expect(routed.coachingHuman).toHaveLength(1);
    // failed_attempt does NOT go to pendingClaudeMd even if HIGH + project-specific
    expect(routed.pendingClaudeMd).toHaveLength(0);
  });

  it("discards LOW confidence learnings", () => {
    const result = makeResult([
      { type: "correction", confidence: "LOW", is_project_specific: true },
    ]);

    const routed = routeLearnings(result);

    expect(routed.discarded).toHaveLength(1);
    expect(routed.pendingClaudeMd).toHaveLength(0);
    expect(routed.coachingClaude).toHaveLength(0);
    expect(routed.memoryFeedback).toHaveLength(0);
    expect(routed.coachingHuman).toHaveLength(0);
  });

  it("discards HIGH confidence delegation_pattern (not in CLAUDE.md types)", () => {
    const result = makeResult([
      { type: "delegation_pattern", confidence: "HIGH", is_project_specific: true },
    ]);
    const routed = routeLearnings(result);
    // delegation_pattern is not in CLAUDE_MD_TYPES → falls through to discard
    expect(routed.discarded).toHaveLength(1);
    expect(routed.pendingClaudeMd).toHaveLength(0);
  });

  it("does NOT route non-project-specific HIGH confidence to pendingClaudeMd", () => {
    const result = makeResult([
      {
        type: "correction",
        confidence: "HIGH",
        is_project_specific: false,
      },
    ]);

    const routed = routeLearnings(result);

    // Not project-specific → does not qualify for CLAUDE.md
    // Falls through: not MEDIUM correction either (it's HIGH), not failed_attempt
    // Lands in discarded
    expect(routed.pendingClaudeMd).toHaveLength(0);
    expect(routed.discarded).toHaveLength(1);
  });

  it("routes mixed learnings to correct buckets", () => {
    const result = makeResult([
      { type: "correction", confidence: "HIGH", is_project_specific: true },
      { type: "correction", confidence: "MEDIUM", is_project_specific: true },
      { type: "failed_attempt", confidence: "MEDIUM", is_project_specific: false },
      { type: "user_frustration", confidence: "LOW", is_project_specific: false },
    ]);

    const routed = routeLearnings(result);

    expect(routed.pendingClaudeMd).toHaveLength(1);
    expect(routed.coachingClaude).toHaveLength(1);
    expect(routed.memoryFeedback).toHaveLength(1);
    expect(routed.coachingHuman).toHaveLength(1);
    expect(routed.discarded).toHaveLength(1);
  });

  it("returns all empty buckets when learnings array is empty", () => {
    const result = makeResult([]);
    const routed = routeLearnings(result);

    expect(routed.pendingClaudeMd).toHaveLength(0);
    expect(routed.coachingClaude).toHaveLength(0);
    expect(routed.coachingHuman).toHaveLength(0);
    expect(routed.memoryFeedback).toHaveLength(0);
    expect(routed.discarded).toHaveLength(0);
  });
});
