#!/usr/bin/env bun
/**
 * Injects iTerm2 triggers for Claude Code agent highlighting.
 * Matches patterns like: Skill(anything:agent-name) or plugin:agent-name
 *
 * Usage:
 *   1. Quit iTerm2 completely
 *   2. bun run item-highlight.ts
 *   3. Open iTerm2 — triggers are active
 *
 * To remove: bun run item-highlight.ts --remove
 */

import { existsSync, copyFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join } from "path";

// ── Agent Color Map ──────────────────────────────────────────────────────────

interface AgentColor {
  bg: string; // hex background
  fg: string; // hex text
}

const AGENTS: Record<string, AgentColor> = {
  // Build & Code
  developer: { bg: "#2ea043", fg: "#ffffff" }, // Green
  architect: { bg: "#1f6feb", fg: "#ffffff" }, // Blue

  // Debug & Fix
  debugger: { bg: "#da3633", fg: "#ffffff" }, // Red

  // Research & Synthesis
  researcher: { bg: "#8957e5", fg: "#ffffff" }, // Purple
  synthesizer: { bg: "#bc8cff", fg: "#000000" }, // Light Purple

  // Testing
  "test-architect": { bg: "#d29922", fg: "#000000" }, // Yellow

  // Infrastructure
  devops: { bg: "#f0883e", fg: "#000000" }, // Orange

  // UI
  "ui-engineer": { bg: "#00b4d8", fg: "#000000" }, // Cyan
  ui: { bg: "#3fb950", fg: "#000000" }, // Teal

  // Documentation
  "doc-writer": { bg: "#8b949e", fg: "#000000" }, // Gray
  "doc-analyzer": { bg: "#6e7681", fg: "#ffffff" }, // Dark Gray
  "doc-fixer": { bg: "#768390", fg: "#ffffff" }, // Mid Gray

  // Spec & Planning
  "spec-writer": { bg: "#d2a8ff", fg: "#000000" }, // Lavender
  scribe: { bg: "#7ee787", fg: "#000000" }, // Light Green

  // Discovery & Detection
  "skill-discovery": { bg: "#79c0ff", fg: "#000000" }, // Light Blue
  "stack-detector": { bg: "#ffa657", fg: "#000000" }, // Light Orange

  // Review & Quality
  reviewer: { bg: "#e3b341", fg: "#000000" }, // Gold
  "code-reviewer": { bg: "#d4a72c", fg: "#000000" }, // Dark Gold
  "code-simplifier": { bg: "#a5d6ff", fg: "#000000" }, // Pale Blue

  // Investigation
  detective: { bg: "#f778ba", fg: "#000000" }, // Pink
};

// ── Helpers ──────────────────────────────────────────────────────────────────

const PLIST_PATH = join(
  homedir(),
  "Library/Preferences/com.googlecode.iterm2.plist",
);
const MARKER = "claude-agent-trigger";

/** Convert #rrggbb to iTerm2 P3 16-bit format: p3#RRRRGGGGBBBB */
function hexToP3(hex: string): string {
  const h = hex.replace("#", "");
  const r = h.slice(0, 2);
  const g = h.slice(2, 4);
  const b = h.slice(4, 6);
  return `p3#${r}${r}${g}${g}${b}${b}`;
}

interface Trigger {
  action: string;
  contentregex: string;
  disabled: boolean;
  matchType: number;
  name: string;
  parameter: string;
  partial: boolean;
  regex: string;
}

function buildTrigger(agent: string, colors: AgentColor): Trigger {
  return {
    action: "HighlightTrigger",
    contentregex: "",
    disabled: false,
    matchType: 0,
    name: `${MARKER}:${agent}`,
    parameter: `{${hexToP3(colors.fg)},${hexToP3(colors.bg)}}`,
    partial: true,
    regex: `\\w[\\w-]*:${agent}\\b`,
  };
}

// ── Plist I/O (via `defaults` + Python for cfprefsd-safe read/write) ────────

const DOMAIN = "com.googlecode.iterm2";
const TMP_PLIST = "/tmp/iterm2_triggers_work.plist";

const PY_READ = `
import plistlib, json, sys, base64, datetime

def prep(obj):
    if isinstance(obj, bytes): return {"__b64__": base64.b64encode(obj).decode()}
    if isinstance(obj, datetime.datetime): return {"__dt__": obj.isoformat()}
    if isinstance(obj, dict): return {k: prep(v) for k, v in obj.items()}
    if isinstance(obj, list): return [prep(v) for v in obj]
    return obj

with open(sys.argv[1], "rb") as f:
    print(json.dumps(prep(plistlib.load(f))))
`;

