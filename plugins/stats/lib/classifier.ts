/**
 * Activity classifier: maps tool names to activity categories.
 */

import type { ActivityCategory } from "./types.ts";

// Research tools
const RESEARCH_TOOLS = new Set([
  "Read",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
]);

// Coding tools
const CODING_TOOLS = new Set([
  "Write",
  "Edit",
  "MultiEdit",
]);

// Delegation tools
const DELEGATION_TOOLS = new Set([
  "Task",
]);

// Bash test patterns
const TEST_PATTERNS = [
  /\b(bun\s+test|npm\s+test|npx\s+jest|pytest|go\s+test|cargo\s+test|make\s+test)\b/i,
  /\b(vitest|mocha|jasmine|cypress|playwright)\b/i,
  /\b(bun\s+run\s+test|bun\s+run\s+check|bun\s+run\s+lint)\b/i,
  /\b(npm\s+run\s+test|yarn\s+test)\b/i,
];

// Bash build patterns (classified as coding)
const BUILD_PATTERNS = [
  /\b(bun\s+build|npm\s+run\s+build|tsc|go\s+build|cargo\s+build|make)\b/i,
];

/**
 * Classify a tool call into an activity category.
 *
 * @param toolName - The tool_name string from the hook payload
 * @param bashCommand - The command string for Bash calls (extracted from transcript at aggregation time)
 *   - undefined for all non-Bash tools (command not available at hook time)
 */
export function classifyTool(toolName: string, bashCommand?: string): ActivityCategory {
  if (RESEARCH_TOOLS.has(toolName)) {
    return "research";
  }

  // mcp__* tools are research (semantic code tools, web tools, etc.)
  if (toolName.startsWith("mcp__")) {
    return "research";
  }

  if (CODING_TOOLS.has(toolName)) {
    return "coding";
  }

  if (DELEGATION_TOOLS.has(toolName)) {
    return "delegation";
  }

  if (toolName === "Bash") {
    if (bashCommand === undefined) {
      // Cannot classify without command; happens at hook time (privacy)
      return "other";
    }

    // Check test patterns first
    for (const pattern of TEST_PATTERNS) {
      if (pattern.test(bashCommand)) {
        return "testing";
      }
    }

    // Check build patterns -> coding
    for (const pattern of BUILD_PATTERNS) {
      if (pattern.test(bashCommand)) {
        return "coding";
      }
    }

    return "other";
  }

  return "other";
}
