"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.skills = void 0;
const https_1 = require("firebase-functions/v2/https");
const treeCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
// ---------------------------------------------------------------------------
// Recommended skills (curated)
// ---------------------------------------------------------------------------
const RECOMMENDED_SKILLS = [
    {
        name: "Find Skills",
        repo: "vercel-labs/skills",
        skillPath: "find-skills",
        description: "Discover and install new skills from the ecosystem",
        category: "search",
    },
    {
        name: "React Best Practices",
        repo: "vercel-labs/agent-skills",
        skillPath: "vercel-react-best-practices",
        description: "Modern React patterns for building scalable UI components",
        category: "frontend",
    },
    {
        name: "Next.js App Router",
        repo: "vercel-labs/agent-skills",
        skillPath: "nextjs-app-router",
        description: "Best practices for Next.js App Router with Server Components",
        category: "frontend",
    },
    {
        name: "TypeScript Patterns",
        repo: "vercel-labs/agent-skills",
        skillPath: "typescript-patterns",
        description: "Advanced TypeScript patterns for type-safe codebases",
        category: "languages",
    },
    {
        name: "API Design",
        repo: "MadAppGang/magus",
        skillPath: "plugins/dev/skills/api-design",
        description: "RESTful API design patterns and OpenAPI specification",
        category: "backend",
    },
    {
        name: "TDD Workflow",
        repo: "MadAppGang/magus",
        skillPath: "plugins/terminal/skills/tdd-workflow",
        description: "Test-driven development workflow with red-green-refactor cycle",
        category: "testing",
    },
    {
        name: "Go Backend",
        repo: "MadAppGang/magus",
        skillPath: "plugins/dev/skills/golang",
        description: "Go best practices for building backend services and APIs",
        category: "backend",
    },
    {
        name: "Database Branching",
        repo: "MadAppGang/magus",
        skillPath: "plugins/dev/skills/db-branching",
        description: "Manage database schema changes with git worktree isolation",
        category: "database",
    },
    {
        name: "Terminal Interaction",
        repo: "MadAppGang/magus",
        skillPath: "plugins/terminal/skills/terminal-interaction",
        description: "Intent-level terminal control for running commands and dev servers",
        category: "tooling",
    },
    {
        name: "Release Process",
        repo: "MadAppGang/magus",
        skillPath: "skills/release",
        description: "Plugin release workflow: version bump, commit, tag, and publish",
        category: "devops",
    },
    {
        name: "Mnemex Search",
        repo: "MadAppGang/magus",
        skillPath: "plugins/code-analysis/skills/mnemex-search",
        description: "Semantic code search and AST analysis with mnemex MCP tools",
        category: "code-analysis",
    },
];
// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------
function getSkillsMPKey() {
    return process.env.SKILLSMP_API_KEY || "";
}
function getGitHubToken() {
    return process.env.GITHUB_TOKEN;
}
// ---------------------------------------------------------------------------
// CORS helper
// ---------------------------------------------------------------------------
function setCors(res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
}
/**
 * Parse githubUrl like "https://github.com/owner/repo/tree/main/path/to/skill"
 * into { repo: "owner/repo", skillPath: "path/to/skill" }
 */
