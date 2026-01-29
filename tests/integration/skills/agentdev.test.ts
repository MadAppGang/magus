/**
 * Integration tests for agentdev plugin skills
 * Tests the M4 skill: yaml-agent-format
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { readFile } from "fs/promises";
import { join } from "path";
import {
  loadPluginSkills,
  validateFrontmatter,
  hasCodeBlocks,
  extractCodeBlocks,
  getWordCount,
  type ParsedSkill,
} from "../utils/skill-parser";

const PLUGIN_DIR = join(import.meta.dir, "../../../plugins/agentdev");

let skills: ParsedSkill[] = [];

beforeAll(async () => {
  skills = await loadPluginSkills(PLUGIN_DIR);
});

describe("M4: yaml-agent-format Skill", () => {
  let skill: ParsedSkill;

  beforeAll(() => {
    skill = skills.find((s) => s.name === "yaml-agent-format")!;
  });

  test("should exist", () => {
    expect(skill).toBeDefined();
  });

  test("should have valid frontmatter", () => {
    const result = validateFrontmatter(skill);
    expect(result.valid).toBe(true);
  });

  test("should belong to agentdev plugin", () => {
    expect(skill.frontmatter.plugin).toBe("agentdev");
  });

  test("should have substantial content (>250 words)", () => {
    const wordCount = getWordCount(skill);
    expect(wordCount).toBeGreaterThan(250);
  });

  test("should include YAML examples", () => {
    expect(hasCodeBlocks(skill, "yaml")).toBe(true);
  });

  test("should document agent schema", () => {
    expect(skill.content.toLowerCase()).toContain("schema");
  });

  test("should explain YAML vs Markdown comparison", () => {
    const hasComparison =
      skill.content.toLowerCase().includes("markdown") ||
      skill.content.toLowerCase().includes("comparison") ||
      skill.content.toLowerCase().includes("alternative");
    expect(hasComparison).toBe(true);
  });

  test("should include agent configuration fields", () => {
    const fields = ["name", "description", "tools"];
    let found = 0;
    for (const field of fields) {
      if (skill.content.toLowerCase().includes(field)) found++;
    }
    expect(found).toBeGreaterThanOrEqual(2);
  });

  test("should have proper YAML code blocks", () => {
    const codeBlocks = extractCodeBlocks(skill);
    const yamlBlocks = codeBlocks.filter((b) => b.language === "yaml");
    expect(yamlBlocks.length).toBeGreaterThan(0);

    // Verify YAML blocks contain agent-like structure
    const hasAgentYaml = yamlBlocks.some(
      (b) => b.code.includes("name:") || b.code.includes("description:")
    );
    expect(hasAgentYaml).toBe(true);
  });
});

describe("Agentdev Plugin Integration", () => {
  test("plugin.json should exist and be valid JSON", async () => {
    const pluginJson = await readFile(
      join(PLUGIN_DIR, "plugin.json"),
      "utf-8"
    );
    const plugin = JSON.parse(pluginJson);

    expect(plugin.name).toBe("agentdev");
    expect(plugin.version).toBeDefined();
  });

  test("plugin.json should list yaml-agent-format skill", async () => {
    const pluginJson = await readFile(
      join(PLUGIN_DIR, "plugin.json"),
      "utf-8"
    );
    const plugin = JSON.parse(pluginJson);

    expect(plugin.skills).toContain("yaml-agent-format");
  });
});
