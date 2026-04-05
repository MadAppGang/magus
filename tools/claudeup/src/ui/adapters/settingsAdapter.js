import { SETTINGS_CATALOG, } from "../../data/settings-catalog.js";
// ─── Constants ─────────────────────────────────────────────────────────────────
export const CATEGORY_LABELS = {
    recommended: "Recommended",
    agents: "Agents & Teams",
    models: "Models & Thinking",
    workflow: "Workflow",
    terminal: "Terminal & UI",
    performance: "Performance",
    advanced: "Advanced",
};
export const CATEGORY_ORDER = [
    "recommended",
    "agents",
    "models",
    "workflow",
    "terminal",
    "performance",
    "advanced",
];
export const CATEGORY_BG = {
    recommended: "#2e7d32",
    agents: "#00838f",
    models: "#4527a0",
    workflow: "#1565c0",
    terminal: "#4e342e",
    performance: "#6a1b9a",
    advanced: "#e65100",
};
export const CATEGORY_COLOR = {
    recommended: "green",
    agents: "cyan",
    models: "cyan",
    workflow: "blue",
    terminal: "blue",
    performance: "magentaBright",
    advanced: "yellow",
};
export const CATEGORY_DESCRIPTIONS = {
    recommended: "Most impactful settings every user should know.",
    agents: "Agent teams, task lists, and subagent configuration.",
    models: "Model selection, extended thinking, and effort.",
    workflow: "Git, plans, permissions, output style, and languages.",
    terminal: "Shell, spinners, progress bars, voice, and UI behavior.",
    performance: "Compaction, token limits, timeouts, and caching.",
    advanced: "Telemetry, updates, debugging, and internal controls.",
};
// ─── Helpers ───────────────────────────────────────────────────────────────────
/** Get the effective value (project overrides user) */
export function getEffectiveValue(scoped) {
    return scoped.project !== undefined ? scoped.project : scoped.user;
}
export function formatValue(setting, value) {
    if (value === undefined || value === "") {
        if (setting.defaultValue !== undefined) {
            return setting.type === "boolean"
                ? setting.defaultValue === "true"
                    ? "on"
                    : "off"
                : setting.defaultValue || "default";
        }
        return "—";
    }
    if (setting.type === "boolean") {
        return value === "true" || value === "1" ? "on" : "off";
    }
    if (setting.type === "select" && setting.options) {
        const opt = setting.options.find((o) => o.value === value);
        return opt ? opt.label : value;
    }
    if (value.length > 20) {
        return value.slice(0, 20) + "...";
    }
    return value;
}
// ─── Adapter ───────────────────────────────────────────────────────────────────
/**
 * Builds the flat list of items for the SettingsScreen list panel.
 * Extracted from SettingsScreen so it can be tested independently.
 */
export function buildSettingsBrowserItems(values) {
    const items = [];
    for (const category of CATEGORY_ORDER) {
        items.push({
            id: `cat:${category}`,
            kind: "category",
            label: CATEGORY_LABELS[category],
            category,
            isDefault: true,
        });
        const categorySettings = SETTINGS_CATALOG.filter((s) => s.category === category);
        for (const setting of categorySettings) {
            const scoped = values.get(setting.id) || {
                user: undefined,
                project: undefined,
            };
            const effective = getEffectiveValue(scoped);
            items.push({
                id: `setting:${setting.id}`,
                kind: "setting",
                label: setting.name,
                category,
                setting,
                scopedValues: scoped,
                effectiveValue: effective,
                isDefault: effective === undefined || effective === "",
            });
        }
    }
    return items;
}
