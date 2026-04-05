import { jsxs as _jsxs, jsx as _jsx } from "@opentui/react/jsx-runtime";
import { CATEGORY_LABELS, CATEGORY_BG, CATEGORY_COLOR, CATEGORY_DESCRIPTIONS, formatValue, } from "../adapters/settingsAdapter.js";
import { MetaText } from "../components/primitives/index.js";
import { theme } from "../theme.js";
// ─── Category renderer ─────────────────────────────────────────────────────────
const categoryRenderer = {
    renderRow: ({ item, isSelected }) => {
        const star = item.category === "recommended" ? "★ " : "";
        const label = `${star}${CATEGORY_LABELS[item.category]}`;
        const bg = isSelected ? theme.selection.bg : CATEGORY_BG[item.category];
        return (_jsx("text", { bg: bg, fg: "white", children: _jsxs("strong", { children: [" ", label, " "] }) }));
    },
    renderDetail: ({ item }) => {
        const cat = item.category;
        return (_jsxs("box", { flexDirection: "column", children: [_jsx("text", { fg: CATEGORY_COLOR[cat], children: _jsx("strong", { children: CATEGORY_LABELS[cat] }) }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: theme.colors.muted, children: CATEGORY_DESCRIPTIONS[cat] }) })] }));
    },
};
// ─── Setting renderer ──────────────────────────────────────────────────────────
const settingRenderer = {
    renderRow: ({ item, isSelected }) => {
        const { setting } = item;
        const indicator = item.isDefault ? "○" : "●";
        const displayValue = formatValue(setting, item.effectiveValue);
        if (isSelected) {
            return (_jsxs("text", { bg: theme.selection.bg, fg: theme.selection.fg, children: [" ", indicator, " ", setting.name.padEnd(28), displayValue, " "] }));
        }
        const indicatorColor = item.isDefault ? theme.colors.muted : theme.colors.info;
        const valueColor = item.isDefault ? theme.colors.muted : theme.colors.success;
        return (_jsxs("text", { children: [_jsxs("span", { fg: indicatorColor, children: [" ", indicator, " "] }), _jsx("span", { children: setting.name.padEnd(28) }), _jsx("span", { fg: valueColor, children: displayValue })] }));
    },
    renderDetail: ({ item }) => {
        const { setting } = item;
        const scoped = item.scopedValues;
        const storageDesc = setting.storage.type === "attribution"
            ? "settings.json: attribution"
            : setting.storage.type === "attribution-text"
                ? "settings.json: attribution"
                : setting.storage.type === "env"
                    ? `env: ${setting.storage.key}`
                    : `settings.json: ${setting.storage.key}`;
        const userValue = formatValue(setting, scoped.user);
        const projectValue = formatValue(setting, scoped.project);
        const userIsSet = scoped.user !== undefined && scoped.user !== "";
        const projectIsSet = scoped.project !== undefined && scoped.project !== "";
        const actionLabel = setting.type === "boolean"
            ? "toggle"
            : setting.type === "select"
                ? "choose"
                : "edit";
        return (_jsxs("box", { flexDirection: "column", children: [_jsx("text", { fg: theme.colors.info, children: _jsx("strong", { children: setting.name }) }), _jsx("box", { marginTop: 1, children: _jsx("text", { fg: theme.colors.text, children: setting.description }) }), _jsx("box", { marginTop: 1, children: _jsxs("text", { children: [_jsx("span", { fg: theme.colors.muted, children: "Stored " }), _jsx("span", { fg: theme.colors.link, children: storageDesc })] }) }), setting.defaultValue !== undefined && (_jsx("box", { children: _jsxs("text", { children: [_jsx("span", { fg: theme.colors.muted, children: "Default " }), _jsx("span", { children: setting.defaultValue })] }) })), _jsxs("box", { flexDirection: "column", marginTop: 1, children: [_jsx("text", { children: "────────────────────────" }), _jsx("text", { children: _jsx("strong", { children: "Scopes:" }) }), _jsxs("box", { marginTop: 1, flexDirection: "column", children: [_jsxs("text", { children: [_jsxs("span", { bg: theme.scopes.user, fg: "black", children: [" ", "u", " "] }), _jsx("span", { fg: userIsSet ? theme.scopes.user : theme.colors.muted, children: userIsSet ? " ● " : " ○ " }), _jsx("span", { fg: theme.scopes.user, children: "User" }), _jsx("span", { children: " global" }), _jsxs("span", { fg: userIsSet ? theme.scopes.user : theme.colors.muted, children: [" ", userValue] })] }), _jsxs("text", { children: [_jsxs("span", { bg: theme.scopes.project, fg: "black", children: [" ", "p", " "] }), _jsx("span", { fg: projectIsSet ? theme.scopes.project : theme.colors.muted, children: projectIsSet ? " ● " : " ○ " }), _jsx("span", { fg: theme.scopes.project, children: "Project" }), _jsx("span", { children: " team" }), _jsxs("span", { fg: projectIsSet ? theme.scopes.project : theme.colors.muted, children: [" ", projectValue] })] })] })] }), _jsx("box", { marginTop: 1, children: _jsxs("text", { fg: theme.colors.muted, children: ["Press u/p to ", actionLabel, " in scope"] }) })] }));
    },
};
// ─── Dispatch helpers ──────────────────────────────────────────────────────────
export const settingsRenderers = {
    category: categoryRenderer,
    setting: settingRenderer,
};
export function renderSettingRow(item, _index, isSelected) {
    if (item.kind === "category") {
        return settingsRenderers.category.renderRow({ item, isSelected });
    }
    return settingsRenderers.setting.renderRow({ item, isSelected });
}
export function renderSettingDetail(item) {
    if (!item)
        return _jsx("text", { fg: theme.colors.muted, children: "Select a setting to see details" });
    if (item.kind === "category") {
        return settingsRenderers.category.renderDetail({ item });
    }
    return settingsRenderers.setting.renderDetail({ item });
}
// Suppress unused import warning — MetaText may be used in future extensions
void MetaText;
