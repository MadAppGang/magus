/**
 * Integration tests for dev plugin skills (claude-flow research skills)
 * Tests the 6 new skills from Medium priority tasks (M1-M5)
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { readFile, access } from "fs/promises";
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

const PLUGIN_DIR = join(import.meta.dir, "../../../plugins/dev");
const SKILLS_DIR = join(PLUGIN_DIR, "skills");
const AI_DOCS_DIR = join(import.meta.dir, "../../../ai-docs");

// Skills created from claude-flow research (M1-M5)
const CLAUDE_FLOW_SKILLS = [
  "plugin-sdk-patterns", // M1
  "audit", // M2
  "optimize", // M2
  "test-coverage", // M2
  "mcp-standards", // M3
  "adr-documentation", // M5
];

let skills: ParsedSkill[] = [];

beforeAll(async () => {
  skills = await loadPluginSkills(PLUGIN_DIR);
});

describe("Dev Plugin Claude-Flow Skills", () => {
  describe("Skill Discovery", () => {
    test("should find all 6 claude-flow research skills", () => {
      const skillNames = skills.map((s) => s.name);

      for (const expected of CLAUDE_FLOW_SKILLS) {
        expect(skillNames).toContain(expected);
      }
    });
  });

  describe("Frontmatter Validation", () => {
    test("all claude-flow skills should have valid frontmatter", () => {
      const claudeFlowSkills = skills.filter((s) =>
        CLAUDE_FLOW_SKILLS.includes(s.name)
      );

      for (const skill of claudeFlowSkills) {
        const result = validateFrontmatter(skill);
        expect(result.valid).toBe(true);
        if (!result.valid) {
          console.log(`${skill.name}: ${result.errors.join(", ")}`);
        }
      }
    });

    test("all skills should belong to dev plugin", () => {
      const claudeFlowSkills = skills.filter((s) =>
        CLAUDE_FLOW_SKILLS.includes(s.name)
      );

      for (const skill of claudeFlowSkills) {
        expect(skill.frontmatter.plugin).toBe("dev");
      }
    });
  });
});

describe("M1: plugin-sdk-patterns Skill", () => {
  let skill: ParsedSkill;

  beforeAll(() => {
    skill = skills.find((s) => s.name === "plugin-sdk-patterns")!;
  });

  test("should exist", () => {
    expect(skill).toBeDefined();
  });

  test("should have substantial content (>800 words)", () => {
    const wordCount = getWordCount(skill);
    expect(wordCount).toBeGreaterThan(800);
  });

  test("should document plugin structure", () => {
    expect(skill.content.toLowerCase()).toContain("plugin");
    expect(skill.content.toLowerCase()).toContain("structure");
  });

  test("should include skill creation patterns", () => {
    expect(skill.content.toLowerCase()).toContain("skill");
  });

  test("should document agent patterns", () => {
    expect(skill.content.toLowerCase()).toContain("agent");
  });

  test("should include JSON examples", () => {
    expect(hasCodeBlocks(skill, "json")).toBe(true);
  });

  test("should include markdown examples", () => {
    const codeBlocks = extractCodeBlocks(skill);
    const hasMarkdown = codeBlocks.some(
      (b) => b.language === "markdown" || b.language === "md"
    );
    expect(hasMarkdown).toBe(true);
  });
});

describe("M2: Analysis Commands (audit, optimize, test-coverage)", () => {
  describe("audit Skill", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = skills.find((s) => s.name === "audit")!;
    });

    test("should exist", () => {
      expect(skill).toBeDefined();
    });

    test("should cover security vulnerabilities", () => {
      expect(skill.content.toLowerCase()).toContain("security");
      expect(skill.content.toLowerCase()).toContain("vulnerabilit");
    });

    test("should cover dependency scanning", () => {
      expect(skill.content.toLowerCase()).toContain("dependenc");
    });

    test("should mention OWASP Top 10", () => {
      expect(skill.content).toContain("OWASP");
    });

    test("should include secret detection patterns", () => {
      expect(skill.content.toLowerCase()).toContain("secret");
    });

    test("should support multiple package managers", () => {
      const packageManagers = ["npm", "pnpm", "cargo"];
      let found = 0;
      for (const pm of packageManagers) {
        if (skill.content.toLowerCase().includes(pm)) found++;
      }
      expect(found).toBeGreaterThanOrEqual(2);
    });
  });

  describe("optimize Skill", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = skills.find((s) => s.name === "optimize")!;
    });

    test("should exist", () => {
      expect(skill).toBeDefined();
    });

    test("should cover performance optimization", () => {
      expect(skill.content.toLowerCase()).toContain("performance");
    });

    test("should include build optimization", () => {
      expect(skill.content.toLowerCase()).toContain("build");
    });

    test("should cover bundle size optimization", () => {
      expect(skill.content.toLowerCase()).toContain("bundle");
    });
  });

  describe("test-coverage Skill", () => {
    let skill: ParsedSkill;

    beforeAll(() => {
      skill = skills.find((s) => s.name === "test-coverage")!;
    });

    test("should exist", () => {
      expect(skill).toBeDefined();
    });

    test("should define coverage metrics", () => {
      expect(skill.content.toLowerCase()).toContain("coverage");
    });

    test("should identify untested code", () => {
      expect(skill.content.toLowerCase()).toContain("untest");
    });

    test("should support multiple test frameworks", () => {
      const frameworks = ["jest", "vitest", "pytest", "go test"];
      let found = 0;
      for (const fw of frameworks) {
        if (skill.content.toLowerCase().includes(fw)) found++;
      }
      expect(found).toBeGreaterThanOrEqual(2);
    });
  });
});

describe("M3: mcp-standards Skill", () => {
  let skill: ParsedSkill;

  beforeAll(() => {
    skill = skills.find((s) => s.name === "mcp-standards")!;
  });

  test("should exist", () => {
    expect(skill).toBeDefined();
  });

  test("should have substantial content (>800 words)", () => {
    const wordCount = getWordCount(skill);
    expect(wordCount).toBeGreaterThan(800);
  });

  test("should document MCP protocol", () => {
    expect(skill.content).toContain("MCP");
    expect(skill.content.toLowerCase()).toContain("protocol");
  });

  test("should include tool definition patterns", () => {
    expect(skill.content.toLowerCase()).toContain("tool");
  });

  test("should document transport types", () => {
    const transports = ["stdio", "http", "sse"];
    let found = 0;
    for (const transport of transports) {
      if (skill.content.toLowerCase().includes(transport)) found++;
    }
    expect(found).toBeGreaterThanOrEqual(1);
  });

  test("should include JSON schema examples", () => {
    expect(hasCodeBlocks(skill, "json")).toBe(true);
  });

  test("should document error handling", () => {
    expect(skill.content.toLowerCase()).toContain("error");
  });
});

describe("M5: adr-documentation Skill", () => {
  let skill: ParsedSkill;

  beforeAll(() => {
    skill = skills.find((s) => s.name === "adr-documentation")!;
  });

  test("should exist", () => {
    expect(skill).toBeDefined();
  });

  test("should explain ADR purpose", () => {
    expect(skill.content).toContain("ADR");
    expect(skill.content.toLowerCase()).toContain("decision");
  });

  test("should include ADR template reference", () => {
    // Check for template mention (case-insensitive) or reference to ADR format
    const hasTemplate =
      skill.content.toLowerCase().includes("template") ||
      skill.content.toLowerCase().includes("format") ||
      skill.content.toLowerCase().includes("structure");
    expect(hasTemplate).toBe(true);
  });

  test("should document decision lifecycle", () => {
    const lifecycle = ["proposed", "accepted", "deprecated", "superseded"];
    let found = 0;
    for (const status of lifecycle) {
      if (skill.content.toLowerCase().includes(status)) found++;
    }
    expect(found).toBeGreaterThanOrEqual(2);
  });

  test("should include markdown example", () => {
    expect(hasCodeBlocks(skill, "markdown")).toBe(true);
  });
});

describe("M5: ADR Template", () => {
  test("ADR template should exist", async () => {
    const templatePath = join(AI_DOCS_DIR, "templates/ADR-TEMPLATE.md");
    let exists = false;
    try {
      await access(templatePath);
      exists = true;
    } catch {
      exists = false;
    }
    expect(exists).toBe(true);
  });

  test("ADR template should have required sections", async () => {
    const templatePath = join(AI_DOCS_DIR, "templates/ADR-TEMPLATE.md");
    const content = await readFile(templatePath, "utf-8");

    const requiredSections = [
      "Title",
      "Status",
      "Context",
      "Decision",
      "Consequences",
    ];

    for (const section of requiredSections) {
      expect(content).toContain(section);
    }
  });
});

describe("Skill Keyword Activation", () => {
  test("audit skill triggers on security keywords", () => {
    const skill = skills.find((s) => s.name === "audit")!;
    const keywords = skill.frontmatter.keywords;

    const hasSecurityKeyword = keywords.some(
      (k) => k.includes("audit") || k.includes("security")
    );
    expect(hasSecurityKeyword).toBe(true);
  });

  test("mcp-standards triggers on MCP keywords", () => {
    const skill = skills.find((s) => s.name === "mcp-standards")!;
    const keywords = skill.frontmatter.keywords;

    const hasMcpKeyword = keywords.some((k) => k.toLowerCase().includes("mcp"));
    expect(hasMcpKeyword).toBe(true);
  });

  test("adr-documentation triggers on ADR keywords", () => {
    const skill = skills.find((s) => s.name === "adr-documentation")!;
    const keywords = skill.frontmatter.keywords;

    const hasAdrKeyword = keywords.some(
      (k) => k.includes("adr") || k.includes("decision")
    );
    expect(hasAdrKeyword).toBe(true);
  });
});

describe("Plugin Integration", () => {
  test("plugin.json should list all claude-flow skills", async () => {
    const pluginJson = await readFile(
      join(PLUGIN_DIR, "plugin.json"),
      "utf-8"
    );
    const plugin = JSON.parse(pluginJson);

    expect(plugin.skills).toBeDefined();

    // Skills may be listed with path prefixes like "./skills/audit"
    const skillList = plugin.skills.map((s: string) =>
      s.replace(/^\.\/skills\//, "").replace(/^skills\//, "")
    );

    for (const skillName of CLAUDE_FLOW_SKILLS) {
      expect(skillList).toContain(skillName);
    }
  });

  test("plugin should have correct version (1.22.0)", async () => {
    const pluginJson = await readFile(
      join(PLUGIN_DIR, "plugin.json"),
      "utf-8"
    );
    const plugin = JSON.parse(pluginJson);

    expect(plugin.version).toBe("1.22.0");
  });
});
