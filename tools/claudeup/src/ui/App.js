import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useEffect, useState } from "react";
import { useRenderer } from "@opentui/react";
import fs from "node:fs";
import { AppProvider, useApp, useNavigation, useModal, } from "./state/AppContext.js";
import { DimensionsProvider, useDimensions, } from "./state/DimensionsContext.js";
import { ModalContainer } from "./components/modals/index.js";
import { PluginsScreen, McpScreen, McpRegistryScreen, SettingsScreen, CliToolsScreen, ModelSelectorScreen, ProfilesScreen, SkillsScreen, } from "./screens/index.js";
import { repairAllMarketplaces } from "../services/local-marketplace.js";
import { migrateMarketplaceRename } from "../services/claude-settings.js";
import { checkForUpdates, getCurrentVersion, } from "../services/version-check.js";
import { useKeyboardHandler } from "./hooks/useKeyboardHandler.js";
import { ProgressBar } from "./components/layout/ProgressBar.js";
export const VERSION = getCurrentVersion();
/**
 * Router Component
 * Renders the current screen based on route
 */
function Router() {
    const { state } = useApp();
    const { currentRoute } = state;
    switch (currentRoute.screen) {
        case "plugins":
            return _jsx(PluginsScreen, {});
        case "mcp":
            return _jsx(McpScreen, {});
        case "mcp-registry":
            return _jsx(McpRegistryScreen, {});
        case "settings":
            return _jsx(SettingsScreen, {});
        case "cli-tools":
            return _jsx(CliToolsScreen, {});
        case "model-selector":
            return _jsx(ModelSelectorScreen, {});
        case "profiles":
            return _jsx(ProfilesScreen, {});
        case "skills":
            return _jsx(SkillsScreen, {});
        default:
            return _jsx(PluginsScreen, {});
    }
}
/**
 * GlobalKeyHandler Component
 * Handles global keyboard shortcuts (1-5, Tab, Escape, q, ?, Shift+D)
 * Does not render anything (returns null)
 */
function GlobalKeyHandler({ onDebugToggle, onExit, }) {
    const { state } = useApp();
    const { navigateToScreen } = useNavigation();
    const modal = useModal();
    const renderer = useRenderer();
    useKeyboardHandler((input, key) => {
        // Debug key (Shift+D) - always available
        if (input === "D" && key.shift) {
            onDebugToggle();
            // Write debug info to file
            const debugInfo = {
                timestamp: new Date().toISOString(),
                terminal: { rows: renderer.height, columns: renderer.width },
                state: {
                    currentRoute: state.currentRoute,
                    isSearching: state.isSearching,
                    modal: state.modal ? { type: state.modal.type } : null,
                    plugins: {
                        scope: state.plugins.scope,
                        selectedIndex: state.plugins.selectedIndex,
                        searchQuery: state.plugins.searchQuery,
                        marketplacesStatus: state.plugins.marketplaces.status,
                        pluginsStatus: state.plugins.plugins.status,
                    },
                },
            };
            fs.writeFileSync("/tmp/claudeup-debug.json", JSON.stringify(debugInfo, null, 2));
            return;
        }
        // Don't handle keys when modal is open or searching
        if (state.modal || state.isSearching)
            return;
        // Global navigation shortcuts (1-5) - include mcp-registry as it's a sub-screen of mcp
        const isTopLevel = [
            "plugins",
            "mcp",
            "mcp-registry",
            "settings",
            "cli-tools",
            "model-selector",
            "profiles",
            "skills",
        ].includes(state.currentRoute.screen);
        if (isTopLevel) {
            if (input === "1")
                navigateToScreen("plugins");
            else if (input === "2")
                navigateToScreen("skills");
            else if (input === "3")
                navigateToScreen("mcp");
            else if (input === "4")
                navigateToScreen("settings");
            else if (input === "5")
                navigateToScreen("profiles");
            else if (input === "6")
                navigateToScreen("cli-tools");
            // Tab navigation cycling
            if (key.tab) {
                const screens = [
                    "plugins",
                    "skills",
                    "mcp",
                    "settings",
                    "profiles",
                    "cli-tools",
                ];
                const currentIndex = screens.indexOf(state.currentRoute.screen);
                if (currentIndex !== -1) {
                    const nextIndex = key.shift
                        ? (currentIndex - 1 + screens.length) % screens.length
                        : (currentIndex + 1) % screens.length;
                    navigateToScreen(screens[nextIndex]);
                }
            }
        }
        // Escape/q to go back or exit
        if (key.escape || input === "q") {
            if (state.currentRoute.screen === "plugins") {
                // On home screen, exit immediately
                onExit();
            }
            else if (state.currentRoute.screen === "mcp-registry") {
                // Go back to MCP from registry
                navigateToScreen("mcp");
            }
            else {
                // Go back to plugins (home)
                navigateToScreen("plugins");
            }
        }
        // ? for help
        if (input === "?") {
            modal.message("claudeup Help", `Navigation
  ↑/↓ or j/k    Move selection
  Enter         Select / Toggle
  Escape or q   Back / Quit
  ?             This help

Quick Navigation
  1  Plugins      4  Settings
  2  Skills       5  Profiles
  3  MCP Servers  6  CLI Tools

Plugin Actions
  u  Update        d  Uninstall
  a  Update All    r  Refresh

MCP Servers
  /  Search local + remote
  r  Browse MCP registry`, "info");
        }
    });
    return null;
}
/**
 * UpdateBanner Component
 * Shows version update notification
 */
