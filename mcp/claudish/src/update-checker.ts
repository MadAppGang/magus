/**
 * Auto-update checker for Claudish
 *
 * Checks npm registry for new versions and prompts user to update.
 */

import { execSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";

const NPM_REGISTRY_URL = "https://registry.npmjs.org/claudish/latest";

/**
 * Semantic version comparison
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.replace(/^v/, "").split(".").map(Number);
  const parts2 = v2.replace(/^v/, "").split(".").map(Number);

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  return 0;
}

/**
 * Fetch latest version from npm registry
 */
async function fetchLatestVersion(): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(NPM_REGISTRY_URL, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.version || null;
  } catch {
    // Network error, timeout, or parsing error - silently fail
    return null;
  }
}

/**
 * Prompt user for confirmation
 */
function promptUser(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr, // Use stderr so it doesn't interfere with JSON output
    });

    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

/**
 * Run npm install -g claudish
 */
function runUpdate(): boolean {
  try {
    console.error("\n[claudish] Updating...\n");

    // Use spawn for better output handling
    const result = execSync("npm install -g claudish@latest", {
      stdio: "inherit",
      encoding: "utf-8",
    });

    console.error("\n[claudish] Update complete! Please restart claudish.\n");
    return true;
  } catch (error) {
    console.error("\n[claudish] Update failed. Try manually:");
    console.error("  npm install -g claudish@latest\n");
    return false;
  }
}

/**
 * Check for updates and prompt user
 *
 * @param currentVersion - Current installed version
 * @param options - Configuration options
 * @returns true if update was performed (caller should exit), false otherwise
 */
export async function checkForUpdates(
  currentVersion: string,
  options: {
    quiet?: boolean;
    skipPrompt?: boolean;
  } = {}
): Promise<boolean> {
  const { quiet = false, skipPrompt = false } = options;

  // Fetch latest version from npm
  const latestVersion = await fetchLatestVersion();

  if (!latestVersion) {
    // Couldn't fetch - silently continue
    return false;
  }

  // Compare versions
  if (compareVersions(latestVersion, currentVersion) <= 0) {
    // Already up to date
    return false;
  }

  // New version available!
  if (!quiet) {
    console.error("");
    console.error("━".repeat(60));
    console.error(`  New version available: ${currentVersion} → ${latestVersion}`);
    console.error("━".repeat(60));
    console.error("");
  }

  if (skipPrompt) {
    // Just notify, don't prompt
    if (!quiet) {
      console.error("  Update with: npm install -g claudish@latest\n");
    }
    return false;
  }

  // Prompt user
  const shouldUpdate = await promptUser("  Would you like to update now? [y/N] ");

  if (!shouldUpdate) {
    if (!quiet) {
      console.error("\n  Skipped. Update later with: npm install -g claudish@latest\n");
    }
    return false;
  }

  // Run update
  const success = runUpdate();

  if (success) {
    // Exit after successful update so user can restart with new version
    return true;
  }

  return false;
}
