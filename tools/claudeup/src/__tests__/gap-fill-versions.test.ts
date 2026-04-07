/**
 * Tests for gapFillInstalledPluginVersions()
 *
 * This function ensures global installedPluginVersions is at least as high as
 * the highest version found across project and local scopes. When a plugin is
 * updated at project scope (e.g. by `claude plugin marketplace update` in a
 * project directory), global may lag behind, causing Claude Code to resolve
 * stale cache paths.
 *
 * Each test uses a real temp filesystem with mocked os.homedir() to exercise
 * the actual read/write paths in claude-settings.ts.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  mock,
} from "bun:test";
import fs from "fs-extra";
import path from "node:path";

// We need real os functions (tmpdir, etc.) but must mock homedir().
// Since mock.module is hoisted and replaces the module for ALL consumers,
// we grab the real os module via require before the mock takes effect.
const realOs = await import("node:os");
const realTmpdir = realOs.tmpdir();
const realHomedir = realOs.homedir();

// ---------------------------------------------------------------------------
// Temp directory helpers
// ---------------------------------------------------------------------------

// Initialize tmpHome eagerly so module-level os.homedir() calls in
// claude-settings.ts (for INSTALLED_PLUGINS_FILE, KNOWN_MARKETPLACES_FILE)
// get a valid path during import. The mock closure reads this variable.
const initTmpHome = fs.mkdtempSync(path.join(realTmpdir, "gfill-init-"));
let tmpHome: string = initTmpHome;
let tmpProject: string;

/** Write a global settings file at <tmpHome>/.claude/settings.json */
async function writeGlobalSettings(settings: Record<string, unknown>) {
  const dir = path.join(tmpHome, ".claude");
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, "settings.json"), settings, { spaces: 2 });
}

/** Read back global settings after function execution */
async function readGlobalSettingsFromDisk(): Promise<Record<string, unknown>> {
  const p = path.join(tmpHome, ".claude", "settings.json");
  if (await fs.pathExists(p)) {
    return fs.readJson(p);
  }
  return {};
}

/** Write project settings at <tmpProject>/.claude/settings.json */
async function writeProjectSettings(settings: Record<string, unknown>) {
  const dir = path.join(tmpProject, ".claude");
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, "settings.json"), settings, { spaces: 2 });
}

/** Write local settings at <tmpProject>/.claude/settings.local.json */
async function writeLocalSettings(settings: Record<string, unknown>) {
  const dir = path.join(tmpProject, ".claude");
  await fs.ensureDir(dir);
  await fs.writeJson(path.join(dir, "settings.local.json"), settings, {
    spaces: 2,
  });
}

// ---------------------------------------------------------------------------
// Mock os.homedir() so getGlobalClaudeDir() points to our temp dir.
//
// Bun hoists mock.module() calls, so this must come before the import of the
// module under test.
// ---------------------------------------------------------------------------

mock.module("node:os", () => {
  // Build a proxy that preserves all real os functions but overrides homedir
  const mocked = { ...realOs, homedir: () => tmpHome };
  return {
    ...mocked,
    default: mocked,
  };
});

