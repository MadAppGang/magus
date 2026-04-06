export interface McpServer {
	name: string;
	description: string;
	// Command-based MCP server
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	// HTTP-based MCP server
	type?: "http";
	url?: string;
	// Common fields
	category:
		| "browser"
		| "ai"
		| "design"
		| "dev-tools"
		| "cloud"
		| "database"
		| "productivity"
		| "seo";
	requiresConfig?: boolean;
	configFields?: ConfigField[];
}

export interface ConfigField {
	name: string;
	label: string;
	type: "string" | "path" | "url" | "boolean";
	required: boolean;
	default?: string;
	envVar?: string;
}

export interface Marketplace {
	name: string;
	displayName: string;
	source: {
		source: "github";
		repo: string;
	};
	description: string;
	official?: boolean;
	featured?: boolean; // Featured marketplaces have plugins fetched by default (like official)
}

export interface DiscoveredMarketplace {
	name: string;
	source: "default" | "configured" | "inferred";
	config?: MarketplaceSource;
}

export interface Plugin {
	name: string;
	version: string;
	description: string;
	marketplace: string;
	installed: boolean;
	availableVersion?: string;
	hasUpdate?: boolean;
}

export interface StatusLineConfig {
	name: string;
	description: string;
	template: string;
}

export interface MarketplaceSource {
	source: {
		source: "github";
		repo: string;
	};
	autoUpdate?: boolean; // Enable auto-update for this marketplace (default: true for new marketplaces)
}

export interface ClaudeHookEntry {
	type: string;
	command: string;
}

export interface ClaudeHookGroup {
	hooks: ClaudeHookEntry[];
}

export interface ClaudeSettings {
	enabledMcpServers?: Record<string, boolean>;
	mcpServers?: Record<string, McpServerConfig>;
	enabledPlugins?: Record<string, boolean>;
	extraKnownMarketplaces?: Record<string, MarketplaceSource>;
	installedPluginVersions?: Record<string, string>;
	statusLine?: string | { type: string; template?: string; command?: string };
	hooks?: Record<string, ClaudeHookGroup[]>;
}

export interface McpServerConfig {
	// Command-based
	command?: string;
	args?: string[];
	env?: Record<string, string>;
	// HTTP-based
	type?: "http";
	url?: string;
}

export interface ClaudeLocalSettings extends ClaudeSettings {
	allowMcp?: boolean;
	enabledMcpjsonServers?: string[];
	enableAllProjectMcpServers?: boolean;
	env?: Record<string, string>;
}

export type Screen =
	| "main"
	| "mcp"
	| "mcp-registry"
	| "plugins"
	| "statusline"
	| "cli-tools"
	| "env-vars"
	| "skills";

// ─── Skill Types ──────────────────────────────────────────────────────────────

/** A configured skill repository (entry in skill-repos.ts) */
export interface SkillSource {
	/** Human-readable label, e.g. "vercel-labs/agent-skills" */
	label: string;
	/** GitHub owner/repo, e.g. "vercel-labs/agent-skills" */
	repo: string;
	/** Sub-path within the repo where skills live, e.g. "skills" */
	skillsPath: string;
}

/** YAML frontmatter extracted from a SKILL.md file */
export interface SkillFrontmatter {
	name: string;
	description: string;
	category?: string;
	author?: string;
	version?: string;
	tags?: string[];
	[key: string]: unknown;
}

/** A skill entry from the available-skills list (may or may not be installed) */
export interface SkillInfo {
	/** Unique key: "{owner}/{repo}/{path}" */
	id: string;
	/** Slug used as directory name: last segment of path */
	name: string;
	/** Source repo this skill comes from */
	source: SkillSource;
	/** Relative path within repo, e.g. "skills/researcher/SKILL.md" */
	repoPath: string;
	/** Git blob SHA from Tree API response */
	gitBlobSha: string;
	/** Parsed frontmatter (null if not yet fetched) */
	frontmatter: SkillFrontmatter | null;
	/** Whether the skill is installed (either scope) */
	installed: boolean;
	/** Scope of the installed copy */
	installedScope: "user" | "project" | null;
	/** True when lock file SHA differs from Tree API SHA */
	hasUpdate: boolean;
	/** Whether this is a recommended skill */
	isRecommended?: boolean;
	/** GitHub star count from the skills API */
	stars?: number;
	/** Short description (from API, before frontmatter is loaded) */
	description?: string;
	/** How reliable the star count is as a quality signal for this skill */
	starReliability?: "dedicated" | "mega-repo" | "skill-dump";
}