function UpdateBanner({ result }) {
    if (!result.updateAvailable)
        return null;
    return (_jsxs("box", { paddingLeft: 1, paddingRight: 1, children: [_jsx("text", { bg: "yellow", fg: "black", children: _jsx("strong", { children: " UPDATE " }) }), _jsxs("text", { fg: "yellow", children: [" ", "v", result.currentVersion, " \u2192 v", result.latestVersion] }), _jsx("text", { fg: "gray", children: " Run: " }), _jsx("text", { fg: "cyan", children: "npm i -g claudeup" })] }));
}
/**
 * ProgressIndicator Component
 * Shows progress bar when operations are running
 */
function ProgressIndicator({ message, current, total, }) {
    return (_jsx("box", { paddingLeft: 1, paddingRight: 1, children: _jsx(ProgressBar, { message: message, current: current, total: total }) }));
}
function AppContentInner({ showDebug, onDebugToggle, updateInfo, onExit, }) {
    const { state, dispatch } = useApp();
    const { progress } = state;
    const dimensions = useDimensions();
    // Auto-refresh marketplaces on startup
    useEffect(() => {
        const noRefresh = process.argv.includes("--no-refresh");
        if (noRefresh)
            return;
        dispatch({
            type: "SHOW_PROGRESS",
            state: { message: "Scanning marketplaces..." },
        });
        // Migrate old marketplace names → magus (idempotent), then repair plugin.json files
        migrateMarketplaceRename().catch(() => { }); // non-blocking, best-effort
        repairAllMarketplaces()
            .then(async () => {
            dispatch({ type: "HIDE_PROGRESS" });
            dispatch({ type: "DATA_REFRESH_COMPLETE" });
        })
            .catch(() => {
            dispatch({ type: "HIDE_PROGRESS" });
        });
    }, [dispatch]);
    return (_jsxs("box", { flexDirection: "column", height: dimensions.terminalHeight, children: [updateInfo?.updateAvailable && _jsx(UpdateBanner, { result: updateInfo }), showDebug && (_jsx("box", { paddingLeft: 1, paddingRight: 1, children: _jsxs("text", { fg: "#888888", children: ["DEBUG: ", dimensions.terminalWidth, "x", dimensions.terminalHeight, " | content=", dimensions.contentHeight, " | screen=", state.currentRoute.screen] }) })), progress && _jsx(ProgressIndicator, { ...progress }), _jsx("box", { flexDirection: "column", height: dimensions.contentHeight, paddingLeft: 1, paddingRight: 1, children: _jsx(Router, {}) }), _jsx(GlobalKeyHandler, { onDebugToggle: onDebugToggle, onExit: onExit }), _jsx(ModalContainer, {})] }));
}
function AppContent({ onExit }) {
    const { state } = useApp();
    const { progress } = state;
    const [showDebug, setShowDebug] = useState(false);
    const [updateInfo, setUpdateInfo] = useState(null);
    // Check for updates on startup (non-blocking)
    useEffect(() => {
        checkForUpdates()
            .then(setUpdateInfo)
            .catch(() => { });
    }, []);
    return (_jsx(DimensionsProvider, { showProgress: !!progress, showDebug: showDebug, showUpdateBanner: !!updateInfo?.updateAvailable, children: _jsx(AppContentInner, { showDebug: showDebug, onDebugToggle: () => setShowDebug((s) => !s), updateInfo: updateInfo, onExit: onExit }) }));
}
export function App({ onExit }) {
    return (_jsx(AppProvider, { children: _jsx(AppContent, { onExit: onExit }) }));
}
export default App;
