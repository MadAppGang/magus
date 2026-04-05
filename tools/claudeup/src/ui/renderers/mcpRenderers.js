import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { theme } from "../theme.js";
// ─── Row renderers ─────────────────────────────────────────────────────────────
export function renderMcpRow(item, _index, isSelected) {
    if (item.kind === "category") {
        return (_jsx("text", { fg: theme.selection.bg, children: _jsxs("strong", { children: ["▸ ", item.label] }) }));
    }
    const { server, isInstalled } = item;
    const icon = isInstalled ? "●" : "○";
    const iconColor = isInstalled ? theme.colors.success : theme.colors.muted;
    if (isSelected) {
        return (_jsxs("text", { bg: theme.selection.bg, fg: theme.selection.fg, children: [" ", icon, " ", server.name, " "] }));
    }
    return (_jsxs("text", { children: [_jsx("span", { fg: iconColor, children: icon }), _jsxs("span", { fg: theme.colors.text, children: [" ", server.name] }), server.requiresConfig ? (_jsx("span", { fg: theme.colors.warning, children: " \u2699" })) : null] }));
}
// ─── Detail renderer ───────────────────────────────────────────────────────────
export function renderMcpDetail(item, loading) {
    if (loading) {
        return _jsx("text", { fg: theme.colors.muted, children: "Loading MCP servers..." });
    }
    if (!item || item.kind === "category") {
        return (_jsx("box", { flexDirection: "column", alignItems: "center", justifyContent: "center", flexGrow: 1, children: _jsx("text", { fg: theme.colors.muted, children: "Select a server to see details" }) }));
    }
    const { server, isInstalled } = item;
    return (_jsxs("box", { flexDirection: "column", children: [_jsxs("box", { marginBottom: 1, children: [_jsx("text", { fg: theme.colors.info, children: _jsxs("strong", { children: ["⚡ ", server.name] }) }), server.requiresConfig ? (_jsx("text", { fg: theme.colors.warning, children: " \u2699" })) : null] }), _jsx("text", { fg: theme.colors.muted, children: server.description }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "Status " }), isInstalled ? (_jsx("text", { fg: theme.colors.success, children: "● Installed" })) : (_jsx("text", { fg: theme.colors.muted, children: "○ Not installed" }))] }), _jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "Type " }), _jsx("text", { fg: theme.colors.text, children: server.type === "http" ? "HTTP" : "Command" })] }), server.type === "http" ? (_jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "URL " }), _jsx("text", { fg: theme.colors.link, children: server.url })] })) : (_jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "Command " }), _jsx("text", { fg: theme.colors.info, children: server.command })] })), server.requiresConfig ? (_jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "Config " }), _jsxs("text", { fg: theme.colors.warning, children: [server.configFields?.length ?? 0, " fields required"] })] })) : null] }), _jsx("box", { marginTop: 2, children: isInstalled ? (_jsxs("box", { children: [_jsxs("text", { bg: theme.colors.danger, fg: "white", children: [" ", "Enter", " "] }), _jsx("text", { fg: theme.colors.muted, children: " Remove server" })] })) : (_jsxs("box", { children: [_jsxs("text", { bg: theme.colors.success, fg: "black", children: [" ", "Enter", " "] }), _jsx("text", { fg: theme.colors.muted, children: " Install server" })] })) })] }));
}
