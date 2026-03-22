import type { AppState, AppAction } from "./types.js";

export const initialState: AppState = {
	// Navigation - start on plugins screen
	currentRoute: { screen: "plugins" },

	// Project context
	projectPath: process.cwd(),

	// Global UI state
	modal: null,
	progress: null,
	isSearching: false,

	// Refresh counter for triggering data refetch
	dataRefreshVersion: 0,

	// Screen-specific state
	plugins: {
		scope: "project",
		collapsedMarketplaces: new Set(),
		selectedIndex: 0,
		searchQuery: "",
		marketplaces: { status: "idle" },
		plugins: { status: "idle" },
	},

	mcp: {
		selectedIndex: 0,
		servers: { status: "idle" },
		installedServers: {},
	},

	mcpRegistry: {
		searchQuery: "",
		selectedIndex: 0,
		servers: { status: "idle" },
	},

	statusline: {
		scope: "project",
		selectedIndex: 0,
		presets: { status: "idle" },
		currentPreset: null,
	},

	settings: {
		selectedIndex: 0,
		values: { status: "idle" },
	},

	cliTools: {
		selectedIndex: 0,
		tools: { status: "idle" },
	},

	modelSelector: {
		selectedIndex: 0,
		searchQuery: "",
		taskSize: "large",
	},

	profiles: {
		selectedIndex: 0,
		profiles: { status: "idle" },
	},
};

