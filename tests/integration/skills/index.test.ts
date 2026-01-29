/**
 * Integration Test Suite for Claude-Flow Research Skills
 *
 * This test suite validates the skills created from the claude-flow research:
 *
 * ## Critical Priority (C1-C5) - Multimodel Plugin
 * - C1: hooks-system - Lifecycle hook patterns
 * - C2: task-complexity-router - 4-tier model routing
 * - C3: hierarchical-coordinator - Anti-drift checkpoints
 * - C4: batching-patterns - Concurrent execution
 * - C5: performance-tracking - Metrics schema
 *
 * ## Medium Priority (M1-M5) - Dev Plugin
 * - M1: plugin-sdk-patterns - Plugin development patterns
 * - M2: audit, optimize, test-coverage - Analysis commands
 * - M3: mcp-standards - MCP server standardization
 * - M4: yaml-agent-format - YAML agent definition (agentdev plugin)
 * - M5: adr-documentation - Architecture Decision Records
 *
 * ## Test Categories
 * - Skill Discovery: Verifies skills exist in expected locations
 * - Frontmatter Validation: Checks YAML metadata completeness
 * - Content Structure: Validates skill documentation structure
 * - Keyword Activation: Tests skill activation on relevant queries
 * - Plugin Integration: Verifies plugin.json references
 * - Hook Configuration: Validates hook examples are syntactically correct
 */

import { describe, test, expect } from "bun:test";
import { join } from "path";
import { loadPluginSkills } from "../utils/skill-parser";

const PLUGINS_DIR = join(import.meta.dir, "../../../plugins");

describe("Test Suite Summary", () => {
  test("should load all plugin skills successfully", async () => {
    const [multimodel, dev, agentdev] = await Promise.all([
      loadPluginSkills(join(PLUGINS_DIR, "multimodel")),
      loadPluginSkills(join(PLUGINS_DIR, "dev")),
      loadPluginSkills(join(PLUGINS_DIR, "agentdev")),
    ]);

    console.log("\n📊 Skill Count Summary:");
    console.log(`  - Multimodel Plugin: ${multimodel.length} skills`);
    console.log(`  - Dev Plugin: ${dev.length} skills`);
    console.log(`  - Agentdev Plugin: ${agentdev.length} skills`);
    console.log(`  - Total: ${multimodel.length + dev.length + agentdev.length} skills\n`);

    // Verify minimum expected skills
    // Note: dev plugin uses nested skill directories, so loadPluginSkills only finds top-level ones
    expect(multimodel.length).toBeGreaterThanOrEqual(14); // 14 multimodel skills
    expect(dev.length).toBeGreaterThanOrEqual(6); // At least 6 top-level dev skills
  });

  test("claude-flow research skills are present", async () => {
    const multimodel = await loadPluginSkills(join(PLUGINS_DIR, "multimodel"));
    const dev = await loadPluginSkills(join(PLUGINS_DIR, "dev"));
    const agentdev = await loadPluginSkills(join(PLUGINS_DIR, "agentdev"));

    const multimodelNames = multimodel.map((s) => s.name);
    const devNames = dev.map((s) => s.name);
    const agentdevNames = agentdev.map((s) => s.name);

    // Critical priority skills (C1-C5)
    const criticalSkills = [
      "hooks-system",
      "task-complexity-router",
      "hierarchical-coordinator",
      "batching-patterns",
      "performance-tracking",
    ];

    // Medium priority skills (M1-M5)
    const mediumSkillsMultimodel: string[] = [];
    const mediumSkillsDev = [
      "plugin-sdk-patterns",
      "audit",
      "optimize",
      "test-coverage",
      "mcp-standards",
      "adr-documentation",
    ];
    const mediumSkillsAgentdev = ["yaml-agent-format"];

    console.log("\n✅ Claude-Flow Research Skills:");

    console.log("  Critical Priority (C1-C5):");
    for (const skill of criticalSkills) {
      const present = multimodelNames.includes(skill);
      console.log(`    ${present ? "✓" : "✗"} ${skill}`);
      expect(present).toBe(true);
    }

    console.log("  Medium Priority (M1-M5):");
    for (const skill of mediumSkillsDev) {
      const present = devNames.includes(skill);
      console.log(`    ${present ? "✓" : "✗"} ${skill} (dev)`);
      expect(present).toBe(true);
    }
    for (const skill of mediumSkillsAgentdev) {
      const present = agentdevNames.includes(skill);
      console.log(`    ${present ? "✓" : "✗"} ${skill} (agentdev)`);
      expect(present).toBe(true);
    }

    console.log("");
  });
});
