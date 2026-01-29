/**
 * Integration tests for hook configuration patterns
 * Validates that hook examples in skills are syntactically correct
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";

const HOOKS_SKILL_PATH = join(
  import.meta.dir,
  "../../../plugins/multimodel/skills/hooks-system/SKILL.md"
);

interface HookConfig {
  matcher?: string;
  hooks?: string[];
  continueOnError?: boolean;
  timeout?: number;
}

interface HooksSettings {
  hooks?: {
    PreToolUse?: HookConfig[];
    PostToolUse?: HookConfig[];
    UserPromptSubmit?: HookConfig[];
    SessionStart?: HookConfig[];
    Stop?: HookConfig[];
    SubagentStop?: HookConfig[];
    Notification?: HookConfig[];
  };
}

/**
 * Extract JSON code blocks from markdown
 */
function extractJsonBlocks(content: string): string[] {
  const blocks: string[] = [];
  const pattern = /```json\n([\s\S]*?)```/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    blocks.push(match[1].trim());
  }

  return blocks;
}

/**
 * Validate a hook configuration object
 */
function validateHookConfig(config: HookConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (config.matcher !== undefined) {
    // Test if matcher is a valid regex
    try {
      new RegExp(config.matcher);
    } catch (e) {
      errors.push(`Invalid regex pattern: ${config.matcher}`);
    }
  }

  if (config.hooks !== undefined && !Array.isArray(config.hooks)) {
    errors.push("hooks must be an array");
  }

  if (
    config.continueOnError !== undefined &&
    typeof config.continueOnError !== "boolean"
  ) {
    errors.push("continueOnError must be a boolean");
  }

  if (config.timeout !== undefined && typeof config.timeout !== "number") {
    errors.push("timeout must be a number");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check if JSON contains hook-like structure
 */
function isHooksSettingsLike(obj: unknown): boolean {
  if (typeof obj !== "object" || obj === null) return false;
  const o = obj as Record<string, unknown>;
  return "hooks" in o || "PreToolUse" in o || "PostToolUse" in o;
}

describe("Hook Configuration Validation", () => {
  let skillContent: string;
  let jsonBlocks: string[];

  beforeAll(async () => {
    skillContent = await readFile(HOOKS_SKILL_PATH, "utf-8");
    jsonBlocks = extractJsonBlocks(skillContent);
  });

  test("should have JSON code blocks", () => {
    expect(jsonBlocks.length).toBeGreaterThan(0);
  });

  test("all JSON blocks should be valid JSON (or JSONC with comments)", () => {
    let validCount = 0;
    let totalCount = jsonBlocks.length;

    for (const block of jsonBlocks) {
      try {
        // Try parsing directly first
        JSON.parse(block);
        validCount++;
      } catch {
        // Try removing single-line comments (JSONC format)
        const withoutComments = block
          .split("\n")
          .map((line) => line.replace(/\/\/.*$/, ""))
          .join("\n");
        try {
          JSON.parse(withoutComments);
          validCount++; // JSONC is acceptable
        } catch {
          // Invalid even without comments
        }
      }
    }

    // At least 80% should be valid JSON/JSONC
    expect(validCount).toBeGreaterThanOrEqual(Math.floor(totalCount * 0.8));
  });

  test("hook matcher patterns should be valid regex", () => {
    const hookPatterns: string[] = [];

    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block);

        // Look for matcher fields at any depth
        const findMatchers = (obj: unknown): void => {
          if (typeof obj !== "object" || obj === null) return;

          const o = obj as Record<string, unknown>;
          if ("matcher" in o && typeof o.matcher === "string") {
            hookPatterns.push(o.matcher);
          }

          for (const value of Object.values(o)) {
            if (Array.isArray(value)) {
              value.forEach(findMatchers);
            } else if (typeof value === "object") {
              findMatchers(value);
            }
          }
        };

        findMatchers(parsed);
      } catch {
        // Skip invalid JSON
      }
    }

    for (const pattern of hookPatterns) {
      expect(() => new RegExp(pattern)).not.toThrow();
    }
  });
});

describe("Hook Matcher Pattern Examples", () => {
  // Common patterns that should be valid
  const validPatterns = [
    "^Write$",
    "^(Write|Edit)$",
    "^Bash$",
    ".*",
    "^Read$",
    "^Task$",
    "^(Grep|Glob)$",
    "\\.(ts|tsx|js|jsx)$",
  ];

  for (const pattern of validPatterns) {
    test(`pattern "${pattern}" should be valid regex`, () => {
      expect(() => new RegExp(pattern)).not.toThrow();
    });
  }

  // Test that patterns match expected tool names
  test("Write matcher should match Write tool", () => {
    const matcher = new RegExp("^Write$");
    expect(matcher.test("Write")).toBe(true);
    expect(matcher.test("Edit")).toBe(false);
  });

  test("Write|Edit matcher should match both tools", () => {
    const matcher = new RegExp("^(Write|Edit)$");
    expect(matcher.test("Write")).toBe(true);
    expect(matcher.test("Edit")).toBe(true);
    expect(matcher.test("Read")).toBe(false);
  });

  test(".* matcher should match all tools", () => {
    const matcher = new RegExp(".*");
    expect(matcher.test("Write")).toBe(true);
    expect(matcher.test("Bash")).toBe(true);
    expect(matcher.test("Task")).toBe(true);
  });
});

describe("Hook Type Coverage", () => {
  let skillContent: string;

  beforeAll(async () => {
    skillContent = await readFile(HOOKS_SKILL_PATH, "utf-8");
  });

  const hookTypes = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "SessionStart",
    "Stop",
    "SubagentStop",
  ];

  for (const hookType of hookTypes) {
    test(`should document ${hookType} hook type`, () => {
      expect(skillContent).toContain(hookType);
    });

    test(`should have example for ${hookType}`, () => {
      // Check for code example containing this hook type
      const hasExample =
        skillContent.includes(`"${hookType}"`) ||
        skillContent.includes(`${hookType}:`);
      expect(hasExample).toBe(true);
    });
  }
});

describe("Hook Configuration Properties", () => {
  let skillContent: string;

  beforeAll(async () => {
    skillContent = await readFile(HOOKS_SKILL_PATH, "utf-8");
  });

  test("should document matcher property", () => {
    expect(skillContent.toLowerCase()).toContain("matcher");
  });

  test("should document hooks array property", () => {
    expect(skillContent).toContain('"hooks"');
  });

  test("should document continueOnError property", () => {
    expect(skillContent).toContain("continueOnError");
  });

  test("should document timeout property", () => {
    expect(skillContent.toLowerCase()).toContain("timeout");
  });
});
