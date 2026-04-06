/**
 * Configuration management for the stats plugin.
 * Reads and writes ~/.claude/stats/config.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { StatsConfig } from "./types.ts";

const DEFAULT_CONFIG: StatsConfig = {
  enabled: true,
  retention_days: 90,
  session_summary: true,
};

function getStatsDir(): string {
  return join(homedir(), ".claude", "stats");
}

function getConfigPath(): string {
  return join(getStatsDir(), "config.json");
}

/**
 * Ensure the stats directory exists with correct permissions.
 */
function ensureConfigDir(): void {
  const statsDir = getStatsDir();
  if (!existsSync(statsDir)) {
    mkdirSync(statsDir, { recursive: true, mode: 0o700 });
  }
}

/**
 * Read the current config, returning defaults for missing fields.
 */
export function getConfig(): StatsConfig {
  const configPath = getConfigPath();
  if (!existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(readFileSync(configPath, "utf-8")) as Partial<StatsConfig>;
    return {
      enabled: raw.enabled ?? DEFAULT_CONFIG.enabled,
      retention_days: raw.retention_days ?? DEFAULT_CONFIG.retention_days,
      session_summary: raw.session_summary ?? DEFAULT_CONFIG.session_summary,
    };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write config to disk with restricted permissions.
 */
export function saveConfig(config: StatsConfig): void {
  ensureConfigDir();
  const configPath = getConfigPath();
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  // Ensure correct permissions even if file existed
  try {
    chmodSync(configPath, 0o600);
  } catch {
    // Best-effort permission fix
  }
}

export { DEFAULT_CONFIG, getStatsDir, getConfigPath };
