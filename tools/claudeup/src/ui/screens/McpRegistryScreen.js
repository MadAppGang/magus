import { jsx as _jsx, jsxs as _jsxs } from "@opentui/react/jsx-runtime";
import { useEffect, useCallback, useState, useRef } from "react";
import { useApp, useModal, useNavigation } from "../state/AppContext.js";
import { useDimensions } from "../state/DimensionsContext.js";
import { useKeyboard } from "../hooks/useKeyboard.js";
import { ScreenLayout } from "../components/layout/index.js";
import { ScrollableList } from "../components/ScrollableList.js";
import { searchMcpServers, formatDate } from "../../services/mcp-registry.js";
import { addMcpServer, setAllowMcp } from "../../services/claude-settings.js";
/**
 * Deduplicate servers by name, keeping only the latest version.
 * Uses version string comparison, falling back to published_at date.
 */
function deduplicateServers(servers) {
    const serverMap = new Map();
    for (const server of servers) {
        const existing = serverMap.get(server.name);
        if (!existing) {
            serverMap.set(server.name, server);
            continue;
        }
        // Compare versions - keep the newer one
        const isNewer = compareVersions(server, existing) > 0;
        if (isNewer) {
            serverMap.set(server.name, server);
        }
    }
    return Array.from(serverMap.values());
}
/**
 * Compare two servers by version. Returns:
 *  > 0 if a is newer
 *  < 0 if b is newer
 *  0 if equal or cannot determine
 */
