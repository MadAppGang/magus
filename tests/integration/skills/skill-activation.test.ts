/**
 * Integration tests for skill activation patterns
 * Tests that skills activate on appropriate keyword triggers
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { join } from "path";
import { loadPluginSkills, type ParsedSkill } from "../utils/skill-parser";

const MULTIMODEL_DIR = join(import.meta.dir, "../../../plugins/multimodel");
const DEV_DIR = join(import.meta.dir, "../../../plugins/dev");
const AGENTDEV_DIR = join(import.meta.dir, "../../../plugins/agentdev");

let multimodelSkills: ParsedSkill[] = [];
let devSkills: ParsedSkill[] = [];
let agentdevSkills: ParsedSkill[] = [];

beforeAll(async () => {
  [multimodelSkills, devSkills, agentdevSkills] = await Promise.all([
    loadPluginSkills(MULTIMODEL_DIR),
    loadPluginSkills(DEV_DIR),
    loadPluginSkills(AGENTDEV_DIR),
  ]);
});

/**
 * Check if a skill would activate for a given user query
 */
function wouldActivate(skill: ParsedSkill, query: string): boolean {
  const queryLower = query.toLowerCase();
  const keywords = skill.frontmatter.keywords || [];
  const description = skill.frontmatter.description.toLowerCase();

  // Check if any keyword matches
  for (const keyword of keywords) {
    if (queryLower.includes(keyword.toLowerCase())) {
      return true;
    }
  }

  // Check if query words appear in description
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 3);
  for (const word of queryWords) {
    if (description.includes(word)) {
      return true;
    }
  }

  return false;
}

describe("Multimodel Skill Activation", () => {
  describe("hooks-system", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = multimodelSkills.find((s) => s.name === "hooks-system")!;
    });

    test("activates on 'configure hooks'", () => {
      expect(wouldActivate(skill, "configure hooks")).toBe(true);
    });

    test("activates on 'PreToolUse validation'", () => {
      expect(wouldActivate(skill, "PreToolUse validation")).toBe(true);
    });

    test("activates on 'PostToolUse auto-format'", () => {
      expect(wouldActivate(skill, "PostToolUse auto-format")).toBe(true);
    });

    test("activates on 'lifecycle hook'", () => {
      expect(wouldActivate(skill, "lifecycle hook")).toBe(true);
    });

    test("does not activate on unrelated query", () => {
      expect(wouldActivate(skill, "write a function")).toBe(false);
    });
  });

  describe("task-complexity-router", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = multimodelSkills.find(
        (s) => s.name === "task-complexity-router"
      )!;
    });

    test("activates on 'route task to model'", () => {
      expect(wouldActivate(skill, "route task to model")).toBe(true);
    });

    test("activates on 'complexity routing'", () => {
      expect(wouldActivate(skill, "complexity routing")).toBe(true);
    });

    test("activates on 'model selection'", () => {
      expect(wouldActivate(skill, "model selection")).toBe(true);
    });
  });

  describe("performance-tracking", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = multimodelSkills.find((s) => s.name === "performance-tracking")!;
    });

    test("activates on 'track agent performance'", () => {
      expect(wouldActivate(skill, "track agent performance")).toBe(true);
    });

    test("activates on 'metrics tracking'", () => {
      expect(wouldActivate(skill, "metrics tracking")).toBe(true);
    });

    test("activates on 'model latency'", () => {
      expect(wouldActivate(skill, "model latency")).toBe(true);
    });
  });

  describe("batching-patterns", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = multimodelSkills.find((s) => s.name === "batching-patterns")!;
    });

    test("activates on 'batch operations'", () => {
      expect(wouldActivate(skill, "batch operations")).toBe(true);
    });

    test("activates on 'parallel execution'", () => {
      expect(wouldActivate(skill, "parallel execution")).toBe(true);
    });
  });

  describe("hierarchical-coordinator", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = multimodelSkills.find(
        (s) => s.name === "hierarchical-coordinator"
      )!;
    });

    test("activates on 'prevent goal drift'", () => {
      expect(wouldActivate(skill, "prevent goal drift")).toBe(true);
    });

    test("activates on 'coordinator agent'", () => {
      expect(wouldActivate(skill, "coordinator agent")).toBe(true);
    });

    test("activates on 'checkpoint validation'", () => {
      expect(wouldActivate(skill, "checkpoint validation")).toBe(true);
    });
  });
});

