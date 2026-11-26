/**
 * The worktree a session works in: the nearest ancestor of cwd (cwd included)
 * holding a `.git` entry, as a real path. A linked worktree's `.git` is a file,
 * so each worktree is its own root. With no `.git` anywhere above, the real
 * path of cwd itself.
 */

import { lstatSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function hasGitEntry(dir: string): boolean {
	try {
		lstatSync(join(dir, ".git"));
		return true;
	} catch {
		return false;
	}
}

export function worktreeRoot(cwd: string): string {
	let dir = resolve(cwd);
	for (;;) {
		if (hasGitEntry(dir)) return realpathSync(dir);
		const parent = dirname(dir);
		if (parent === dir) return realpathSync(cwd);
		dir = parent;
	}
}
