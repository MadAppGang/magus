import type {
	Marketplace,
	McpServer,
	StatusLineConfig,
	ProfileEntry,
	SkillInfo,
} from "../../types/index.js";
import type { PluginInfo } from "../../services/plugin-manager.js";

// ============================================================================
// Route Types
// ============================================================================

export type Screen =
	| "plugins"
	| "mcp"
	| "mcp-registry"
	| "settings"
	| "cli-tools"
	| "model-selector"
	| "profiles"
	| "skills";

export type Route =
	| { screen: "plugins" }
	| { screen: "mcp" }
	| { screen: "mcp-registry"; query?: string }
	| { screen: "settings" }
	| { screen: "cli-tools" }
	| { screen: "model-selector" }
	| { screen: "profiles" }
	| { screen: "skills" };

// ============================================================================
// Async Data Types
// ============================================================================

export type AsyncData<T> =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "success"; data: T }
	| { status: "error"; error: Error };

// ============================================================================
// Modal Types
// ============================================================================

export interface SelectOption {
	label: string;
	value: string;
	description?: string;
}

export type ModalState =
	| {
			type: "confirm";
			title: string;
			message: string;
			onConfirm: () => void;
			onCancel: () => void;
	  }
	| {
			type: "input";
			title: string;
			label: string;
			defaultValue?: string;
			onSubmit: (value: string) => void;
			onCancel: () => void;
	  }
	| {
			type: "select";
			title: string;
			message: string;
			options: SelectOption[];
			defaultIndex?: number;
			onSelect: (value: string) => void;
			onCancel: () => void;
	  }
	| {
			type: "message";
			title: string;
			message: string;
			variant: "info" | "success" | "error";
			onDismiss: () => void;
	  }
	| {
			type: "loading";
			message: string;
	  };

// ============================================================================
// Progress Types
// ============================================================================

export interface ProgressState {
	message: string;
	current?: number;
	total?: number;
}

// ============================================================================
// Screen State Types
// ============================================================================

export interface PluginsScreenState {
	scope: "project" | "global";
	collapsedMarketplaces: Set<string>;
	selectedIndex: number;
	searchQuery: string;
	marketplaces: AsyncData<Marketplace[]>;
	plugins: AsyncData<PluginInfo[]>;
}

export interface McpScreenState {
	selectedIndex: number;
	servers: AsyncData<McpServer[]>;
	installedServers: Record<string, boolean>;
}

export interface McpRegistryScreenState {
	searchQuery: string;
	selectedIndex: number;
	servers: AsyncData<McpServer[]>;
}

export interface StatusLineScreenState {
	scope: "project" | "global";
	selectedIndex: number;
	presets: AsyncData<StatusLineConfig[]>;
	currentPreset: string | null;
}

export interface ScopedSettingValues {
	user: string | undefined;
	project: string | undefined;
}

export interface SettingsScreenState {
	selectedIndex: number;
	values: AsyncData<Map<string, ScopedSettingValues>>;
}

export interface CliTool {
	name: string;
	displayName: string;
	description: string;
	installCommand: string;
	checkCommand: string;
	homebrewFormula?: string;
	npmPackage?: string;
	installedVersion?: string;
	latestVersion?: string;
	hasUpdate?: boolean;
	isInstalled: boolean;
	isChecking: boolean;
}

export interface CliToolsScreenState {
	selectedIndex: number;
	tools: AsyncData<CliTool[]>;
}

export interface ModelSelectorScreenState {
	selectedIndex: number;
	searchQuery: string;
	taskSize: "large" | "small";
}

export interface ProfilesScreenState {
	selectedIndex: number;
	profiles: AsyncData<ProfileEntry[]>;
}

export interface SkillsScreenState {
	scope: "user" | "project";
	selectedIndex: number;
	searchQuery: string;
	/** Available skills from Tree API, cross-referenced with lock files */
	skills: AsyncData<SkillInfo[]>;
	/** Null until check completes; then Map<skillName, hasUpdate> */
	updateStatus: Map<string, boolean> | null;
}

// ============================================================================
// App State
// ============================================================================

export interface AppState {
	// Navigation
	currentRoute: Route;

	// Project context
	projectPath: string;

	// Global UI state
	modal: ModalState | null;
	progress: ProgressState | null;
	isSearching: boolean;

	// Refresh counter - incremented when marketplace sync completes
	// Screens can watch this to know when to refetch data
	dataRefreshVersion: number;

	// Screen-specific state
	plugins: PluginsScreenState;
	mcp: McpScreenState;
	mcpRegistry: McpRegistryScreenState;
	statusline: StatusLineScreenState;
	settings: SettingsScreenState;
	cliTools: CliToolsScreenState;
	modelSelector: ModelSelectorScreenState;
	profiles: ProfilesScreenState;
	skills: SkillsScreenState;
}

// ============================================================================
// Action Types
// ============================================================================