function compareVersions(a, b) {
    // Try semver comparison first
    if (a.version && b.version) {
        const aParts = a.version.split(".").map((n) => parseInt(n, 10) || 0);
        const bParts = b.version.split(".").map((n) => parseInt(n, 10) || 0);
        for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
            const aVal = aParts[i] || 0;
            const bVal = bParts[i] || 0;
            if (aVal !== bVal) {
                return aVal - bVal;
            }
        }
    }
    // Fall back to published_at date
    if (a.published_at && b.published_at) {
        return (new Date(a.published_at).getTime() - new Date(b.published_at).getTime());
    }
    // If one has a date and other doesn't, prefer the one with date
    if (a.published_at && !b.published_at)
        return 1;
    if (!a.published_at && b.published_at)
        return -1;
    return 0;
}
export function McpRegistryScreen() {
    const { state, dispatch } = useApp();
    const { mcpRegistry } = state;
    const modal = useModal();
    const { navigateToScreen } = useNavigation();
    const dimensions = useDimensions();
    const [servers, setServers] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState(mcpRegistry.searchQuery || "");
    const isSearchActive = state.isSearching &&
        state.currentRoute.screen === "mcp-registry" &&
        !state.modal;
    const searchTimeoutRef = useRef(null);
    // Load servers
    const loadServers = useCallback(async (query) => {
        setIsLoading(true);
        setError(null);
        try {
            const response = await searchMcpServers({ query, limit: 50 });
            if (!response || !Array.isArray(response.servers)) {
                throw new Error("Invalid response from MCP Registry API");
            }
            // Deduplicate to show only latest version of each server
            const deduplicated = deduplicateServers(response.servers);
            setServers(deduplicated);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Failed to load servers");
            setServers([]);
        }
        setIsLoading(false);
    }, []);
    // Debounced search
    const debouncedSearch = useCallback((query) => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }
        searchTimeoutRef.current = setTimeout(() => {
            loadServers(query);
        }, 300);
    }, [loadServers]);
    useEffect(() => {
        loadServers(searchQuery);
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, []);
    // Keyboard handling
    useKeyboard((event) => {
        // Handle search mode
        if (isSearchActive) {
            if (event.name === "escape") {
                dispatch({ type: "SET_SEARCHING", isSearching: false });
            }
            else if (event.name === "enter") {
                // Exit search mode and stay on list for navigation
                dispatch({ type: "SET_SEARCHING", isSearching: false });
            }
            else if (event.name === "up") {
                // Allow navigation while searching
                const newIndex = Math.max(0, mcpRegistry.selectedIndex - 1);
                dispatch({ type: "MCPREGISTRY_SELECT", index: newIndex });
            }
            else if (event.name === "down") {
                // Allow navigation while searching
                const newIndex = Math.min(Math.max(0, servers.length - 1), mcpRegistry.selectedIndex + 1);
                dispatch({ type: "MCPREGISTRY_SELECT", index: newIndex });
            }
            else if (event.name === "backspace" || event.name === "delete") {
                const newQuery = searchQuery.slice(0, -1);
                setSearchQuery(newQuery);
                dispatch({ type: "MCPREGISTRY_SEARCH", query: newQuery });
                debouncedSearch(newQuery);
            }
            else if (event.name.length === 1 && !event.ctrl && !event.meta) {
                const newQuery = searchQuery + event.name;
                setSearchQuery(newQuery);
                dispatch({ type: "MCPREGISTRY_SEARCH", query: newQuery });
                debouncedSearch(newQuery);
            }
            return;
        }
        if (state.modal)
            return;
        // Start search with /
        if (event.name === "/") {
            dispatch({ type: "SET_SEARCHING", isSearching: true });
            return;
        }
        // Navigation
        if (event.name === "up" || event.name === "k") {
            const newIndex = Math.max(0, mcpRegistry.selectedIndex - 1);
            dispatch({ type: "MCPREGISTRY_SELECT", index: newIndex });
        }
        else if (event.name === "down" || event.name === "j") {
            const newIndex = Math.min(Math.max(0, servers.length - 1), mcpRegistry.selectedIndex + 1);
            dispatch({ type: "MCPREGISTRY_SELECT", index: newIndex });
        }
        else if (event.name === "l") {
            navigateToScreen("mcp");
        }
        else if (event.name === "R") {
            loadServers(searchQuery);
        }
        else if (event.name === "enter") {
            handleInstall();
        }
    });
    const handleInstall = async () => {
        const server = servers[mcpRegistry.selectedIndex];
        if (!server)
            return;
        const config = {
            type: "http",
            url: server.url,
        };
        modal.loading(`Installing ${server.name}...`);
        try {
            await setAllowMcp(true, state.projectPath);
            await addMcpServer(server.name, config, state.projectPath);
            modal.hideModal();
            await modal.message("Installed", `${server.name} has been configured.\n\nRestart Claude Code to activate.`, "success");
        }
        catch (error) {
            modal.hideModal();
            await modal.message("Error", `Failed to install: ${error}`, "error");
        }
    };
    // Get selected server
    const selectedServer = servers[mcpRegistry.selectedIndex];
    const renderDetail = () => {
        if (isLoading) {
            return _jsx("text", { fg: "gray", children: "Loading..." });
        }
        if (error) {
            return _jsxs("text", { fg: "red", children: ["Error: ", error] });
        }
        if (!selectedServer) {
            return _jsx("text", { fg: "gray", children: "Select a server to see details" });
        }
        const dateDisplay = selectedServer.published_at
            ? formatDate(selectedServer.published_at)
            : "unknown";
        const versionDisplay = selectedServer.version
            ? `v${selectedServer.version}`
            : "unknown";
        return (_jsxs("box", { flexDirection: "column", children: [_jsx("text", { fg: "magenta", children: _jsx("strong", { children: selectedServer.name }) }), _jsx("box", { marginTop: 1, children: _jsx("text", { children: selectedServer.short_description }) }), _jsxs("box", { marginTop: 1, children: [_jsx("text", { children: _jsx("strong", { children: "Version: " }) }), _jsx("text", { fg: "green", children: versionDisplay })] }), _jsxs("box", { children: [_jsx("text", { children: _jsx("strong", { children: "Published: " }) }), _jsx("text", { fg: "cyan", children: dateDisplay })] }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsx("text", { children: _jsx("strong", { children: "URL:" }) }), _jsx("text", { fg: "cyan", children: selectedServer.url })] }), selectedServer.source_code_url && (_jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsx("text", { children: _jsx("strong", { children: "Source:" }) }), _jsx("text", { fg: "gray", children: selectedServer.source_code_url })] })), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: "green", children: "Press Enter to install" }) })] }));
    };
    const renderListItem = (server, _idx, isSelected) => {
        const version = server.version ? ` v${server.version}` : "";
        return isSelected ? (_jsxs("text", { bg: "magenta", fg: "white", children: [" ", server.name, version, " "] })) : (_jsxs("text", { children: [_jsx("span", { children: _jsx("strong", { children: server.name }) }), _jsx("span", { fg: "green", children: version })] }));
    };
    // Footer hints
    const footerHints = isSearchActive
        ? "Type to search │ ↑↓:nav │ Enter:done │ Esc:cancel"
        : "↑↓:nav │ Enter:install │ /:search │ R:refresh │ l:local";
    // Status for search placeholder
    const searchPlaceholder = `${servers.length} servers │ / to search`;
    return (_jsx(ScreenLayout, { title: "claudeup MCP Registry", subtitle: "Powered by MCP Registry", currentScreen: "mcp-registry", search: {
            isActive: isSearchActive,
            query: searchQuery,
            placeholder: searchPlaceholder,
        }, footerHints: footerHints, listPanel: isLoading ? (_jsx("text", { fg: "gray", children: "Loading..." })) : error ? (_jsxs("text", { fg: "red", children: ["Error: ", error] })) : servers.length === 0 ? (_jsx("text", { fg: "gray", children: "No servers found" })) : (_jsx(ScrollableList, { items: servers, selectedIndex: mcpRegistry.selectedIndex, renderItem: renderListItem, maxHeight: dimensions.listPanelHeight })), detailPanel: renderDetail() }));
}
export default McpRegistryScreen;