/** How reliable the star count is as a quality signal for this skill */
export type StarReliability = "dedicated" | "mega-repo" | "skill-dump";

/** A skill set — a group of skills from a single repo */
export interface SkillSetInfo {
	/** Unique key, e.g. "huggingface/skills" */
	id: string;
	/** Display name, e.g. "Hugging Face" */
	name: string;
	/** Repo description */
	description: string;
	/** GitHub owner/repo */
	repo: string;
	/** Icon/emoji for display */
	icon: string;
	/** GitHub star count */
	stars?: number;
	/** Individual skills within this set (fetched lazily via Tree API) */
	skills: SkillInfo[];
	/** Whether skills have been fetched yet */
	loaded: boolean;
	/** Loading state */
	loading: boolean;
	/** Error if fetch failed */
	error?: string;
}

// ─── GitHub Tree API types ────────────────────────────────────────────────────

export interface GitTreeItem {
	path: string;
	mode: string;
	type: "blob" | "tree";
	sha: string;
	size?: number;
	url: string;
}

export interface GitTreeResponse {
	sha: string;
	url: string;
	tree: GitTreeItem[];
	truncated: boolean;
}

// MCP Registry Types (registry.modelcontextprotocol.io)
export interface McpRegistryServer {
	name: string;
	url: string;
	short_description: string;
	version?: string;
	source_code_url?: string;
	package_registry?: string;
	published_at?: string;
}

export interface McpRegistryResponse {
	servers: McpRegistryServer[];
	next_cursor?: string;
}

// installed_plugins.json registry types
export interface InstalledPluginEntry {
	scope: "user" | "project" | "local";
	projectPath?: string;
	installPath: string;
	version: string;
	installedAt: string;
	lastUpdated: string;
	gitCommitSha?: string;
}

export interface InstalledPluginsRegistry {
	version: number;
	plugins: Record<string, InstalledPluginEntry[]>;
}

// ─── Plugin Profile Types ──────────────────────────────────────────────────────

export interface Profile {
	name: string;
	plugins: Record<string, boolean>;
	createdAt: string;
	updatedAt: string;
}

export interface ProfilesFile {
	version: number;
	profiles: Record<string, Profile>;
}

/** A profile with its id and scope, as used in UI lists */
export interface ProfileEntry {
	id: string;
	name: string;
	plugins: Record<string, boolean>;
	createdAt: string;
	updatedAt: string;
	scope: "user" | "project";
}

// ─── Predefined Profile Types ──────────────────────────────────────────────────

/** A skill reference for predefined profiles */
export interface PredefinedSkill {
	name: string;
	repo: string;
	skillPath: string;
}

/** Settings that can be configured in a predefined profile */
export interface PredefinedSettings {
	effortLevel?: "low" | "medium" | "high";
	alwaysThinkingEnabled?: boolean;
	model?: "claude-sonnet-4-6" | "claude-opus-4-6";
	outputStyle?: "concise" | "explanatory" | "formal";
	CLAUDE_CODE_ENABLE_TASKS?: boolean;
	CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS?: boolean;
	includeGitInstructions?: boolean;
	respectGitignore?: boolean;
	enableAllProjectMcpServers?: boolean;
}

/** A predefined (built-in) profile for claudeup */
export interface PredefinedProfile {
	id: string;
	name: string;
	description: string;
	targetAudience: string;
	plugins: Record<string, boolean>;
	skills: PredefinedSkill[];
	settings: PredefinedSettings;
}