export function appReducer(state: AppState, action: AppAction): AppState {
	switch (action.type) {
		// =========================================================================
		// Navigation
		// =========================================================================
		case "NAVIGATE":
			return {
				...state,
				currentRoute: action.route,
				// Clear search state when navigating away
				isSearching: false,
			};

		// =========================================================================
		// Plugins Screen
		// =========================================================================
		case "PLUGINS_SET_SCOPE":
			return {
				...state,
				plugins: {
					...state.plugins,
					scope: action.scope,
					selectedIndex: 0, // Reset selection when scope changes
					marketplaces: { status: "loading" },
					plugins: { status: "loading" },
				},
			};

		case "PLUGINS_TOGGLE_SCOPE":
			return appReducer(state, {
				type: "PLUGINS_SET_SCOPE",
				scope: state.plugins.scope === "project" ? "global" : "project",
			});

		case "PLUGINS_TOGGLE_MARKETPLACE": {
			const collapsed = new Set(state.plugins.collapsedMarketplaces);
			if (collapsed.has(action.name)) {
				collapsed.delete(action.name);
			} else {
				collapsed.add(action.name);
			}
			return {
				...state,
				plugins: {
					...state.plugins,
					collapsedMarketplaces: collapsed,
				},
			};
		}

		case "PLUGINS_SELECT":
			return {
				...state,
				plugins: {
					...state.plugins,
					selectedIndex: action.index,
				},
			};

		case "PLUGINS_SET_SEARCH":
			return {
				...state,
				plugins: {
					...state.plugins,
					searchQuery: action.query,
					selectedIndex: 0, // Reset selection when search changes
				},
			};

		case "PLUGINS_DATA_LOADING":
			return {
				...state,
				plugins: {
					...state.plugins,
					marketplaces: { status: "loading" },
					plugins: { status: "loading" },
				},
			};

		case "PLUGINS_DATA_SUCCESS":
			return {
				...state,
				plugins: {
					...state.plugins,
					marketplaces: { status: "success", data: action.marketplaces },
					plugins: { status: "success", data: action.plugins },
				},
			};

		case "PLUGINS_DATA_ERROR":
			return {
				...state,
				plugins: {
					...state.plugins,
					marketplaces: { status: "error", error: action.error },
					plugins: { status: "error", error: action.error },
				},
			};

		// =========================================================================
		// MCP Screen
		// =========================================================================
		case "MCP_SELECT":
			return {
				...state,
				mcp: {
					...state.mcp,
					selectedIndex: action.index,
				},
			};

		case "MCP_DATA_LOADING":
			return {
				...state,
				mcp: {
					...state.mcp,
					servers: { status: "loading" },
				},
			};

		case "MCP_DATA_SUCCESS":
			return {
				...state,
				mcp: {
					...state.mcp,
					servers: { status: "success", data: action.servers },
					installedServers: action.installedServers,
				},
			};

		case "MCP_DATA_ERROR":
			return {
				...state,
				mcp: {
					...state.mcp,
					servers: { status: "error", error: action.error },
				},
			};

		// =========================================================================
		// MCP Registry Screen
		// =========================================================================
		case "MCP_REGISTRY_SET_QUERY":
		case "MCPREGISTRY_SEARCH":
			return {
				...state,
				mcpRegistry: {
					...state.mcpRegistry,
					searchQuery: action.query,
					selectedIndex: 0,
				},
			};

		case "MCP_REGISTRY_SELECT":
		case "MCPREGISTRY_SELECT":
			return {
				...state,
				mcpRegistry: {
					...state.mcpRegistry,
					selectedIndex: action.index,
				},
			};

		case "MCP_REGISTRY_DATA_LOADING":
			return {
				...state,
				mcpRegistry: {
					...state.mcpRegistry,
					servers: { status: "loading" },
				},
			};

		case "MCP_REGISTRY_DATA_SUCCESS":
			return {
				...state,
				mcpRegistry: {
					...state.mcpRegistry,
					servers: { status: "success", data: action.servers },
				},
			};

		case "MCP_REGISTRY_DATA_ERROR":
			return {
				...state,
				mcpRegistry: {
					...state.mcpRegistry,
					servers: { status: "error", error: action.error },
				},
			};

		// =========================================================================
		// Status Line Screen
		// =========================================================================
		case "STATUSLINE_SET_SCOPE":
			return {
				...state,
				statusline: {
					...state.statusline,
					scope: action.scope,
					selectedIndex: 0,
					presets: { status: "loading" },
				},
			};

		case "STATUSLINE_TOGGLE_SCOPE":
			return appReducer(state, {
				type: "STATUSLINE_SET_SCOPE",
				scope: state.statusline.scope === "project" ? "global" : "project",
			});

		case "STATUSLINE_SELECT":
			return {
				...state,
				statusline: {
					...state.statusline,
					selectedIndex: action.index,
				},
			};

		case "STATUSLINE_DATA_LOADING":
			return {
				...state,
				statusline: {
					...state.statusline,
					presets: { status: "loading" },
				},
			};

		case "STATUSLINE_DATA_SUCCESS":
			return {
				...state,
				statusline: {
					...state.statusline,
					presets: { status: "success", data: action.presets },
					currentPreset: action.currentPreset,
				},
			};

		case "STATUSLINE_DATA_ERROR":
			return {
				...state,
				statusline: {
					...state.statusline,
					presets: { status: "error", error: action.error },
				},
			};

		// =========================================================================
		// Settings Screen
		// =========================================================================
		case "SETTINGS_SELECT":
			return {
				...state,
				settings: {
					...state.settings,
					selectedIndex: action.index,
				},
			};

		case "SETTINGS_DATA_LOADING":
			return {
				...state,
				settings: {
					...state.settings,
					values: { status: "loading" },
				},
			};

		case "SETTINGS_DATA_SUCCESS":
			return {
				...state,
				settings: {
					...state.settings,
					values: { status: "success", data: action.values },
				},
			};

		case "SETTINGS_DATA_ERROR":
			return {
				...state,
				settings: {
					...state.settings,
					values: { status: "error", error: action.error },
				},
			};

		// =========================================================================
		// CLI Tools Screen
		// =========================================================================
		case "CLITOOLS_SELECT":
			return {
				...state,
				cliTools: {
					...state.cliTools,
					selectedIndex: action.index,
				},
			};

		case "CLITOOLS_DATA_LOADING":
			return {
				...state,
				cliTools: {
					...state.cliTools,
					tools: { status: "loading" },
				},
			};

		case "CLITOOLS_DATA_SUCCESS":
			return {
				...state,
				cliTools: {
					...state.cliTools,
					tools: { status: "success", data: action.tools },
				},
			};

		case "CLITOOLS_DATA_ERROR":
			return {
				...state,
				cliTools: {
					...state.cliTools,
					tools: { status: "error", error: action.error },
				},
			};

		case "CLITOOLS_UPDATE_TOOL": {
			if (state.cliTools.tools.status !== "success") return state;
			return {
				...state,
				cliTools: {
					...state.cliTools,
					tools: {
						status: "success",
						data: state.cliTools.tools.data.map((tool) =>
							tool.name === action.name ? { ...tool, ...action.updates } : tool,
						),
					},
				},
			};
		}

		// =========================================================================
		// Model Selector Screen
		// =========================================================================
		case "MODEL_SELECTOR_SELECT":
			return {
				...state,
				modelSelector: {
					...state.modelSelector,
					selectedIndex: action.index,
				},
			};

		case "MODEL_SELECTOR_SET_SEARCH":
			return {
				...state,
				modelSelector: {
					...state.modelSelector,
					searchQuery: action.query,
					selectedIndex: 0, // Reset selection when search changes
				},
			};

		case "MODEL_SELECTOR_SET_TASK_SIZE":
			return {
				...state,
				modelSelector: {
					...state.modelSelector,
					taskSize: action.size,
				},
			};

		// =========================================================================
		// Profiles Screen
		// =========================================================================
		case "PROFILES_SELECT":
			return {
				...state,
				profiles: {
					...state.profiles,
					selectedIndex: action.index,
				},
			};

		case "PROFILES_DATA_LOADING":
			return {
				...state,
				profiles: {
					...state.profiles,
					profiles: { status: "loading" },
				},
			};

		case "PROFILES_DATA_SUCCESS":
			return {
				...state,
				profiles: {
					...state.profiles,
					profiles: { status: "success", data: action.profiles },
				},
			};

		case "PROFILES_DATA_ERROR":
			return {
				...state,
				profiles: {
					...state.profiles,
					profiles: { status: "error", error: action.error },
				},
			};

		// =========================================================================
		// Modals
		// =========================================================================
		case "SHOW_MODAL":
			return { ...state, modal: action.modal, isSearching: true };

		case "HIDE_MODAL":
			return { ...state, modal: null, isSearching: false };

		// =========================================================================
		// Progress
		// =========================================================================
		case "SHOW_PROGRESS":
			return { ...state, progress: action.state };

		case "UPDATE_PROGRESS":
			return { ...state, progress: action.state };

		case "HIDE_PROGRESS":
			return { ...state, progress: null };

		// =========================================================================
		// Search State
		// =========================================================================
		case "SET_SEARCHING":
			return { ...state, isSearching: action.isSearching };

		// =========================================================================
		// Data Refresh
		// =========================================================================
		case "DATA_REFRESH_COMPLETE":
			return { ...state, dataRefreshVersion: state.dataRefreshVersion + 1 };

		default:
			return state;
	}
}
