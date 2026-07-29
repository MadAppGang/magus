import { describe, expect, it } from "bun:test";
import { parseClassifierResponse } from "./classifier";

/**
 * parseClassifierResponse consumes raw LLM output. Everything in it is
 * untrusted: the model can emit any type, any confidence, any number. These
 * tests pin that malformed values are rejected or clamped rather than cast
 * straight into the routing rules and the CLAUDE.md line budget.
 */

const valid = {
  type: "correction",
  confidence: "HIGH",
  is_project_specific: true,
  scope: "claude_md",
  rule_text: "Prefer bun over node for scripts",
  evidence: "user said so",
  subsection: "Conventions",
  line_cost: 2,
};

function wrap(learnings: unknown[]) {
  return JSON.stringify({ learnings, session_quality: "high", summary: "ok" });
}

describe("parseClassifierResponse — happy path", () => {
  it("accepts a well-formed learning and derives a stable id", () => {
    const r = parseClassifierResponse(wrap([valid]));
    expect(r.learnings).toHaveLength(1);
    expect(r.learnings[0].id).toMatch(/^learning-[0-9a-f]{8}$/);
    expect(r.learnings[0].rule_text).toBe(valid.rule_text);
    expect(r.learnings[0].line_cost).toBe(2);
  });

  it("unwraps a fenced json code block", () => {
    const r = parseClassifierResponse("```json\n" + wrap([valid]) + "\n```");
    expect(r.learnings).toHaveLength(1);
  });

  it("gives the same id to the same rule text", () => {
    const a = parseClassifierResponse(wrap([valid])).learnings[0].id;
    const b = parseClassifierResponse(wrap([{ ...valid, evidence: "different" }]))
      .learnings[0].id;
    expect(a).toBe(b);
  });
});

describe("parseClassifierResponse — rejects unknown enums", () => {
  it("drops a learning with an unrecognised type instead of defaulting it", () => {
    // Defaulting to "correction" would route an unknown thing through a rule
    // written for a known one.
    const r = parseClassifierResponse(wrap([{ ...valid, type: "exfiltrate" }]));
    expect(r.learnings).toHaveLength(0);
  });

  it("drops a learning with an unrecognised confidence", () => {
    const r = parseClassifierResponse(wrap([{ ...valid, confidence: "CERTAIN" }]));
    expect(r.learnings).toHaveLength(0);
  });

  it("drops a learning with an unrecognised scope", () => {
    const r = parseClassifierResponse(wrap([{ ...valid, scope: "everywhere" }]));
    expect(r.learnings).toHaveLength(0);
  });

  it("keeps valid siblings when one entry is rejected", () => {
    const r = parseClassifierResponse(wrap([{ ...valid, type: "bogus" }, valid]));
    expect(r.learnings).toHaveLength(1);
  });
});

describe("parseClassifierResponse — line_cost cannot poison the budget", () => {
  const cases: Array<[string, unknown, number]> = [
    ["negative", -50, 1],
    ["zero", 0, 1],
    ["NaN", "not a number", 1],
    ["Infinity", Infinity, 1],
    ["absurdly large", 99999, 10],
    ["fractional", 2.6, 3],
    ["missing", undefined, 1],
  ];

  for (const [label, input, expected] of cases) {
    it(`clamps ${label} to ${expected}`, () => {
      const r = parseClassifierResponse(wrap([{ ...valid, line_cost: input }]));
      expect(r.learnings[0].line_cost).toBe(expected);
    });
  }

  it("never emits a value that breaks current + cost <= budget arithmetic", () => {
    const r = parseClassifierResponse(
      wrap([{ ...valid, line_cost: Number.NaN }, { ...valid, line_cost: -1 }]),
    );
    for (const l of r.learnings) {
      expect(Number.isInteger(l.line_cost)).toBe(true);
      expect(l.line_cost).toBeGreaterThan(0);
    }
  });
});

describe("parseClassifierResponse — bounds and degenerate input", () => {
  it("drops a learning with empty rule text", () => {
    expect(parseClassifierResponse(wrap([{ ...valid, rule_text: "   " }])).learnings)
      .toHaveLength(0);
  });

  it("drops an absurdly long rule text rather than truncating it into nonsense", () => {
    const r = parseClassifierResponse(
      wrap([{ ...valid, rule_text: "x".repeat(5000) }]),
    );
    expect(r.learnings).toHaveLength(0);
  });

  it("truncates oversized evidence and subsection", () => {
    const r = parseClassifierResponse(
      wrap([{ ...valid, evidence: "e".repeat(9000), subsection: "s".repeat(9000) }]),
    );
    expect(r.learnings[0].evidence.length).toBeLessThanOrEqual(1000);
    expect(r.learnings[0].subsection.length).toBeLessThanOrEqual(100);
  });

  it("treats a non-boolean is_project_specific as false", () => {
    const r = parseClassifierResponse(
      wrap([{ ...valid, is_project_specific: "yes" }]),
    );
    expect(r.learnings[0].is_project_specific).toBe(false);
  });

  it("falls back to low quality on an unrecognised session_quality", () => {
    const raw = JSON.stringify({
      learnings: [],
      session_quality: "excellent",
      summary: "x",
    });
    expect(parseClassifierResponse(raw).session_quality).toBe("low");
  });

  it("survives learnings being absent or not an array", () => {
    expect(parseClassifierResponse('{"summary":"x"}').learnings).toHaveLength(0);
    expect(
      parseClassifierResponse('{"learnings":"nope","summary":"x"}').learnings,
    ).toHaveLength(0);
  });
});
