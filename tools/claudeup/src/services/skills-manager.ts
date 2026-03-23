import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import type {
	SkillSource,
	SkillInfo,
	SkillFrontmatter,
	GitTreeResponse,
} from "../types/index.js";

// ─── In-process cache ─────────────────────────────────────────────────────────

interface TreeCacheEntry {
	etag: string;
	tree: GitTreeResponse;
	fetchedAt: number;
}

const treeCache = new Map<string, TreeCacheEntry>();

// ─── Path helpers ──────────────────────────────────────────────────────────────

export function getUserSkillsDir(): string {
	return path.join(os.homedir(), ".claude", "skills");
}

export function getProjectSkillsDir(projectPath?: string): string {
	return path.join(projectPath ?? process.cwd(), ".claude", "skills");
}

// ─── GitHub Tree API ──────────────────────────────────────────────────────────

async function fetchGitTree(repo: string): Promise<GitTreeResponse> {
	const cached = treeCache.get(repo);

	const url = `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`;
	const headers: Record<string, string> = {
		Accept: "application/vnd.github+json",
		"X-GitHub-Api-Version": "2022-11-28",
	};

	if (cached?.etag) {
		headers["If-None-Match"] = cached.etag;
	}

	const token =
		process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
	if (token) {
		headers.Authorization = `Bearer ${token}`;
	}

	const response = await fetch(url, {
		headers,
		signal: AbortSignal.timeout(10000),
	});

	if (response.status === 304 && cached) {
		return cached.tree;
	}

	if (response.status === 403 || response.status === 429) {
		const resetHeader = response.headers.get("X-RateLimit-Reset");
		const resetTime = resetHeader
			? new Date(Number(resetHeader) * 1000).toLocaleTimeString()
			: "unknown";
		throw new Error(
			`GitHub API rate limit exceeded. Resets at ${resetTime}. Set GITHUB_TOKEN to increase limits.`,
		);
	}

	if (!response.ok) {
		throw new Error(
			`GitHub API error: ${response.status} ${response.statusText}`,
		);
	}

	const etag = response.headers.get("ETag") || "";
	const tree = (await response.json()) as GitTreeResponse;

	treeCache.set(repo, { etag, tree, fetchedAt: Date.now() });
	return tree;
}

// ─── Frontmatter parser ───────────────────────────────────────────────────────

