#!/usr/bin/env bun
/**
 * Injects iTerm2 triggers for Claude Code agent highlighting.
 * Auto-discovers agents from plugin directories by reading `color:` frontmatter.
 *
 * Usage:
 *   bun run item-highlight.ts                          # scan ./plugins + installed cache
 *   bun run item-highlight.ts --dir /path/to/plugins   # scan custom directory
 *   bun run item-highlight.ts --remove                 # remove all triggers
 *   bun run item-highlight.ts --dry-run                # preview without writing
 *   bun run item-highlight.ts --force                  # skip iTerm2 running check
 */

import { existsSync, copyFileSync, unlinkSync } from "fs";
import { homedir } from "os";
import { join, dirname } from "path";
import { Glob } from "bun";

// ── Color Name → Hex Map ────────────────────────────────────────────────────

interface AgentColor {
  bg: string;
  fg: string;
}

/** Maps frontmatter color names to GitHub-inspired hex pairs */
const COLOR_PALETTE: Record<string, AgentColor> = {
  green:   { bg: "#2ea043", fg: "#ffffff" },
  blue:    { bg: "#1f6feb", fg: "#ffffff" },
  red:     { bg: "#da3633", fg: "#ffffff" },
  orange:  { bg: "#f0883e", fg: "#000000" },
  yellow:  { bg: "#d29922", fg: "#000000" },
  purple:  { bg: "#8957e5", fg: "#ffffff" },
  cyan:    { bg: "#00b4d8", fg: "#000000" },
  magenta: { bg: "#db61a2", fg: "#ffffff" },
  violet:  { bg: "#a371f7", fg: "#000000" },
  pink:    { bg: "#f778ba", fg: "#000000" },
  gray:    { bg: "#8b949e", fg: "#000000" },
  gold:    { bg: "#e3b341", fg: "#000000" },
};

// ── Agent Discovery ─────────────────────────────────────────────────────────

interface DiscoveredAgent {
  name: string;
  color: string;
  plugin: string;
  file: string;
}

/** Parse YAML frontmatter from a markdown file for name: and color: fields */
function parseFrontmatter(content: string): { name?: string; color?: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const name = yaml.match(/^name:\s*(.+)$/m)?.[1]?.trim();
  const color = yaml.match(/^color:\s*(.+)$/m)?.[1]?.trim();
  return { name, color };
}

/** Scan a directory for plugin agent .md files and extract name + color */
async function discoverAgents(dir: string): Promise<DiscoveredAgent[]> {
  const agents: DiscoveredAgent[] = [];
  const glob = new Glob("*/agents/*.md");

  for await (const path of glob.scan({ cwd: dir, absolute: false })) {
    const fullPath = join(dir, path);
    const content = await Bun.file(fullPath).text();
    const { name, color } = parseFrontmatter(content);
    if (!name || !color) continue;

    const plugin = path.split("/")[0];
    agents.push({ name, color, plugin, file: fullPath });
  }

  return agents;
}

/** Find all installed plugin cache directories */
function getInstalledPluginDirs(): string[] {
  const cacheDir = join(homedir(), ".claude/plugins/cache");
  if (!existsSync(cacheDir)) return [];

  const dirs: string[] = [];
  const marketplaces = new Glob("*/*").scan({ cwd: cacheDir, onlyFiles: false });

  // We need the versioned dirs: cache/<marketplace>/<plugin>/<version>/
  // But we want unique plugin dirs (latest version only)
  // Simpler: scan marketplace source dirs instead
  const marketplaceSrc = join(homedir(), ".claude/plugins/marketplaces");
  if (existsSync(marketplaceSrc)) {
    for (const entry of new Glob("*").scanSync({ cwd: marketplaceSrc, onlyFiles: false })) {
      const pluginsDir = join(marketplaceSrc, entry, "plugins");
      if (existsSync(pluginsDir)) {
        dirs.push(pluginsDir);
      }
    }
  }

  return dirs;
}

// ── iTerm2 Trigger Building ─────────────────────────────────────────────────

const PLIST_PATH = join(
  homedir(),
  "Library/Preferences/com.googlecode.iterm2.plist",
);
const MARKER = "claude-agent-trigger";

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

// ── Plist I/O ───────────────────────────────────────────────────────────────

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
  await spawn(["defaults", "export", DOMAIN, TMP_PLIST]);
  const text = await spawn(["python3", "-c", PY_READ, TMP_PLIST]);
  return JSON.parse(text);
}

