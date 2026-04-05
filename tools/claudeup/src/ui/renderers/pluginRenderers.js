import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { CategoryHeader } from "../components/CategoryHeader.js";
import { SelectableRow, ScopeSquares, ActionHints, MetaText, KeyValueLine, DetailSection, } from "../components/primitives/index.js";
import { theme } from "../theme.js";
import { highlightMatches } from "../../utils/fuzzy-search.js";
// ─── Category renderers ───────────────────────────────────────────────────────
function categoryRow(item, isSelected) {
    const mp = item.marketplace;
    if (isSelected) {
        const arrow = item.isExpanded ? "▼" : "▶";
        const count = item.pluginCount > 0 ? ` (${item.pluginCount})` : "";
        return (_jsx(SelectableRow, { selected: true, children: _jsxs("strong", { children: [" ", arrow, " ", mp.displayName, count, " "] }) }));
    }
    // Map tone to a statusColor for CategoryHeader (legacy component)
    const statusColorMap = {
        yellow: "yellow",
        gray: "gray",
        green: "green",
        red: "red",
        purple: theme.colors.accent,
        teal: "cyan",
    };
    return (_jsx(CategoryHeader, { title: mp.displayName, expanded: item.isExpanded, count: item.pluginCount, status: item.badge, statusColor: statusColorMap[item.tone] }));
}
function categoryDetail(item, collapsedMarketplaces) {
    const mp = item.marketplace;
    const isEnabled = item.marketplaceEnabled;
    const isCollapsed = collapsedMarketplaces.has(mp.name);
    const hasPlugins = item.pluginCount > 0;
    let actionHint = "Add";
    if (isEnabled) {
        if (isCollapsed) {
            actionHint = "Expand";
        }
        else if (hasPlugins) {
            actionHint = "Collapse";
        }
        else {
            actionHint = "Remove";
        }
    }
    return (_jsxs("box", { flexDirection: "column", children: [_jsx("text", { fg: theme.colors.info, children: _jsxs("strong", { children: [mp.displayName, item.badge ? ` ${item.badge}` : ""] }) }), _jsx("text", { fg: theme.colors.muted, children: mp.description || "No description" }), _jsx("text", { fg: isEnabled ? theme.colors.success : theme.colors.muted, children: isEnabled ? "● Added" : "○ Not added" }), _jsxs("text", { fg: theme.colors.link, children: ["github.com/", mp.source.repo] }), _jsxs("text", { children: ["Plugins: ", item.pluginCount] }), _jsx(ActionHints, { hints: [
                    { key: "Enter", label: actionHint, tone: isEnabled ? "primary" : "default" },
                ] }), isEnabled ? (_jsx("box", { children: _jsx("text", { fg: theme.colors.muted, children: "\u2190 \u2192 to expand/collapse" }) })) : null] }));
}
// ─── Plugin renderers ─────────────────────────────────────────────────────────
function pluginRow(item, isSelected) {
    const { plugin } = item;
    const hasUser = !!plugin.userScope?.enabled;
    const hasProject = !!plugin.projectScope?.enabled;
    const hasLocal = !!plugin.localScope?.enabled;
    const hasAnyScope = hasUser || hasProject || hasLocal;
    // Build version string — only show if plugin is installed in at least one scope
    let versionStr = "";
    if (plugin.isOrphaned) {
        versionStr = " deprecated";
    }
    else if (hasAnyScope && plugin.installedVersion && plugin.installedVersion !== "0.0.0") {
        versionStr = ` v${plugin.installedVersion}`;
        if (plugin.hasUpdate && plugin.version) {
            versionStr += ` → v${plugin.version}`;
        }
    }
    if (isSelected) {
        return (_jsxs("text", { bg: theme.selection.bg, fg: theme.selection.fg, children: [" ", _jsx(ScopeSquares, { user: hasUser, project: hasProject, local: hasLocal, selected: true }), " ", plugin.name, versionStr, " "] }));
    }
    // Fuzzy highlight
    const segments = item.matches ? highlightMatches(plugin.name, item.matches) : null;
    const displayName = segments ? segments.map((seg) => seg.text).join("") : plugin.name;
    if (plugin.isOrphaned) {
        const ver = plugin.installedVersion && plugin.installedVersion !== "0.0.0"
            ? ` v${plugin.installedVersion}`
            : "";
        return (_jsxs("text", { children: [_jsx("span", { fg: theme.colors.danger, children: " \u25A0\u25A0\u25A0 " }), _jsx("span", { fg: theme.colors.muted, children: displayName }), ver ? _jsx("span", { fg: theme.colors.warning, children: ver }) : null, _jsx("span", { fg: theme.colors.danger, children: " deprecated" })] }));
    }
    return (_jsxs("text", { children: [_jsx("span", { children: " " }), _jsx(ScopeSquares, { user: hasUser, project: hasProject, local: hasLocal }), _jsx("span", { children: " " }), _jsx("span", { fg: hasAnyScope ? theme.colors.text : theme.colors.muted, children: displayName }), _jsx(MetaText, { text: versionStr, tone: plugin.hasUpdate ? "warning" : "muted" })] }));
}
function pluginDetail(item) {
    const { plugin } = item;
    const isInstalled = plugin.userScope?.enabled ||
        plugin.projectScope?.enabled ||
        plugin.localScope?.enabled;
    // Orphaned/deprecated plugin
    if (plugin.isOrphaned) {
        return (_jsxs("box", { flexDirection: "column", children: [_jsx("box", { justifyContent: "center", children: _jsx("text", { bg: theme.colors.warning, fg: "black", children: _jsxs("strong", { children: [" ", plugin.name, " \u2014 DEPRECATED "] }) }) }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: theme.colors.warning, children: "This plugin is no longer in the marketplace." }) }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: theme.colors.muted, children: "It was removed from the marketplace but still referenced in your settings. Press d to uninstall and clean up." }) }), _jsx(ActionHints, { hints: [{ key: "d", label: isInstalled ? "Remove from all scopes" : "Clean up stale reference", tone: "danger" }] })] }));
    }
    // Build component counts
    const components = [];
    if (plugin.agents?.length)
        components.push(`${plugin.agents.length} agents`);
    if (plugin.commands?.length)
        components.push(`${plugin.commands.length} commands`);
    if (plugin.skills?.length)
        components.push(`${plugin.skills.length} skills`);
    if (plugin.mcpServers?.length)
        components.push(`${plugin.mcpServers.length} MCP`);
    if (plugin.lspServers && Object.keys(plugin.lspServers).length) {
        components.push(`${Object.keys(plugin.lspServers).length} LSP`);
    }
    const showVersion = plugin.version && plugin.version !== "0.0.0";
    const showInstalledVersion = isInstalled && plugin.installedVersion && plugin.installedVersion !== "0.0.0";
    return (_jsxs("box", { flexDirection: "column", children: [_jsx("box", { justifyContent: "center", children: _jsx("text", { bg: theme.selection.bg, fg: theme.selection.fg, children: _jsxs("strong", { children: [" ", plugin.name, isInstalled && plugin.hasUpdate ? " ⬆" : "", " "] }) }) }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: isInstalled ? theme.colors.success : theme.colors.muted, children: isInstalled ? "● Installed" : "○ Not installed" }) }), _jsx("box", { marginTop: 1, marginBottom: 1, children: _jsx("text", { fg: theme.colors.text, children: plugin.description }) }), showVersion ? (_jsx(KeyValueLine, { label: "Version", value: _jsxs("span", { children: [_jsxs("span", { fg: theme.colors.link, children: ["v", plugin.version] }), showInstalledVersion && plugin.installedVersion !== plugin.version ? (_jsxs("span", { children: [" (v", plugin.installedVersion, " installed)"] })) : null] }) })) : null, plugin.category ? (_jsx(KeyValueLine, { label: "Category", value: _jsx("span", { fg: theme.colors.accent, children: plugin.category }) })) : null, plugin.author ? (_jsx(KeyValueLine, { label: "Author", value: _jsx("span", { children: plugin.author.name }) })) : null, components.length > 0 ? (_jsx(KeyValueLine, { label: "Contains", value: _jsx("span", { fg: theme.colors.warning, children: components.join(" · ") }) })) : null, _jsxs(DetailSection, { children: [_jsx("text", { children: "─".repeat(24) }), _jsx("text", { children: _jsx("strong", { children: "Scopes:" }) }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsxs("text", { children: [_jsxs("span", { bg: theme.scopes.user, fg: "black", children: [" ", "u", " "] }), _jsx("span", { fg: plugin.userScope?.enabled ? theme.scopes.user : theme.colors.muted, children: plugin.userScope?.enabled ? " ● " : " ○ " }), _jsx("span", { fg: theme.scopes.user, children: "User" }), _jsx("span", { children: " global" }), plugin.userScope?.version ? (_jsxs("span", { fg: theme.scopes.user, children: [" v", plugin.userScope.version] })) : null] }), _jsxs("text", { children: [_jsxs("span", { bg: theme.scopes.project, fg: "black", children: [" ", "p", " "] }), _jsx("span", { fg: plugin.projectScope?.enabled ? theme.scopes.project : theme.colors.muted, children: plugin.projectScope?.enabled ? " ● " : " ○ " }), _jsx("span", { fg: theme.scopes.project, children: "Project" }), _jsx("span", { children: " team" }), plugin.projectScope?.version ? (_jsxs("span", { fg: theme.scopes.project, children: [" v", plugin.projectScope.version] })) : null] }), _jsxs("text", { children: [_jsxs("span", { bg: theme.scopes.local, fg: "black", children: [" ", "l", " "] }), _jsx("span", { fg: plugin.localScope?.enabled ? theme.scopes.local : theme.colors.muted, children: plugin.localScope?.enabled ? " ● " : " ○ " }), _jsx("span", { fg: theme.scopes.local, children: "Local" }), _jsx("span", { children: " private" }), plugin.localScope?.version ? (_jsxs("span", { fg: theme.scopes.local, children: [" v", plugin.localScope.version] })) : null] })] })] }), isInstalled && plugin.hasUpdate ? (_jsx(ActionHints, { hints: [{ key: "U", label: `Update to v${plugin.version}`, tone: "primary" }] })) : null] }));
}
// ─── Public dispatch functions ────────────────────────────────────────────────
/**
 * Render a plugin browser list row by item kind.
 */
export function renderPluginRow(item, _index, isSelected) {
    if (item.kind === "category") {
        return categoryRow(item, isSelected);
    }
    return pluginRow(item, isSelected);
}
/**
 * Render the detail panel for a plugin browser item.
 */
export function renderPluginDetail(item, collapsedMarketplaces) {
    if (!item)
        return _jsx("text", { fg: theme.colors.muted, children: "Select an item" });
    if (item.kind === "category") {
        return categoryDetail(item, collapsedMarketplaces);
    }
    return pluginDetail(item);
}