export type AppAction =
	// Navigation
	| { type: "NAVIGATE"; route: Route }

	// Plugins screen
	| { type: "PLUGINS_SET_SCOPE"; scope: "project" | "global" }
	| { type: "PLUGINS_TOGGLE_SCOPE" }
	| { type: "PLUGINS_TOGGLE_MARKETPLACE"; name: string }
	| { type: "PLUGINS_SELECT"; index: number }
	| { type: "PLUGINS_SET_SEARCH"; query: string }
	| { type: "PLUGINS_DATA_LOADING" }
	| {
			type: "PLUGINS_DATA_SUCCESS";
			marketplaces: Marketplace[];
			plugins: PluginInfo[];
	  }
	| { type: "PLUGINS_DATA_ERROR"; error: Error }

	// MCP screen
	| { type: "MCP_SELECT"; index: number }
	| { type: "MCP_DATA_LOADING" }
	| {
			type: "MCP_DATA_SUCCESS";
			servers: McpServer[];
			installedServers: Record<string, boolean>;
	  }
	| { type: "MCP_DATA_ERROR"; error: Error }

	// MCP Registry screen
	| { type: "MCP_REGISTRY_SET_QUERY"; query: string }
	| { type: "MCPREGISTRY_SEARCH"; query: string } // Alias for MCP_REGISTRY_SET_QUERY
	| { type: "MCPREGISTRY_SELECT"; index: number } // Alias for MCP_REGISTRY_SELECT
	| { type: "MCP_REGISTRY_SELECT"; index: number }
	| { type: "MCP_REGISTRY_DATA_LOADING" }
	| { type: "MCP_REGISTRY_DATA_SUCCESS"; servers: McpServer[] }
	| { type: "MCP_REGISTRY_DATA_ERROR"; error: Error }

	// Status line screen
	| { type: "STATUSLINE_SET_SCOPE"; scope: "project" | "global" }
	| { type: "STATUSLINE_TOGGLE_SCOPE" }
	| { type: "STATUSLINE_SELECT"; index: number }
	| { type: "STATUSLINE_DATA_LOADING" }
	| {
			type: "STATUSLINE_DATA_SUCCESS";
			presets: StatusLineConfig[];
			currentPreset: string | null;
	  }
	| { type: "STATUSLINE_DATA_ERROR"; error: Error }

	// Settings screen
	| { type: "SETTINGS_SELECT"; index: number }
	| { type: "SETTINGS_DATA_LOADING" }
	| { type: "SETTINGS_DATA_SUCCESS"; values: Map<string, ScopedSettingValues> }
	| { type: "SETTINGS_DATA_ERROR"; error: Error }

	// CLI tools screen
	| { type: "CLITOOLS_SELECT"; index: number }
	| { type: "CLITOOLS_DATA_LOADING" }
	| { type: "CLITOOLS_DATA_SUCCESS"; tools: CliTool[] }
	| { type: "CLITOOLS_DATA_ERROR"; error: Error }
	| { type: "CLITOOLS_UPDATE_TOOL"; name: string; updates: Partial<CliTool> }

	// Model Selector Screen
	| { type: "MODEL_SELECTOR_SELECT"; index: number }
	| { type: "MODEL_SELECTOR_SET_SEARCH"; query: string }
	| { type: "MODEL_SELECTOR_SET_TASK_SIZE"; size: "large" | "small" }

	// Modals
	| { type: "SHOW_MODAL"; modal: ModalState }
	| { type: "HIDE_MODAL" }

	// Progress
	| { type: "SHOW_PROGRESS"; state: ProgressState }
	| { type: "UPDATE_PROGRESS"; state: ProgressState }
	| { type: "HIDE_PROGRESS" }

	// Search state (blocks global key handlers)
	| { type: "SET_SEARCHING"; isSearching: boolean }

	// Profiles screen
	| { type: "PROFILES_SELECT"; index: number }
	| { type: "PROFILES_DATA_LOADING" }
	| { type: "PROFILES_DATA_SUCCESS"; profiles: ProfileEntry[] }
	| { type: "PROFILES_DATA_ERROR"; error: Error }

	// Skills screen
	| { type: "SKILLS_SET_SCOPE"; scope: "user" | "project" }
	| { type: "SKILLS_TOGGLE_SCOPE" }
	| { type: "SKILLS_SELECT"; index: number }
	| { type: "SKILLS_SET_SEARCH"; query: string }
	| { type: "SKILLS_DATA_LOADING" }
	| { type: "SKILLS_DATA_SUCCESS"; skills: SkillInfo[] }
	| { type: "SKILLS_DATA_ERROR"; error: Error }
	| { type: "SKILLS_UPDATE_STATUS"; updates: Map<string, boolean> }
	| { type: "SKILLS_UPDATE_ITEM"; name: string; updates: Partial<SkillInfo> }

	// Data refresh - triggers screens to refetch
	| { type: "DATA_REFRESH_COMPLETE" };
