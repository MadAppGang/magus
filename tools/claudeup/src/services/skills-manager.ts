import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import type {
	SkillSource,
	SkillInfo,
	SkillFrontmatter,
	GitTreeResponse,
} from "../types/index.js";
import { RECOMMENDED_SKILLS } from "../data/skill-repos.js";

const SKILLS_API_BASE =
	"https://us-central1-claudish-6da10.cloudfunctions.net/skills";

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

// ─── Firebase Skills API ──────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapApiSkillToSkillInfo(raw: any): SkillInfo {
	const repo = (raw.repo as string) || "unknown";
	const skillPath = (raw.skillPath as string) || (raw.name as string) || "";
	const source: SkillSource = {
		label: repo,
		repo,
		skillsPath: "",
	};
	return {
		id: `${repo}/${skillPath}`,
		name: (raw.name as string) || skillPath,
		description: (raw.description as string) || "",
		source,
		repoPath: skillPath ? `${skillPath}/SKILL.md` : "SKILL.md",
		gitBlobSha: "",
		frontmatter: null,
		installed: false,
		installedScope: null,
		hasUpdate: false,
		stars: typeof raw.stars === "number" ? raw.stars : undefined,
	};
}

export async function fetchPopularSkills(limit = 30): Promise<SkillInfo[]> {
	try {
		const res = await fetch(
			`${SKILLS_API_BASE}/search?q=development&limit=${limit}&sortBy=stars`,
			{ signal: AbortSignal.timeout(10000) },
		);
		if (!res.ok) return [];
		const data = (await res.json()) as { skills?: unknown[] };
		return (data.skills || []).map(mapApiSkillToSkillInfo);
	} catch {
		return [];
	}
}

// ─── Fetch available skills ───────────────────────────────────────────────────

export async function fetchAvailableSkills(
	_repos: SkillSource[],
	projectPath?: string,
): Promise<SkillInfo[]> {
	const userInstalled = await getInstalledSkillNames("user");
	const projectInstalled = await getInstalledSkillNames("project", projectPath);

	const markInstalled = (skill: SkillInfo): SkillInfo => {
		const isUserInstalled = userInstalled.has(skill.name);
		const isProjInstalled = projectInstalled.has(skill.name);
		const installed = isUserInstalled || isProjInstalled;
		const installedScope: "user" | "project" | null = isProjInstalled
			? "project"
			: isUserInstalled
				? "user"
				: null;
		return { ...skill, installed, installedScope };
	};

	// 1. Recommended skills from RECOMMENDED_SKILLS constant (no API call)
	const recommendedSkills: SkillInfo[] = RECOMMENDED_SKILLS.map((rec) => {
		const source: SkillSource = {
			label: rec.repo,
			repo: rec.repo,
			skillsPath: "",
		};
		const skill: SkillInfo = {
			id: `${rec.repo}/${rec.skillPath}`,
			name: rec.name,
			description: rec.description,
			source,
			repoPath: `${rec.skillPath}/SKILL.md`,
			gitBlobSha: "",
			frontmatter: null,
			installed: false,
			installedScope: null,
			hasUpdate: false,
			isRecommended: true,
		};
		return markInstalled(skill);
	});

	// 2. Fetch popular skills from Firebase API
	const popular = await fetchPopularSkills(30);
	const popularSkills = popular.map((s) => markInstalled({ ...s, isRecommended: false }));

	// 3. Enrich recommended skills with GitHub repo stars
	//    Fetch stars for each unique repo (typically ~7 repos, parallel)
	const uniqueRepos = [...new Set(recommendedSkills.map((s) => s.source.repo))];
	const repoStars = new Map<string, number>();
	try {
		const starResults = await Promise.allSettled(
			uniqueRepos.map(async (repo) => {
				const res = await fetch(`https://api.github.com/repos/${repo}`, {
					headers: { Accept: "application/vnd.github+json" },
					signal: AbortSignal.timeout(5000),
				});
				if (!res.ok) return;
				const data = (await res.json()) as { stargazers_count?: number };
				if (data.stargazers_count) repoStars.set(repo, data.stargazers_count);
			}),
		);
	} catch {
		// Non-fatal — stars are cosmetic
	}
	for (const rec of recommendedSkills) {
		rec.stars = repoStars.get(rec.source.repo) || undefined;
	}

	// 4. Combine: recommended first, then popular (dedup by name)
	const seen = new Set<string>(recommendedSkills.map((s) => s.name));
	const deduped = popularSkills.filter((s) => !seen.has(s.name));

	return [...recommendedSkills, ...deduped];
}

// ─── Install / Uninstall ──────────────────────────────────────────────────────

export async function installSkill(
	skill: SkillInfo,
	scope: "user" | "project",
	projectPath?: string,
): Promise<void> {
	// Try multiple URL patterns — repos structure SKILL.md differently
	const repo = skill.source.repo;
	const repoPath = skill.repoPath.replace(/\/SKILL\.md$/, "");
	const candidates = [
		`https://raw.githubusercontent.com/${repo}/HEAD/${repoPath}/SKILL.md`,
		`https://raw.githubusercontent.com/${repo}/main/${repoPath}/SKILL.md`,
		`https://raw.githubusercontent.com/${repo}/master/${repoPath}/SKILL.md`,
		`https://raw.githubusercontent.com/${repo}/HEAD/SKILL.md`,
		`https://raw.githubusercontent.com/${repo}/main/SKILL.md`,
	];

	let content: string | null = null;
	for (const url of candidates) {
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
			if (response.ok) {
				content = await response.text();
				break;
			}
		} catch {
			continue;
		}
	}

	if (!content) {
		throw new Error(
			`Failed to fetch skill: SKILL.md not found in ${repo}/${repoPath}`,
		);
	}

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