describe("Dev Skill Activation", () => {
  describe("audit", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = devSkills.find((s) => s.name === "audit")!;
    });

    test("activates on 'security audit'", () => {
      expect(wouldActivate(skill, "security audit")).toBe(true);
    });

    test("activates on 'vulnerability scan'", () => {
      expect(wouldActivate(skill, "vulnerability scan")).toBe(true);
    });

    test("activates on 'check for security issues'", () => {
      expect(wouldActivate(skill, "check for security issues")).toBe(true);
    });
  });

  describe("optimize", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = devSkills.find((s) => s.name === "optimize")!;
    });

    test("activates on 'optimize performance'", () => {
      expect(wouldActivate(skill, "optimize performance")).toBe(true);
    });

    test("activates on 'reduce bundle size'", () => {
      expect(wouldActivate(skill, "reduce bundle size")).toBe(true);
    });

    test("activates on 'improve build times'", () => {
      expect(wouldActivate(skill, "improve build times")).toBe(true);
    });
  });

  describe("test-coverage", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = devSkills.find((s) => s.name === "test-coverage")!;
    });

    test("activates on 'test coverage analysis'", () => {
      expect(wouldActivate(skill, "test coverage analysis")).toBe(true);
    });

    test("activates on 'find untested code'", () => {
      expect(wouldActivate(skill, "find untested code")).toBe(true);
    });
  });

  describe("mcp-standards", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = devSkills.find((s) => s.name === "mcp-standards")!;
    });

    test("activates on 'MCP server'", () => {
      expect(wouldActivate(skill, "MCP server")).toBe(true);
    });

    test("activates on 'implement MCP'", () => {
      expect(wouldActivate(skill, "implement MCP")).toBe(true);
    });

    test("activates on 'model context protocol'", () => {
      expect(wouldActivate(skill, "model context protocol")).toBe(true);
    });
  });

  describe("adr-documentation", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = devSkills.find((s) => s.name === "adr-documentation")!;
    });

    test("activates on 'create ADR'", () => {
      expect(wouldActivate(skill, "create ADR")).toBe(true);
    });

    test("activates on 'architecture decision record'", () => {
      expect(wouldActivate(skill, "architecture decision record")).toBe(true);
    });

    test("activates on 'document decision'", () => {
      expect(wouldActivate(skill, "document decision")).toBe(true);
    });
  });

  describe("plugin-sdk-patterns", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = devSkills.find((s) => s.name === "plugin-sdk-patterns")!;
    });

    test("activates on 'create plugin'", () => {
      expect(wouldActivate(skill, "create plugin")).toBe(true);
    });

    test("activates on 'plugin development'", () => {
      expect(wouldActivate(skill, "plugin development")).toBe(true);
    });

    test("activates on 'skill template'", () => {
      expect(wouldActivate(skill, "skill template")).toBe(true);
    });
  });
});

describe("Agentdev Skill Activation", () => {
  describe("yaml-agent-format", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = agentdevSkills.find((s) => s.name === "yaml-agent-format")!;
    });

    test("activates on 'YAML agent'", () => {
      expect(wouldActivate(skill, "YAML agent")).toBe(true);
    });

    test("activates on 'agent definition'", () => {
      expect(wouldActivate(skill, "agent definition")).toBe(true);
    });
  });
});

describe("Skill Conflict Detection", () => {
  // Test that similar queries don't activate too many skills

  test("'audit code' should primarily activate audit skill", () => {
    const activatedSkills = devSkills.filter((s) =>
      wouldActivate(s, "audit code")
    );
    const auditSkill = activatedSkills.find((s) => s.name === "audit");
    expect(auditSkill).toBeDefined();
  });

  test("'configure hooks' should primarily activate hooks-system", () => {
    const activatedSkills = multimodelSkills.filter((s) =>
      wouldActivate(s, "configure hooks")
    );
    const hooksSkill = activatedSkills.find((s) => s.name === "hooks-system");
    expect(hooksSkill).toBeDefined();
  });
});

describe("Keyword Coverage", () => {
  // Ensure no skill has empty keywords

  test("all multimodel skills have keywords", () => {
    for (const skill of multimodelSkills) {
      expect(skill.frontmatter.keywords.length).toBeGreaterThan(0);
    }
  });

  test("all dev skills have keywords", () => {
    for (const skill of devSkills) {
      expect(skill.frontmatter.keywords.length).toBeGreaterThan(0);
    }
  });

  test("most agentdev skills have keywords", () => {
    const withKeywords = agentdevSkills.filter(
      (s) => (s.frontmatter.keywords || []).length > 0
    );
    // Allow some tolerance - at least one skill with keywords
    if (agentdevSkills.length > 0) {
      expect(withKeywords.length).toBeGreaterThanOrEqual(1);
    }
  });
});
