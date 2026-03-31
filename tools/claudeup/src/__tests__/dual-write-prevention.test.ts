/**
 * Version tracking tests
 *
 * The Claude CLI's `plugin install` command does NOT update `installedPluginVersions`
 * in settings.json — it only manages `enabledPlugins`. Claudeup must save the version
 * itself after a successful CLI install/update.
 *
 * PluginsScreen: no saveVersionAfterInstall helper (removed in v4.5.0), but each
 *   action handler calls saveVersionForScope after CLI success.
 * Prerunner: calls saveGlobalInstalledPluginVersion after successful updatePlugin,
 *   but NOT when CLI is unavailable or update fails (no phantom state).
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as url from "node:url";

// ---------------------------------------------------------------------------
// PART 1: PluginsScreen source-level policy tests
//
// The dual-write calls in PluginsScreen are inside React event handlers.
// Rendering the full TUI component in a unit test would require the opentui
// terminal runtime. Instead we assert the source does NOT contain the
// forbidden call pattern — this is a code-policy test that:
//   - FAILS before the fix  (6 saveVersionAfterInstall calls follow CLI calls)
//   - PASSES after the fix  (those calls are removed)
// ---------------------------------------------------------------------------

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const PLUGINS_SCREEN_PATH = path.resolve(
  __dirname,
  "../ui/screens/PluginsScreen.tsx",
);

describe("PluginsScreen — no dual-write after CLI operations", () => {
  let source: string;

  beforeEach(() => {
    source = fs.readFileSync(PLUGINS_SCREEN_PATH, "utf8");
  });

  it("does not call saveVersionAfterInstall immediately after cliUpdatePlugin", () => {
    // Find every occurrence of cliUpdatePlugin in the source. Each one should
    // NOT be immediately followed (within 3 lines) by saveVersionAfterInstall.
    const lines = source.split("\n");
    const violations: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("cliUpdatePlugin(")) {
        // Check the next 3 lines for a dual-write call
        for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
          if (lines[j].includes("saveVersionAfterInstall(")) {
            violations.push(i + 1); // 1-indexed line number
            break;
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("does not call saveVersionAfterInstall immediately after cliInstallPlugin", () => {
    const lines = source.split("\n");
    const violations: number[] = [];

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("cliInstallPlugin(")) {
        for (let j = i + 1; j <= Math.min(i + 3, lines.length - 1); j++) {
          if (lines[j].includes("saveVersionAfterInstall(")) {
            violations.push(i + 1);
            break;
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// PART 2: Prerunner — saveGlobalInstalledPluginVersion guarded by CLI success
//
// We mock the prerunner's module dependencies so we can call prerunClaude()
// directly and inspect call counts.
// ---------------------------------------------------------------------------

// Mutable state shared between mock factories and test assertions.
let mockSaveGlobal: ReturnType<typeof mock>;
let mockUpdatePlugin: ReturnType<typeof mock>;
let mockIsClaudeAvailable: ReturnType<typeof mock>;
let mockGetAvailablePlugins: ReturnType<typeof mock>;

// We must register mock.module before importing the module under test.
// Bun hoists mock.module() calls, so the mocks are active when the
// module is first loaded.

mock.module("../services/claude-settings.js", () => ({
  recoverMarketplaceSettings: mock(() =>
    Promise.resolve({ enabledAutoUpdate: [], removed: [] }),
  ),
  migrateMarketplaceRename: mock(() =>
    Promise.resolve({
      projectMigrated: 0,
      globalMigrated: 0,
      localMigrated: 0,
      registryMigrated: 0,
      knownMarketplacesMigrated: false,
    }),
  ),
  getGlobalEnabledPlugins: mock(() => Promise.resolve({})),
  getEnabledPlugins: mock(() => Promise.resolve({})),
  getLocalEnabledPlugins: mock(() => Promise.resolve({})),
  saveGlobalInstalledPluginVersion: (...args: unknown[]) =>
    mockSaveGlobal(...args),
  readGlobalSettings: mock(() => Promise.resolve({ hooks: {} })),
  writeGlobalSettings: mock(() => Promise.resolve()),
}));

mock.module("../services/claude-cli.js", () => ({
  updatePlugin: (...args: unknown[]) => mockUpdatePlugin(...args),
  isClaudeAvailable: (...args: unknown[]) => mockIsClaudeAvailable(...args),
  addMarketplace: mock(() => Promise.resolve()),
  updateMarketplace: mock(() => Promise.resolve()),
}));

mock.module("../services/plugin-manager.js", () => ({
  getAvailablePlugins: (...args: unknown[]) =>
    mockGetAvailablePlugins(...args),
  clearMarketplaceCache: mock(() => undefined),
}));

mock.module("../services/update-cache.js", () => ({
  UpdateCache: class {
    shouldCheckForUpdates = mock(() => Promise.resolve(true));
    saveCheck = mock(() => Promise.resolve());
  },
}));

mock.module("../services/claude-runner.js", () => ({
  runClaude: mock(() => Promise.resolve(0)),
}));

mock.module("../data/marketplaces.js", () => ({
  defaultMarketplaces: [],
}));

mock.module("../utils/string-utils.js", () => ({
  parsePluginId: mock((_id: string) => null),
}));

mock.module("fs-extra", () => ({
  default: {
    pathExists: mock(() => Promise.resolve(false)),
    readJson: mock(() => Promise.resolve({})),
    writeJson: mock(() => Promise.resolve()),
    ensureDir: mock(() => Promise.resolve()),
  },
}));

// Now import the module under test (after mock.module registrations).
const { prerunClaude } = await import("../prerunner/index.js");

// Helper: build a minimal PluginInfo-like object
function makePlugin(overrides: Partial<{
  id: string;
  enabled: boolean;
  hasUpdate: boolean;
  installedVersion: string;
  version: string;
}> = {}): {
  id: string;
  enabled: boolean;
  hasUpdate: boolean;
  installedVersion: string;
  version: string;
} {
  return {
    id: "test-plugin@magus",
    enabled: true,
    hasUpdate: true,
    installedVersion: "1.0.0",
    version: "1.1.0",
    ...overrides,
  };
}

describe("prerunner — saveGlobalInstalledPluginVersion call count", () => {
  beforeEach(() => {
    mockSaveGlobal = mock(() => Promise.resolve());
    mockUpdatePlugin = mock(() => Promise.resolve());
    mockIsClaudeAvailable = mock(() => Promise.resolve(true));
    mockGetAvailablePlugins = mock(() =>
      Promise.resolve([makePlugin()]),
    );
  });

  it("calls saveGlobalInstalledPluginVersion once after successful CLI update", async () => {
    // CLI is available, updatePlugin succeeds.
    // The CLI does NOT update installedPluginVersions, so claudeup must save
    // the version after a successful update.
    mockIsClaudeAvailable = mock(() => Promise.resolve(true));
    mockUpdatePlugin = mock(() => Promise.resolve());

    await prerunClaude(["--help"], { force: true });

    expect(mockSaveGlobal).toHaveBeenCalledTimes(1);
  });

  it("does NOT call saveGlobalInstalledPluginVersion when CLI is unavailable", async () => {
    // CLI unavailable — we must NOT write phantom state.
    mockIsClaudeAvailable = mock(() => Promise.resolve(false));

    await prerunClaude(["--help"], { force: true });

    expect(mockSaveGlobal).toHaveBeenCalledTimes(0);
  });

  it("does NOT call saveGlobalInstalledPluginVersion when CLI updatePlugin throws", async () => {
    // CLI available but updatePlugin fails — must NOT write phantom state.
    mockIsClaudeAvailable = mock(() => Promise.resolve(true));
    mockUpdatePlugin = mock(() =>
      Promise.reject(new Error("CLI update failed")),
    );

    await prerunClaude(["--help"], { force: true });

    expect(mockSaveGlobal).toHaveBeenCalledTimes(0);
  });
});
