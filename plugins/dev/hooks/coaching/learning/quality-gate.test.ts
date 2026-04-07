/**
 * Tests for quality-gate.ts — Stage 6: Quality Gate
 *
 * Tests cover:
 * - hashLearning produces consistent SHA-256 prefix
 * - isDuplicate returns true for already-applied (staged_to_claude_md) learnings
 * - isDuplicate returns false for new learnings
 * - reinforceLearning increments times_seen and updates last_reinforced_session
 * - countLearnedPreferencesLines counts correctly
 * - checkBudget enforces 200-line limit
 * - registerLearning creates state entry with staged_to_claude_md: false
 * - loadLearningState / saveLearningState roundtrip
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  hashLearning,
  isDuplicate,
  reinforceLearning,
  registerLearning,
  countLearnedPreferencesLines,
  checkBudget,
  loadLearningState,
  saveLearningState,
  CLAUDE_MD_LINE_BUDGET,
} from "./quality-gate";
import type { Learning } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir = "";

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "quality-gate-test-"));
});

afterEach(() => {
  if (testDir && existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
});

function makeLearning(overrides: Partial<Learning> = {}): Learning {
  return {
    id: "learning-abcd1234",
    type: "correction",
    confidence: "HIGH",
    is_project_specific: true,
    scope: "claude_md",
    rule_text: "Use pnpm for package management",
    evidence: "User said 'we use pnpm' at message 3",
    subsection: "Tools & Commands",
    line_cost: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// hashLearning()
// ---------------------------------------------------------------------------

describe("hashLearning()", () => {
  it("returns a 16-character hex string", () => {
    const hash = hashLearning("Use pnpm");
    expect(hash).toHaveLength(16);
    expect(hash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("is deterministic — same input always produces same hash", () => {
    const text = "Use pnpm for package management";
    expect(hashLearning(text)).toBe(hashLearning(text));
  });

  it("produces different hashes for different inputs", () => {
    expect(hashLearning("Use pnpm")).not.toBe(hashLearning("Use npm"));
  });

  it("is case-sensitive", () => {
    expect(hashLearning("use pnpm")).not.toBe(hashLearning("Use pnpm"));
  });
});

// ---------------------------------------------------------------------------
// isDuplicate()
// ---------------------------------------------------------------------------

describe("isDuplicate()", () => {
  it("returns false for a learning not in state", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    const learning = makeLearning();
    expect(isDuplicate(learning, state)).toBe(false);
  });

  it("returns false for a learning registered but not yet applied to CLAUDE.md", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    const learning = makeLearning();
    registerLearning(learning, state, "session-1");
    // staged_to_claude_md defaults to false
    expect(isDuplicate(learning, state)).toBe(false);
  });

  it("returns true for a learning with staged_to_claude_md: true", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    const learning = makeLearning();
    const hash = hashLearning(learning.rule_text);
    // Manually mark as staged (as /dev:learn --apply would do)
    state.learnings[hash] = {
      rule_text: learning.rule_text,
      first_seen_session: "session-1",
      last_reinforced_session: "session-1",
      times_seen: 1,
      staged_to_claude_md: true,
      staged_session: "session-1",
    };
    expect(isDuplicate(learning, state)).toBe(true);
  });

  it("uses rule_text for hashing (ignores other fields)", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    const learning1 = makeLearning({ rule_text: "Use pnpm" });
    const learning2 = makeLearning({
      rule_text: "Use pnpm",
      evidence: "different evidence",
      type: "explicit_rule",
    });
    // Mark learning1 as staged
    const hash = hashLearning(learning1.rule_text);
    state.learnings[hash] = {
      rule_text: learning1.rule_text,
      first_seen_session: "s1",
      last_reinforced_session: "s1",
      times_seen: 1,
      staged_to_claude_md: true,
      staged_session: "s1",
    };
    // learning2 has same rule_text → also detected as duplicate
    expect(isDuplicate(learning2, state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// reinforceLearning()
// ---------------------------------------------------------------------------

describe("reinforceLearning()", () => {
  it("increments times_seen for an existing entry", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    const learning = makeLearning();
    registerLearning(learning, state, "session-1");

    reinforceLearning(learning, state, "session-2");

    const hash = hashLearning(learning.rule_text);
    expect(state.learnings[hash].times_seen).toBe(2);
  });

  it("updates last_reinforced_session", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    const learning = makeLearning();
    registerLearning(learning, state, "session-1");

    reinforceLearning(learning, state, "session-99");

    const hash = hashLearning(learning.rule_text);
    expect(state.learnings[hash].last_reinforced_session).toBe("session-99");
  });

  it("preserves first_seen_session", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    const learning = makeLearning();
    registerLearning(learning, state, "session-1");
    reinforceLearning(learning, state, "session-2");

    const hash = hashLearning(learning.rule_text);
    expect(state.learnings[hash].first_seen_session).toBe("session-1");
  });

  it("is a no-op for a learning not in state", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    const learning = makeLearning();
    // Should not throw
    expect(() => reinforceLearning(learning, state, "session-1")).not.toThrow();
    expect(Object.keys(state.learnings)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// registerLearning()
// ---------------------------------------------------------------------------

describe("registerLearning()", () => {
  it("creates a new state entry with correct fields", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    const learning = makeLearning();
    registerLearning(learning, state, "session-1");

    const hash = hashLearning(learning.rule_text);
    const entry = state.learnings[hash];

    expect(entry).toBeDefined();
    expect(entry.rule_text).toBe(learning.rule_text);
    expect(entry.first_seen_session).toBe("session-1");
    expect(entry.last_reinforced_session).toBe("session-1");
    expect(entry.times_seen).toBe(1);
  });

  it("sets staged_to_claude_md to false regardless of scope", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    // Even a claude_md-scoped learning should start as false
    const learning = makeLearning({ scope: "claude_md" });
    registerLearning(learning, state, "session-1");

    const hash = hashLearning(learning.rule_text);
    expect(state.learnings[hash].staged_to_claude_md).toBe(false);
    expect(state.learnings[hash].staged_session).toBeNull();
  });

  it("is a no-op if learning is already registered", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    const learning = makeLearning();
    registerLearning(learning, state, "session-1");

    // Calling again should not change first_seen_session
    registerLearning(learning, state, "session-2");

    const hash = hashLearning(learning.rule_text);
    expect(state.learnings[hash].first_seen_session).toBe("session-1");
    expect(state.learnings[hash].times_seen).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// loadLearningState() / saveLearningState()
// ---------------------------------------------------------------------------

describe("loadLearningState() / saveLearningState()", () => {
  it("returns default empty state when file does not exist", () => {
    const state = loadLearningState(join(testDir, "nonexistent.json"));
    expect(state._session_count).toBe(0);
    expect(Object.keys(state.learnings)).toHaveLength(0);
  });

  it("returns default state when file is corrupted", () => {
    const path = join(testDir, "state.json");
    writeFileSync(path, "{ bad json }}}");
    const state = loadLearningState(path);
    expect(state._session_count).toBe(0);
  });

  it("roundtrips state to disk", () => {
    const path = join(testDir, "state.json");
    const state = loadLearningState(path);
    const learning = makeLearning();
    registerLearning(learning, state, "session-1");
    state._session_count = 5;

    saveLearningState(path, state);

    const loaded = loadLearningState(path);
    expect(loaded._session_count).toBe(5);
    const hash = hashLearning(learning.rule_text);
    expect(loaded.learnings[hash]).toBeDefined();
    expect(loaded.learnings[hash].times_seen).toBe(1);
  });

  it("writes atomically (no .tmp file left behind)", () => {
    const path = join(testDir, "state.json");
    const state = loadLearningState(path);
    saveLearningState(path, state);

    expect(existsSync(path)).toBe(true);
    const files = require("fs").readdirSync(testDir) as string[];
    expect(files.filter((f: string) => f.includes(".tmp"))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// countLearnedPreferencesLines()
// ---------------------------------------------------------------------------

describe("countLearnedPreferencesLines()", () => {
  it("returns 0 when file does not exist", () => {
    expect(countLearnedPreferencesLines(join(testDir, "CLAUDE.md"))).toBe(0);
  });

  it("returns 0 when file has no Learned Preferences section", () => {
    const path = join(testDir, "CLAUDE.md");
    writeFileSync(path, "# Project\n\n## Setup\n\nSome content.\n");
    expect(countLearnedPreferencesLines(path)).toBe(0);
  });

  it("counts non-blank lines inside the Learned Preferences section", () => {
    const path = join(testDir, "CLAUDE.md");
    writeFileSync(
      path,
      [
        "# Project",
        "",
        "## Learned Preferences",
        "",
        "- Use pnpm",
        "- No hardcoded paths",
        "- Use bun for testing",
        "",
        "## Another Section",
        "more content",
      ].join("\n")
    );
    // 3 non-blank lines inside the section
    expect(countLearnedPreferencesLines(path)).toBe(3);
  });

  it("stops counting at the next ## heading", () => {
    const path = join(testDir, "CLAUDE.md");
    writeFileSync(
      path,
      [
        "## Learned Preferences",
        "- Rule 1",
        "- Rule 2",
        "## Other Section",
        "- Not counted",
      ].join("\n")
    );
    expect(countLearnedPreferencesLines(path)).toBe(2);
  });

  it("counts all remaining lines if section is last", () => {
    const path = join(testDir, "CLAUDE.md");
    writeFileSync(
      path,
      ["## Learned Preferences", "- A", "- B", "- C"].join("\n")
    );
    expect(countLearnedPreferencesLines(path)).toBe(3);
  });

  it("does not count blank lines", () => {
    const path = join(testDir, "CLAUDE.md");
    writeFileSync(
      path,
      ["## Learned Preferences", "", "- A", "", "- B", ""].join("\n")
    );
    expect(countLearnedPreferencesLines(path)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// checkBudget()
// ---------------------------------------------------------------------------

describe("checkBudget()", () => {
  it("returns ok: true when under budget", () => {
    const path = join(testDir, "CLAUDE.md");
    writeFileSync(path, "## Learned Preferences\n- Rule 1\n");
    const result = checkBudget(1, path);
    expect(result.ok).toBe(true);
    expect(result.current).toBe(1);
    expect(result.budget).toBe(CLAUDE_MD_LINE_BUDGET);
  });

  it("returns ok: true when exactly at budget", () => {
    const path = join(testDir, "CLAUDE.md");
    // Create 199 lines
    const lines = ["## Learned Preferences"];
    for (let i = 0; i < 199; i++) lines.push(`- Rule ${i}`);
    writeFileSync(path, lines.join("\n") + "\n");
    // Adding 1 more → exactly 200
    const result = checkBudget(1, path);
    expect(result.ok).toBe(true);
    expect(result.current).toBe(199);
  });

  it("returns ok: false when adding would exceed budget", () => {
    const path = join(testDir, "CLAUDE.md");
    // Create 200 lines (already at limit)
    const lines = ["## Learned Preferences"];
    for (let i = 0; i < 200; i++) lines.push(`- Rule ${i}`);
    writeFileSync(path, lines.join("\n") + "\n");
    const result = checkBudget(1, path);
    expect(result.ok).toBe(false);
    expect(result.current).toBe(200);
  });

  it("returns ok: true when file does not exist (0 current lines)", () => {
    const path = join(testDir, "CLAUDE.md");
    const result = checkBudget(5, path);
    expect(result.ok).toBe(true);
    expect(result.current).toBe(0);
  });

  it("accounts for multi-line cost", () => {
    const path = join(testDir, "CLAUDE.md");
    // 195 existing lines
    const lines = ["## Learned Preferences"];
    for (let i = 0; i < 195; i++) lines.push(`- Rule ${i}`);
    writeFileSync(path, lines.join("\n") + "\n");
    // Adding 6 more (195 + 6 = 201 > 200)
    const result = checkBudget(6, path);
    expect(result.ok).toBe(false);
    // Adding 5 exactly (195 + 5 = 200)
    const result2 = checkBudget(5, path);
    expect(result2.ok).toBe(true);
  });
});