function parseGitHubUrl(url) {
    // Match: github.com/{owner}/{repo}/tree/{branch}/{...path}
    const match = url.match(/github\.com\/([^/]+\/[^/]+)\/tree\/[^/]+\/(.+)/);
    if (match) {
        return { repo: match[1], skillPath: match[2] };
    }
    // Match: github.com/{owner}/{repo} (no tree path)
    const repoMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/?$/);
    if (repoMatch) {
        return { repo: repoMatch[1], skillPath: "" };
    }
    return null;
}
function mapSkillsMPResult(raw) {
    const parsed = raw.githubUrl ? parseGitHubUrl(raw.githubUrl) : null;
    return {
        name: raw.name,
        displayName: raw.name,
        repo: parsed?.repo ?? (raw.author ? `${raw.author}/${raw.name}` : undefined),
        skillPath: parsed?.skillPath ?? raw.name,
        description: raw.description,
        source: "skillsmp",
        stars: raw.stars,
    };
}
// ---------------------------------------------------------------------------
// SkillsMP: keyword search
// ---------------------------------------------------------------------------
async function searchSkillsMP(query, page = 1, limit = 20) {
    const apiKey = getSkillsMPKey();
    if (!apiKey)
        return { skills: [], total: 0 };
    const params = new URLSearchParams({
        q: query,
        page: String(page),
        limit: String(limit),
    });
    const res = await fetch(`https://skillsmp.com/api/v1/skills/search?${params}`, {
        headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
        },
        signal: AbortSignal.timeout(10000),
    });
    if (!res.ok)
        return { skills: [], total: 0 };
    const data = await res.json();
    if (!data.success || !data.data?.skills)
        return { skills: [], total: 0 };
    const skills = data.data.skills.map(mapSkillsMPResult);
    return { skills, total: data.data.total ?? skills.length };
}
// ---------------------------------------------------------------------------
// SkillsMP: AI / natural-language search
// ---------------------------------------------------------------------------
async function aiSearchSkillsMP(query) {
    const apiKey = getSkillsMPKey();
    if (!apiKey)
        return [];
    const res = await fetch(`https://skillsmp.com/api/v1/skills/ai-search?q=${encodeURIComponent(query)}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
    });
    if (!res.ok)
        return [];
    const data = await res.json();
    if (!data.success || !data.data)
        return [];
    // AI search returns { data: { data: [{ skill: {...}, score }] } }
    // Keyword search returns { data: { skills: [...] } }
    let rawSkills = [];
    if (data.data.data && Array.isArray(data.data.data)) {
        // AI search format: extract .skill from each result
        rawSkills = data.data.data
            .filter((item) => item.skill)
            .map((item) => item.skill);
    }
    else if (data.data.skills) {
        rawSkills = data.data.skills;
    }
    return rawSkills.map(mapSkillsMPResult);
}
// ---------------------------------------------------------------------------
// GitHub Tree API: list skills in a repo
// ---------------------------------------------------------------------------
async function fetchRepoSkills(owner, repo) {
    const cacheKey = `${owner}/${repo}`;
    const cached = treeCache.get(cacheKey);
    if (cached && cached.expires > Date.now()) {
        return { skills: cached.data, cached: true, treeEtag: cached.etag };
    }
    const headers = {
        Accept: "application/vnd.github+json",
    };
    const ghToken = getGitHubToken();
    if (ghToken)
        headers.Authorization = `Bearer ${ghToken}`;
    if (cached?.etag)
        headers["If-None-Match"] = cached.etag;
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`, { headers, signal: AbortSignal.timeout(10000) });
    // Not Modified — extend TTL and return cached data
    if (res.status === 304 && cached) {
        cached.expires = Date.now() + CACHE_TTL;
        return { skills: cached.data, cached: true, treeEtag: cached.etag };
    }
    if (!res.ok)
        return { skills: [], cached: false, treeEtag: "" };
    const tree = await res.json();
    const etag = res.headers.get("etag") ?? "";
    // Keep only SKILL.md blob entries
    const skillEntries = tree.tree.filter((entry) => entry.type === "blob" && entry.path.endsWith("/SKILL.md"));
    const skills = skillEntries.map((entry) => {
        const parts = entry.path.split("/");
        const skillName = parts[parts.length - 2]; // parent folder name
        return {
            name: skillName,
            skillPath: entry.path.replace("/SKILL.md", ""),
            treeSha: entry.sha,
        };
    });
    treeCache.set(cacheKey, { data: skills, etag, expires: Date.now() + CACHE_TTL });
    return { skills, cached: false, treeEtag: etag };
}
// ---------------------------------------------------------------------------
// Cloud Function — single onRequest handler with path routing
// ---------------------------------------------------------------------------
exports.skills = (0, https_1.onRequest)({
    cors: true,
    region: "us-central1",
    secrets: ["SKILLSMP_API_KEY"],
}, async (req, res) => {
    setCors(res);
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    const path = req.path;
    // -----------------------------------------------------------------------
    // GET /search?q=...&page=1&limit=20
    // -----------------------------------------------------------------------
    if (path === "/search" || path.startsWith("/search?")) {
        const q = req.query.q;
        if (!q) {
            res.status(400).json({ error: "Missing q parameter" });
            return;
        }
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const wordCount = q.trim().split(/\s+/).length;
        const promises = [
            searchSkillsMP(q, page, limit),
        ];
        const sources = ["skillsmp"];
        if (wordCount > 3) {
            promises.push(aiSearchSkillsMP(q));
            sources.push("skillsmp-ai");
        }
        const results = await Promise.allSettled(promises);
        const allSkills = [];
        const seen = new Set();
        for (const result of results) {
            if (result.status !== "fulfilled")
                continue;
            const value = result.value;
            const items = Array.isArray(value)
                ? value
                : value.skills ?? [];
            for (const skill of items) {
                const key = `${skill.repo ?? ""}/${skill.skillPath ?? skill.name}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    allSkills.push(skill);
                }
            }
        }
        res.json({ skills: allSkills, total: allSkills.length, page, sources });
        return;
    }
    // -----------------------------------------------------------------------
    // GET /repo/{owner}/{repo}
    // -----------------------------------------------------------------------
    if (path.startsWith("/repo/")) {
        const remainder = path.replace("/repo/", "");
        const parts = remainder.split("/").filter(Boolean);
        if (parts.length < 2) {
            res.status(400).json({ error: "Expected /repo/{owner}/{repo}" });
            return;
        }
        const [owner, repoName] = parts;
        const result = await fetchRepoSkills(owner, repoName);
        res.json({ repo: `${owner}/${repoName}`, ...result });
        return;
    }
    // -----------------------------------------------------------------------
    // GET /recommended
    // -----------------------------------------------------------------------
    if (path === "/recommended") {
        res.json({ skills: RECOMMENDED_SKILLS });
        return;
    }
    res.status(404).json({
        error: "Not found. Endpoints: /search, /repo/{owner}/{repo}, /recommended",
    });
});
//# sourceMappingURL=index.js.map