// Import function under test AFTER mock registration
const { gapFillInstalledPluginVersions } = await import(
  "../services/claude-settings.js"
);

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("gapFillInstalledPluginVersions", () => {
  beforeEach(async () => {
    // Create isolated temp dirs for each test
    tmpHome = await fs.mkdtemp(path.join(realTmpdir, "gfill-home-"));
    tmpProject = await fs.mkdtemp(path.join(realTmpdir, "gfill-proj-"));
    // Ensure the global .claude dir exists
    await fs.ensureDir(path.join(tmpHome, ".claude"));
  });

  afterEach(async () => {
    await fs.remove(tmpHome);
    await fs.remove(tmpProject);
  });

  afterAll(async () => {
    // Clean up the initial temp home created for module-level evaluation
    await fs.remove(initTmpHome).catch(() => {});
  });

  // Scenario 1: "The kanban bug" — project has newer version, global is stale
  it("bumps global when project has a newer version (the kanban bug)", async () => {
    await writeGlobalSettings({
      installedPluginVersions: { "kanban@magus": "1.0.0" },
    });
    await writeProjectSettings({
      installedPluginVersions: { "kanban@magus": "1.3.0" },
    });

    const result = await gapFillInstalledPluginVersions(tmpProject);

    expect(result).toEqual([
      {
        pluginId: "kanban@magus",
        oldVersion: "1.0.0",
        newVersion: "1.3.0",
      },
    ]);

    // Verify the file was actually updated
    const global = await readGlobalSettingsFromDisk();
    expect((global as any).installedPluginVersions["kanban@magus"]).toBe(
      "1.3.0",
    );
  });

  // Scenario 2: Global is already current — no changes needed
  it("returns empty array when global is already at the highest version", async () => {
    await writeGlobalSettings({
      installedPluginVersions: { "kanban@magus": "1.3.0" },
    });
    await writeProjectSettings({
      installedPluginVersions: { "kanban@magus": "1.3.0" },
    });

    const result = await gapFillInstalledPluginVersions(tmpProject);

    expect(result).toEqual([]);

    // Verify global was NOT rewritten (check original content is intact)
    const global = await readGlobalSettingsFromDisk();
    expect((global as any).installedPluginVersions["kanban@magus"]).toBe(
      "1.3.0",
    );
  });

  // Scenario 3: Multiple plugins with mixed staleness
  it("handles multiple plugins with mixed staleness correctly", async () => {
    await writeGlobalSettings({
      installedPluginVersions: {
        "a@mp": "1.0.0",
        "b@mp": "2.0.0",
      },
    });
    await writeProjectSettings({
      installedPluginVersions: {
        "a@mp": "2.0.0",
        "b@mp": "2.0.0",
        "c@mp": "1.0.0",
      },
    });

    const result = await gapFillInstalledPluginVersions(tmpProject);

    // a@mp should be bumped, b@mp unchanged, c@mp added (missing from global)
    const bumped = result.map((r) => r.pluginId).sort();
    expect(bumped).toEqual(["a@mp", "c@mp"]);

    const aEntry = result.find((r) => r.pluginId === "a@mp");
    expect(aEntry).toEqual({
      pluginId: "a@mp",
      oldVersion: "1.0.0",
      newVersion: "2.0.0",
    });

    const cEntry = result.find((r) => r.pluginId === "c@mp");
    expect(cEntry).toEqual({
      pluginId: "c@mp",
      oldVersion: "(missing)",
      newVersion: "1.0.0",
    });

    // Verify file state
    const global = await readGlobalSettingsFromDisk();
    const versions = (global as any).installedPluginVersions;
    expect(versions["a@mp"]).toBe("2.0.0");
    expect(versions["b@mp"]).toBe("2.0.0");
    expect(versions["c@mp"]).toBe("1.0.0");
  });

  // Scenario 4: Local scope has the highest version
  it("uses the highest version across all 3 scopes (local wins)", async () => {
    await writeGlobalSettings({
      installedPluginVersions: { "x@mp": "1.0.0" },
    });
    await writeProjectSettings({
      installedPluginVersions: { "x@mp": "1.5.0" },
    });
    await writeLocalSettings({
      installedPluginVersions: { "x@mp": "2.0.0" },
    });

    const result = await gapFillInstalledPluginVersions(tmpProject);

    expect(result).toEqual([
      {
        pluginId: "x@mp",
        oldVersion: "1.0.0",
        newVersion: "2.0.0",
      },
    ]);

    const global = await readGlobalSettingsFromDisk();
    expect((global as any).installedPluginVersions["x@mp"]).toBe("2.0.0");
  });

  // Scenario 5: No project path — only global scope
  it("returns empty array when called with no projectPath", async () => {
    await writeGlobalSettings({
      installedPluginVersions: { "a@mp": "1.0.0" },
    });

    const result = await gapFillInstalledPluginVersions();

    expect(result).toEqual([]);
  });

  // Scenario 6: Idempotency — running twice is a no-op
  it("is idempotent — second call returns empty array", async () => {
    await writeGlobalSettings({
      installedPluginVersions: { "a@mp": "1.0.0" },
    });
    await writeProjectSettings({
      installedPluginVersions: { "a@mp": "2.0.0" },
    });

    // First call: should bump
    const first = await gapFillInstalledPluginVersions(tmpProject);
    expect(first).toHaveLength(1);
    expect(first[0].newVersion).toBe("2.0.0");

    // Second call: global is now at 2.0.0, so nothing to do
    const second = await gapFillInstalledPluginVersions(tmpProject);
    expect(second).toEqual([]);
  });

  // Scenario 7: Invalid semver versions are skipped
  it("skips invalid semver versions in project scope", async () => {
    await writeGlobalSettings({
      installedPluginVersions: { "a@mp": "1.0.0" },
    });
    await writeProjectSettings({
      installedPluginVersions: { "a@mp": "not-a-version" },
    });

    const result = await gapFillInstalledPluginVersions(tmpProject);

    expect(result).toEqual([]);

    // Global should remain unchanged
    const global = await readGlobalSettingsFromDisk();
    expect((global as any).installedPluginVersions["a@mp"]).toBe("1.0.0");
  });

  // Scenario 8: Project settings file doesn't exist (new project)
  it("returns empty array when project settings file does not exist", async () => {
    await writeGlobalSettings({
      installedPluginVersions: { "a@mp": "1.0.0" },
    });

    // Use a path that doesn't have any .claude directory
    const nonExistentProject = path.join(tmpProject, "no-such-project");

    const result = await gapFillInstalledPluginVersions(nonExistentProject);

    expect(result).toEqual([]);
  });

  // Scenario 9: Global version is higher than project — no downgrade
  it("does not downgrade global when global is higher than project", async () => {
    await writeGlobalSettings({
      installedPluginVersions: { "kanban@magus": "2.0.0" },
    });
    await writeProjectSettings({
      installedPluginVersions: { "kanban@magus": "1.0.0" },
    });

    const result = await gapFillInstalledPluginVersions(tmpProject);

    expect(result).toEqual([]);

    // Verify global was NOT downgraded
    const global = await readGlobalSettingsFromDisk();
    expect((global as any).installedPluginVersions["kanban@magus"]).toBe("2.0.0");
  });

  // Scenario 10: Preserves unrelated settings fields during write
  it("preserves other global settings fields when bumping versions", async () => {
    await writeGlobalSettings({
      enabledPlugins: { "kanban@magus": true, "dev@magus": true },
      env: { SOME_VAR: "value" },
      installedPluginVersions: { "kanban@magus": "1.0.0" },
    });
    await writeProjectSettings({
      installedPluginVersions: { "kanban@magus": "2.0.0" },
    });

    const result = await gapFillInstalledPluginVersions(tmpProject);

    expect(result).toHaveLength(1);

    // Verify other fields are preserved
    const global = await readGlobalSettingsFromDisk();
    expect((global as any).enabledPlugins).toEqual({ "kanban@magus": true, "dev@magus": true });
    expect((global as any).env).toEqual({ SOME_VAR: "value" });
    expect((global as any).installedPluginVersions["kanban@magus"]).toBe("2.0.0");
  });

  // Scenario 11: Invalid semver in GLOBAL scope gets overwritten
  it("overwrites corrupted global version when project has valid semver", async () => {
    await writeGlobalSettings({
      installedPluginVersions: { "kanban@magus": "not-a-version" },
    });
    await writeProjectSettings({
      installedPluginVersions: { "kanban@magus": "1.3.0" },
    });

    const result = await gapFillInstalledPluginVersions(tmpProject);

    expect(result).toEqual([
      {
        pluginId: "kanban@magus",
        oldVersion: "not-a-version",
        newVersion: "1.3.0",
      },
    ]);

    const global = await readGlobalSettingsFromDisk();
    expect((global as any).installedPluginVersions["kanban@magus"]).toBe(
      "1.3.0",
    );
  });

  // Scenario 12: Both global and project have invalid semver — no crash, no change
  it("does nothing when all versions are invalid semver", async () => {
    await writeGlobalSettings({
      installedPluginVersions: { "kanban@magus": "broken" },
    });
    await writeProjectSettings({
      installedPluginVersions: { "kanban@magus": "also-broken" },
    });

    const result = await gapFillInstalledPluginVersions(tmpProject);

    expect(result).toEqual([]);

    // Global unchanged
    const global = await readGlobalSettingsFromDisk();
    expect((global as any).installedPluginVersions["kanban@magus"]).toBe(
      "broken",
    );
  });
});
