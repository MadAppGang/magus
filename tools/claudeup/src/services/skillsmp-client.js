/**
 * Skills API client — calls our Firebase aggregator function
 * instead of hitting SkillsMP/GitHub APIs directly.
 *
 * The Firebase function handles:
 * - SkillsMP keyword + AI search (with server-side API key)
 * - GitHub Tree API with ETag caching
 * - Recommended skills list
 */
// TODO: Update to production URL after Firebase deploy
const SKILLS_API_BASE = process.env.SKILLS_API_URL || "https://us-central1-claudish-6da10.cloudfunctions.net/skills";
/**
 * Search skills across all sources (SkillsMP keyword + AI search)
 */
export async function searchSkills(query, options) {
    const params = new URLSearchParams({ q: query });
    if (options?.page)
        params.set("page", String(options.page));
    if (options?.limit)
        params.set("limit", String(options.limit));
    try {
        const res = await fetch(`${SKILLS_API_BASE}/search?${params}`, {
            signal: AbortSignal.timeout(12000),
        });
        if (!res.ok)
            return [];
        const data = (await res.json());
        return data.skills || [];
    }
    catch {
        return [];
    }
}
/**
 * Fetch skills from a specific GitHub repo (via our proxy)
 */
export async function fetchRepoSkills(owner, repo) {
    try {
        const res = await fetch(`${SKILLS_API_BASE}/repo/${owner}/${repo}`, {
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            return [];
        const data = (await res.json());
        return data.skills || [];
    }
    catch {
        return [];
    }
}
/**
 * Get recommended skills list (curated, server-side)
 */
export async function fetchRecommendedSkills() {
    try {
        const res = await fetch(`${SKILLS_API_BASE}/recommended`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok)
            return [];
        const data = (await res.json());
        return data.skills || [];
    }
    catch {
        return [];
    }
}
