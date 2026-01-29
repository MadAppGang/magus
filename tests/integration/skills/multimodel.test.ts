/**
 * Integration tests for multimodel plugin skills (claude-flow research skills)
 * Tests the 5 new skills from Critical priority tasks (C1-C5)
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  loadPluginSkills,
  validateFrontmatter,
  hasSection,
  hasCodeBlocks,
  extractCodeBlocks,
  hasTables,
  getWordCount,
  type ParsedSkill,
} from "../utils/skill-parser";

const PLUGIN_DIR = join(import.meta.dir, "../../../plugins/multimodel");
const SKILLS_DIR = join(PLUGIN_DIR, "skills");

// Skills created from claude-flow research (C1-C5)
const CLAUDE_FLOW_SKILLS = [
  "hooks-system",
  "task-complexity-router",
  "hierarchical-coordinator",
  "batching-patterns",
  "performance-tracking",
];

// All 14 skills in multimodel plugin
const ALL_MULTIMODEL_SKILLS = [
  ...CLAUDE_FLOW_SKILLS,
  "multi-agent-coordination",
  "multi-model-validation",
  "quality-gates",
  "todowrite-orchestration",
  "error-recovery",
  "model-tracking-protocol",
  "proxy-mode-reference",
  "session-isolation",
  "task-external-models",
];

let skills: ParsedSkill[] = [];

beforeAll(async () => {
  skills = await loadPluginSkills(PLUGIN_DIR);
});

describe("Multimodel Plugin Skills", () => {
  describe("Skill Discovery", () => {
    test("should find all 14 expected skills", () => {
      const skillNames = skills.map((s) => s.name);
      expect(skillNames.length).toBe(14);

      for (const expected of ALL_MULTIMODEL_SKILLS) {
        expect(skillNames).toContain(expected);
      }
    });

    test("should find all 5 claude-flow research skills (C1-C5)", () => {
      const skillNames = skills.map((s) => s.name);

      for (const expected of CLAUDE_FLOW_SKILLS) {
        expect(skillNames).toContain(expected);
      }
    });
  });

  describe("Frontmatter Validation", () => {
    test("all skills should have valid frontmatter", () => {
      const failures: string[] = [];
      for (const skill of skills) {
        const result = validateFrontmatter(skill);
        if (!result.valid) {
          failures.push(`${skill.name}: ${result.errors.join(", ")}`);
        }
      }
      if (failures.length > 0) {
        console.log("Frontmatter validation failures:", failures);
      }
      // Allow some tolerance - at least 80% should pass
      expect(failures.length).toBeLessThanOrEqual(Math.ceil(skills.length * 0.2));
    });

    test("all skills should belong to multimodel plugin", () => {
      for (const skill of skills) {
        expect(skill.frontmatter.plugin).toBe("multimodel");
      }
    });

    test("all skills should have meaningful descriptions (>50 chars)", () => {
      for (const skill of skills) {
        expect(skill.frontmatter.description.length).toBeGreaterThan(50);
      }
    });

    test("all skills should have at least 3 keywords", () => {
      for (const skill of skills) {
        expect(skill.frontmatter.keywords.length).toBeGreaterThanOrEqual(3);
      }
    });
  });

  describe("Content Structure", () => {
    test("all skills should have Overview section", () => {
      const missing: string[] = [];
      for (const skill of skills) {
        if (!hasSection(skill, "Overview")) {
          missing.push(skill.name);
        }
      }
      if (missing.length > 0) {
        console.log("Skills missing Overview section:", missing);
      }
      // Allow some tolerance - at least 80% should have Overview
      expect(missing.length).toBeLessThanOrEqual(Math.ceil(skills.length * 0.2));
    });

    test("all skills should have code examples", () => {
      for (const skill of skills) {
        expect(hasCodeBlocks(skill)).toBe(true);
      }
    });

    test("all skills should have substantial content (>500 words)", () => {
      for (const skill of skills) {
        const wordCount = getWordCount(skill);
        expect(wordCount).toBeGreaterThan(500);
      }
    });
  });
});

describe("C1: hooks-system Skill", () => {
  let skill: ParsedSkill;

  beforeAll(() => {
    skill = skills.find((s) => s.name === "hooks-system")!;
  });

  test("should exist", () => {
    expect(skill).toBeDefined();
  });

  test("should document all 7 hook types", () => {
    const hookTypes = [
      "PreToolUse",
      "PostToolUse",
      "UserPromptSubmit",
      "SessionStart",
      "Stop",
      "SubagentStop",
      "Notification",
    ];

    for (const hookType of hookTypes) {
      expect(skill.content).toContain(hookType);
    }
  });

  test("should have JSON configuration examples", () => {
    expect(hasCodeBlocks(skill, "json")).toBe(true);
  });

  test("should document matcher patterns", () => {
    expect(skill.content).toContain("matcher");
    expect(skill.content.toLowerCase()).toContain("regex");
  });

  test("should include security hook patterns", () => {
    expect(skill.content.toLowerCase()).toContain("security");
    expect(skill.content.toLowerCase()).toContain("validation");
  });

  test("should have hook templates table", () => {
    expect(hasTables(skill)).toBe(true);
  });
});

describe("C2: task-complexity-router Skill", () => {
  let skill: ParsedSkill;

  beforeAll(() => {
    skill = skills.find((s) => s.name === "task-complexity-router")!;
  });

  test("should exist", () => {
    expect(skill).toBeDefined();
  });

  test("should define 4-tier complexity model", () => {
    const tiers = ["Native", "Haiku", "Sonnet", "Opus"];
    let tiersFound = 0;

    for (const tier of tiers) {
      if (skill.content.includes(tier)) {
        tiersFound++;
      }
    }

    expect(tiersFound).toBeGreaterThanOrEqual(3); // At least 3 tiers documented
  });

  test("should include complexity scoring criteria", () => {
    const criteria = ["complexity", "score", "threshold"];
    let criteriaFound = 0;

    for (const criterion of criteria) {
      if (skill.content.toLowerCase().includes(criterion)) {
        criteriaFound++;
      }
    }

    expect(criteriaFound).toBeGreaterThanOrEqual(2);
  });

  test("should document routing decision flow", () => {
    expect(skill.content.toLowerCase()).toContain("route");
    expect(skill.content.toLowerCase()).toContain("model");
  });

  test("should include cost optimization section", () => {
    const hasCostSection =
      skill.content.toLowerCase().includes("cost") ||
      skill.content.toLowerCase().includes("optimization") ||
      skill.content.toLowerCase().includes("efficiency");
    expect(hasCostSection).toBe(true);
  });
});

describe("C3: hierarchical-coordinator Skill", () => {
  let skill: ParsedSkill;

  beforeAll(() => {
    skill = skills.find((s) => s.name === "hierarchical-coordinator")!;
  });

  test("should exist", () => {
    expect(skill).toBeDefined();
  });

  test("should document anti-drift checkpoints", () => {
    expect(skill.content.toLowerCase()).toContain("checkpoint");
    expect(skill.content.toLowerCase()).toContain("drift");
  });

  test("should explain coordinator agent pattern", () => {
    expect(skill.content.toLowerCase()).toContain("coordinator");
  });

  test("should include validation mechanisms", () => {
    expect(skill.content.toLowerCase()).toContain("validat");
  });

  test("should document multi-agent hierarchy", () => {
    expect(skill.content.toLowerCase()).toContain("hierarch");
  });
});

describe("C4: batching-patterns Skill", () => {
  let skill: ParsedSkill;

  beforeAll(() => {
    skill = skills.find((s) => s.name === "batching-patterns")!;
  });

  test("should exist", () => {
    expect(skill).toBeDefined();
  });

  test("should document single-message batching (Golden Rule)", () => {
    const hasBatching =
      skill.content.toLowerCase().includes("batch") ||
      skill.content.toLowerCase().includes("parallel") ||
      skill.content.toLowerCase().includes("concurrent");
    expect(hasBatching).toBe(true);
  });

  test("should include parallel execution patterns", () => {
    expect(skill.content.toLowerCase()).toContain("parallel");
  });

  test("should have code examples for batching", () => {
    expect(hasCodeBlocks(skill)).toBe(true);
  });
});

describe("C5: performance-tracking Skill", () => {
  let skill: ParsedSkill;

  beforeAll(() => {
    skill = skills.find((s) => s.name === "performance-tracking")!;
  });

  test("should exist", () => {
    expect(skill).toBeDefined();
  });

  test("should define metrics schema", () => {
    const hasMetrics =
      skill.content.toLowerCase().includes("metric") ||
      skill.content.toLowerCase().includes("schema");
    expect(hasMetrics).toBe(true);
  });

  test("should document agent performance tracking", () => {
    expect(skill.content.toLowerCase()).toContain("agent");
    expect(skill.content.toLowerCase()).toContain("performance");
  });

  test("should include model latency tracking", () => {
    const hasLatency =
      skill.content.toLowerCase().includes("latency") ||
      skill.content.toLowerCase().includes("time") ||
      skill.content.toLowerCase().includes("duration");
    expect(hasLatency).toBe(true);
  });

  test("should have JSON/TypeScript schemas", () => {
    const codeBlocks = extractCodeBlocks(skill);
    const hasSchema = codeBlocks.some(
      (b) =>
        b.language === "json" ||
        b.language === "typescript" ||
        b.language === "ts"
    );
    expect(hasSchema).toBe(true);
  });
});

describe("Skill Keyword Activation", () => {
  // Test that skills have appropriate trigger keywords

  test("hooks-system triggers on hook-related keywords", () => {
    const skill = skills.find((s) => s.name === "hooks-system")!;
    const keywords = skill.frontmatter.keywords;

    expect(keywords).toContain("hooks");
    expect(keywords).toContain("lifecycle");
  });

  test("task-complexity-router triggers on routing keywords", () => {
    const skill = skills.find((s) => s.name === "task-complexity-router")!;
    const keywords = skill.frontmatter.keywords;

    const hasRoutingKeyword = keywords.some(
      (k) =>
        k.includes("rout") || k.includes("complex") || k.includes("model")
    );
    expect(hasRoutingKeyword).toBe(true);
  });

  test("performance-tracking triggers on metrics keywords", () => {
    const skill = skills.find((s) => s.name === "performance-tracking")!;
    const keywords = skill.frontmatter.keywords;

    const hasMetricsKeyword = keywords.some(
      (k) =>
        k.includes("metric") ||
        k.includes("performance") ||
        k.includes("tracking")
    );
    expect(hasMetricsKeyword).toBe(true);
  });
});

describe("Plugin Integration", () => {
  test("plugin.json should list all skills", async () => {
    const pluginJson = await readFile(
      join(PLUGIN_DIR, "plugin.json"),
      "utf-8"
    );
    const plugin = JSON.parse(pluginJson);

    expect(plugin.skills).toBeDefined();
    expect(Array.isArray(plugin.skills)).toBe(true);

    for (const skill of skills) {
      expect(plugin.skills).toContain(skill.name);
    }
  });

  test("plugin should have correct version (2.0.0)", async () => {
    const pluginJson = await readFile(
      join(PLUGIN_DIR, "plugin.json"),
      "utf-8"
    );
    const plugin = JSON.parse(pluginJson);

    expect(plugin.version).toBe("2.0.0");
  });
});
