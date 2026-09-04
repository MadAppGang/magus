#!/usr/bin/env bun
/**
 * tag.ts — Tag a merged release on main and push each tag as an explicit ref.
 *
 * Usage:
 *   bun run skills/release/scripts/tag.ts <proposal.json|-> <merge-sha> [--dry-run]
 *
 * For every plugin in the proposal, the tag plugins/<name>/v<version> is created as an
 * annotated tag at <merge-sha> and pushed as refs/tags/<tag>. Never `git push --tags`:
 * that pushes every local tag on the machine, and tags are shared across every
 * worktree of this repository.
 *
 * Every push is a predicate + action, so a rerun after a partial failure is safe:
 *   - origin lacks the tag                 → create it if needed, push it
 *   - origin has it at <merge-sha>          → skip
 *   - origin has it at another commit       → STOP. That version number is taken.
 *     Never delete or move a pushed tag; bump to the next version and release again.
 *
 * <merge-sha> must be reachable from origin/main. Tagging the branch head would mark a
 * commit CI never validated as the merge result. Get it with:
 *   gh pr view <n> --json mergeCommit -q .mergeCommit.oid
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

interface Proposal {
  plugins: Array<{ name: string; proposedVersion: string; description: string }>;
}

const SRC_ROOT = process.env.MAGUS_SRC_ROOT ?? process.cwd();

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: SRC_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(args: string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function die(msg: string): never {
  console.error(`\nERROR: ${msg}\n`);
  process.exit(1);
}

function main(): void {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [source, shaArg] = args.filter(a => !a.startsWith("--"));
  if (!source || !shaArg) {
    console.error("Usage: bun run tag.ts <proposal.json|-> <merge-sha> [--dry-run]");
    process.exit(2);
  }

  const raw = source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  const proposal = JSON.parse(raw) as Proposal;
  if (!proposal.plugins?.length) die("proposal has zero plugins");

  git(["fetch", "origin", "main", "--quiet"]);
  const sha = tryGit(["rev-parse", "--verify", "--quiet", `${shaArg}^{commit}`]);
  if (!sha) die(`${shaArg} is not a commit in this repository`);
  if (tryGit(["merge-base", "--is-ancestor", sha, "origin/main"]) === null) {
    die(
      `${sha.slice(0, 8)} is not on origin/main. Tag the merge commit ` +
      `(gh pr view <n> --json mergeCommit -q .mergeCommit.oid), not the branch head.`
    );
  }

  console.log(`── Tagging ${sha.slice(0, 8)} on origin/main ────────────────`);
  for (const p of proposal.plugins) {
    const tag = `plugins/${p.name}/v${p.proposedVersion}`;

    // Predicate: what does origin hold under this name? An annotated tag lists two
    // lines (the tag object and its peeled commit); a lightweight one lists one.
    const remote = tryGit(["ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`]) ?? "";
    const lines = remote.split("\n").filter(Boolean).map(l => l.split("\t"));
    const peeled = lines.find(([, ref]) => ref?.endsWith("^{}"))?.[0];
    const direct = lines.find(([, ref]) => ref === `refs/tags/${tag}`)?.[0];
    const remoteTarget = peeled ?? direct;

    if (remoteTarget === sha) {
      console.log(`  = ${tag} already on origin at ${sha.slice(0, 8)} — skipped`);
      continue;
    }
    if (remoteTarget) {
      die(
        `${tag} exists on origin at ${remoteTarget.slice(0, 8)}, not ${sha.slice(0, 8)}. ` +
        `The number is taken: never delete or move a pushed tag. ` +
        `Bump ${p.name} to the next version and release again.`
      );
    }

    const local = tryGit(["rev-parse", "--verify", "--quiet", `${tag}^{commit}`]);
    if (local && local !== sha) {
      die(
        `a local tag ${tag} points at ${local.slice(0, 8)}, not the merge commit. ` +
        `It was never pushed, so it is safe to drop: git tag -d ${tag} — then rerun.`
      );
    }

    const msg = `${p.name} v${p.proposedVersion} — ${p.description}`;
    if (dryRun) {
      if (!local) console.log(`  [dry-run] git tag -a ${tag} -m "${msg.slice(0, 60)}…" ${sha.slice(0, 8)}`);
      console.log(`  [dry-run] git push origin refs/tags/${tag}`);
      continue;
    }
    if (!local) git(["tag", "-a", tag, "-m", msg, sha]);
    try {
      git(["push", "origin", `refs/tags/${tag}`]);
    } catch (e) {
      const err = e as { stderr?: string };
      die(`push of refs/tags/${tag} failed:\n${err.stderr ?? String(e)}`);
    }
    console.log(`  ✓ ${tag} → ${sha.slice(0, 8)} pushed`);
  }
  console.log("\n✓ Tags are on origin. CI publishes on the merge: gh run list --workflow publish-dist.yml");
}

main();
