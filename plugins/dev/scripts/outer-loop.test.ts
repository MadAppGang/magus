import { describe, expect, test } from "bun:test";
import {
  canComplete,
  emptyMeta,
  recordResult,
  startIteration,
  type SessionMeta,
} from "./outer-loop.ts";

const NOW = "2026-07-29T00:00:00.000Z";
const meta = (): SessionMeta => emptyMeta("ai-docs/sessions/dev-feature-x", NOW);

function withResults(scores: Array<[string, number | undefined]>): SessionMeta {
  let m = meta();
  for (const [status, score] of scores) {
    m.outerLoop.currentIteration += 1;
    m = recordResult(m, status, NOW, { score }).meta;
  }
  return m;
}

describe("startIteration", () => {
  test("increments and moves the checkpoint to phase3", () => {
    const out = startIteration(meta());
    expect(out.iteration).toBe(1);
    expect(out.meta.checkpoint.nextPhase).toBe("phase3");
    expect(out.maxReached).toBe(false);
  });

  test("flags budget exhaustion only after exceeding maxIterations", () => {
    const m = meta();
    m.outerLoop.currentIteration = 3; // max is 3
    expect(startIteration(m).maxReached).toBe(true);
  });

  test("never exhausts in infinite mode", () => {
    const m = meta();
    m.outerLoop.currentIteration = 999;
    const out = startIteration(m, { outerLoop: { maxIterations: "infinite" } });
    expect(out.maxReached).toBe(false);
    expect(out.meta.outerLoop.mode).toBe("infinite");
  });

  test("notifies every N iterations in infinite mode", () => {
    const m = meta();
    m.outerLoop.currentIteration = 9;
    const out = startIteration(m, {
      outerLoop: { maxIterations: "infinite", notifyEvery: 5 },
    });
    expect(out.iteration).toBe(10);
    expect(out.shouldNotify).toBe(true);
  });

  test("detects a falling score across iterations", () => {
    const m = withResults([["FAIL", 90], ["FAIL", 70]]);
    expect(startIteration(m).regression).toEqual({ previous: 90, current: 70 });
  });

  test("does not report regression when the score improves", () => {
    const m = withResults([["FAIL", 70], ["FAIL", 90]]);
    expect(startIteration(m).regression).toBeNull();
  });

  test("does not report regression when scores are absent", () => {
    const m = withResults([["FAIL", undefined], ["FAIL", undefined]]);
    expect(startIteration(m).regression).toBeNull();
  });

  test("a malformed config leaves existing settings intact", () => {
    const out = startIteration(meta(), {} as never);
    expect(out.meta.outerLoop.maxIterations).toBe(3);
    expect(out.meta.outerLoop.mode).toBe("limited");
  });
});

describe("recordResult", () => {
  test("PASS advances the checkpoint to phase8", () => {
    const { meta: m, result } = recordResult(meta(), "pass", NOW, { score: 94 });
    expect(result.status).toBe("PASS");
    expect(result.score).toBe(94);
    expect(m.checkpoint.nextPhase).toBe("phase8");
  });

  test("FAIL loops back to phase3", () => {
    const { meta: m } = recordResult(meta(), "fail", NOW, { reason: "button colour" });
    expect(m.checkpoint.nextPhase).toBe("phase3");
    expect(m.outerLoop.phase7Results[0].reason).toBe("button colour");
  });

  test("an unrecognised status is treated as FAIL rather than trusted", () => {
    expect(recordResult(meta(), "probably fine", NOW).result.status).toBe("FAIL");
  });

  test("a non-numeric score becomes null instead of NaN", () => {
    const { result } = recordResult(meta(), "PASS", NOW, { score: Number.NaN });
    expect(result.score).toBeNull();
  });
});

describe("canComplete — the Phase 8 gate", () => {
  test("blocks when no Phase 7 result exists", () => {
    const v = canComplete(meta());
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("no Phase 7 result");
  });

  test("blocks on a failing Phase 7 and says why", () => {
    const v = canComplete(withResults([["FAIL", 40]]));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("FAIL");
  });

  test("allows after a passing Phase 7", () => {
    expect(canComplete(withResults([["PASS", 96]])).ok).toBe(true);
  });

  test("judges only the most recent result", () => {
    expect(canComplete(withResults([["PASS", 96], ["FAIL", 20]])).ok).toBe(false);
    expect(canComplete(withResults([["FAIL", 20], ["PASS", 96]])).ok).toBe(true);
  });
});
