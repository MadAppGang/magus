import fs from "fs-extra";
import path from "node:path";
import os from "node:os";
import { RECOMMENDED_SKILLS, classifyStarReliability } from "../data/skill-repos.js";
const SKILLS_API_BASE = "https://us-central1-claudish-6da10.cloudfunctions.net/skills";
const treeCache = new Map();
// ─── Path helpers ──────────────────────────────────────────────────────────────
export function getUserSkillsDir() {
    return path.join(os.homedir(), ".claude", "skills");
}
export function getProjectSkillsDir(projectPath) {
    return path.join(projectPath ?? process.cwd(), ".claude", "skills");
}
// ─── GitHub Tree API ──────────────────────────────────────────────────────────
async function fetchGitTree(repo) {
    const cached = treeCache.get(repo);
    const url = `https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`;
    const headers = {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    };
    if (cached?.etag) {
        headers["If-None-Match"] = cached.etag;
    }
    const token = process.env.GITHUB_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
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
        throw new Error(`GitHub API rate limit exceeded. Resets at ${resetTime}. Set GITHUB_TOKEN to increase limits.`);
    }
    if (!response.ok) {
        throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
    }
    const etag = response.headers.get("ETag") || "";
    const tree = (await response.json());
    treeCache.set(repo, { etag, tree, fetchedAt: Date.now() });
    return tree;
}
// ─── Skill Set fetching ──────────────────────────────────────────────────────
/**
 * Fetch all skills from a skill set repo using the GitHub Tree API.
 * Returns SkillInfo[] with installed status marked via disk scan.
 */