const PY_WRITE = `
import plistlib, json, sys, base64, datetime

def unprep(obj):
    if isinstance(obj, dict):
        if "__b64__" in obj: return base64.b64decode(obj["__b64__"])
        if "__dt__" in obj: return datetime.datetime.fromisoformat(obj["__dt__"])
        return {k: unprep(v) for k, v in obj.items()}
    if isinstance(obj, list): return [unprep(v) for v in obj]
    return obj

data = unprep(json.loads(sys.stdin.read()))
with open(sys.argv[1], "wb") as f:
    plistlib.dump(data, f)
`;

async function spawn(
  cmd: string[],
  opts?: { stdin?: string },
): Promise<string> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: opts?.stdin ? "pipe" : undefined,
  });
  if (opts?.stdin && proc.stdin) {
    proc.stdin.write(opts.stdin);
    proc.stdin.end();
  }
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(`${cmd[0]} failed: ${stderr}`);
  return stdout;
}

async function readPlist(): Promise<any> {
  // Export through cfprefsd (the authoritative preference source)
  await spawn(["defaults", "export", DOMAIN, TMP_PLIST]);
  // Parse the exported XML plist with Python
  const text = await spawn(["python3", "-c", PY_READ, TMP_PLIST]);
  return JSON.parse(text);
}

async function writePlist(data: any): Promise<void> {
  // Write modified plist to temp file
  await spawn(["python3", "-c", PY_WRITE, TMP_PLIST], {
    stdin: JSON.stringify(data),
  });
  // Import through cfprefsd so changes are actually recognized
  await spawn(["defaults", "import", DOMAIN, TMP_PLIST]);
}

function getDefaultProfile(data: any): any {
  const profiles = data["New Bookmarks"] ?? [];
  const def = profiles.find((p: any) => p.Name === "Default");
  if (def) return def;
  if (profiles.length > 0) return profiles[0];
  console.error("No profiles found in iTerm2 config");
  process.exit(1);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const removing = process.argv.includes("--remove");
  const force = process.argv.includes("--force");

  // Warn if iTerm2 is running (changes won't take effect until restart)
  if (!force) {
    try {
      const out = await spawn([
        "osascript",
        "-e",
        'tell application "System Events" to (name of processes) contains "iTerm2"',
      ]);
      if (out.trim() === "true") {
        console.error(
          "iTerm2 is running. Either:\n" +
            "  1. Quit iTerm2, re-run from Terminal.app, then open iTerm2\n" +
            "  2. Run with --force, then restart iTerm2\n",
        );
        process.exit(1);
      }
    } catch {
      // osascript unavailable — skip check
    }
  }

  // Backup
  const backup = PLIST_PATH + ".bak";
  if (!existsSync(backup)) {
    copyFileSync(PLIST_PATH, backup);
    console.log(`Backup saved to ${backup}`);
  }

  const data = await readPlist();
  const profile = getDefaultProfile(data);

  const existing: Trigger[] = profile.Triggers ?? [];
  const cleaned = existing.filter((t: any) => !t.name?.startsWith(MARKER));

  if (removing) {
    profile.Triggers = cleaned;
    await writePlist(data);
    console.log(`Removed ${existing.length - cleaned.length} agent triggers.`);
    return;
  }

  // Build new triggers
  const newTriggers = Object.entries(AGENTS).map(([agent, colors]) =>
    buildTrigger(agent, colors),
  );

  profile.Triggers = [...cleaned, ...newTriggers];
  await writePlist(data);

  console.log(`\nInjected ${newTriggers.length} agent triggers into iTerm2.`);
  console.log(`Kept ${cleaned.length} existing triggers.\n`);

  console.log("Color map:");
  for (const [agent, { bg }] of Object.entries(AGENTS)) {
    console.log(`  ${bg}  ${agent}`);
  }

  console.log(`
Test with:
  echo "Skill(code-analysis:architect)"
  echo "dev:developer"
  echo "Skill(test:debugger)"

To remove: bun run item-highlight.ts --remove`);

  // Cleanup temp file
  try { unlinkSync(TMP_PLIST); } catch {}
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