async function writePlist(data: any): Promise<void> {
  await spawn(["python3", "-c", PY_WRITE, TMP_PLIST], {
    stdin: JSON.stringify(data),
  });
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

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const removing = args.includes("--remove");
  const force = args.includes("--force");
  const dryRun = args.includes("--dry-run");

  // Custom --dir arguments
  const customDirs: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--dir" && args[i + 1]) {
      customDirs.push(args[++i]);
    }
  }

  // iTerm2 running check
  if (!force && !dryRun) {
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
    } catch {}
  }

  if (!removing) {
    // ── Discover agents ──────────────────────────────────────
    const scanDirs = customDirs.length > 0
      ? customDirs
      : [
          // Local dev repo (if running from magus root)
          join(dirname(new URL(import.meta.url).pathname), "plugins"),
          // Installed plugin marketplace sources
          ...getInstalledPluginDirs(),
        ];

    console.log("Scanning directories:");
    for (const d of scanDirs) {
      const exists = existsSync(d);
      console.log(`  ${exists ? "+" : "-"} ${d}`);
    }
    console.log();

    const allAgents: DiscoveredAgent[] = [];
    for (const dir of scanDirs) {
      if (!existsSync(dir)) continue;
      const found = await discoverAgents(dir);
      allAgents.push(...found);
    }

    // Deduplicate by agent name (first occurrence wins)
    const seen = new Set<string>();
    const unique: DiscoveredAgent[] = [];
    for (const agent of allAgents) {
      if (seen.has(agent.name)) continue;
      seen.add(agent.name);
      unique.push(agent);
    }

    // Resolve colors
    const resolved: Array<{ name: string; colors: AgentColor; plugin: string }> = [];
    const unknown: string[] = [];

    for (const agent of unique) {
      const colors = COLOR_PALETTE[agent.color];
      if (colors) {
        resolved.push({ name: agent.name, colors, plugin: agent.plugin });
      } else {
        unknown.push(`${agent.name} (color: "${agent.color}" from ${agent.plugin})`);
      }
    }

    if (unknown.length > 0) {
      console.log(`Unknown colors (add to COLOR_PALETTE):`);
      for (const u of unknown) console.log(`  ? ${u}`);
      console.log();
    }

    console.log(`Discovered ${resolved.length} agents from ${scanDirs.length} directories:\n`);
    for (const { name, colors, plugin } of resolved) {
      console.log(`  ${colors.bg}  ${name} (${plugin})`);
    }

    if (dryRun) {
      console.log("\n--dry-run: no changes written.");
      return;
    }

    // ── Write triggers ─────────────────────────────────────
    const backup = PLIST_PATH + ".bak";
    if (!existsSync(backup)) {
      copyFileSync(PLIST_PATH, backup);
      console.log(`\nBackup saved to ${backup}`);
    }

    const data = await readPlist();
    const profile = getDefaultProfile(data);

    const existing: Trigger[] = profile.Triggers ?? [];
    const cleaned = existing.filter((t: any) => !t.name?.startsWith(MARKER));

    const newTriggers = resolved.map(({ name, colors }) =>
      buildTrigger(name, colors),
    );

    profile.Triggers = [...cleaned, ...newTriggers];
    await writePlist(data);

    console.log(`\nInjected ${newTriggers.length} agent triggers into iTerm2.`);
    console.log(`Kept ${cleaned.length} existing triggers.`);

    console.log(`
Test with:
  echo "dev:developer"
  echo "code-analysis:detective"
  echo "seo:seo-researcher"

To remove: bun run item-highlight.ts --remove`);
  } else {
    // ── Remove mode ────────────────────────────────────────
    const backup = PLIST_PATH + ".bak";
    if (!existsSync(backup)) {
      copyFileSync(PLIST_PATH, backup);
    }

    const data = await readPlist();
    const profile = getDefaultProfile(data);
    const existing: Trigger[] = profile.Triggers ?? [];
    const cleaned = existing.filter((t: any) => !t.name?.startsWith(MARKER));

    profile.Triggers = cleaned;
    await writePlist(data);
    console.log(`Removed ${existing.length - cleaned.length} agent triggers.`);
  }

  try { unlinkSync(TMP_PLIST); } catch {}
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
