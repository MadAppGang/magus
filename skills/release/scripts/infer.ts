#!/usr/bin/env bun
/**
 * infer.ts — Propose a release for one or more plugins.
 *
 * Reads git history and dist marketplace files to propose:
 *   - the next semver for each plugin (based on conventional commits)
 *   - a short description synthesized from commits since the last tag
 *   - which dist repos (magus / magus-alpha / magus-marketing) the plugin targets
 *
 * Output is a single JSON object on stdout. The human (or Claude) reviews it,
 * edits if needed, and hands the confirmed JSON back to apply.ts.
 *
 * Usage:
 *   bun run skills/release/scripts/infer.ts <plugin> [<plugin> ...]
 *
 * Example:
 *   bun run skills/release/scripts/infer.ts kanban gtd
 */

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

// ─── Configuration ────────────────────────────────────────────────────────────

const SRC_ROOT = process.env.MAGUS_SRC_ROOT ?? process.cwd();
const MARKETPLACE_FILE = join(SRC_ROOT, ".claude-plugin", "marketplace.json");

// ─── Types ────────────────────────────────────────────────────────────────────

type BumpKind = "major" | "minor" | "patch";

interface Commit {
  sha: string;
  subject: string;       // first line
  body: string;          // rest
  breaking: boolean;
  type: string;          // feat, fix, chore, docs, refactor, etc.
}

interface PluginProposal {
  name: string;
  currentVersion: string;
  proposedVersion: string;
  bump: BumpKind;
  bumpReason: string;
  lastTag: string | null;   // null if no prior release
  commitsSinceLastTag: number;
  description: string;
  commits: Array<{ sha: string; subject: string; breaking: boolean }>;
  targets: string[];        // dist repo names this plugin publishes to
  warnings: string[];
}

interface ReleaseProposal {
  generatedAt: string;
  srcRoot: string;
  plugins: PluginProposal[];
  warnings: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sh(cmd: string, cwd = SRC_ROOT): string {
  return execSync(cmd, { cwd, encoding: "utf8" }).trim();
}

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function bumpSemver(version: string, kind: BumpKind): string {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) throw new Error(`Cannot parse version: ${version}`);
  const [, majS, minS, patS] = m;
  const maj = Number(majS), min = Number(minS), pat = Number(patS);
  switch (kind) {
    case "major": return `${maj + 1}.0.0`;
    case "minor": return `${maj}.${min + 1}.0`;
    case "patch": return `${maj}.${min}.${pat + 1}`;
  }
}

// Conventional-commit parser, tolerant of noise.
function parseCommit(sha: string, subject: string, body: string): Commit {
  // feat(scope)!: description   OR   fix: description   OR   chore(scope): x
  const headerRe = /^(?<type>[a-z]+)(?:\((?<scope>[^)]+)\))?(?<bang>!)?:\s*(?<rest>.*)$/i;
  const m = subject.match(headerRe);
  const breakingInBody = /^BREAKING(?:[ -]CHANGE)?:/im.test(body);
  return {
    sha,
    subject,
    body,
    type: m?.groups?.type?.toLowerCase() ?? "other",
    breaking: Boolean(m?.groups?.bang) || breakingInBody,
  };
}

// ─── Git queries ──────────────────────────────────────────────────────────────