export async function fetchSkillSetSkills(repo, projectPath) {
    const tree = await fetchGitTree(repo);
    // Find all SKILL.md blobs
    const skillBlobs = tree.tree.filter((entry) => entry.type === "blob" && entry.path.endsWith("/SKILL.md"));
    const userInstalled = await getInstalledSkillNames("user");
    const projectInstalled = await getInstalledSkillNames("project", projectPath);
    const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const source = {
        label: repo,
        repo,
        skillsPath: "",
    };
    return skillBlobs.map((blob) => {
        // Derive skill name from parent directory of SKILL.md
        const parts = blob.path.split("/");
        const name = parts[parts.length - 2]; // e.g. "huggingface-datasets"
        const repoPath = blob.path; // e.g. "skills/huggingface-datasets/SKILL.md"
        const slug = slugify(name);
        const isUser = userInstalled.has(slug) || userInstalled.has(name);
        const isProj = projectInstalled.has(slug) || projectInstalled.has(name);
        const installed = isUser || isProj;
        const installedScope = isProj
            ? "project"
            : isUser
                ? "user"
                : null;
        return {
            id: `${repo}/${blob.path.replace("/SKILL.md", "")}`,
            name,
            source,
            repoPath,
            gitBlobSha: blob.sha,
            frontmatter: null,
            installed,
            installedScope,
            hasUpdate: false,
            description: "",
        };
    });
}
// ─── Frontmatter parser ───────────────────────────────────────────────────────
function parseYamlFrontmatter(content) {
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatterMatch)
        return {};
    const yaml = frontmatterMatch[1];
    const result = {};
    for (const line of yaml.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1)
            continue;
        const key = line.slice(0, colonIdx).trim();
        const rawValue = line.slice(colonIdx + 1).trim();
        if (!key)
            continue;
        // Handle arrays (simple inline: [a, b, c])
        if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
            const items = rawValue
                .slice(1, -1)
                .split(",")
                .map((s) => s.trim().replace(/^["']|["']$/g, ""))
                .filter(Boolean);
            result[key] = items;
        }
        else {
            // Strip quotes
            result[key] = rawValue.replace(/^["']|["']$/g, "");
        }
    }
    return result;
}
export async function fetchSkillFrontmatter(skill) {
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
export async function getInstalledSkillNames(scope, projectPath) {
    const dir = scope === "user"
        ? getUserSkillsDir()
        : getProjectSkillsDir(projectPath);
    const installed = new Set();
    try {
        if (!(await fs.pathExists(dir)))
            return installed;
        const entries = await fs.readdir(dir);
        for (const entry of entries) {
            const skillMd = path.join(dir, entry, "SKILL.md");
            if (await fs.pathExists(skillMd)) {
                installed.add(entry);
            }
        }
    }
    catch {
        // ignore
    }
    return installed;
}
// ─── Firebase Skills API ──────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapApiSkillToSkillInfo(raw) {
    const repo = raw.repo || "unknown";
    const skillPath = raw.skillPath || raw.name || "";
    const source = {
        label: repo,
        repo,
        skillsPath: "",
    };
    const stars = typeof raw.stars === "number" ? raw.stars : undefined;
    return {
        id: `${repo}/${skillPath}`,
        name: raw.name || skillPath,
        description: raw.description || "",
        source,
        repoPath: skillPath ? `${skillPath}/SKILL.md` : "SKILL.md",
        gitBlobSha: "",
        frontmatter: null,
        installed: false,
        installedScope: null,
        hasUpdate: false,
        stars,
        starReliability: classifyStarReliability(repo, stars),
    };
}
export async function fetchPopularSkills(limit = 30) {
    try {
        const res = await fetch(`${SKILLS_API_BASE}/search?q=development&limit=${limit}&sortBy=stars`, { signal: AbortSignal.timeout(10000) });
        if (!res.ok)
            return [];
        const data = (await res.json());
        return (data.skills || []).map(mapApiSkillToSkillInfo);
    }
    catch {
        return [];
    }
}
// ─── Fetch available skills ───────────────────────────────────────────────────
export async function fetchAvailableSkills(_repos, projectPath) {
    const userInstalled = await getInstalledSkillNames("user");
    const projectInstalled = await getInstalledSkillNames("project", projectPath);
    const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const markInstalled = (skill) => {
        const slug = slugify(skill.name);
        const isUserInstalled = userInstalled.has(slug) || userInstalled.has(skill.name);
        const isProjInstalled = projectInstalled.has(slug) || projectInstalled.has(skill.name);
        const installed = isUserInstalled || isProjInstalled;
        const installedScope = isProjInstalled
            ? "project"
            : isUserInstalled
                ? "user"
                : null;
        return { ...skill, installed, installedScope };
    };
    // 1. Recommended skills from RECOMMENDED_SKILLS constant (no API call)
    const recommendedSkills = RECOMMENDED_SKILLS.map((rec) => {
        const source = {
            label: rec.repo,
            repo: rec.repo,
            skillsPath: "",
        };
        const skill = {
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
            starReliability: classifyStarReliability(rec.repo, rec.stars),
        };
        return markInstalled(skill);
    });
    // 2. Fetch popular skills from Firebase API
    const popular = await fetchPopularSkills(30);
    const popularSkills = popular.map((s) => markInstalled({ ...s, isRecommended: false }));
    // 3. Enrich recommended skills with GitHub repo stars (cached to disk)
    const starsCachePath = path.join(os.homedir(), ".claude", "skill-stars-cache.json");
    let starsCache = {};
    try {
        starsCache = await fs.readJson(starsCachePath);
    }
    catch { /* no cache yet */ }
    const uniqueRepos = [...new Set(recommendedSkills.map((s) => s.source.repo))];
    const repoStars = new Map();
    const cacheMaxAge = 24 * 60 * 60 * 1000; // 24 hours
    let cacheUpdated = false;
    for (const repo of uniqueRepos) {
        const cached = starsCache[repo];
        if (cached && Date.now() - new Date(cached.fetchedAt).getTime() < cacheMaxAge) {
            repoStars.set(repo, cached.stars);
            continue;
        }
        // Try fetching from GitHub (may be rate limited)
        try {
            const res = await fetch(`https://api.github.com/repos/${repo}`, {
                headers: { Accept: "application/vnd.github+json" },
                signal: AbortSignal.timeout(5000),
            });
            if (res.ok) {
                const data = (await res.json());
                if (data.stargazers_count) {
                    repoStars.set(repo, data.stargazers_count);
                    starsCache[repo] = { stars: data.stargazers_count, fetchedAt: new Date().toISOString() };
                    cacheUpdated = true;
                }
            }
            else if (cached) {
                // Rate limited but have stale cache — use it
                repoStars.set(repo, cached.stars);
            }
        }
        catch {
            if (cached)
                repoStars.set(repo, cached.stars);
        }
    }
    if (cacheUpdated) {
        try {
            await fs.writeJson(starsCachePath, starsCache);
        }
        catch { /* ignore */ }
    }
    for (const rec of recommendedSkills) {
        rec.stars = repoStars.get(rec.source.repo) || rec.stars || undefined;
    }
    // 4. Combine: recommended first, then popular (dedup by name)
    const seen = new Set(recommendedSkills.map((s) => s.name));
    const deduped = popularSkills.filter((s) => !seen.has(s.name));
    return [...recommendedSkills, ...deduped];
}
// ─── Install / Uninstall ──────────────────────────────────────────────────────
export async function installSkill(skill, scope, projectPath) {
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
    let content = null;
    for (const url of candidates) {
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
            if (response.ok) {
                content = await response.text();
                break;
            }
        }
        catch {
            continue;
        }
    }
    if (!content) {
        throw new Error(`Failed to fetch skill: SKILL.md not found in ${repo}/${repoPath}`);
    }
    // Use slug for directory name — display names can have slashes/spaces
    const dirName = skill.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const installDir = scope === "user"
        ? path.join(getUserSkillsDir(), dirName)
        : path.join(getProjectSkillsDir(projectPath), dirName);
    await fs.ensureDir(installDir);
    await fs.writeFile(path.join(installDir, "SKILL.md"), content, "utf8");
}
export async function uninstallSkill(skillName, scope, projectPath) {
    const dirName = skillName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const installDir = scope === "user"
        ? path.join(getUserSkillsDir(), dirName)
        : path.join(getProjectSkillsDir(projectPath), dirName);
    const skillMdPath = path.join(installDir, "SKILL.md");
    if (await fs.pathExists(skillMdPath)) {
        await fs.remove(skillMdPath);
    }
    // Try to remove directory if empty
    try {
        await fs.rmdir(installDir);
    }
    catch {
        // Ignore if not empty or doesn't exist
    }
}
// ─── Check installed skills from file system ──────────────────────────────────
export async function getInstalledSkillsFromFs(projectPath) {
    const result = [];
    const userDir = getUserSkillsDir();
    const projDir = getProjectSkillsDir(projectPath);
    const scopedDirs = [
        [userDir, "user"],
        [projDir, "project"],
    ];
    for (const [dir, scope] of scopedDirs) {
        try {
            if (!(await fs.pathExists(dir)))
                continue;
            const entries = await fs.readdir(dir);
            for (const entry of entries) {
                const skillMd = path.join(dir, entry, "SKILL.md");
                if (await fs.pathExists(skillMd)) {
                    result.push({ name: entry, scope });
                }
            }
        }
        catch {
            // ignore
        }
    }
    return result;
}
