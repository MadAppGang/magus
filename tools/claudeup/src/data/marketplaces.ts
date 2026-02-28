import type { Marketplace } from "../types/index.js";
import type { LocalMarketplace } from "../services/local-marketplace.js";
import { formatMarketplaceName } from "../utils/string-utils.js";

/**
 * Known repo aliases — GitHub redirects the old repo to the new one,
 * so these should be treated as identical for deduplication.
 */
const REPO_ALIASES: Record<string, string> = {
	"madappgang/claude-code": "madappgang/magus",
};

/** Normalize a repo string through known aliases. */
function normalizeRepo(repo: string): string {
	const lower = repo.toLowerCase();
	return REPO_ALIASES[lower] || lower;
}

/**
 * Deprecated marketplace names that should be hidden if the canonical
 * marketplace is already present.  Maps deprecated name → canonical name.
 */
export const deprecatedMarketplaces: Record<string, string> = {
	"mag-claude-plugins": "magus",
};

export const defaultMarketplaces: Marketplace[] = [
	{
		name: "magus",
		displayName: "Magus",
		source: {
			source: "github",
			repo: "MadAppGang/magus",
		},
		description:
			"Professional plugins for frontend, backend, and code analysis",
		official: false,
		featured: true, // Always show plugins (expanded by default)
	},
	{
		name: "claude-plugins-official",
		displayName: "Anthropic Official",
		source: {
			source: "github",
			repo: "anthropics/claude-plugins-official",
		},
		description:
			"Official Anthropic-managed directory of high quality Claude Code plugins",
		official: true,
	},
	{
		name: "claude-code-plugins",
		displayName: "Anthropic Deprecated",
		source: {
			source: "github",
			repo: "anthropics/claude-code",
		},
		description:
			"Legacy demo plugins from Anthropic (deprecated - use Official instead)",
		official: true,
	},
];

export function getMarketplaceByName(name: string): Marketplace | undefined {
	return defaultMarketplaces.find((m) => m.name === name);
}

// Get all available marketplaces from local cache + hardcoded defaults
// Local cache is primary source of truth, defaults are fallback
// Deduplicates by normalized repo URL to avoid showing same marketplace twice
export function getAllMarketplaces(
	localMarketplaces?: Map<string, LocalMarketplace>,
): Marketplace[] {
	const all = new Map<string, Marketplace>();
	const seenRepos = new Set<string>();

	// Primary source: local cache (what's actually cloned)
	if (localMarketplaces) {
		for (const [name, local] of localMarketplaces) {
			const repo = normalizeRepo(local.gitRepo || "");

			// Skip deprecated marketplaces if their canonical replacement exists
			// (or will be added from defaults)
			const canonical = deprecatedMarketplaces[name];
			if (canonical) {
				// If canonical already in the map or in defaults, skip this entry
				if (all.has(canonical) || defaultMarketplaces.some((m) => m.name === canonical)) {
					continue;
				}
			}

			// Skip if another marketplace already claimed this repo URL
			if (repo && seenRepos.has(repo)) continue;
			if (repo) seenRepos.add(repo);

			// Check if this marketplace has defaults (for official/featured flags)
			const defaultMp = defaultMarketplaces.find((m) => m.name === name);

			all.set(name, {
				name,
				// Prefer default displayName over stale local clone data
				displayName: defaultMp?.displayName || local.name || formatMarketplaceName(name),
				source: { source: "github" as const, repo: defaultMp?.source.repo || local.gitRepo || "" },
				description: defaultMp?.description || local.description || "",
				official:
					defaultMp?.official ?? repo.toLowerCase().includes("anthropics/"),
				featured: defaultMp?.featured,
			});
		}
	}

	// Fallback: hardcoded defaults (only if their repo isn't already represented)
	for (const mp of defaultMarketplaces) {
		const repo = normalizeRepo(mp.source.repo || "");
		if (!all.has(mp.name) && !seenRepos.has(repo)) {
			all.set(mp.name, mp);
			if (repo) seenRepos.add(repo);
		}
	}

	// Sort: Magus first, then alphabetically
	return Array.from(all.values()).sort((a, b) => {
		// Magus (MadAppGang) always first
		const aIsMag = a.source.repo?.toLowerCase().includes("madappgang/");
		const bIsMag = b.source.repo?.toLowerCase().includes("madappgang/");
		if (aIsMag && !bIsMag) return -1;
		if (!aIsMag && bIsMag) return 1;
		// Then alphabetically by display name
		return (a.displayName || a.name).localeCompare(b.displayName || b.name);
	});
}
