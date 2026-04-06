#!/usr/bin/env bun
/**
 * /stats:config command
 * Reads and writes the stats plugin configuration at ~/.claude/stats/config.json
 */

import { getConfig, saveConfig } from "../lib/config.ts";

function showConfig(cfg: { enabled: boolean; retention_days: number; session_summary: boolean }) {
  console.log("Stats Plugin Configuration");
  console.log("──────────────────────────────────────");
  console.log("  enabled         ", cfg.enabled);
  console.log("  retention_days  ", `${cfg.retention_days} days`);
  console.log("  session_summary ", cfg.session_summary);
  console.log("");
  console.log("Config file: ~/.claude/stats/config.json");
}

const args = process.argv.slice(2);
const cfg = getConfig();
const changes: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === "--show") {
    // no-op, show is always printed at end
  } else if (arg === "--retention-days") {
    const raw = args[++i];
    const val = parseInt(raw, 10);
    if (isNaN(val) || val < 1 || val > 3650) {
      console.error(`Error: --retention-days must be between 1 and 3650. Got: ${raw}`);
      process.exit(1);
    }
    if (cfg.retention_days !== val) {
      changes.push(`retention_days ${cfg.retention_days} → ${val}`);
    }
    cfg.retention_days = val;
  } else if (arg === "--enabled") {
    const val = args[++i];
    if (val !== "on" && val !== "off") {
      console.error(`Error: --enabled must be on or off. Got: ${val}`);
      process.exit(1);
    }
    const newVal = val === "on";
    if (cfg.enabled !== newVal) {
      changes.push(`enabled ${cfg.enabled} → ${newVal}`);
    }
    cfg.enabled = newVal;
  } else if (arg === "--session-summary") {
    const val = args[++i];
    if (val !== "on" && val !== "off") {
      console.error(`Error: --session-summary must be on or off. Got: ${val}`);
      process.exit(1);
    }
    const newVal = val === "on";
    if (cfg.session_summary !== newVal) {
      changes.push(`session_summary ${cfg.session_summary} → ${newVal}`);
    }
    cfg.session_summary = newVal;
  } else if (arg) {
    console.error(`Unknown argument: ${arg}`);
    process.exit(1);
  }
}

if (changes.length > 0) {
  saveConfig(cfg);
  for (const change of changes) {
    console.log(`Updated: ${change}`);
  }
  console.log("");
}

showConfig(cfg);

if (!cfg.enabled && changes.some((c) => c.startsWith("enabled"))) {
  console.log("");
  console.log("Stats collection is now disabled. No data will be recorded until you run:");
  console.log("  /stats:config --enabled on");
}