function parseYamlFrontmatter(content: string): Partial<SkillFrontmatter> {
	const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
	if (!frontmatterMatch) return {};

	const yaml = frontmatterMatch[1];
	const result: Record<string, unknown> = {};

	for (const line of yaml.split("\n")) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;

		const key = line.slice(0, colonIdx).trim();
		const rawValue = line.slice(colonIdx + 1).trim();

		if (!key) continue;

		// Handle arrays (simple inline: [a, b, c])
		if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
			const items = rawValue
				.slice(1, -1)
				.split(",")
				.map((s) => s.trim().replace(/^["']|["']$/g, ""))
				.filter(Boolean);
			result[key] = items;
		} else {
			// Strip quotes
			result[key] = rawValue.replace(/^["']|["']$/g, "");
		}
	}

	return result as Partial<SkillFrontmatter>;
}

export async function fetchSkillFrontmatter(
	skill: SkillInfo,
): Promise<SkillFrontmatter> {
	const url = `https://raw.githubusercontent.com/${skill.source.repo}/HEAD/${skill.repoPath}`;

	const response = await fetch(url, {
		signal: AbortSignal.timeout(10000),
	});

	if (!response.ok) {
		return {
			name: skill.name,
			description: "(no description)",
			category: "general",
		};
	}

	const content = await response.text();
	const parsed = parseYamlFrontmatter(content);

	return {
		name: parsed.name || skill.name,
		description: parsed.description || "(no description)",
		category: parsed.category,
		author: parsed.author,
		version: parsed.version,
		tags: parsed.tags,
	};
}

// ─── Check installation ───────────────────────────────────────────────────────

export async function getInstalledSkillNames(
	scope: "user" | "project",
	projectPath?: string,
): Promise<Set<string>> {
	const dir =
		scope === "user"
			? getUserSkillsDir()
			: getProjectSkillsDir(projectPath);

	const installed = new Set<string>();

	try {
		if (!(await fs.pathExists(dir))) return installed;
		const entries = await fs.readdir(dir);
		for (const entry of entries) {
			const skillMd = path.join(dir, entry, "SKILL.md");
			if (await fs.pathExists(skillMd)) {
				installed.add(entry);
			}
		}
	} catch {
		// ignore
	}

	return installed;
}

// ─── Fetch available skills ───────────────────────────────────────────────────

export async function fetchAvailableSkills(
	repos: SkillSource[],
	projectPath?: string,
): Promise<SkillInfo[]> {
	const userInstalled = await getInstalledSkillNames("user");
	const projectInstalled = await getInstalledSkillNames("project", projectPath);

	const skills: SkillInfo[] = [];

	for (const source of repos) {
		let tree: GitTreeResponse;
		try {
			tree = await fetchGitTree(source.repo);
		} catch {
			// Skip this repo on error
			continue;
		}

		// Filter for SKILL.md files under skillsPath
		const prefix = source.skillsPath ? `${source.skillsPath}/` : "";

		for (const item of tree.tree) {
			if (item.type !== "blob") continue;
			if (!item.path.endsWith("/SKILL.md")) continue;
			if (prefix && !item.path.startsWith(prefix)) continue;

			// Extract skill name: second-to-last segment of path
			const parts = item.path.split("/");
			if (parts.length < 2) continue;
			const skillName = parts[parts.length - 2];

			// Validate name (prevent traversal)
			if (!/^[a-z0-9][a-z0-9-_]*$/i.test(skillName)) continue;

			const isUserInstalled = userInstalled.has(skillName);
			const isProjInstalled = projectInstalled.has(skillName);
			const installed = isUserInstalled || isProjInstalled;
			const installedScope: "user" | "project" | null = isProjInstalled
				? "project"
				: isUserInstalled
					? "user"
					: null;

			skills.push({
				id: `${source.repo}/${item.path}`,
				name: skillName,
				source,
				repoPath: item.path,
				gitBlobSha: item.sha,
				frontmatter: null,
				installed,
				installedScope,
				hasUpdate: false,
			});
		}
	}

	// Sort by name within each repo
	skills.sort((a, b) => a.name.localeCompare(b.name));

	return skills;
}

// ─── Install / Uninstall ──────────────────────────────────────────────────────

export async function installSkill(
	skill: SkillInfo,
	scope: "user" | "project",
	projectPath?: string,
): Promise<void> {
	const url = `https://raw.githubusercontent.com/${skill.source.repo}/HEAD/${skill.repoPath}`;

	const response = await fetch(url, {
		signal: AbortSignal.timeout(15000),
	});

	if (!response.ok) {
		throw new Error(
			`Failed to fetch skill: ${response.status} ${response.statusText}`,
		);
	}

	const content = await response.text();

	const installDir =
		scope === "user"
			? path.join(getUserSkillsDir(), skill.name)
			: path.join(getProjectSkillsDir(projectPath), skill.name);

	await fs.ensureDir(installDir);
	await fs.writeFile(path.join(installDir, "SKILL.md"), content, "utf8");
}

export async function uninstallSkill(
	skillName: string,
	scope: "user" | "project",
	projectPath?: string,
): Promise<void> {
	const installDir =
		scope === "user"
			? path.join(getUserSkillsDir(), skillName)
			: path.join(getProjectSkillsDir(projectPath), skillName);

	const skillMdPath = path.join(installDir, "SKILL.md");

	if (await fs.pathExists(skillMdPath)) {
		await fs.remove(skillMdPath);
	}

	// Try to remove directory if empty
	try {
		await fs.rmdir(installDir);
	} catch {
		// Ignore if not empty or doesn't exist
	}
}

// ─── Check installed skills from file system ──────────────────────────────────

export async function getInstalledSkillsFromFs(
	projectPath?: string,
): Promise<{ name: string; scope: "user" | "project" }[]> {
	const result: { name: string; scope: "user" | "project" }[] = [];

	const userDir = getUserSkillsDir();
	const projDir = getProjectSkillsDir(projectPath);

	const scopedDirs: Array<[string, "user" | "project"]> = [
		[userDir, "user"],
		[projDir, "project"],
	];

	for (const [dir, scope] of scopedDirs) {
		try {
			if (!(await fs.pathExists(dir))) continue;
			const entries = await fs.readdir(dir);
			for (const entry of entries) {
				const skillMd = path.join(dir, entry, "SKILL.md");
				if (await fs.pathExists(skillMd)) {
					result.push({ name: entry, scope });
				}
			}
		} catch {
			// ignore
		}
	}

	return result;
}