function lastTagFor(plugin: string): string | null {
  // Tag format: plugins/<plugin>/vX.Y.Z
  try {
    const tags = sh(`git tag --list 'plugins/${plugin}/v*' --sort=-v:refname`);
    return tags.split("\n").filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

function currentVersion(plugin: string): string {
  const manifest = readJson<{ version: string }>(
    join(SRC_ROOT, "plugins", plugin, "plugin.json")
  );
  return manifest.version;
}

function commitsSince(plugin: string, since: string | null): Commit[] {
  // Path-filter to only count commits that touched this plugin's directory.
  const range = since ? `${since}..HEAD` : "HEAD";
  const sep = "<<<CMT>>>";
  const fieldSep = "<<<FLD>>>";
  const fmt = `%H${fieldSep}%s${fieldSep}%b${sep}`;
  const out = sh(
    `git log ${range} --format='${fmt}' -- plugins/${plugin}/`
  );
  if (!out) return [];
  return out
    .split(sep)
    .map(s => s.trim())
    .filter(Boolean)
    .map(chunk => {
      const [sha, subject, body = ""] = chunk.split(fieldSep);
      return parseCommit(sha, subject, body);
    });
}

// ─── Inference ────────────────────────────────────────────────────────────────

function inferBump(commits: Commit[]): { bump: BumpKind; reason: string } {
  if (commits.length === 0) return { bump: "patch", reason: "no commits since last tag" };
  if (commits.some(c => c.breaking)) {
    const c = commits.find(c => c.breaking)!;
    return { bump: "major", reason: `breaking change in ${c.sha.slice(0, 7)}: ${c.subject}` };
  }
  if (commits.some(c => c.type === "feat")) {
    const c = commits.find(c => c.type === "feat")!;
    return { bump: "minor", reason: `feat in ${c.sha.slice(0, 7)}: ${c.subject}` };
  }
  return { bump: "patch", reason: "only fix/chore/docs/refactor since last tag" };
}

function synthesizeDescription(plugin: string, commits: Commit[], bump: BumpKind): string {
  if (commits.length === 0) {
    return `${plugin} — no functional changes (metadata-only release).`;
  }
  const tagged = commits.map(c => {
    const tag = c.breaking ? "BREAKING" : c.type.toUpperCase();
    // Strip conventional prefix from subject for cleaner text
    const clean = c.subject.replace(/^[a-z]+(\([^)]+\))?!?:\s*/i, "");
    return `${tag}: ${clean}`;
  });
  // Keep it short — marketplace.json descriptions should be scannable.
  // Put breaking changes first, then feats, then fixes.
  const ordered = [
    ...tagged.filter(t => t.startsWith("BREAKING")),
    ...tagged.filter(t => t.startsWith("FEAT")),
    ...tagged.filter(t => !t.startsWith("BREAKING") && !t.startsWith("FEAT")),
  ];
  const prefix = bump === "major" ? "(breaking) " : "";
  return `${prefix}${ordered.slice(0, 4).join("; ")}${ordered.length > 4 ? "; …" : ""}`;
}

function findTargets(plugin: string): { targets: string[]; warnings: string[] } {
  // Source of truth: the magus-src marketplace.json, where each plugin entry
  // declares its distTargets (e.g. ["magus"], ["magus-alpha"], ["magus", "magus-marketing"]).
  const mp = readJson<{
    plugins: Array<{ name: string; distTargets?: string[] }>;
  }>(MARKETPLACE_FILE);
  const entry = mp.plugins.find(p => p.name === plugin);
  if (!entry) {
    return {
      targets: [],
      warnings: [`${plugin} is not in .claude-plugin/marketplace.json — cannot infer dist targets`],
    };
  }
  return { targets: entry.distTargets ?? [], warnings: [] };
}

function proposeForPlugin(plugin: string): PluginProposal {
  const pluginDir = join(SRC_ROOT, "plugins", plugin);
  if (!existsSync(pluginDir)) {
    throw new Error(`Plugin directory not found: ${pluginDir}`);
  }

  const current = currentVersion(plugin);
  const tag = lastTagFor(plugin);
  const commits = commitsSince(plugin, tag);
  const { bump, reason } = inferBump(commits);
  const proposed = bumpSemver(current, bump);
  const description = synthesizeDescription(plugin, commits, bump);
  const { targets, warnings } = findTargets(plugin);

  if (targets.length === 0) {
    warnings.push(
      `${plugin} is not listed in any dist repo's marketplace.json — release will update magus-src only`
    );
  }

  return {
    name: plugin,
    currentVersion: current,
    proposedVersion: proposed,
    bump,
    bumpReason: reason,
    lastTag: tag,
    commitsSinceLastTag: commits.length,
    description,
    commits: commits.map(c => ({
      sha: c.sha.slice(0, 7),
      subject: c.subject,
      breaking: c.breaking,
    })),
    targets,
    warnings,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const plugins = process.argv.slice(2);
  if (plugins.length === 0) {
    console.error("Usage: bun run infer.ts <plugin> [<plugin> ...]");
    process.exit(2);
  }

  const topLevelWarnings: string[] = [];

  // Working tree check — unstaged changes to plugin files would create a release
  // from inconsistent state.
  const dirty = sh("git status --porcelain");
  if (dirty) {
    topLevelWarnings.push(
      "working tree has uncommitted changes; apply.ts will refuse to run until clean"
    );
  }

  const proposals: PluginProposal[] = [];
  for (const plugin of plugins) {
    try {
      proposals.push(proposeForPlugin(plugin));
    } catch (err) {
      topLevelWarnings.push(
        `${plugin}: ${(err as Error).message}`
      );
    }
  }

  const out: ReleaseProposal = {
    generatedAt: new Date().toISOString(),
    srcRoot: SRC_ROOT,
    plugins: proposals,
    warnings: topLevelWarnings,
  };

  console.log(JSON.stringify(out, null, 2));
}

main();
