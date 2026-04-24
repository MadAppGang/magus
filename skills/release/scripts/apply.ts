#!/usr/bin/env bun
/**
 * apply.ts — Execute a confirmed release proposal.
 *
 * Reads a release proposal (same shape as infer.ts output, possibly with
 * user-edited descriptions/versions) and performs the mechanical work:
 *
 *   1. Validate: working tree clean, every proposed tag is unused,
 *      every plugin.json + marketplace.json entry exists.
 *   2. Update plugins/<name>/plugin.json version + description.
 *   3. Update .claude-plugin/marketplace.json plugin entry (version + description).
 *   4. git add + commit (single commit for the batch).
 *   5. git tag for each plugin (plugins/<name>/v<X.Y.Z>).
 *   6. git push origin main --tags.
 *   7. Run scripts/release.sh (syncs shared deps, bumps magus-alpha SHAs).
 *   8. Run scripts/publish-dist.sh (force-pushes to MadAppGang/magus dist repo).
 *
 * Stops at the first failure and prints a clear state report so the user
 * can either fix-and-release-a-patch OR roll back manually. The script
 * never attempts automatic rollback — half-rolled-back state is worse than
 * a known-broken state.
 *
 * Usage:
 *   bun run skills/release/scripts/apply.ts <proposal.json>
 *   bun run skills/release/scripts/apply.ts -               # read from stdin
 *   bun run skills/release/scripts/apply.ts <proposal.json> --dry-run
 *
 * Flags:
 *   --dry-run    Print what would happen; no file writes, no git, no push.
 *   --skip-push  Do all local steps (commit + tag) but don't push/publish.
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

function validate(proposal: ReleaseProposal, opts: { skipPush: boolean }): void {
  console.log("── Validating ──────────────────────────────────");

  // Working tree clean
  const dirty = sh("git status --porcelain");
  if (dirty) {
    console.error(dirty);
    die("working tree is not clean. Commit or stash before releasing.");
  }
  console.log("  ✓ working tree clean");

  // Every plugin dir + plugin.json must exist
  for (const p of proposal.plugins) {
    const manifest = join(SRC_ROOT, "plugins", p.name, "plugin.json");
    if (!existsSync(manifest)) {
      die(`plugins/${p.name}/plugin.json not found`);
    }
  }
  console.log("  ✓ all plugin manifests found");

  // No tag already exists for any proposed version
  for (const p of proposal.plugins) {
    const tag = `plugins/${p.name}/v${p.proposedVersion}`;
    const exists = sh(`git tag --list '${tag}'`);
    if (exists) {
      die(
        `tag ${tag} already exists. Either bump the proposed version ` +
        `or delete the stale tag with: git tag -d ${tag} && git push origin :refs/tags/${tag}`
      );
    }
  }
  console.log("  ✓ all proposed tags are free");

  // marketplace.json must have an entry for every plugin that declares targets
  const mpPath = join(SRC_ROOT, ".claude-plugin", "marketplace.json");
  const mp = readJson<{ plugins: Array<{ name: string }> }>(mpPath);
  const mpNames = new Set(mp.plugins.map(p => p.name));
  for (const p of proposal.plugins) {
    if (!mpNames.has(p.name)) {
      die(
        `${p.name} is not in .claude-plugin/marketplace.json. ` +
        `Add it there first, or remove from the release proposal.`
      );
    }
  }
  console.log("  ✓ all plugins present in magus-src marketplace.json");

  if (!opts.skipPush) {
    // Remote reachable
    try {
      sh("git ls-remote --exit-code origin HEAD");
      console.log("  ✓ origin reachable");
    } catch {
      die("origin is not reachable. Check network / SSH keys, or rerun with --skip-push.");
    }
  }
}

// ─── File mutations ───────────────────────────────────────────────────────────

function updatePluginManifest(p: PluginProposal, dryRun: boolean): void {
  const path = join(SRC_ROOT, "plugins", p.name, "plugin.json");
  const manifest = readJson<Record<string, unknown>>(path);
  const before = manifest.version;
  manifest.version = p.proposedVersion;
  console.log(`  plugins/${p.name}/plugin.json: ${before} → ${p.proposedVersion}`);
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
  entry.description = p.description;
  console.log(`  marketplace.json[${p.name}]: v${versionBefore} → v${p.proposedVersion}`);
  if (!dryRun) writeJsonPreserving(path, mp);
}

// ─── Git + publish ────────────────────────────────────────────────────────────

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

function gitCommitAndTag(proposal: ReleaseProposal, dryRun: boolean): void {
  console.log("── Committing ──────────────────────────────────");
  sh("git add plugins/ .claude-plugin/marketplace.json", { dryRun });
  // Use a temp file for the message to avoid shell-escape pain with multi-line.
  const msgFile = "/tmp/magus-release-msg.txt";
  const msg = commitMessage(proposal) +
    `\n\nCo-Authored-By: Magus <magus@madappgang.com>` +
    `\n\nCrafted with agentic harness Magus (https://github.com/MadAppGang/magus)`;
  if (!dryRun) writeFileSync(msgFile, msg);
  sh(`git commit -F ${msgFile}`, { dryRun });

  console.log("── Tagging ─────────────────────────────────────");
  for (const p of proposal.plugins) {
    const tag = `plugins/${p.name}/v${p.proposedVersion}`;
    const tagMsg = `${p.name} v${p.proposedVersion} — ${p.description.slice(0, 100)}`;
    // Single-quote the message arg and escape any single quotes in the content
    const safeMsg = tagMsg.replace(/'/g, `'\\''`);
    sh(`git tag -a '${tag}' -m '${safeMsg}'`, { dryRun });
    console.log(`  ✓ ${tag}`);
  }
}

function pushAndPublish(dryRun: boolean): void {
  console.log("── Pushing ─────────────────────────────────────");
  sh("git push origin main --tags", { dryRun });

  console.log("── Running scripts/release.sh (sync shared deps + alpha SHAs) ──");
  sh("./scripts/release.sh", { dryRun });

  console.log("── Running scripts/publish-dist.sh (force-push to dist repos) ──");
  sh("./scripts/publish-dist.sh", { dryRun });
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
    console.error(
      "Usage: bun run apply.ts <proposal.json|-> [--dry-run] [--skip-push]"
    );
    process.exit(2);
  }
  const dryRun = args.includes("--dry-run");
  const skipPush = args.includes("--skip-push");

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

  validate(proposal, { skipPush });

  console.log("\n── Applying changes ────────────────────────────");
  for (const p of proposal.plugins) {
    updatePluginManifest(p, dryRun);
    updateMarketplaceEntry(p, dryRun);
  }

  gitCommitAndTag(proposal, dryRun);

  if (skipPush) {
    console.log("\n[--skip-push] stopping before push. Local commit + tags created.");
    console.log("To finish: git push origin main --tags && ./scripts/release.sh && ./scripts/publish-dist.sh");
    return;
  }

  pushAndPublish(dryRun);

  console.log("\n✓ Release complete.");
  if (dryRun) {
    console.log("(dry-run — no changes were actually made)");
  }
}

main();
