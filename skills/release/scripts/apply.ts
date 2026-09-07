#!/usr/bin/env bun
/**
 * apply.ts — Execute a confirmed release proposal: bump the manifests and commit.
 *
 * Reads a release proposal (infer.ts output, possibly with user-edited versions or
 * descriptions) and performs the local, reversible part of a release:
 *
 *   1. Validate: working tree clean; every plugin.json and marketplace.json entry
 *      exists; no proposed tag exists locally or on origin.
 *   2. Update plugins/<name>/.claude-plugin/plugin.json version.
 *   3. Update .claude-plugin/marketplace.json plugin entry version.
 *   4. git add + commit — one commit for the batch, on the CURRENT branch.
 *
 * It stops there. Nothing here pushes, tags, or publishes:
 *   - the branch is pushed and merged through a PR, where CI runs the gates;
 *   - tags go on the MERGE commit, after the merge, via tag.ts — one explicit ref
 *     per tag, never `git push --tags`;
 *   - publishing belongs to CI alone (.github/workflows/publish-dist.yml) and fires
 *     on the merge because marketplace.json versions changed.
 *
 * VERSIONS ONLY — a release never touches `description`. The proposal's
 * `description` is the release NOTE, and it belongs in the commit subject, the tag
 * message, and CHANGELOG.md (from which generate-releases.ts fills the `releases`
 * field). `description` answers "what is this plugin", changes rarely, and is
 * written by a human. This script used to assign the release note over it, which is
 * why claudeup's plugin panel once showed a changelog line where the plugin's
 * purpose belonged. validate-versions.js rejects that shape on every commit.
 *
 * Usage:
 *   bun run skills/release/scripts/apply.ts <proposal.json>
 *   bun run skills/release/scripts/apply.ts -               # read from stdin
 *   bun run skills/release/scripts/apply.ts <proposal.json> --dry-run
 *
 * Flags:
 *   --dry-run    Print what would happen; no file writes, no git.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

// ─── Types (mirror infer.ts output) ───────────────────────────────────────────

interface PluginProposal {
  name: string;
  currentVersion: string;
  proposedVersion: string;
  bump: "major" | "minor" | "patch";
  bumpReason: string;
  lastTag: string | null;
  commitsSinceLastTag: number;
  description: string;
  commits: Array<{ sha: string; subject: string; breaking: boolean }>;
  targets: string[];
  warnings: string[];
}

interface ReleaseProposal {
  generatedAt: string;
  srcRoot: string;
  plugins: PluginProposal[];
  warnings: string[];
}

// ─── Config ───────────────────────────────────────────────────────────────────

const SRC_ROOT = process.env.MAGUS_SRC_ROOT ?? process.cwd();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sh(cmd: string, opts: { cwd?: string; dryRun?: boolean } = {}): string {
  const cwd = opts.cwd ?? SRC_ROOT;
  if (opts.dryRun) {
    console.log(`  [dry-run] ${cmd}`);
    return "";
  }
  return execSync(cmd, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
}

function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function writeJsonPreserving(path: string, obj: unknown): void {
  // marketplace.json has specific formatting (2-space indent, trailing newline).
  writeFileSync(path, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function die(msg: string): never {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

// ─── Validation ───────────────────────────────────────────────────────────────

function validate(proposal: ReleaseProposal): void {
  console.log("── Validating ──────────────────────────────────");

  // Working tree clean
  const dirty = sh("git status --porcelain");
  if (dirty) {
    console.error(dirty);
    die("working tree is not clean. Commit the work first; a release commit carries versions only.");
  }
  console.log("  ✓ working tree clean");

  // Every plugin dir + plugin.json must exist
  for (const p of proposal.plugins) {
    const manifest = join(SRC_ROOT, "plugins", p.name, ".claude-plugin", "plugin.json");
    if (!existsSync(manifest)) {
      die(`plugins/${p.name}/.claude-plugin/plugin.json not found`);
    }
  }
  console.log("  ✓ all plugin manifests found");

  // marketplace.json must have an entry for every plugin
  const mpPath = join(SRC_ROOT, ".claude-plugin", "marketplace.json");
  const mp = readJson<{ plugins: Array<{ name: string }> }>(mpPath);
  const mpNames = new Set(mp.plugins.map(p => p.name));
  for (const p of proposal.plugins) {
    if (!mpNames.has(p.name)) {
      die(
        `${p.name} is not in .claude-plugin/marketplace.json. ` +
        `Add it there first, or remove it from the release proposal.`
      );
    }
  }
  console.log("  ✓ all plugins present in magus-src marketplace.json");

  // Origin must answer: the tag predicate below is checked against it.
  try {
    sh("git ls-remote --exit-code origin HEAD");
    console.log("  ✓ origin reachable");
  } catch {
    die("origin is not reachable. Check network / SSH keys.");
  }

  // No proposed tag may exist, locally or on origin. A tag on origin means the
  // version number is taken: never delete or move a pushed tag — bump instead.
  for (const p of proposal.plugins) {
    const tag = `plugins/${p.name}/v${p.proposedVersion}`;
    if (sh(`git tag --list '${tag}'`)) {
      die(`tag ${tag} already exists locally. Bump the proposed version, or if it was never pushed, git tag -d ${tag}.`);
    }
    if (sh(`git ls-remote --tags origin 'refs/tags/${tag}'`)) {
      die(`tag ${tag} already exists on origin — that version number is taken. Bump the proposed version.`);
    }
  }
  console.log("  ✓ all proposed tags are free, locally and on origin");
}

// ─── File mutations ───────────────────────────────────────────────────────────

function updatePluginManifest(p: PluginProposal, dryRun: boolean): void {
  const path = join(SRC_ROOT, "plugins", p.name, ".claude-plugin", "plugin.json");
  const manifest = readJson<Record<string, unknown>>(path);
  const before = manifest.version;
  manifest.version = p.proposedVersion;
  console.log(`  plugins/${p.name}/.claude-plugin/plugin.json: ${before} → ${p.proposedVersion}`);
  if (!dryRun) writeJsonPreserving(path, manifest);
}

function updateMarketplaceEntry(p: PluginProposal, dryRun: boolean): void {
  const path = join(SRC_ROOT, ".claude-plugin", "marketplace.json");
  const mp = readJson<{
    plugins: Array<{ name: string; version: string; description: string }>;
  }>(path);
  const entry = mp.plugins.find(x => x.name === p.name);
  if (!entry) die(`marketplace entry for ${p.name} vanished between validate and apply`);
  const versionBefore = entry.version;
  entry.version = p.proposedVersion;
  // Deliberately NOT `entry.description = p.description`. See the header note: the
  // durable description and the release note are different fields with different
  // authors, and assigning one over the other also drifts marketplace.json out of
  // parity with plugin.json, which validate-versions.js fails on.
  console.log(`  marketplace.json[${p.name}]: v${versionBefore} → v${p.proposedVersion}`);
  if (!dryRun) writeJsonPreserving(path, mp);
}

// ─── Commit ───────────────────────────────────────────────────────────────────

function commitMessage(proposal: ReleaseProposal): string {
  const plugins = proposal.plugins;
  if (plugins.length === 1) {
    const p = plugins[0]!;
    const bang = p.bump === "major" ? "!" : "";
    return `release(${p.name})${bang}: v${p.proposedVersion}\n\n${p.description}`;
  }
  const header = `release: ${plugins.map(p => `${p.name} v${p.proposedVersion}`).join(", ")}`;
  const body = plugins.map(p => `- ${p.name} v${p.proposedVersion}: ${p.description}`).join("\n");
  return `${header}\n\n${body}`;
}

function gitCommit(proposal: ReleaseProposal, dryRun: boolean): void {
  console.log("── Committing ──────────────────────────────────");
  sh("git add plugins/ .claude-plugin/marketplace.json", { dryRun });
  // Use a temp file for the message to avoid shell-escape pain with multi-line.
  const msgFile = join(process.env.TMPDIR ?? "/tmp", "magus-release-msg.txt");
  const msg = commitMessage(proposal) +
    `\n\nCo-Authored-By: Magus <magus@madappgang.com>` +
    `\n\nCrafted with agentic harness Magus (https://github.com/MadAppGang/magus)`;
  if (!dryRun) writeFileSync(msgFile, msg);
  sh(`git commit -F ${msgFile}`, { dryRun });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function readProposal(source: string): ReleaseProposal {
  const raw = source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  return JSON.parse(raw) as ReleaseProposal;
}

function main(): void {
  const args = process.argv.slice(2);
  const proposalPath = args.find(a => !a.startsWith("--"));
  if (!proposalPath) {
    console.error("Usage: bun run apply.ts <proposal.json|-> [--dry-run]");
    process.exit(2);
  }
  const dryRun = args.includes("--dry-run");

  const proposal = readProposal(proposalPath);

  if (proposal.plugins.length === 0) {
    die("proposal has zero plugins");
  }

  console.log("── Release plan ────────────────────────────────");
  for (const p of proposal.plugins) {
    console.log(
      `  ${p.name}: ${p.currentVersion} → ${p.proposedVersion} (${p.bump})` +
      ` [targets: ${p.targets.join(", ") || "magus-src only"}]`
    );
  }
  console.log();

  validate(proposal);

  console.log("\n── Applying changes ────────────────────────────");
  for (const p of proposal.plugins) {
    updatePluginManifest(p, dryRun);
    updateMarketplaceEntry(p, dryRun);
  }

  gitCommit(proposal, dryRun);

  const branch = dryRun ? "<branch>" : sh("git rev-parse --abbrev-ref HEAD");
  console.log("\n✓ Release commit created. Nothing has left this machine.");
  console.log("\nNext:");
  console.log(`  1. git push -u origin ${branch}; open a PR to main; merge when CI (release-gates) is green.`);
  console.log("  2. Tag the MERGE commit and push each tag as an explicit ref:");
  console.log(`       bun run skills/release/scripts/tag.ts ${proposalPath} <merge-sha>`);
  console.log("  3. CI publishes every channel on the merge: gh run list --workflow publish-dist.yml");
  if (dryRun) {
    console.log("\n(dry-run — no changes were actually made)");
  }
}

main();
