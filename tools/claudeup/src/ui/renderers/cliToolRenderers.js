import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { theme } from "../theme.js";
// ─── Helpers ────────────────────────────────────────────────────────────────
function getUninstallHint(tool, method, brewFormula) {
    switch (method) {
        case "bun": return `bun remove -g ${tool.packageName}`;
        case "npm": return `npm uninstall -g ${tool.packageName}`;
        case "pnpm": return `pnpm remove -g ${tool.packageName}`;
        case "yarn": return `yarn global remove ${tool.packageName}`;
        case "brew": return `brew uninstall ${brewFormula || tool.name}`;
        case "pip": return `pip uninstall ${tool.packageName}`;
        default: return "";
    }
}
// ─── Row renderer ──────────────────────────────────────────────────────────────
export function renderCliToolRow(status, _index, isSelected) {
    const { tool, installed, installedVersion, hasUpdate, checking, allMethods } = status;
    const hasConflict = allMethods && allMethods.length > 1;
    let icon;
    let iconColor;
    if (!installed) {
        icon = "○";
        iconColor = theme.colors.muted;
    }
    else if (hasConflict) {
        icon = "!";
        iconColor = theme.colors.danger;
    }
    else if (hasUpdate) {
        icon = "*";
        iconColor = theme.colors.warning;
    }
    else {
        icon = "●";
        iconColor = theme.colors.success;
    }
    const versionText = installedVersion ? ` v${installedVersion}` : "";
    const methodTag = installed && allMethods?.length
        ? ` ${allMethods.join("+")}`
        : "";
    if (isSelected) {
        return (_jsxs("text", { bg: theme.selection.bg, fg: theme.selection.fg, children: [" ", icon, " ", tool.displayName, versionText, methodTag, checking ? " ..." : "", " "] }));
    }
    return (_jsxs("text", { children: [_jsxs("span", { fg: iconColor, children: [" ", icon] }), _jsxs("span", { fg: theme.colors.text, children: [" ", tool.displayName] }), versionText ? _jsx("span", { fg: theme.colors.success, children: versionText }) : null, methodTag ? _jsx("span", { fg: hasConflict ? theme.colors.danger : theme.colors.dim, children: methodTag }) : null, checking ? _jsx("span", { fg: theme.colors.muted, children: " ..." }) : null] }));
}
// ─── Detail renderer ───────────────────────────────────────────────────────────
export function renderCliToolDetail(status) {
    if (!status) {
        return (_jsx("box", { flexDirection: "column", alignItems: "center", justifyContent: "center", flexGrow: 1, children: _jsx("text", { fg: theme.colors.muted, children: "Select a tool to see details" }) }));
    }
    const { tool, installed, installedVersion, latestVersion, hasUpdate, checking, installMethod, allMethods, updateCommand, brewFormula } = status;
    const hasConflict = allMethods && allMethods.length > 1;
    return (_jsxs("box", { flexDirection: "column", children: [_jsxs("box", { marginBottom: 1, children: [_jsx("text", { fg: theme.colors.info, children: _jsxs("strong", { children: ["⚙ ", tool.displayName] }) }), hasUpdate ? _jsx("text", { fg: theme.colors.warning, children: " \u2B06" }) : null, hasConflict ? _jsx("text", { fg: theme.colors.danger, children: " !" }) : null] }), _jsx("text", { fg: theme.colors.muted, children: tool.description }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "Status   " }), !installed ? (_jsx("text", { fg: theme.colors.muted, children: "○ Not installed" })) : checking ? (_jsx("text", { fg: theme.colors.success, children: "● Checking..." })) : hasUpdate ? (_jsx("text", { fg: theme.colors.warning, children: "● Update available" })) : (_jsx("text", { fg: theme.colors.success, children: "● Up to date" }))] }), installedVersion ? (_jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "Version  " }), _jsxs("text", { children: [_jsxs("span", { fg: theme.colors.success, children: ["v", installedVersion] }), latestVersion && hasUpdate ? (_jsxs("span", { fg: theme.colors.warning, children: [" \u2192 v", latestVersion] })) : null] })] })) : latestVersion ? (_jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "Latest   " }), _jsxs("text", { fg: theme.colors.text, children: ["v", latestVersion] })] })) : null, installed && updateCommand ? (_jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "Update   " }), _jsx("text", { fg: theme.colors.accent, children: updateCommand })] })) : !installed ? (_jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "Install  " }), _jsx("text", { fg: theme.colors.accent, children: tool.installCommand })] })) : null, _jsxs("box", { children: [_jsx("text", { fg: theme.colors.muted, children: "Website  " }), _jsx("text", { fg: theme.colors.link, children: tool.website })] })] }), hasConflict ? (_jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsx("box", { children: _jsx("text", { bg: theme.colors.danger, fg: "white", children: _jsxs("strong", { children: [" ", "Conflict: installed via ", allMethods.join(" + "), " "] }) }) }), _jsx("box", { marginTop: 1, children: _jsxs("text", { fg: theme.colors.muted, children: ["Multiple installs can cause version mismatches.", "\n", "Keep one, remove the rest:"] }) }), allMethods.map((method, i) => (_jsx("box", { children: _jsxs("text", { children: [_jsx("span", { fg: i === 0 ? theme.colors.success : theme.colors.danger, children: i === 0 ? "  ● keep  " : "  ○ remove " }), _jsx("span", { fg: theme.colors.warning, children: method }), i > 0 ? (_jsx("span", { fg: theme.colors.dim, children: `  ${getUninstallHint(tool, method, brewFormula)}` })) : (_jsx("span", { fg: theme.colors.dim, children: "  (active in PATH)" }))] }) }, method))), _jsxs("box", { marginTop: 1, children: [_jsxs("text", { bg: theme.colors.danger, fg: "white", children: [" ", "c", " "] }), _jsx("text", { fg: theme.colors.muted, children: " Resolve \u2014 pick which to keep" })] })] })) : null, _jsx("box", { marginTop: 2, flexDirection: "column", children: !installed ? (_jsxs("box", { children: [_jsxs("text", { bg: theme.colors.success, fg: "black", children: [" ", "Enter", " "] }), _jsx("text", { fg: theme.colors.muted, children: " Install" }), _jsxs("text", { fg: theme.colors.dim, children: ["  ", tool.installCommand] })] })) : hasUpdate ? (_jsxs("box", { children: [_jsxs("text", { bg: theme.colors.warning, fg: "black", children: [" ", "Enter", " "] }), _jsxs("text", { fg: theme.colors.muted, children: [" Update to v", latestVersion] })] })) : (_jsxs("box", { children: [_jsxs("text", { bg: theme.colors.muted, fg: "white", children: [" ", "Enter", " "] }), _jsx("text", { fg: theme.colors.muted, children: " Reinstall" })] })) })] }));
}
