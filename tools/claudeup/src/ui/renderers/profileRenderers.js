import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "@opentui/react/jsx-runtime";
import { theme } from "../theme.js";
// ─── Helpers ───────────────────────────────────────────────────────────────────
function truncate(s, maxLen) {
    if (s.length <= maxLen)
        return s;
    return s.slice(0, maxLen - 1) + "\u2026";
}
export function humanizeValue(_key, value) {
    if (typeof value === "boolean")
        return value ? "on" : "off";
    if (typeof value !== "string")
        return String(value);
    if (value === "claude-sonnet-4-6")
        return "Sonnet";
    if (value === "claude-opus-4-6")
        return "Opus";
    if (value === "claude-haiku-4-6")
        return "Haiku";
    if (value.startsWith("claude-sonnet"))
        return "Sonnet";
    if (value.startsWith("claude-opus"))
        return "Opus";
    if (value.startsWith("claude-haiku"))
        return "Haiku";
    return value;
}
export function humanizeKey(key) {
    const labels = {
        effortLevel: "Effort",
        model: "Model",
        outputStyle: "Output",
        alwaysThinkingEnabled: "Thinking",
        includeGitInstructions: "Git Instructions",
        respectGitignore: "Gitignore",
        enableAllProjectMcpServers: "Auto MCP",
        autoUpdatesChannel: "Updates",
        language: "Language",
        cleanupPeriodDays: "Cleanup",
    };
    return labels[key] ?? key;
}
export function stripSuffix(pluginName) {
    return pluginName
        .replace(/@magus$/, "")
        .replace(/@claude-plugins-official$/, "");
}
export function wrapNames(names, lineMax = 40) {
    const lines = [];
    let current = "";
    for (const name of names) {
        const add = current ? `, ${name}` : name;
        if (current && current.length + add.length > lineMax) {
            lines.push(current);
            current = name;
        }
        else {
            current += current ? `, ${name}` : name;
        }
    }
    if (current)
        lines.push(current);
    return lines;
}
export function formatDate(iso) {
    try {
        const d = new Date(iso);
        return d.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }
    catch {
        return iso;
    }
}
// ─── Header renderer ───────────────────────────────────────────────────────────
const headerRenderer = {
    renderRow: ({ item }) => (_jsx("text", { bg: item.color, fg: "white", children: _jsxs("strong", { children: [" ", item.label, " (", item.count, ")", " "] }) })),
    renderDetail: () => (_jsx("text", { fg: theme.colors.muted, children: "Select a profile to see details" })),
};
// ─── Predefined renderer ───────────────────────────────────────────────────────
const DIVIDER = "────────────────────────";
const predefinedRenderer = {
    renderRow: ({ item, isSelected }) => {
        const { profile } = item;
        const pluginCount = profile.magusPlugins.length + profile.anthropicPlugins.length;
        const skillCount = profile.skills.length;
        const countStr = `${pluginCount}p ${skillCount}s`;
        if (isSelected) {
            return (_jsxs("text", { bg: theme.selection.bg, fg: theme.selection.fg, children: ["  ", profile.name, "  ", countStr, " "] }));
        }
        return (_jsxs("text", { children: [_jsxs("span", { fg: "white", children: ["  ", profile.name] }), _jsxs("span", { fg: theme.colors.dim, children: ["  ", countStr] })] }));
    },
    renderDetail: ({ item }) => {
        const { profile } = item;
        const settingEntries = Object.entries(profile.settings).filter(([k]) => k !== "env");
        const envMap = profile.settings["env"] ?? {};
        const tasksOn = envMap["CLAUDE_CODE_ENABLE_TASKS"] === "true";
        const teamsOn = envMap["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] === "true";
        return (_jsxs("box", { flexDirection: "column", children: [_jsx("box", { children: _jsx("text", { bg: theme.colors.accent, fg: "white", children: _jsxs("strong", { children: [" ", profile.name, " "] }) }) }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: theme.colors.muted, children: profile.description }) }), _jsx("box", { children: _jsx("text", { fg: theme.colors.muted, children: `\nMagus (${profile.magusPlugins.length})` }) }), _jsx("box", { children: _jsx("text", { fg: "#00bfa5", children: profile.magusPlugins.map((p) => `  ■ ${p}`).join("\n") }) }), _jsx("box", { children: _jsx("text", { fg: theme.colors.muted, children: `\nAnthropic (${profile.anthropicPlugins.length})` }) }), _jsx("box", { children: _jsx("text", { fg: "#b39ddb", children: profile.anthropicPlugins.map((p) => `  ■ ${p}`).join("\n") }) }), profile.skills.length > 0 && (_jsxs(_Fragment, { children: [_jsx("box", { children: _jsx("text", { fg: theme.colors.muted, children: `\nSkills (${profile.skills.length})` }) }), _jsx("box", { children: _jsx("text", { fg: "#ffd54f", children: profile.skills.map((s) => `  ■ ${s}`).join("\n") }) })] })), _jsx("box", { children: _jsx("text", { fg: theme.colors.dim, children: `\n${DIVIDER}` }) }), _jsx("box", { children: _jsx("text", { fg: theme.colors.muted, children: [
                            ...settingEntries.map(([k, v]) => `  ${humanizeKey(k).padEnd(18)}${humanizeValue(k, v)}`),
                            ...(tasksOn ? [`  ${"Tasks".padEnd(18)}on`] : []),
                            ...(teamsOn ? [`  ${"Agent Teams".padEnd(18)}on`] : []),
                        ].join("\n") }) }), _jsx("box", { children: _jsx("text", { fg: theme.colors.dim, children: `\n${DIVIDER}` }) }), _jsx("box", { children: _jsx("text", { fg: theme.colors.info, children: "  Enter/a to apply" }) })] }));
    },
};
// ─── Saved renderer ────────────────────────────────────────────────────────────
const savedRenderer = {
    renderRow: ({ item, isSelected }) => {
        const { entry } = item;
        const pluginCount = Object.keys(entry.plugins).length;
        const dateStr = formatDate(entry.updatedAt);
        const label = truncate(`${entry.name} — ${pluginCount} plugin${pluginCount !== 1 ? "s" : ""} · ${dateStr}`, 45);
        if (isSelected) {
            return (_jsxs("text", { bg: theme.selection.bg, fg: theme.selection.fg, children: [" ", label, " "] }));
        }
        const scopeColor = entry.scope === "user" ? theme.scopes.user : theme.scopes.project;
        const scopeLabel = entry.scope === "user" ? "[user]" : "[proj]";
        return (_jsxs("text", { children: [_jsxs("span", { fg: scopeColor, children: [scopeLabel, " "] }), _jsx("span", { fg: theme.colors.text, children: label })] }));
    },
    renderDetail: ({ item }) => {
        const { entry: selectedProfile } = item;
        const plugins = Object.keys(selectedProfile.plugins);
        const cleanPlugins = plugins.map(stripSuffix);
        const scopeColor = selectedProfile.scope === "user" ? theme.scopes.user : theme.scopes.project;
        const scopeLabel = selectedProfile.scope === "user"
            ? "User (~/.claude/profiles.json)"
            : "Project (.claude/profiles.json — committed to git)";
        return (_jsxs("box", { flexDirection: "column", children: [_jsx("text", { fg: theme.colors.info, children: _jsx("strong", { children: selectedProfile.name }) }), _jsxs("box", { marginTop: 1, children: [_jsx("text", { fg: theme.colors.muted, children: "Scope: " }), _jsx("text", { fg: scopeColor, children: scopeLabel })] }), _jsx("box", { marginTop: 1, children: _jsxs("text", { fg: theme.colors.muted, children: ["Created: ", formatDate(selectedProfile.createdAt), " \u00B7 Updated:", " ", formatDate(selectedProfile.updatedAt)] }) }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsxs("text", { fg: theme.colors.muted, children: ["Plugins (", plugins.length, plugins.length === 0 ? " — applying will disable all plugins" : "", "):"] }), cleanPlugins.length === 0 ? (_jsx("text", { fg: theme.colors.warning, children: " (none)" })) : (wrapNames(cleanPlugins).map((line, i) => (_jsxs("text", { fg: theme.colors.text, children: ["  ", line] }, i))))] }), _jsxs("box", { marginTop: 2, flexDirection: "column", children: [_jsxs("box", { children: [_jsxs("text", { bg: theme.selection.bg, fg: theme.selection.fg, children: [" ", "Enter/a", " "] }), _jsx("text", { fg: theme.colors.muted, children: " Apply profile" })] }), _jsxs("box", { marginTop: 1, children: [_jsxs("text", { bg: theme.colors.dim, fg: "white", children: [" ", "r", " "] }), _jsx("text", { fg: theme.colors.muted, children: " Rename" })] }), _jsxs("box", { marginTop: 1, children: [_jsxs("text", { bg: theme.colors.danger, fg: "white", children: [" ", "d", " "] }), _jsx("text", { fg: theme.colors.muted, children: " Delete" })] }), _jsxs("box", { marginTop: 1, children: [_jsxs("text", { bg: "blue", fg: "white", children: [" ", "c", " "] }), _jsx("text", { fg: theme.colors.muted, children: " Copy JSON to clipboard" })] }), _jsxs("box", { marginTop: 1, children: [_jsxs("text", { bg: theme.colors.success, fg: "white", children: [" ", "i", " "] }), _jsx("text", { fg: theme.colors.muted, children: " Import from clipboard" })] })] })] }));
    },
};
// ─── Dispatch helpers ──────────────────────────────────────────────────────────
export function renderProfileRow(item, _index, isSelected) {
    if (item.kind === "header") {
        return headerRenderer.renderRow({ item, isSelected });
    }
    if (item.kind === "predefined") {
        return predefinedRenderer.renderRow({ item, isSelected });
    }
    return savedRenderer.renderRow({ item, isSelected });
}
export function renderProfileDetail(item, loading, error) {
    if (loading)
        return _jsx("text", { fg: theme.colors.muted, children: "Loading profiles..." });
    if (error)
        return _jsxs("text", { fg: theme.colors.danger, children: ["Error: ", error] });
    if (!item || item.kind === "header")
        return _jsx("text", { fg: theme.colors.muted, children: "Select a profile to see details" });
    if (item.kind === "predefined") {
        return predefinedRenderer.renderDetail({ item });
    }
    return savedRenderer.renderDetail({ item });
}
export function buildProfileListItems(profileList, PREDEFINED_PROFILES) {
    const items = [];
    items.push({
        kind: "header",
        label: "Presets",
        color: "#4527a0",
        count: PREDEFINED_PROFILES.length,
    });
    for (const p of PREDEFINED_PROFILES) {
        items.push({ kind: "predefined", profile: p });
    }
    items.push({
        kind: "header",
        label: "Your Profiles",
        color: "#00695c",
        count: profileList.length,
    });
    for (const e of profileList) {
        items.push({ kind: "saved", entry: e });
    }
    return items;
}
